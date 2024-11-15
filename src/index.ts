/* eslint-disable @typescript-eslint/no-namespace */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars
export interface BindingConstraint<T> {}

export type BindingKey<T> = symbol & BindingConstraint<T>;
type BindingKeys = [...BindingKey<unknown>[]];
type UParams = unknown[];
type UAsyncBuilder<out T> = (...params: UParams) => Promise<T>;
type Fun2R<Params extends UParams, R> = (...params: Params) => Promise<R> | R;
type Class2R<Params extends UParams, R> = new (...params: Params) => R;
export type Creator<out T> = {
  deps: BindingKeys;
  create: UAsyncBuilder<T>;
};

// Type Function... gets [A,B,C] from [BindingKey<A>,BindingKey<B>,BindingKey<C>]
type DerefMany<Deps extends BindingKeys> = Deps extends [
  BindingKey<infer To>,
  ...infer Tail extends BindingKeys,
]
  ? [To, ...DerefMany<Tail>]
  : Deps extends []
    ? []
    : Deps extends BindingKey<infer Of>[]
      ? Of[]
      : never;

namespace Creator {
  export function fromFun<Keys extends BindingKeys, R>(
    deps: [...Keys],
    fun: Fun2R<DerefMany<Keys>, R>,
  ): Creator<R> {
    return {
      deps,
      async create(...params): Promise<R> {
        return fun(...(params as DerefMany<Keys>));
      },
    };
  }
  export function fromClass<Keys extends BindingKeys, R>(
    deps: [...Keys],
    clazz: Class2R<DerefMany<Keys>, R>,
  ): Creator<R> {
    return {
      deps,
      async create(...params): Promise<R> {
        return new clazz(...(params as DerefMany<Keys>));
      },
    };
  }
}
type OneOrMore<T> = T | [...T[]];
type DerefOneOrMore<T extends OneOrMore<BindingKey<unknown>>> = T extends [
  ...infer Keys extends BindingKeys,
]
  ? DerefMany<Keys>
  : T extends BindingKey<infer R>
    ? R
    : never;
export class Container {
  private instances: Record<symbol, Promise<unknown>> = {};
  constructor(private bindings: Record<symbol, Creator<unknown>> = {}) {}
  private async obtain<T>(key: BindingKey<T>, trace: BindingKeys): Promise<T> {
    if (key in this.instances) {
      return this.instances[key] as Promise<T>;
    }
    if (!(key in this.bindings)) {
      throw `No binding for key ${String(key)}`;
    }
    const newTrace = [key, ...trace];
    if (trace.includes(key)) {
      throw `Illegal circular dependency ${newTrace.map((k) => k.description).join('-->')}`;
    }
    const creator = this.bindings[key];
    const params = await Promise.all(
      creator.deps.map((key) => this.obtain(key, newTrace)),
    );
    const instance = Promise.resolve(creator.create(...params));
    this.instances[key] = instance;
    return instance as Promise<T>;
  }
  get<T>(key: BindingKey<T>): Promise<T>;
  get<Keys extends BindingKeys>(keys: [...Keys]): Promise<DerefMany<[...Keys]>>;
  async get<Keys extends OneOrMore<BindingKey<unknown>>>(
    keys: Keys,
  ): Promise<DerefOneOrMore<Keys>> {
    if (Array.isArray(keys)) {
      return Promise.all(keys.map((key) => this.obtain(key, []))) as Promise<
        DerefOneOrMore<Keys>
      >;
    } else return this.obtain(keys, []);
  }
}
export interface Binder<T> {
  to(creator: Creator<T>): Module;
  toFun<Deps extends BindingKeys>(
    deps: [...Deps],
    fun: Fun2R<DerefMany<Deps>, T>,
  ): Module;
  toClass<Deps extends BindingKeys>(
    deps: [...Deps],
    fun: Class2R<DerefMany<Deps>, T>,
  ): Module;
  toValue(value: T): Module;
}

export class Module {
  constructor(private bindings: Record<symbol, Creator<unknown>> = {}) {}
  bind<T>(key: BindingKey<T>): Binder<T> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      to(creator: Creator<T>): Module {
        const newLocal = { ...self.bindings, [key]: creator };
        return new Module(newLocal);
      },
      toFun<Deps extends BindingKeys>(
        deps: [...Deps],
        fun: Fun2R<DerefMany<Deps>, T>,
      ): Module {
        return this.to(Creator.fromFun(deps, fun));
      },
      toClass<Deps extends BindingKeys>(
        deps: [...Deps],
        clazz: Class2R<DerefMany<Deps>, T>,
      ): Module {
        return this.to(Creator.fromClass(deps, clazz));
      },
      toValue(value): Module {
        return this.to(Creator.fromFun([], async () => value));
      },
    };
  }
  mergeWith(other: Module): Module {
    return new Module({ ...this.bindings, ...other.bindings });
  }
  asContainer(): Container {
    return new Container(this.bindings);
  }
}

export namespace Wyr {
  export function container(...modules: Module[]): Container {
    let container: Module = new Module();
    for (const module of modules) {
      container = container.mergeWith(module);
    }
    return container.asContainer();
  }
  export function module(): Module {
    return new Module();
  }
  export const reifyFun = Creator.fromFun;
  export const reifyClass = Creator.fromClass;
}
export const container = Wyr.container;
export const module = Wyr.module;
