type Simplify<T> = { [K in keyof T]: T[K] } & {};

// ─── Provider ────────────────────────────────────────────────────────────────

export type TagDependency<Tag extends PropertyKey = PropertyKey> = Readonly<{
  tag: Tag;
}>;

export type Dependency = PropertyKey | TagDependency;

type TagCollection = readonly PropertyKey[] | ReadonlySet<PropertyKey>;
type TagsOf<Tags extends TagCollection> =
  Tags extends ReadonlySet<infer Tag extends PropertyKey>
    ? Tag
    : Tags extends readonly (infer Tag extends PropertyKey)[]
      ? Tag
      : never;

class Provider<
  in In extends {},
  out Out,
  out Tags extends PropertyKey,
  in TaggedIn extends {},
> {
  readonly deps: readonly Dependency[];
  readonly tags: ReadonlySet<Tags>;
  readonly #factory: (deps: In, tagged: TaggedIn) => Promise<Out>;

  constructor(
    deps: readonly Dependency[],
    tags: Iterable<PropertyKey>,
    factory: (deps: In, tagged: TaggedIn) => Promise<Out>,
  ) {
    this.deps = [...deps];
    this.tags = new Set(tags) as unknown as ReadonlySet<Tags>;
    this.#factory = factory;
  }

  call(deps: In, tagged: TaggedIn): Promise<Out> {
    return this.#factory(deps, tagged);
  }
}
type AnyProvider = Provider<never, unknown, PropertyKey, never>;
type ProviderIn<P extends AnyProvider> =
  P extends Provider<infer I, unknown, PropertyKey, never> ? I : never;
type ProviderOut<P extends AnyProvider> =
  P extends Provider<never, infer O, PropertyKey, never> ? O : unknown;
type ProviderTags<P extends AnyProvider> =
  P extends Provider<never, unknown, infer Tags, never> ? Tags : never;
type ProviderTaggedIn<P extends AnyProvider> =
  P extends Provider<never, unknown, PropertyKey, infer TaggedIn>
    ? TaggedIn
    : never;

// ─── Graph ───────────────────────────────────────────────────────────────────

export type AnyGraph = Record<PropertyKey, AnyProvider>;
type ProvidersToGraph<Providers extends Record<PropertyKey, AnyProvider>> =
  Simplify<{
    readonly [K in keyof Providers]: Providers[K];
  }>;
type MergeGraphs<G extends AnyGraph, N extends AnyGraph> = {
  [K in Exclude<keyof G, keyof N> | keyof N]: K extends keyof N
    ? N[K]
    : K extends keyof G
      ? G[K]
      : never;
};

// ─── Builder helpers ─────────────────────────────────────────────────────────

type ZipDependenciesToParams<
  Dependencies extends readonly Dependency[],
  Params extends readonly unknown[],
> = Dependencies extends readonly []
  ? {}
  : Dependencies extends readonly [
        infer Head,
        ...infer DependencyTail extends readonly Dependency[],
      ]
    ? Params extends readonly [
        infer P,
        ...infer PTail extends readonly unknown[],
      ]
      ? Head extends PropertyKey
        ? { readonly [_ in Head]: P } & ZipDependenciesToParams<
            DependencyTail,
            PTail
          >
        : ZipDependenciesToParams<DependencyTail, PTail>
      : {}
    : {};

type ZipTagsToParams<
  Dependencies extends readonly Dependency[],
  Params extends readonly unknown[],
> = Dependencies extends readonly []
  ? {}
  : Dependencies extends readonly [
        infer Head,
        ...infer DependencyTail extends readonly Dependency[],
      ]
    ? Params extends readonly [
        infer P,
        ...infer PTail extends readonly unknown[],
      ]
      ? Head extends TagDependency<infer Tag>
        ? { readonly [_ in Tag]: P } & ZipTagsToParams<DependencyTail, PTail>
        : ZipTagsToParams<DependencyTail, PTail>
      : {}
    : {};

