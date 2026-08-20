type Simplify<T> = { [K in keyof T]: T[K] } & {};

// ─── Provider ────────────────────────────────────────────────────────────────

class Provider<in In extends {}, out Out> {
  readonly deps: ReadonlySet<keyof In>;
  readonly #factory: (deps: In) => Promise<Out>;

  constructor(
    deps: ReadonlySet<keyof In>,
    factory: (deps: In) => Promise<Out>,
  ) {
    this.deps = deps;
    this.#factory = factory;
  }

  call(deps: In): Promise<Out> {
    return this.#factory(deps);
  }
}
type AnyProvider = Provider<never, unknown>;
type ProviderIn<P extends AnyProvider> =
  P extends Provider<infer I, unknown> ? I : never;
type ProviderOut<P extends AnyProvider> =
  P extends Provider<never, infer O> ? O : unknown;

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

type ZipKeysToParams<
  Keys extends readonly PropertyKey[],
  Params extends readonly unknown[],
> = Keys extends readonly []
  ? {}
  : Keys extends readonly [
        infer K extends PropertyKey,
        ...infer KTail extends readonly PropertyKey[],
      ]
    ? Params extends readonly [
        infer P,
        ...infer PTail extends readonly unknown[],
      ]
      ? { readonly [_ in K]: P } & ZipKeysToParams<KTail, PTail>
      : {}
    : {};

export const toValue = <const T>(value: T | Promise<T>): Provider<{}, T> =>
  new Provider(new Set(), async () => value);

export const toFactory = <
  const Keys extends readonly PropertyKey[],
  const Out,
  const Params extends { readonly [I in keyof Keys]: unknown },
>(
  keys: Keys,
  fn: (...args: Params) => Promise<Out> | Out,
): Provider<Simplify<ZipKeysToParams<Keys, Params>>, Out> =>
  new Provider(
    new Set(keys) as unknown as ReadonlySet<
      keyof Simplify<ZipKeysToParams<Keys, Params>>
    >,
    async (deps) =>
      fn(
        ...(keys.map(
          (k) => (deps as Record<PropertyKey, unknown>)[k],
        ) as unknown as Params),
      ),
  ) as unknown as Provider<Simplify<ZipKeysToParams<Keys, Params>>, Out>;

export const toClass = <
  const Keys extends readonly PropertyKey[],
  const Out,
  const Params extends { readonly [I in keyof Keys]: unknown },
>(
  keys: Keys,
  ctor: new (...args: Params) => Out,
): Provider<Simplify<ZipKeysToParams<Keys, Params>>, Out> =>
  toFactory(keys, async (...args: Params) => new ctor(...args));

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

// Walks from Origin looking for a path back to it; the path is the cycle.
type CycleFrom<
  Graph extends AnyGraph,
  Origin extends PropertyKey,
  K extends PropertyKey,
  Seen extends readonly PropertyKey[],
> = {
  [D in DepsOf<Graph, K>]: D extends Origin
    ? readonly [...Seen, K, Origin]
    : D extends Seen[number] | K
      ? never
      : CycleFrom<Graph, Origin, D, readonly [...Seen, K]>;
}[DepsOf<Graph, K>];

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
  CircularErr<Graph, K>;

type HasErr<
  Graph extends AnyGraph,
  K extends PropertyKey,
  Seen extends readonly PropertyKey[],
> = [keyof OwnErr<Graph, K>] extends [never]
  ? true extends {
      [D in DepsOf<Graph, K>]: D extends Seen[number]
        ? false
        : HasErr<Graph, D, readonly [...Seen, K]>;
    }[DepsOf<Graph, K>]
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
  [D in DepsOf<Graph, K>]: D extends CycleMembers<Graph, K>
    ? never
    : HasErr<Graph, D, readonly [K]> extends true
      ? D
      : never;
}[DepsOf<Graph, K>];

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
      | (keyof ProviderIn<Graph[K]> extends infer D
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
  const promise = Promise.all(
    [...provider.deps].map(
      async (depKey) =>
        [depKey, await resolve(depKey, registry, cache, nextTrace)] as const,
    ),
  ).then((entries) => provider.call(Object.fromEntries(entries) as never));

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
        for (const dep of provider.deps) visit(dep);
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
    const targets = (Object.keys(this.#registry) as PropertyKey[]).concat(
      Object.getOwnPropertySymbols(this.#registry),
    );
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
