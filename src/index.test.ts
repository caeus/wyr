import { describe, expect, test } from 'vitest';
import {
  AnyGraph,
  Compilation,
  Failed,
  GraphErr,
  Module,
  Ok,
  Resolved,
  ShakenGraph,
  TaggedKeys,
  TaggedValues,
  TransitiveKeys,
  ValidModule,
  toClass,
  toFactory,
  toValue,
} from '.';

declare function errOf<Graph extends AnyGraph>(
  module: Module<Graph>,
): GraphErr<Graph>;

declare function compilationOf<Graph extends AnyGraph>(
  module: Module<Graph>,
): Compilation<Graph>;

// Contract consumers — each demands a different requirement strength
declare function anyValid(module: ValidModule): void;
declare function exposesCount(module: ValidModule<{ count: unknown }>): void;
declare function countIsNumber(module: ValidModule<{ count: number }>): void;
declare function countIsString(module: ValidModule<{ count: string }>): void;
declare function exposesMissing(
  module: ValidModule<{ missing: unknown }>,
): void;
declare function petIsAnimal(module: ValidModule<{ pet: Animal }>): void;

class Animal {
  legs = 4;
}
class Dog extends Animal {
  bark(): string {
    return 'woof';
  }
}

const typeTest = (s: string, _: () => void): void =>
  test(s, () => {
    expectTypeOf(_).toBeFunction();
  });

// Unique symbol and numeric keys — used to verify non-string key support
const symKey: unique symbol = Symbol('symKey');
const numKey: 0 = 0 as const;
const handlerTag: unique symbol = Symbol('handlerTag');
const symbolHandler: unique symbol = Symbol('symbolHandler');

class Greeter {
  constructor(
    private readonly message: string,
    private readonly excited: boolean,
  ) {}

  shout(): string {
    return this.excited ? `${this.message}!` : this.message;
  }
}

const baseModule = Module({
  [symKey]: toFactory([], async () => 'hola'),
  [numKey]: toValue(true),
});
const appModule = Module({
  count: toValue(42),
  greeting: toFactory([symKey, numKey], async (s: string, b: boolean) => [
    s,
    b,
  ]),
}).merge(baseModule);

const taggedModule = Module({
  prefix: toValue('handler:'),
  alpha: toFactory(['prefix'], (prefix: string) => `${prefix}alpha`, [
    handlerTag,
  ]),
  [symbolHandler]: toValue(42, [handlerTag]),
  ignored: toValue(false),
  handlers: toFactory(
    ['prefix', { tag: handlerTag }],
    (prefix: string, handlers: { alpha: string; [symbolHandler]: number }) => ({
      prefix,
      handlers,
    }),
  ),
});