const isTagDependency = (dependency: Dependency): dependency is TagDependency =>
  typeof dependency === 'object' && dependency !== null && 'tag' in dependency;

export const toValue = <
  const T,
  const Tags extends TagCollection = readonly [],
>(
  value: T | Promise<T>,
  tags: Tags = [] as unknown as Tags,
): Provider<{}, T, TagsOf<Tags>, {}> =>
  new Provider<{}, T, TagsOf<Tags>, {}>([], tags, async () => value);

export const toFactory = <
  const Dependencies extends readonly Dependency[],
  const Out,
  const Params extends { readonly [I in keyof Dependencies]: unknown },
  const Tags extends TagCollection = readonly [],
>(
  dependencies: Dependencies,
  fn: (...args: Params) => Promise<Out> | Out,
  tags: Tags = [] as unknown as Tags,
): Provider<
  Simplify<ZipDependenciesToParams<Dependencies, Params>>,
  Out,
  TagsOf<Tags>,
  Simplify<ZipTagsToParams<Dependencies, Params>>
> =>
  new Provider(dependencies, tags, async (deps, tagged) =>
    fn(
      ...(dependencies.map((dependency) =>
        isTagDependency(dependency)
          ? (tagged as Record<PropertyKey, unknown>)[dependency.tag]
          : (deps as Record<PropertyKey, unknown>)[dependency],
      ) as unknown as Params),
    ),
  ) as unknown as Provider<
    Simplify<ZipDependenciesToParams<Dependencies, Params>>,
    Out,
    TagsOf<Tags>,
    Simplify<ZipTagsToParams<Dependencies, Params>>
  >;

export const toClass = <
  const Dependencies extends readonly Dependency[],
  const Out,
  const Params extends { readonly [I in keyof Dependencies]: unknown },
  const Tags extends TagCollection = readonly [],
>(
  dependencies: Dependencies,
  ctor: new (...args: Params) => Out,
  tags: Tags = [] as unknown as Tags,
): Provider<
  Simplify<ZipDependenciesToParams<Dependencies, Params>>,
  Out,
  TagsOf<Tags>,
  Simplify<ZipTagsToParams<Dependencies, Params>>
> =>
  toFactory(dependencies, async (...args: Params) => new ctor(...args), tags);

// ─── Result ──────────────────────────────────────────────────────────────────

declare const _ok: unique symbol;
declare const _err: unique symbol;

export type Ok<T> = { readonly [_ok]: T };
export type Failed<E> = { readonly [_err]: E };

// ─── Graph errors ────────────────────────────────────────────────────────────

type DepsOf<
  Graph extends AnyGraph,
  K extends PropertyKey,
> = K extends keyof Graph ? keyof ProviderIn<Graph[K]> & PropertyKey : never;

export type TaggedKeys<Graph extends AnyGraph, Tag extends PropertyKey> = {
  [K in keyof Graph]: Tag extends ProviderTags<Graph[K]> ? K : never;
}[keyof Graph];

export type TaggedValues<
  Graph extends AnyGraph,
  Tag extends PropertyKey,
> = Simplify<{
  [K in TaggedKeys<Graph, Tag>]: ProviderOut<Graph[K]>;
}>;

type TaggedDepsOf<
  Graph extends AnyGraph,
  K extends PropertyKey,
> = K extends keyof Graph
  ? {
      [Tag in keyof ProviderTaggedIn<Graph[K]>]: Tag extends PropertyKey
        ? TaggedKeys<Graph, Tag>
        : never;
    }[keyof ProviderTaggedIn<Graph[K]>]
  : never;

type EdgesOf<Graph extends AnyGraph, K extends PropertyKey> =
  | DepsOf<Graph, K>
  | TaggedDepsOf<Graph, K>;

type Expects<
  Graph extends AnyGraph,
  K extends keyof Graph,
  D extends PropertyKey,
> = D extends keyof ProviderIn<Graph[K]> ? ProviderIn<Graph[K]>[D] : never;

