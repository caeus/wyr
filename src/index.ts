declare const message: unique symbol;
declare const data: unique symbol;
declare const ok: unique symbol;
export type TErr<T extends string> = string extends T
  ? never
  : { [ok]: false; [data]: { [message]: T } };
type TEither<T> = { [ok]: false; [data]: unknown } | { [ok]: true; [data]: T };

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Components {}
export type ValidKey = keyof Components;

// a typed tuple of SymbolKey (known size at compile time)

export type KeysTuple<Ks> = Ks extends readonly ValidKey[]
  ? number extends Ks['length']
    ? TErr<'Expected a tuple of bound symbols'>
    : Ks
  : TErr<'Expected a tuple of bound symbols'>;

export type DepGraph<D> = {
  [K in keyof D & ValidKey]: D[K];
};

export type Simplify<T> = { [K in keyof T]: T[K] } & {};
export type KeysToTypes<Ks> = Ks extends readonly ValidKey[]
  ? {
      [I in keyof Ks]: Ks[I] extends ValidKey ? Components[Ks[I]] : never;
    }
  : TErr<'Expected a tuple of bound symbols'>[];

// Walks the graph for a symbol and returns any missing bindings (direct or transitive).

type UnionToIntersection<U> = (
  U extends unknown ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;
export type LastOf<U> =
  UnionToIntersection<U extends unknown ? (k: U) => void : never> extends (
    k: infer L,
  ) => void
    ? L
    : never;

// Accumulate every key from `Keys` that is absent from `Graph` or from its transitive deps.
/*
const Missing = (keys, graph, result = empty(), seen = empty()) => {
  if (isEmpty(keys)) result;
  else if (isError(result)) result;
  else {
    const picked = pickKey(keys ∩ ValidKey);
    if (!picked) error({ message: "Shouldn't happen", marker });
    else if (picked in seen) error({ message: "Cyclical dependency", key: picked, marker });
    else {
      const nextSeen = add(seen, picked);
      if (hasKey(graph, picked)) {
        const nextResult = picked in result
          ? result
          : Missing(graph[picked], graph, result, nextSeen);
        Missing(remove(keys, picked), graph, nextResult, nextSeen);
      } else {
        const nextResult = add(result, picked);
        Missing(remove(keys, picked), graph, nextResult, nextSeen);
      }
    }
  }
};
*/
type MissingResult = TEither<ValidKey>;

export type Missing<
  Keys extends ValidKey,
  Graph extends DepGraph<Graph>,
  Result extends MissingResult = {
    [ok]: true;
    [data]: never;
  },
  Seen extends ValidKey = never,
> = [Keys] extends [never]
  ? Result // Branch A (condition: `Keys` is empty) → nothing else to inspect, return the accumulator
  : Result[typeof ok] extends false
    ? Result
    : LastOf<Keys & ValidKey> extends infer Picked extends ValidKey
      ? Picked extends Seen
        ? {
            [ok]: false;
            [data]: {
              [message]: `Cyclical dependency`;
              involving: { [P in Picked]: Components[P] };
            };
          } // Branch B1 (condition: `Picked` already tracked in `Seen`) → cycle detected
        : Missing<
            Exclude<Keys, Picked>,
            Graph,
            (Picked extends keyof Graph & ValidKey
              ? Picked extends Result[typeof data] & ValidKey
                ? Result // Branch B2a (condition: `Picked` already in `Result`) → skip, already known missing
                : Missing<Graph[Picked], Graph, Result, Seen | Picked>
              : { [ok]: true; [data]: Result[typeof data] | Picked }) &
              MissingResult,
            Seen | Picked
          > // Branch B2b (condition: `Picked` exists in `Graph`) → recurse into its declared deps
      : {
          [ok]: false;
          [data]: { [message]: `Shouldn't happen` };
        }; // Branch B fallback → `LastOf` failed to pick a key

type MissingError<
  Message extends string,
  Context,
  MissingKey extends ValidKey,
> = Simplify<
  {
    [message]: Message;
  } & Context & {
      missing: { [K in MissingKey]: Components[K] };
    }
>;

type MissingUnexpected<Context> = {
  [message]: `Shouldn't ever happen`;
} & Context & {};

type MissingEval<
  Result extends MissingResult,
  Success,
  Message extends string,
  Context,
> = Simplify<
  (
    [Result] extends [{ [ok]: true; [data]: infer ResultData }]
      ? [ResultData] extends [never]
        ? Success
        : [ResultData] extends [infer Errs & ValidKey]
          ? MissingError<Message, Context, Errs & ValidKey>
          : MissingUnexpected<Context>
      : MissingUnexpected<Result & { hola: 5 }>
  ) extends infer R
    ? R extends Success
      ? Success
      : R
    : MissingUnexpected<Context>
>;

export type Resolvable<
  Key extends ValidKey,
  Graph extends DepGraph<Graph>,
> = MissingEval<
  Missing<Key, Graph>,
  Key,
  `Unresolvable key`,
  { key: Key; value: Components[Key] }
>;

export type ResolvableTuple<Keys extends readonly ValidKey[], Graph> =
  MissingEval<
    Missing<Keys[number], DepGraph<Graph>>,
    Keys,
    `Unresolvable tuple`,
    { keys: Keys }
  > extends infer R
    ? Keys extends R
      ? Keys
      : R
    : MissingUnexpected<{ keys: Keys }>;

export type ResolvedTuple<Keys extends readonly ValidKey[]> = {
  [Index in keyof Keys]: Components[Keys[Index] & ValidKey];
};

export type ResolvableRecord<Map extends Record<string, ValidKey>, Graph> =
  MissingEval<
    Missing<Map[keyof Map], DepGraph<Graph>>,
    Map,
    `Unresolvable record`,
    { map: Map }
  > extends infer R
    ? R extends Map
      ? Map
      : R
    : MissingUnexpected<{ map: Map }>;

export type ResolvedRecord<Map extends Record<string, ValidKey>> = {
  [Name in keyof Map]: Components[Map[Name] & ValidKey];
};

type UBinding = {
  deps: readonly ValidKey[];
  factory: (...args: unknown[]) => Promise<unknown>;
};
type UDepGraph = Partial<Record<PropertyKey, UBinding>>;

export class Binder<
  Key extends keyof Components,
  Graph extends DepGraph<Graph>,
> {
  constructor(
    private readonly key: Key,
    private readonly registry: UDepGraph,
  ) {}

  toFunction<const Deps>(
    deps: KeysTuple<Deps>,
    impl: (
      ...args: KeysToTypes<Deps>
    ) => Promise<Components[Key]> | Awaited<Components[Key]>,
  ): Wyr<
    Simplify<
      Omit<Graph, Key> & {
        [_ in Key]: { [t in keyof Deps & number]: Deps[t] }[keyof Deps &
          number];
      }
    >
  > {
    const keyValue = this.key as unknown as PropertyKey;
    if (Object.prototype.hasOwnProperty.call(this.registry, keyValue)) {
      const label =
        typeof keyValue === 'symbol'
          ? (keyValue.description ?? keyValue.toString())
          : String(keyValue);
      throw new Error(`Key ${label} is already bound`);
    }
    const depsList = [...(deps as readonly ValidKey[])];
    const binding: UBinding = {
      deps: depsList,
      factory: async (...args) => impl(...(args as KeysToTypes<Deps>)),
    };
    const nextRegistry: UDepGraph = {
      ...this.registry,
      [keyValue]: binding,
    };
    return new InternalWyr<Record<never, never>>(nextRegistry) as Wyr<
      Simplify<
        Omit<Graph, Key> & {
          [_ in Key]: { [t in keyof Deps & number]: Deps[t] }[keyof Deps &
            number];
        }
      >
    >;
  }

  toValue(
    value: Components[Key],
  ): Wyr<Simplify<Omit<Graph, Key> & { [_ in Key]: never }>> {
    return this.toFunction([], async () => value);
  }

  toClass<const Deps>(
    deps: KeysTuple<Deps>,
    impl: new (...args: KeysToTypes<Deps>) => Components[Key],
  ): Wyr<
    Simplify<
      Omit<Graph, Key> & {
        [_ in Key]: { [t in keyof Deps & number]: Deps[t] }[keyof Deps &
          number];
      }
    >
  > {
    return this.toFunction(
      deps,
      async (...args: KeysToTypes<Deps>) => new impl(...args),
    );
  }
}
type UContainer = Partial<Record<PropertyKey, Promise<unknown>>>;

const wire = (reg: UDepGraph, keys: readonly ValidKey[]): UContainer => {
  const container: UContainer = {};
  const describe = (key: ValidKey): string => {
    const value = key as unknown as PropertyKey;
    return typeof value === 'symbol'
      ? (value.description ?? value.toString())
      : String(value);
  };

  const resolve = (
    key: ValidKey,
    trace: readonly ValidKey[],
  ): Promise<unknown> => {
    const index = key as unknown as PropertyKey;
    const cached = container[index];
    if (cached) {
      return cached;
    }
    const binding = reg[key as unknown as PropertyKey];
    if (!binding) {
      throw new Error(`No binding registered for key ${describe(key)}`);
    }
    if (trace.includes(key)) {
      const cycle = ([...trace, key] as const).map(describe).join(' -> ');
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

class InternalWyr<
  Graph extends DepGraph<Graph> = Simplify<Record<never, never>>,
> implements Wyr<Graph>
{
  constructor(private readonly registry: UDepGraph = {}) {}
  missing<const K extends ValidKey>(): Set<Missing<K, Graph> & ValidKey> {
    throw new Error('missing() is a compile-time helper only');
  }

  bind<K extends keyof Components>(k: K): Binder<K, Graph> {
    return new Binder<K, Graph>(k, this.registry);
  }

  merge<const D2 extends DepGraph<D2>>(
    other: Wyr<D2>,
  ): Wyr<Simplify<Omit<Graph, keyof D2> & D2>> {
    return new InternalWyr({
      ...this.registry,
      ...(other as InternalWyr<D2>).registry,
    }) as Wyr<Simplify<Omit<Graph, keyof D2> & D2>>;
  }

  async wireTuple<
    const Keys extends readonly ValidKey[],
    Guard extends ResolvableTuple<Keys, Graph>,
  >(
    keys: Guard extends Keys ? Keys : Guard,
  ): Promise<Simplify<ResolvedTuple<Keys>>> {
    const tuple = keys as unknown as readonly ValidKey[];
    const container = wire(this.registry, tuple);
    const promises = tuple.map((key, index) => {
      const value = container[key as unknown as PropertyKey];
      if (!value) {
        throw new Error(`Key at position ${index} is not wired`);
      }
      return value;
    });
    return Promise.all(promises) as unknown as Promise<ResolvedTuple<Keys>>;
  }
  async wireRecord<
    const Map extends Record<string, ValidKey>,
    Guard extends ResolvableRecord<Map, Graph>,
  >(
    keys: Guard extends Map ? Map : Guard,
  ): Promise<Simplify<ResolvedRecord<Map>>> {
    const record = keys as Map;
    const container = wire(this.registry, Object.values(record) as ValidKey[]);
    const entries = await Promise.all(
      Object.entries(record).map(async ([name, key]) => {
        const result =
          container[key as unknown as PropertyKey] ??
          Promise.reject(new Error(`Key ${String(name)} not wired`));
        return [name, await result] as const;
      }),
    );
    return Object.fromEntries(entries) as unknown as ResolvedRecord<Map>;
  }
  async wire<const Key extends ValidKey, Guard extends Resolvable<Key, Graph>>(
    k: Guard extends Key ? Key : Guard,
  ): Promise<Components[Key]> {
    const container = wire(this.registry, [k as unknown as ValidKey]);
    const value = container[k as unknown as PropertyKey];
    if (!value) {
      throw new Error(`Key ${String(k)} not wired`);
    }
    return (await value) as Components[Key];
  }
}

export interface Wyr<
  Graph extends DepGraph<Graph> = Simplify<Record<never, never>>,
> {
  bind<K extends keyof Components>(k: K): Binder<K, Graph>;
  merge<const D2 extends DepGraph<D2>>(
    other: Wyr<D2>,
  ): Wyr<Simplify<Omit<Graph, keyof D2> & D2>>;
  wireTuple<
    const Keys extends readonly ValidKey[],
    Guard extends ResolvableTuple<Keys, Graph>,
  >(
    keys: Guard extends Keys ? Keys : Guard,
  ): Promise<Simplify<ResolvedTuple<Keys>>>;
  wireRecord<
    const Map extends Record<string, ValidKey>,
    Guard extends ResolvableRecord<Map, Graph>,
  >(
    keys: Guard extends Map ? Map : Guard,
  ): Promise<Simplify<ResolvedRecord<Map>>>;
  wire<const Key extends ValidKey, Guard extends Resolvable<Key, Graph>>(
    k: Guard extends Key ? Key : Guard,
  ): Promise<Components[Key]>;
}

export const Wyr = (): Wyr<Record<never, never>> =>
  new InternalWyr({}) as Wyr<Record<never, never>>;
