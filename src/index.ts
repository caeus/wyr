declare const message: unique symbol;
declare const ok: unique symbol;
declare const err: unique symbol;

export type TErr<T extends string> = string extends T
  ? never
  : { readonly [message]: T };
export type Ok<T> = { readonly [ok]: T };
export type Err<Msg extends string, Ctx extends object> = {
  readonly [err]: { readonly message: Msg; readonly ctx: Ctx };
};
export type Result = Ok<unknown> | Err<string, object>;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Components {}
export type ValidKey = keyof Components;
export type Key = PropertyKey;

export type Param<From extends Key = Key, A = unknown> = {
  readonly from: From;
  readonly a: A;
};
export type Provider<
  Provides = unknown,
  Requires extends readonly Param[] = readonly Param[],
> = {
  readonly provides: Provides;
  readonly requires: Requires;
};
export type AnyGraph = Partial<Record<Key, Provider>>;

export type Simplify<T> = { [K in keyof T]: T[K] } & {};

export type KeysTuple<Ks> = Ks extends readonly ValidKey[]
  ? number extends Ks['length']
    ? TErr<'Expected a tuple of bound symbols'>
    : Ks
  : TErr<'Expected a tuple of bound symbols'>;

export type KeysToTypes<Ks> = Ks extends readonly ValidKey[]
  ? {
      [I in keyof Ks]: Ks[I] extends ValidKey ? Components[Ks[I]] : never;
    }
  : TErr<'Expected a tuple of bound symbols'>[];

type ParamsFromKeys<Ks extends readonly ValidKey[]> = Ks extends readonly []
  ? readonly []
  : Ks extends readonly [
        infer Head extends ValidKey,
        ...infer Tail extends readonly ValidKey[],
      ]
    ? readonly [Param<Head, Components[Head]>, ...ParamsFromKeys<Tail>]
    : readonly Param[];

type BindingFor<
  K extends ValidKey,
  Deps extends readonly ValidKey[],
> = Provider<Components[K], ParamsFromKeys<Deps>>;

export type GraphLike<D> = {
  readonly [K in keyof D & ValidKey]: D[K] extends Provider
    ? D[K]
    : D[K] extends readonly ValidKey[]
      ? BindingFor<K, D[K]>
      : Provider<Components[K], readonly []>;
};

type WireableParam<G extends AnyGraph, P extends Param, Trace extends Key> =
  Wireable<G, P['from'], Trace> extends Ok<infer Got>
    ? Got extends P['a']
      ? Ok<Got>
      : Err<'type mismatch', { key: P['from']; expected: P['a']; got: Got }>
    : Err<
        'failed to resolve param',
        {
          from: P['from'];
          expected: P['a'];
          cause: Wireable<G, P['from'], Trace>;
        }
      >;

export type WireableParams<
  G extends AnyGraph,
  Ps extends readonly Param[],
  Trace extends Key,
> = Ps extends readonly []
  ? Ok<unknown>
  : Ps extends readonly [
        infer Head extends Param,
        ...infer Tail extends readonly Param[],
      ]
    ? WireableParam<G, Head, Trace> extends Ok<unknown>
      ? WireableParams<G, Tail, Trace>
      : WireableParam<G, Head, Trace>
    : Err<'unreachable', { params: Ps }>;

export type Wireable<
  G extends AnyGraph,
  K extends Key,
  Trace extends Key = never,
> = K extends Trace
  ? Err<'circular dependency', { key: K; trace: Trace }>
  : K extends keyof G
    ? G[K] extends Provider<
        infer Provides,
        infer Requires extends readonly Param[]
      >
      ? WireableParams<G, Requires, Trace | K> extends Ok<unknown>
        ? Ok<Provides>
        : WireableParams<G, Requires, Trace | K>
      : Err<'unreachable', { key: K }>
    : Err<'missing key', { key: K }>;

export type WireableTuple<
  G extends AnyGraph,
  Keys extends readonly Key[],