// Every key the graph talks about — provided, or merely depended upon.
type MentionedKeys<Graph extends AnyGraph> =
  | keyof Graph
  | { [K in keyof Graph]: DepsOf<Graph, K> }[keyof Graph];

type RequiredBy<Graph extends AnyGraph, K extends PropertyKey> = {
  [P in keyof Graph]: K extends DepsOf<Graph, P> ? P : never;
}[keyof Graph];

// Deps of K whose provider resolves to something K cannot accept.
type MismatchedDeps<Graph extends AnyGraph, K extends keyof Graph> = {
  [D in DepsOf<Graph, K> as D extends keyof Graph
    ? ProviderOut<Graph[D]> extends Expects<Graph, K, D>
      ? never
      : D
    : never]: {
    expected: Expects<Graph, K, D>;
    got: D extends keyof Graph ? ProviderOut<Graph[D]> : never;
  };
};

type MismatchedTags<Graph extends AnyGraph, K extends keyof Graph> = {
  [Tag in keyof ProviderTaggedIn<Graph[K]> as Tag extends PropertyKey
    ? TaggedValues<Graph, Tag> extends ProviderTaggedIn<Graph[K]>[Tag]
      ? never
      : Tag
    : never]: {
    expected: ProviderTaggedIn<Graph[K]>[Tag];
    got: Tag extends PropertyKey ? TaggedValues<Graph, Tag> : never;
  };
};

// Walks from Origin looking for a path back to it; the path is the cycle.
type CycleFrom<
  Graph extends AnyGraph,
  Origin extends PropertyKey,
  K extends PropertyKey,
  Seen extends readonly PropertyKey[],
> = {
  [D in EdgesOf<Graph, K>]: D extends Origin
    ? readonly [...Seen, K, Origin]
    : D extends Seen[number] | K
      ? never
      : CycleFrom<Graph, Origin, D, readonly [...Seen, K]>;
}[EdgesOf<Graph, K>];

type UnprovidedErr<
  Graph extends AnyGraph,
  K extends PropertyKey,
> = K extends keyof Graph
  ? {}
  : { unprovided: { requiredBy: RequiredBy<Graph, K> } };

type MismatchedErr<
  Graph extends AnyGraph,
  K extends PropertyKey,
> = K extends keyof Graph
  ? [keyof MismatchedDeps<Graph, K>] extends [never]
    ? {}
    : { mismatched: Simplify<MismatchedDeps<Graph, K>> }
  : {};

type TaggedMismatchedErr<
  Graph extends AnyGraph,
  K extends PropertyKey,
> = K extends keyof Graph
  ? [keyof MismatchedTags<Graph, K>] extends [never]
    ? {}
    : { taggedMismatched: Simplify<MismatchedTags<Graph, K>> }
  : {};

type CircularErr<Graph extends AnyGraph, K extends PropertyKey> = [
  CycleFrom<Graph, K, K, readonly []>,
] extends [never]
  ? {}
  : { circular: CycleFrom<Graph, K, K, readonly []> };

// Problems belonging to K itself, needing no recursion into dependents.
type OwnErr<Graph extends AnyGraph, K extends PropertyKey> = UnprovidedErr<
  Graph,
  K
> &
  MismatchedErr<Graph, K> &
  TaggedMismatchedErr<Graph, K> &
  CircularErr<Graph, K>;

type HasErr<
  Graph extends AnyGraph,
  K extends PropertyKey,
  Seen extends readonly PropertyKey[],
> = [keyof OwnErr<Graph, K>] extends [never]
  ? true extends {
      [D in EdgesOf<Graph, K>]: D extends Seen[number]
        ? false
        : HasErr<Graph, D, readonly [...Seen, K]>;
    }[EdgesOf<Graph, K>]
    ? true
    : false
  : true;

type Unmet<Graph extends AnyGraph, K extends PropertyKey> = [
  FailedDeps<Graph, K>,
] extends [never]
  ? {}
  : { unmet: FailedDeps<Graph, K> };

