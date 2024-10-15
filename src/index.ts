export interface BindingConstraint<T> {}

export type BindingKey<T> = symbol & BindingConstraint<T>;
export type Creator<out T> = {
  deps: BindingKey<unknown>[];
  create: (...params: unknown[]) => Promise<T>;
};
namespace Creator {
  export function from<Deps extends BindingKey<unknown>[]>(
    ...deps: Deps
  ): <R>(create: (...params: DepsToParams<Deps>) => Promise<R>) => Creator<R> {
    return <R>(create: (...params: DepsToParams<Deps>) => Promise<R>) => ({
      deps,
      create: create as (...params: unknown[]) => Promise<R>,
    });
  }
}
// Type Function... gets [A,B,C] from [BindingKey<A>,BindingKey<B>,BindingKey<C>]
type DepsToParams<Deps extends BindingKey<unknown>[]> = Deps extends [
  BindingKey<infer To>,
  ...infer Tail extends BindingKey<unknown>[],
]
  ? [To, ...DepsToParams<Tail>]
  : Deps extends []
    ? []
    : Deps extends BindingKey<infer Of>[] ? Of[] : never;
export class Container {
  private instances: Record<symbol, Promise<unknown>> = {};
  constructor(private bindings: Record<symbol, Creator<unknown>> = {}) {}
  private async obtain<T>(
    key: BindingKey<T>,
    trace: BindingKey<unknown>[],
  ): Promise<T> {
    if (key in this.instances) {
      return this.instances[key] as Promise<T>;
    }
    if (!(key in this.bindings)) {
      throw `No binding for key ${String(key)}`;
    }
    const newTrace = [key, ...trace];
    if (trace.includes(key)) {
      throw `Illegal circular dependency ${newTrace.map(k=>k.description).join('-->')}`;
    }
    const creator = this.bindings[key];
    const params = await Promise.all(
      creator.deps.map((key) => this.obtain(key, newTrace)),
    );
    const instance = Promise.resolve(creator.create(...params));
    this.instances[key] = instance;
    return instance as Promise<T>;
  }
  async get<Keys extends BindingKey<unknown>[]>(
    ...keys: Keys
  ): Promise<DepsToParams<Keys>> {
    return Promise.all(keys.map((key) => this.obtain(key, []))) as Promise<
      DepsToParams<Keys>
    >;
  }
}

export class Module {
  constructor(private bindings: Record<symbol, Creator<unknown>> = {}) {}
  bind<T>(key: BindingKey<T>): { to: (creator: Creator<T>) => Module } {
    const self = this;
    return {
      to(creator: Creator<T>): Module {
        const newLocal = { ...self.bindings, [key]: creator };
        return new Module(newLocal);
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
  export function module() {
    return new Module();
  }
  export const creator = Creator.from;
}
export const container = Wyr.container;
export const module = Wyr.module;