> = Keys extends readonly []
  ? Ok<readonly []>
  : Keys extends readonly [
        infer Head extends Key,
        ...infer Tail extends readonly Key[],
      ]
    ? Wireable<G, Head> extends Ok<infer Provides>
      ? WireableTuple<G, Tail> extends Ok<infer Rest extends readonly unknown[]>
        ? Ok<readonly [Provides, ...Rest]>
        : WireableTuple<G, Tail>
      : Wireable<G, Head>
    : Err<'unreachable', { keys: Keys }>;

type WireableRecordErrors<
  G extends AnyGraph,
  Map extends Record<string, Key>,
> = {
  [Name in keyof Map]: Wireable<G, Map[Name]> extends Ok<unknown>
    ? never
    : Wireable<G, Map[Name]>;
}[keyof Map];

export type WireableRecord<
  G extends AnyGraph,
  Map extends Record<string, Key>,
> = [WireableRecordErrors<G, Map>] extends [never]
  ? Ok<{
      readonly [Name in keyof Map]: Wireable<G, Map[Name]> extends Ok<infer P>
        ? P
        : never;
    }>
  : WireableRecordErrors<G, Map>;

export type Missing<
  Keys extends ValidKey,
  Graph extends AnyGraph,
> = WireableTuple<Graph, readonly [Keys]>;
export type LastOf<U> = U;

export type Resolvable<Key extends ValidKey, Graph extends AnyGraph> =
  Wireable<Graph, Key> extends Ok<unknown> ? Key : Wireable<Graph, Key>;

export type ResolvableTuple<
  Keys extends readonly ValidKey[],
  Graph extends AnyGraph,
> =
  WireableTuple<Graph, Keys> extends Ok<unknown>
    ? Keys
    : WireableTuple<Graph, Keys>;

export type ResolvedTuple<Keys extends readonly ValidKey[]> = {
  readonly [Index in keyof Keys]: Components[Keys[Index] & ValidKey];
};

export type ResolvableRecord<
  Map extends Record<string, ValidKey>,
  Graph extends AnyGraph,
> =
  WireableRecord<Graph, Map> extends Ok<unknown>
    ? Map
    : WireableRecord<Graph, Map>;

export type ResolvedRecord<Map extends Record<string, ValidKey>> = {
  readonly [Name in keyof Map]: Components[Map[Name] & ValidKey];
};

type UBinding = {
  readonly deps: readonly ValidKey[];
  readonly factory: (...args: unknown[]) => Promise<unknown>;
};
type UDepGraph = Partial<Record<PropertyKey, UBinding>>;
type UContainer = Partial<Record<PropertyKey, Promise<unknown>>>;

type NextGraph<
  Graph extends AnyGraph,
  K extends ValidKey,
  Deps extends readonly ValidKey[],
> = Simplify<Omit<Graph, K> & { readonly [_ in K]: BindingFor<K, Deps> }>;

type MergeGraph<Graph extends AnyGraph, Graph2 extends AnyGraph> = GraphLike<
  Simplify<{
    readonly [K in
      | Exclude<keyof Graph, keyof Graph2>
      | keyof Graph2]: K extends keyof Graph2
      ? Graph2[K]
      : K extends keyof Graph
        ? Graph[K]
        : never;
  }>
>;

const describeKey = (key: PropertyKey): string => {
  const value = key as unknown as PropertyKey;
  return typeof value === 'symbol'
    ? (value.description ?? value.toString())
    : String(value);
};

export class Binder<Key extends ValidKey, Graph extends AnyGraph> {
  constructor(
    private readonly key: Key,
    private readonly registry: UDepGraph,
  ) {}

