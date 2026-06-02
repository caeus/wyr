type Empty = Record<never, never> & {};
type Simplify<T> = { [K in keyof T]: T[K] } & {};

// ─── Provider ────────────────────────────────────────────────────────────────

// A Provider encodes its dependency record (In) and what it produces (Out).
// Variance is explicit: In is contravariant (consumed), Out is covariant (produced).
// Backed by a factory function and a dep key set for runtime resolution.
class Provider<in In extends Empty, out Out> {
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
  P extends Provider<infer I, unknown> ? I : never; // never is good error here
type ProviderOut<P extends AnyProvider> =
  P extends Provider<never, infer O> ? O : unknown; // unknown is better than never

// ─── Graph ───────────────────────────────────────────────────────────────────

type AnyGraph = Record<PropertyKey, AnyProvider>;
type ProvidersToGraph<Providers extends Record<PropertyKey, AnyProvider>> =
  Simplify<{
    readonly [K in keyof Providers]: Providers[K];
  }>;

// ─── Builder helpers ─────────────────────────────────────────────────────────

// Zip a const key tuple with the param types of a function into a dep record.
// Duplicate keys collapse via intersection (intended).
type ZipKeysToParams<
  Keys extends readonly PropertyKey[],
  Params extends readonly unknown[],
> = Keys extends readonly []
  ? Empty
  : Keys extends readonly [
        infer K extends PropertyKey,
        ...infer KTail extends readonly PropertyKey[],
      ]
    ? Params extends readonly [
        infer P,
        ...infer PTail extends readonly unknown[],
      ]
      ? { readonly [_ in K]: P } & ZipKeysToParams<KTail, PTail>
      : Empty
    : Empty;

export const toValue = <const T>(value: T | Promise<T>): Provider<Empty, T> =>
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
type Err<Msg extends string, Ctx extends object = Empty> = {
  readonly [_err]: { readonly message: Msg; readonly ctx: Ctx };
};

// ─── Wireable ────────────────────────────────────────────────────────────────

// Pure mapper — delegates every check to WireableKey<..., Expected>.
// Produces a union of Ok | Err across all dep keys, then:
//   - if every member is Ok → collapse to Ok<unknown>
//   - otherwise → strip the Ok members and bubble the Err(s)
type WireableDeps<
  Graph extends AnyGraph,
  Deps extends Empty,
  Trace extends readonly PropertyKey[],
> = [keyof Deps] extends [never]
  ? Ok<unknown> // no deps — trivially satisfied
  : {
        [K in keyof Deps]: WireableKey<Graph, K & PropertyKey, Trace, Deps[K]>;
      }[keyof Deps] extends infer R
    ? [R] extends [Ok<unknown>]
      ? Ok<unknown> // all deps passed — every mapped key returned Ok
      : Exclude<R, Ok<unknown>> // some deps failed — strip Ok members, surface only the Errs
    : Err<'unreachable', object>; // infer always succeeds; this branch never fires

// DFS reachability check for a single key K.
// Expected: the type the caller requires from K's output — checked before recursing into deps.
// Trace is a tuple of keys visited so far — preserves insertion order for readable cycle errors.
// Returns Ok<Out> if fully resolvable, Err otherwise.
type WireableKey<
  Graph extends AnyGraph,
  K extends PropertyKey,
  Trace extends readonly PropertyKey[] = readonly [],
  Expected = unknown,
> = K extends Trace[number]
  ? Err<'circular dependency', { key: K; trace: Trace }> // K already in the call stack
  : K extends keyof Graph
    ? ProviderOut<Graph[K]> extends Expected
      ? WireableDeps<
          Graph,
          ProviderIn<Graph[K]>,
          readonly [...Trace, K]
        > extends infer Deps
        ? Deps extends Ok<unknown>
          ? Ok<ProviderOut<Graph[K]>> // all deps resolved, carry the provided type up
          : Deps extends Err<string, object>
            ? Deps // bubble dep errors
            : Err<'unreachable', object> // WireableDeps always returns Ok|Err; this branch never fires
        : Err<'unreachable', object> // infer always succeeds; this branch never fires
      : Err<
          'type mismatch',
          {
            key: K;
            expected: Expected;
            got: ProviderOut<Graph[K]>;
            trace: Trace;
          }
        >
    : Err<'missing key', { key: K; trace: Trace }>; // key not in graph at all

// ─── Wireable tuple + record helpers ─────────────────────────────────────────

// Walk a const tuple of keys left-to-right, accumulate Ok<[P1, P2, ...]>.
// Short-circuits on the first unwireable key.
type WireableTuple<
  Graph extends AnyGraph,
  Keys extends readonly PropertyKey[],
> = Keys extends readonly []
  ? Ok<readonly []> // base case: empty tuple
  : Keys extends readonly [
        infer K extends PropertyKey,
        ...infer Rest extends readonly PropertyKey[],
      ]
    ? WireableKey<Graph, K> extends Ok<infer P>
      ? WireableTuple<Graph, Rest> extends Ok<
          infer Tail extends readonly unknown[]
        >
        ? Ok<readonly [P, ...Tail]> // prepend resolved head onto tail
        : WireableTuple<Graph, Rest> // tail failed, bubble
      : WireableKey<Graph, K> // head failed, bubble
    : Err<'unreachable', { keys: Keys }>; // unreachable: Keys is always a known tuple

// For a record Map: string name → Key, collect any Err across all values.
// If none, Ok<{ name: Provides }>.
type WireableRecordErrors<
  Graph extends AnyGraph,
  Map extends Record<string, PropertyKey>,
> = {
  [Name in keyof Map]: WireableKey<Graph, Map[Name]> extends Ok<unknown>
    ? never
    : WireableKey<Graph, Map[Name]>;
}[keyof Map];

type WireableRecord<
  Graph extends AnyGraph,
  Map extends Record<string, PropertyKey>,
> = [WireableRecordErrors<Graph, Map>] extends [never]
  ? Ok<{
      readonly [Name in keyof Map]: WireableKey<Graph, Map[Name]> extends Ok<
        infer P
      >
        ? P
        : never;
    }>
  : Simplify<WireableRecordErrors<Graph, Map>>;

// ─── Container ───────────────────────────────────────────────────────────────

// Dispatches to the right Wireable check based on the shape of the input:
//   PropertyKey           → WireableKey   → Ok<Out>
//   readonly PropertyKey[]→ WireableTuple → Ok<[P1, P2, ...]>
//   Record<string, Key>   → WireableRecord→ Ok<{ name: P }>
type WireableInput<Graph extends AnyGraph, T> = T extends PropertyKey
  ? WireableKey<Graph, T & PropertyKey>
  : T extends readonly PropertyKey[]
    ? WireableTuple<Graph, T>
    : T extends Record<string, PropertyKey>
      ? WireableRecord<Graph, T>
      : Err<'invalid input', { got: T }>;

// Extracts the resolved value type from a successful WireableInput result.
type WireableOutput<Graph extends AnyGraph, T> =
  WireableInput<Graph, T> extends Ok<infer R> ? R : unknown;

// Builds a lean graph containing only the snapshotted keys, each replaced with a
// depless Provider carrying the resolved output type — all upstream deps are gone.
type SnapshotGraph<
  Graph extends AnyGraph,
  Keys extends readonly PropertyKey[],
> = {
  [K in Keys[number] & keyof Graph]: Provider<Empty, ProviderOut<Graph[K]>>;
};

interface Module<Graph extends AnyGraph> {
  // Single unified wire — dispatches on input shape.
  // Guard encodes the Wireable result; if Err it leaks into the input position, surfacing at the call site.
  wire<
    const T extends
      | PropertyKey
      | readonly PropertyKey[]
      | Record<string, PropertyKey>,
    Guard extends WireableInput<Graph, T>,
  >(
    input: Guard extends Ok<unknown> ? T : Guard,
  ): Promise<WireableOutput<Graph, T>>;
  override<NewGraph extends AnyGraph>(
    module: Module<NewGraph>,
  ): Module<Omit<Graph, keyof NewGraph> & NewGraph>;
  // Resolves the given keys (sharing one memoised container), then returns a new
  // Module containing only those keys as depless providers seeded with the values.
  snapshot<
    const Keys extends readonly (keyof Graph)[],
    Guard extends WireableTuple<Graph, Keys>,
  >(
    keys: Guard extends Ok<unknown> ? Keys : Guard,
  ): Promise<Module<SnapshotGraph<Graph, Keys>>>;
}

type URegistry = Record<PropertyKey, AnyProvider>;
type UContainer = Map<PropertyKey, Promise<unknown>>;

// Resolves a single key from the registry, memoising into container.
// Throws at runtime if a key is missing or a cycle is detected — the type
// system prevents both, so these are last-resort guards only.
const resolve = async (
  key: PropertyKey,
  registry: URegistry,
  container: UContainer,
  trace: readonly PropertyKey[],
): Promise<unknown> => {
  const cached = container.get(key);
  if (cached) return cached;

  const provider = registry[key];
  if (!provider)
    throw new Error(`No provider registered for key: ${String(key)}`);
  if (trace.includes(key)) {
    const cycle = [...trace, key].map(String).join(' → ');
    throw new Error(`Circular dependency detected: ${cycle}`);
  }

  const nextTrace = [...trace, key];
  // Build the deps record by resolving each dep declared on the provider.
  const promise = Promise.all(
    [...provider.deps].map(
      async (depKey) =>
        [
          depKey,
          await resolve(depKey, registry, container, nextTrace),
        ] as const,
    ),
  ).then((entries) => provider.call(Object.fromEntries(entries) as never));

  container.set(key, promise);
  return promise;
};

class InternalModule<Graph extends AnyGraph> implements Module<Graph> {
  readonly #registry: URegistry;