// [T] extends [never] first: inferring from a bare `never` succeeds vacuously
// with M as unknown, which would exempt every dep from `unmet`.
type Members<T> = [T] extends [never]
  ? never
  : T extends readonly (infer M)[]
    ? M
    : never;

type CycleMembers<Graph extends AnyGraph, K extends PropertyKey> = Members<
  CycleFrom<Graph, K, K, readonly []>
>;

// A cycle member's partners are already explained by `circular`; reporting them
// as unmet too would double every cycle entry.
type FailedDeps<Graph extends AnyGraph, K extends PropertyKey> = {
  [D in EdgesOf<Graph, K>]: D extends CycleMembers<Graph, K>
    ? never
    : HasErr<Graph, D, readonly [K]> extends true
      ? D
      : never;
}[EdgesOf<Graph, K>];

type KeyErr<Graph extends AnyGraph, K extends PropertyKey> = Simplify<
  OwnErr<Graph, K> & Unmet<Graph, K>
>;

export type GraphErr<Graph extends AnyGraph> = Simplify<{
  [K in MentionedKeys<Graph> as [keyof KeyErr<Graph, K>] extends [never]
    ? never
    : K]: KeyErr<Graph, K>;
}>;

// ─── TransitiveKeys / ShakenGraph ────────────────────────────────────────────

export type TransitiveKeys<
  Graph extends AnyGraph,
  K extends keyof Graph,
> = K extends keyof Graph
  ?
      | K
      | (EdgesOf<Graph, K> extends infer D
          ? D extends keyof Graph
            ? TransitiveKeys<Graph, D>
            : never
          : never)
  : never;

export type ShakenGraph<
  Graph extends AnyGraph,
  Keys extends readonly (keyof Graph)[],
> = { [K in TransitiveKeys<Graph, Keys[number]>]: Graph[K] };

// ─── Container ───────────────────────────────────────────────────────────────

export interface Container<M extends {}> {
  get<K extends keyof M>(key: K): M[K];
}

export type Resolved<Graph extends AnyGraph> = {
  [K in keyof Graph]: ProviderOut<Graph[K]>;
} & {};

// ─── Compilation ─────────────────────────────────────────────────────────────

export declare const compilation: unique symbol;

export type Compilation<Graph extends AnyGraph> = [
  keyof GraphErr<Graph>,
] extends [never]
  ? Ok<Resolved<Graph>>
  : Failed<GraphErr<Graph>>;

// ─── Module ───────────────────────────────────────────────────────────────────

export interface Module<Graph extends AnyGraph> {
  readonly [compilation]?: Compilation<Graph>;
  merge<NewGraph extends AnyGraph>(
    module: Module<NewGraph>,
  ): Module<MergeGraphs<Graph, NewGraph>>;

  shake<const Keys extends readonly (keyof Graph)[]>(
    keys: Keys,
  ): Module<ShakenGraph<Graph, Keys>>;

  compile(
    this: Module<Graph> & { readonly [compilation]?: Ok<unknown> },
  ): Promise<Container<Resolved<Graph>>>;
}

export interface ValidModule<Exports extends {} = {}> {
  readonly [compilation]?: Ok<Exports>;
  compile(): Promise<Container<Exports>>;
}

type URegistry = Record<PropertyKey, AnyProvider>;
type UCache = Map<PropertyKey, Promise<unknown>>;

const registryKeys = (registry: URegistry): PropertyKey[] =>
  (Object.keys(registry) as PropertyKey[]).concat(
    Object.getOwnPropertySymbols(registry),
  );

const taggedKeys = (registry: URegistry, tag: PropertyKey): PropertyKey[] =>
  registryKeys(registry).filter((key) => registry[key]?.tags.has(tag));