  toFunction<const Deps extends readonly ValidKey[]>(
    deps: number extends Deps['length']
      ? TErr<'Expected a tuple of bound symbols'>
      : readonly [...Deps],
    impl: (
      ...args: KeysToTypes<Deps>
    ) => Promise<Components[Key]> | Awaited<Components[Key]>,
  ): Wyr<NextGraph<Graph, Key, Deps>> {
    const keyValue = this.key as unknown as PropertyKey;
    if (Object.prototype.hasOwnProperty.call(this.registry, keyValue)) {
      throw new Error(`Key ${describeKey(this.key)} is already bound`);
    }

    const depsList = [...(deps as readonly ValidKey[])];
    const binding: UBinding = {
      deps: depsList,
      factory: async (...args): Promise<unknown> =>
        impl(...(args as KeysToTypes<Deps>)),
    };
    const nextRegistry: UDepGraph = {
      ...this.registry,
      [keyValue]: binding,
    };

    return new InternalWyr(nextRegistry) as unknown as Wyr<
      NextGraph<Graph, Key, Deps>
    >;
  }

  toValue(value: Components[Key]): Wyr<NextGraph<Graph, Key, readonly []>> {
    return this.toFunction([], async (): Promise<Components[Key]> => value);
  }

  toClass<const Deps extends readonly ValidKey[]>(
    deps: number extends Deps['length']
      ? TErr<'Expected a tuple of bound symbols'>
      : readonly [...Deps],
    impl: new (...args: KeysToTypes<Deps>) => Components[Key],
  ): Wyr<NextGraph<Graph, Key, Deps>> {
    return this.toFunction(
      deps,
      async (...args: KeysToTypes<Deps>): Promise<Components[Key]> =>
        new impl(...args),
    );
  }
}

const makeContainer = (
  reg: UDepGraph,
  keys: readonly ValidKey[],
): UContainer => {
  const container: UContainer = {};

  const resolve = (
    key: ValidKey,
    trace: readonly ValidKey[],
  ): Promise<unknown> => {
    const index = key as unknown as PropertyKey;
    const cached = container[index];
    if (cached) {
      return cached;
    }

    const binding = reg[index];
    if (!binding) {
      throw new Error(`No binding registered for key ${describeKey(key)}`);
    }
    if (trace.includes(key)) {
      const cycle = [...trace, key].map(describeKey).join(' -> ');
      throw new Error(`Circular dependency detected: ${cycle}`);
    }

    const promise = Promise.all(
      binding.deps.map((dep) => resolve(dep, [...trace, key])),
    ).then((deps) => binding.factory(...deps));
    container[index] = promise;
    return promise;
  };

  keys.forEach((key) => resolve(key, []));
  return container;
};