describe('Module', () => {
  describe('compile (Container)', () => {
    test('resolves all keys, .get is synchronous', async () => {
      const container = await appModule.compile();
      expect(container.get(symKey)).toBe('hola');
      expect(container.get(numKey)).toBe(true);
      expect(container.get('count')).toBe(42);
    });

    test('resolves dependencies in parallel', async () => {
      const slowModule = Module({
        name: toFactory([], async () => {
          await new Promise((r) => setTimeout(r, 120));
          return 'hola';
        }),
        excited: toFactory([], async () => {
          await new Promise((r) => setTimeout(r, 130));
          return true;
        }),
      });

      const start = performance.now();
      const container = await slowModule.compile();
      const elapsed = performance.now() - start;

      expect(container.get('name')).toBe('hola');
      expect(container.get('excited')).toBe(true);
      expect(elapsed).toBeLessThan(200);
    });

    test('memoises — factory invoked only once even when depended on by multiple providers', async () => {
      let invocations = 0;
      const m = Module({
        base: toFactory([], async () => {
          invocations += 1;
          return 'hola';
        }),
        a: toFactory(['base'], async (s: string) => s + '!'),
        b: toFactory(['base'], async (s: string) => s + '?'),
      });
      const container = await m.compile();
      expect(container.get('a')).toBe('hola!');
      expect(container.get('b')).toBe('hola?');
      expect(container.get('base')).toBe('hola');
      expect(invocations).toBe(1);
    });

    test('rejects when a dependency is absent', async () => {
      const missingDep = Module({
        greeting: toFactory(['name', 'excited'], (s, b) => [s, b]),
      });
      await expect(
        (missingDep as never as typeof appModule).compile(),
      ).rejects.toThrow(/No provider registered for key/i);
    });

    test('rejects circular dependencies', async () => {
      const cyclic = Module({
        a: toFactory(['b'], async (x: string) => x),
        b: toFactory(['a'], async (x: string) => x),
      });
      await expect((cyclic as any).compile()).rejects.toThrow(
        /circular dependency/i,
      );
    });

    test('bubbles up factory exceptions', async () => {
      const kaboom = new Error('kaboom');
      const failing = Module({
        name: toFactory([], async () => {
          throw kaboom;
        }),
        greeting: toFactory(['name'], async (s: string) => s),
      });
      await expect(failing.compile()).rejects.toThrow(kaboom);
    });

    test('get throws for a key not in the container', async () => {
      const container = await appModule.shake(['greeting']).compile();
      expect(() => container.get('count' as never)).toThrow(
        /Key not in container/i,
      );
    });

    test('get returns value synchronously, not a Promise', async () => {
      const container = await appModule.compile();
      const value = container.get('count');
      expect(value).not.toBeInstanceOf(Promise);
      expect(value).toBe(42);
    });
  });

  describe('shake', () => {
    test('keeps target keys and their transitive deps', async () => {
      const container = await appModule.shake(['greeting']).compile();
      expect(container.get('greeting')).toStrictEqual(['hola', true]);
      expect(container.get(symKey)).toBe('hola');
      expect(container.get(numKey)).toBe(true);
    });

    test('drops keys not in the transitive closure', async () => {
      const container = await appModule.shake(['greeting']).compile();
      expect(() => container.get('count' as never)).toThrow(
        /Key not in container/i,
      );
    });
  });

  describe('tags', () => {
    test('injects all matching providers as a record', async () => {
      const container = await taggedModule.shake(['handlers']).compile();
      const result = container.get('handlers');

      expect(result.prefix).toBe('handler:');
      expect(result.handlers.alpha).toBe('handler:alpha');
      expect(result.handlers[symbolHandler]).toBe(42);
    });

    test('an unmatched tag resolves to an empty record', async () => {
      const module = Module({
        bindings: toFactory([{ tag: 'missing' }], (bindings: {}) => bindings),
      });

      const container = await module.compile();
      expect(Reflect.ownKeys(container.get('bindings'))).toStrictEqual([]);
    });

    test('provider tags can be supplied as a set', async () => {
      const tag = Symbol('setTag');
      const module = Module({
        value: toValue(42, new Set([tag])),
        values: toFactory([{ tag }], (values: { value: number }) => values),
      });

      const container = await module.compile();
      expect(container.get('values')).toStrictEqual({ value: 42 });
    });

    test('resolves matching providers in parallel', async () => {
      const module = Module({
        first: toFactory(
          [],
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 120));
            return 1;
          },
          ['item'],
        ),
        second: toFactory(
          [],
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 130));
            return 2;
          },
          ['item'],
        ),
        values: toFactory(
          [{ tag: 'item' }],
          (values: { first: number; second: number }) => values,
        ),
      });

      const start = performance.now();
      const container = await module.shake(['values']).compile();
      const elapsed = performance.now() - start;

      expect(container.get('values')).toStrictEqual({ first: 1, second: 2 });
      expect(elapsed).toBeLessThan(200);
    });

    test('shake retains tagged providers and their transitive deps', async () => {
      const container = await taggedModule.shake(['handlers']).compile();

      expect(container.get('alpha')).toBe('handler:alpha');
      expect(container.get(symbolHandler)).toBe(42);
      expect(container.get('prefix')).toBe('handler:');
      expect(() => container.get('ignored' as never)).toThrow(
        /Key not in container/i,
      );
    });

    test('a replacement provider replaces its tags too', async () => {
      const base = Module({
        value: toValue(1, ['item']),
        values: toFactory(
          [{ tag: 'item' }],
          (values: Record<PropertyKey, unknown>) => values,
        ),
      });
      const replacement = Module({ value: toValue(2) });

      const container = await base
        .merge(replacement)
        .shake(['values'])
        .compile();
      expect(Reflect.ownKeys(container.get('values'))).toStrictEqual([]);
      expect(() => container.get('value' as never)).toThrow(
        /Key not in container/i,
      );
    });

    test('rejects cycles introduced through a tag dependency', async () => {
      const cyclic = Module({
        value: toFactory(
          [{ tag: 'loop' }],
          (values: Record<PropertyKey, unknown>) => values,
          ['loop'],
        ),
      });

      await expect((cyclic as any).compile()).rejects.toThrow(
        /circular dependency/i,
      );
    });
  });

  describe('merge', () => {
    test('prefers bindings from the argument module', async () => {
      const base = Module({ flag: toValue(false) });
      const patch = Module({ flag: toValue(true) });
      const merged = base.merge(patch);
      const container = await merged.compile();
      expect(container.get('flag')).toBe(true);
    });
  });

  describe('toClass', () => {
    test('wires class constructors', async () => {
      const m = Module({
        message: toFactory([], async () => 'hola'),
        excited: toValue(true),
        greeter: toClass(['message', 'excited'], Greeter),
      });
      const container = await m.shake(['greeter']).compile();
      const greeter = container.get('greeter');
      expect(greeter).toBeInstanceOf(Greeter);
      expect(greeter.shout()).toBe('hola!');
    });
  });

  describe('types', () => {
    typeTest('valid module has empty error type', () => {
      expectTypeOf(errOf(appModule)).toEqualTypeOf<{}>();
    });

    typeTest(
      'an unprovided key is reported on itself, its dependents as unmet',
      () => {
        const broken = Module({
          greeting: toFactory([symKey, numKey], (s: string, b: boolean) => [
            s,
            b,
          ]),
        });
        expectTypeOf(errOf(broken)).toEqualTypeOf<{
          greeting: { unmet: typeof symKey | typeof numKey };
          [symKey]: { unprovided: { requiredBy: 'greeting' } };
          0: { unprovided: { requiredBy: 'greeting' } };
        }>();
      },
    );

    typeTest(
      'a root cause is reported once; each dependent points one hop back',
      () => {
        const chain = Module({
          b: toFactory(['a'], (s: string) => s),
          c: toFactory(['b'], (s: string) => s),
          d: toFactory(['c'], (s: string) => s),
        });
        expectTypeOf(errOf(chain)).toEqualTypeOf<{
          a: { unprovided: { requiredBy: 'b' } };
          b: { unmet: 'a' };
          c: { unmet: 'b' };
          d: { unmet: 'c' };
        }>();
      },
    );

    typeTest(
      'a mismatch is reported on the dependent, keyed by the offending dep',
      () => {
        const mismatched = Module({
          excited: toValue('not a boolean' as string),
          name: toFactory([], async () => 'hola'),
          greeting: toFactory(
            ['name', 'excited'],
            async (s: string, b: boolean) => [s, b],
          ),
        });
        expectTypeOf(errOf(mismatched)).toEqualTypeOf<{
          greeting: {
            mismatched: { excited: { expected: boolean; got: string } };
          };
        }>();
      },
    );

    typeTest(
      'each cycle member reports the cycle, rotated to start on itself',
      () => {
        const cyclic = Module({
          a: toFactory(['b'], async (x: string) => x),
          b: toFactory(['a'], async (x: string) => x),
        });
        expectTypeOf(errOf(cyclic)).toEqualTypeOf<{
          a: { circular: readonly ['a', 'b', 'a'] };
          b: { circular: readonly ['b', 'a', 'b'] };
        }>();
      },
    );

    typeTest(
      'compile() on a module with missing deps is a compile error',
      () => {
        const broken = Module({
          greeting: toFactory([symKey, numKey], (s: string, b: boolean) => [
            s,
            b,
          ]),
        });
        // @ts-expect-error — symKey and numKey are missing from the module
        broken.compile();
      },
    );

    typeTest(
      'TransitiveKeys includes the key itself and all transitive deps',
      () => {
        // appModule graph: greeting -> [symKey, numKey], symKey -> [], numKey -> [], count -> []
        type Graph = typeof appModule extends Module<infer G> ? G : never;
        expectTypeOf<TransitiveKeys<Graph, 'greeting'>>().toEqualTypeOf<
          'greeting' | typeof symKey | typeof numKey | 0
        >();
        // count has no deps — only itself
        expectTypeOf<TransitiveKeys<Graph, 'count'>>().toEqualTypeOf<'count'>();
      },
    );

    typeTest(
      'TransitiveKeys distributes over a union — dep-free keys must not drop transitive deps of other keys',
      () => {
        // 'count' has no deps; 'greeting' depends on symKey and numKey.
        // With the bug, ProviderIn<Graph['greeting'] | Graph['count']> collapses to {}
        // via keyof ({symKey,numKey} | {}) = never, losing all transitive deps.
        type Graph = typeof appModule extends Module<infer G> ? G : never;
        expectTypeOf<
          TransitiveKeys<Graph, 'greeting' | 'count'>
        >().toEqualTypeOf<
          'greeting' | 'count' | typeof symKey | typeof numKey | 0
        >();
      },
    );

    typeTest(
      'ShakenGraph contains only the transitive closure of the given keys',
      () => {
        type Graph = typeof appModule extends Module<infer G> ? G : never;
        expectTypeOf<keyof ShakenGraph<Graph, ['greeting']>>().toEqualTypeOf<
          'greeting' | typeof symKey | typeof numKey
        >();
        // count is NOT in the closure of greeting
        expectTypeOf<
          'count' extends keyof ShakenGraph<Graph, ['greeting']> ? true : false
        >().toEqualTypeOf<false>();
      },
    );

    typeTest('tag queries expose matching keys and resolved values', () => {
      type Graph = typeof taggedModule extends Module<infer G> ? G : never;

      expectTypeOf<TaggedKeys<Graph, typeof handlerTag>>().toEqualTypeOf<
        'alpha' | typeof symbolHandler
      >();
      expectTypeOf<TaggedValues<Graph, typeof handlerTag>>().toEqualTypeOf<{
        alpha: `${string}alpha`;
        [symbolHandler]: 42;
      }>();
    });

    typeTest('tag dependencies are graph edges', () => {
      type Graph = typeof taggedModule extends Module<infer G> ? G : never;

      expectTypeOf<TransitiveKeys<Graph, 'handlers'>>().toEqualTypeOf<
        'handlers' | 'prefix' | 'alpha' | typeof symbolHandler
      >();
      expectTypeOf<keyof ShakenGraph<Graph, ['handlers']>>().toEqualTypeOf<
        'handlers' | 'prefix' | 'alpha' | typeof symbolHandler
      >();
    });

    typeTest('tag record mismatches are reported on the consumer', () => {
      const mismatched = Module({
        value: toValue(1, ['item']),
        values: toFactory([{ tag: 'item' }], (values: { value: string }) => {
          void values;
          return null;
        }),
      });

      type Graph = typeof mismatched extends Module<infer G> ? G : never;
      type Expected = {
        values: {
          taggedMismatched: {
            item: { expected: { value: string }; got: { value: 1 } };
          };
        };
      };

      expectTypeOf<GraphErr<Graph>>().toMatchTypeOf<Expected>();
      expectTypeOf<Expected>().toMatchTypeOf<GraphErr<Graph>>();
      void mismatched;
    });

    typeTest('cycles through tag edges are reported', () => {
      const cyclic = Module({
        value: toFactory(
          [{ tag: 'loop' }],
          (values: Record<PropertyKey, unknown>) => values,
          ['loop'],
        ),
      });

      expectTypeOf(errOf(cyclic)).toEqualTypeOf<{
        value: { circular: readonly ['value', 'value'] };
      }>();
      // @ts-expect-error - tag edge makes the graph circular
      cyclic.compile();
    });

    typeTest(
      'shake(keys).compile() is a compile error only for keys with wiring errors',
      () => {
        const partiallyBroken = Module({
          count: toValue(42),
          greeting: toFactory([symKey, numKey], (s: string, b: boolean) => [
            s,
            b,
          ]),
        });
        // count has no deps — valid after shake, no error
        partiallyBroken.shake(['count']).compile();
        // greeting has missing transitive deps — blocked
        // @ts-expect-error — symKey and numKey are transitively missing
        partiallyBroken.shake(['greeting']).compile();
      },
    );
  });

  describe('compilation', () => {
    const brokenModule = Module({
      greeting: toFactory([symKey, numKey], (s: string, b: boolean) => [s, b]),
    });
    type AppGraph = typeof appModule extends Module<infer G> ? G : never;
    type BrokenGraph = typeof brokenModule extends Module<infer G> ? G : never;

    typeTest('a wired module compiles to Ok of its resolved graph', () => {
      expectTypeOf(compilationOf(appModule)).toEqualTypeOf<
        Ok<Resolved<AppGraph>>
      >();
    });

    typeTest(
      'a module with missing deps compiles to Failed of its errors',
      () => {
        expectTypeOf(compilationOf(brokenModule)).toEqualTypeOf<
          Failed<GraphErr<BrokenGraph>>
        >();
        expectTypeOf(compilationOf(brokenModule)).not.toMatchTypeOf<
          Ok<unknown>
        >();
      },
    );

    typeTest('satisfies ValidModule contracts of increasing strength', () => {
      anyValid(appModule);
      exposesCount(appModule);
      countIsNumber(appModule);
    });

    typeTest(
      'an exported binding satisfies a contract for its supertype',
      () => {
        const pets = Module({ pet: toFactory([], async () => new Dog()) });
        petIsAnimal(pets);
      },
    );

    typeTest(
      'rejects failed modules, absent keys, and mismatched types',
      () => {
        // @ts-expect-error — Failed is not assignable to Ok
        anyValid(brokenModule);
        // @ts-expect-error — appModule exposes no 'missing' key
        exposesMissing(appModule);
        // @ts-expect-error — 'count' resolves to number, not string
        countIsString(appModule);
      },
    );

    test('a contract consumer can compile and get typed bindings', async () => {
      const readCount = async (
        module: ValidModule<{ count: number }>,
      ): Promise<number> => (await module.compile()).get('count');

      expect(await readCount(appModule)).toBe(42);
    });

    typeTest('merge repairs a failed module', () => {
      expectTypeOf(compilationOf(brokenModule)).not.toMatchTypeOf<
        Ok<unknown>
      >();

      const repaired = brokenModule.merge(baseModule);
      expectTypeOf(compilationOf(repaired)).toMatchTypeOf<Ok<unknown>>();
      repaired.compile();
    });
  });
});
