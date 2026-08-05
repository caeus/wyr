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

type Ok<T> = { readonly [_ok]: T };
type Err<Msg extends string, Ctx extends {} = {}> = {
  readonly [_err]: { readonly message: Msg; readonly ctx: Ctx };
};

// ─── Wireable ────────────────────────────────────────────────────────────────

type WireableDeps<
  Graph extends AnyGraph,
  Deps extends {},
  Trace extends readonly PropertyKey[],
> = [keyof Deps] extends [never]
  ? Ok<unknown>
  : {
        [K in keyof Deps]: WireableKey<Graph, K & PropertyKey, Trace, Deps[K]>;
      }[keyof Deps] extends infer R
    ? [R] extends [Ok<unknown>]
      ? Ok<unknown>
      : Exclude<R, Ok<unknown>>
    : Err<'unreachable', object>;

type WireableKey<
  Graph extends AnyGraph,
  K extends PropertyKey,
  Trace extends readonly PropertyKey[] = readonly [],
  Expected = unknown,
> = K extends Trace[number]
  ? Err<'circular dependency', { key: K; trace: Trace }>
  : K extends keyof Graph
    ? ProviderOut<Graph[K]> extends Expected
      ? WireableDeps<
          Graph,
          ProviderIn<Graph[K]>,
          readonly [...Trace, K]
        > extends infer Deps
        ? Deps extends Ok<unknown>
          ? Ok<ProviderOut<Graph[K]>>
          : Deps extends Err<string, object>
            ? Deps
            : Err<'unreachable', object>
        : Err<'unreachable', object>
      : Err<
          'type mismatch',
          {
            key: K;
            expected: Expected;
            got: ProviderOut<Graph[K]>;
            trace: Trace;
          }
        >
    : Err<'missing key', { key: K; trace: Trace }>;

type UnwrapErr<E> =
  E extends Err<infer Msg extends string, infer Ctx extends object>
    ? { message: Msg; ctx: Ctx }
    : never;

export type GraphErr<Graph extends AnyGraph> = Simplify<{
  [K in keyof Graph as WireableKey<Graph, K & PropertyKey> extends Ok<unknown>
    ? never
    : K]: UnwrapErr<WireableKey<Graph, K & PropertyKey>>;
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

// ─── Module ───────────────────────────────────────────────────────────────────

export interface Module<Graph extends AnyGraph> {
  readonly validity?: {};
  merge<NewGraph extends AnyGraph>(
    module: Module<NewGraph>,
  ): Module<MergeGraphs<Graph, NewGraph>>;

  shake<const Keys extends readonly (keyof Graph)[]>(
    keys: Keys,
  ): Module<ShakenGraph<Graph, Keys>>;

  compile(
    this: ValidModule<Graph>,
  ): Promise<Container<{ [K in keyof Graph]: ProviderOut<Graph[K]> }>>;
}

interface ValidModule<Graph extends AnyGraph> extends Module<Graph> {
  readonly validity?: GraphErr<Graph>;
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
  declare readonly validity?: {};
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