const resolve = async (
  key: PropertyKey,
  registry: URegistry,
  cache: UCache,
  trace: readonly PropertyKey[],
): Promise<unknown> => {
  const cached = cache.get(key);
  if (cached) return cached;

  const provider = registry[key];
  if (!provider)
    throw new Error(`No provider registered for key: ${String(key)}`);
  if (trace.includes(key)) {
    const cycle = [...trace, key].map(String).join(' → ');
    throw new Error(`Circular dependency detected: ${cycle}`);
  }

  const nextTrace = [...trace, key];
  const directKeys = [
    ...new Set(
      provider.deps.filter(
        (dependency): dependency is PropertyKey => !isTagDependency(dependency),
      ),
    ),
  ];
  const tags = [
    ...new Set(
      provider.deps.filter(isTagDependency).map((dependency) => dependency.tag),
    ),
  ];
  const promise = Promise.all([
    Promise.all(
      directKeys.map(
        async (depKey) =>
          [depKey, await resolve(depKey, registry, cache, nextTrace)] as const,
      ),
    ),
    Promise.all(
      tags.map(async (tag) => {
        const entries = await Promise.all(
          taggedKeys(registry, tag).map(
            async (depKey) =>
              [
                depKey,
                await resolve(depKey, registry, cache, nextTrace),
              ] as const,
          ),
        );
        return [tag, Object.fromEntries(entries)] as const;
      }),
    ),
  ]).then(([deps, tagged]) =>
    provider.call(
      Object.fromEntries(deps) as never,
      Object.fromEntries(tagged) as never,
    ),
  );

  cache.set(key, promise);
  return promise;
};

class InternalContainer<M extends Record<PropertyKey, unknown>>
  implements Container<M>
{
  readonly #values: Record<PropertyKey, unknown>;

  constructor(values: Record<PropertyKey, unknown>) {
    this.#values = values;
  }

  get<K extends keyof M>(key: K): M[K] {
    if (!((key as PropertyKey) in this.#values))
      throw new Error(`Key not in container: ${String(key)}`);
    return this.#values[key as PropertyKey] as M[K];
  }
}

class InternalModule<Graph extends AnyGraph> implements Module<Graph> {
  declare readonly [compilation]?: Compilation<Graph>;
  readonly #registry: URegistry;

  constructor(registry: URegistry) {
    this.#registry = registry;
  }

  merge<NewGraph extends AnyGraph>(
    module: Module<NewGraph>,
  ): Module<MergeGraphs<Graph, NewGraph>> {
    const newRegistry = {
      ...this.#registry,
      ...(module as unknown as InternalModule<NewGraph>).#registry,
    };
    return new InternalModule(newRegistry) as unknown as Module<
      MergeGraphs<Graph, NewGraph>
    >;
  }

  shake<const Keys extends readonly (keyof Graph)[]>(
    keys: Keys,
  ): Module<ShakenGraph<Graph, Keys>> {
    const visited = new Set<PropertyKey>();
    const visit = (key: PropertyKey): void => {
      if (visited.has(key)) return;
      visited.add(key);
      const provider = this.#registry[key];
      if (provider) {
        for (const dependency of provider.deps) {
          if (isTagDependency(dependency)) {
            for (const tagged of taggedKeys(this.#registry, dependency.tag))
              visit(tagged);
          } else {
            visit(dependency);
          }
        }
      }
    };
    for (const k of keys) visit(k as PropertyKey);
    const shaken: URegistry = {};
    for (const k of visited) shaken[k] = this.#registry[k]!;
    return new InternalModule(shaken) as unknown as Module<
      ShakenGraph<Graph, Keys>
    >;
  }

  compile(): Promise<Container<{ [K in keyof Graph]: ProviderOut<Graph[K]> }>>;
  async compile(): Promise<Container<Record<PropertyKey, unknown>>> {
    const targets = registryKeys(this.#registry);
    const cache: UCache = new Map();
    await Promise.all(
      targets.map((k) => resolve(k, this.#registry, cache, [])),
    );
    const entries = await Promise.all(
      [...cache.keys()].map(async (k) => [k, await cache.get(k)!] as const),
    );
    return new InternalContainer(Object.fromEntries(entries));
  }
}

export const Module = <
  const Providers extends Record<PropertyKey, AnyProvider>,
>(
  providers: Providers,
): Module<ProvidersToGraph<Providers>> => new InternalModule(providers);