  constructor(registry: URegistry) {
    this.#registry = registry;
  }
  override<NewGraph extends AnyGraph>(
    module: Module<NewGraph>,
  ): Module<Omit<Graph, keyof NewGraph> & NewGraph> {
    const newRegistry = {
      ...this.#registry,
      ...(module as InternalModule<NewGraph>).#registry,
    };
    return new InternalModule(newRegistry) as unknown as Module<
      Omit<Graph, keyof NewGraph> & NewGraph
    >;
  }

  snapshot<
    const Keys extends readonly (keyof Graph)[],
    Guard extends WireableTuple<Graph, Keys>,
  >(
    keys: Guard extends Ok<unknown> ? Keys : Guard,
  ): Promise<Module<SnapshotGraph<Graph, Keys>>>;
  snapshot(keys: readonly PropertyKey[]): Promise<unknown> {
    const container: UContainer = new Map();
    const promise = Promise.all(
      keys.map(
        async (k) =>
          [k, await resolve(k, this.#registry, container, [])] as const,
      ),
    ).then((entries) => {
      const registry = Object.fromEntries(
        entries.map(([k, v]) => [k, toValue(v)]),
      );
      return new InternalModule(registry) as unknown as Module<AnyGraph>;
    });
    return promise;
  }

  wire<
    const T extends
      | PropertyKey
      | readonly PropertyKey[]
      | Record<string, PropertyKey>,
    Guard extends WireableInput<Graph, T>,
  >(
    input: Guard extends Ok<unknown> ? T : Guard,
  ): Promise<WireableOutput<Graph, T>>;
  wire(keyOrKeysOrMap: unknown): Promise<unknown> {
    // Each wire call gets its own container — deps resolved together share memoisation within the call.
    const container: UContainer = new Map();

    // Single key
    if (
      typeof keyOrKeysOrMap === 'string' ||
      typeof keyOrKeysOrMap === 'symbol' ||
      typeof keyOrKeysOrMap === 'number'
    ) {
      return resolve(keyOrKeysOrMap, this.#registry, container, []);
    }
    // Tuple of keys
    if (Array.isArray(keyOrKeysOrMap)) {
      return Promise.all(
        (keyOrKeysOrMap as PropertyKey[]).map((k) =>
          resolve(k, this.#registry, container, []),
        ),
      );
    }
    // Record of name → key
    const map = keyOrKeysOrMap as Record<string, PropertyKey>;
    return Promise.all(
      Object.entries(map).map(
        async ([name, key]) =>
          [name, await resolve(key, this.#registry, container, [])] as const,
      ),
    ).then(Object.fromEntries);
  }
}

export const Module = <
  const Providers extends Record<PropertyKey, AnyProvider>,
>(
  providers: Providers,
): Module<ProvidersToGraph<Providers>> =>
  new InternalModule(providers) as unknown as Module<
    ProvidersToGraph<Providers>
  >;

// ─── Playground ──────────────────────────────────────────────────────────────