class InternalWyr<Graph extends AnyGraph = Record<never, never>>
  implements Wyr<Graph>
{
  constructor(private readonly registry: UDepGraph = {}) {}

  bind<K extends ValidKey>(k: K): Binder<K, Graph> {
    return new Binder<K, Graph>(k, this.registry);
  }

  merge<const Graph2 extends AnyGraph>(
    other: Wyr<Graph2>,
  ): Wyr<MergeGraph<Graph, Graph2>> {
    return new InternalWyr({
      ...this.registry,
      ...(other as unknown as InternalWyr<Graph2>).registry,
    }) as unknown as Wyr<MergeGraph<Graph, Graph2>>;
  }

  async wire<const K extends ValidKey, Guard extends Wireable<Graph, K>>(
    key: Guard extends Ok<unknown> ? K : Guard,
  ): Promise<Guard extends Ok<infer Provides> ? Provides : unknown> {
    const wireKey = key as unknown as ValidKey;
    const container = makeContainer(this.registry, [wireKey]);
    const value = container[wireKey as unknown as PropertyKey];
    if (!value) {
      throw new Error(`Key ${describeKey(wireKey)} not wired`);
    }
    return (await value) as Guard extends Ok<infer Provides>
      ? Provides
      : unknown;
  }

  async wireTuple<
    const Keys extends readonly ValidKey[],
    Guard extends WireableTuple<Graph, Keys>,
  >(
    keys: Guard extends Ok<unknown> ? Keys : Guard,
  ): Promise<Guard extends Ok<infer Provides> ? Simplify<Provides> : unknown> {
    const tuple = keys as unknown as readonly ValidKey[];
    const container = makeContainer(this.registry, tuple);
    const promises = tuple.map((key, index) => {
      const value = container[key as unknown as PropertyKey];
      if (!value) {
        throw new Error(`Key at position ${index} is not wired`);
      }
      return value;
    });
    return Promise.all(promises) as Promise<
      Guard extends Ok<infer Provides> ? Simplify<Provides> : unknown
    >;
  }

  async wireRecord<
    const Map extends Record<string, ValidKey>,
    Guard extends WireableRecord<Graph, Map>,
  >(
    map: Guard extends Ok<unknown> ? Map : Guard,
  ): Promise<Guard extends Ok<infer Provides> ? Simplify<Provides> : unknown> {
    const record = map as unknown as Map;
    const container = makeContainer(
      this.registry,
      Object.values(record) as ValidKey[],
    );
    const entries = await Promise.all(
      Object.entries(record).map(async ([name, key]) => {
        const result =
          container[key as unknown as PropertyKey] ??
          Promise.reject(new Error(`Key ${String(name)} not wired`));
        return [name, await result] as const;
      }),
    );
    return Object.fromEntries(entries) as Guard extends Ok<infer Provides>
      ? Simplify<Provides>
      : unknown;
  }

  async snapshot<
    const Keys extends readonly ValidKey[],
    Guard extends WireableTuple<Graph, Keys>,
  >(
    ...keys: Guard extends Ok<unknown> ? Keys : [Guard]
  ): Promise<
    Wyr<{ readonly [K in Keys[number]]: BindingFor<K, readonly []> }>
  > {
    const tuple = keys as unknown as Keys;
    const resolved = await this.wireTuple(tuple as never);

    const registry: UDepGraph = {};
    tuple.forEach((key, index) => {
      registry[key as unknown as PropertyKey] = {
        deps: [],
        factory: async (): Promise<unknown> =>
          (resolved as readonly unknown[])[index],
      };
    });

    return new InternalWyr(registry) as unknown as Wyr<{
      readonly [K in Keys[number]]: BindingFor<K, readonly []>;
    }>;
  }
}

export interface Wyr<Graph extends AnyGraph = Record<never, never>> {
  bind<K extends ValidKey>(k: K): Binder<K, Graph>;
  merge<const Graph2 extends AnyGraph>(
    other: Wyr<Graph2>,
  ): Wyr<MergeGraph<Graph, Graph2>>;
  wire<const K extends ValidKey, Guard extends Wireable<Graph, K>>(
    key: Guard extends Ok<unknown> ? K : Guard,
  ): Promise<Guard extends Ok<infer Provides> ? Provides : unknown>;
  wireTuple<
    const Keys extends readonly ValidKey[],
    Guard extends WireableTuple<Graph, Keys>,
  >(
    keys: Guard extends Ok<unknown> ? Keys : Guard,
  ): Promise<Guard extends Ok<infer Provides> ? Simplify<Provides> : unknown>;
  wireRecord<
    const Map extends Record<string, ValidKey>,
    Guard extends WireableRecord<Graph, Map>,
  >(
    map: Guard extends Ok<unknown> ? Map : Guard,
  ): Promise<Guard extends Ok<infer Provides> ? Simplify<Provides> : unknown>;
  snapshot<
    const Keys extends readonly ValidKey[],
    Guard extends WireableTuple<Graph, Keys>,
  >(
    ...keys: Guard extends Ok<unknown> ? Keys : [Guard]
  ): Promise<Wyr<{ readonly [K in Keys[number]]: BindingFor<K, readonly []> }>>;
}

export const Wyr = (): Wyr<Record<never, never>> =>
  new InternalWyr({}) as unknown as Wyr<Record<never, never>>;
