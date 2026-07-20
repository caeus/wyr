import { describe, expect, test } from 'vitest';
import { AnyGraph, GraphErr, Module, toClass, toFactory, toValue } from '.';

declare function errOf<Graph extends AnyGraph>(
  module: Module<Graph>,
): GraphErr<Graph>;

const typeTest = (s: string, _: () => void): void =>
  test(s, () => {
    expectTypeOf(_).toBeFunction();
  });

// Unique symbol and numeric keys — used to verify non-string key support
const symKey: unique symbol = Symbol('symKey');
const numKey: 0 = 0 as const;

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

describe('Module', () => {
  describe('wire (LazyContainer)', () => {
    test('no keys — covers all keys, .get returns promise of correct value', async () => {
      const container = appModule.wire();
      await expect(container.get(symKey)).resolves.toBe('hola');
      await expect(container.get(numKey)).resolves.toBe(true);
      await expect(container.get('count')).resolves.toBe(42);
    });

    test('scoped keys — container includes targets and transitives', async () => {
      const container = appModule.wire(['greeting']);
      await expect(container.get('greeting')).resolves.toStrictEqual([
        'hola',
        true,
      ]);
      await expect(container.get(symKey)).resolves.toBe('hola');
      await expect(container.get(numKey)).resolves.toBe(true);
    });

    test('memoises — factory invoked only once across multiple .get calls', async () => {
      let invocations = 0;
      const m = Module({
        greeting: toFactory([], async () => {
          invocations += 1;
          return 'hola';
        }),
      });
      const container = m.wire();
      await container.get('greeting');
      await container.get('greeting');
      expect(invocations).toBe(1);
    });

    test('rejects when a dependency is absent', async () => {
      const missingDep = Module({
        greeting: toFactory(['name', 'excited'], (s, b) => [s, b]),
      });
      await expect(
        (missingDep as never as typeof appModule).compile(['greeting']),
      ).rejects.toThrow(/No provider registered for key/i);
    });

    test('rejects circular dependencies', async () => {
      const cyclic = Module({
        a: toFactory(['b'], async (x: string) => x),
        b: toFactory(['a'], async (x: string) => x),
      });
      await expect((cyclic as any).compile(['a'])).rejects.toThrow(
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
      await expect(failing.compile(['greeting'])).rejects.toThrow(kaboom);
    });
  });

  describe('LazyContainer', () => {
    test('get throws for a key not in the container', () => {
      const container = appModule.wire(['greeting']);
      expect(() => container.get('count' as never)).toThrow(
        /Key not in container/i,
      );
    });
  });

  describe('compile (EagerContainer)', () => {
    test('no keys — covers all keys, .get is synchronous', async () => {
      const container = await appModule.compile();
      expect(container.get(symKey)).toBe('hola');
      expect(container.get(numKey)).toBe(true);
      expect(container.get('count')).toBe(42);
    });

    test('scoped keys — container includes targets and transitives', async () => {
      const container = await appModule.compile(['greeting']);
      expect(container.get('greeting')).toStrictEqual(['hola', true]);
      expect(container.get(symKey)).toBe('hola');
      expect(container.get(numKey)).toBe(true);
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

    test('get throws for a key not in the container', async () => {
      const container = await appModule.compile(['greeting']);
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

  describe('merge', () => {
    test('prefers bindings from the argument module', async () => {
      const base = Module({ flag: toValue(false) });
      const patch = Module({ flag: toValue(true) });
      const merged = base.merge(patch);
      const container = await merged.compile(['flag']);
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
      const container = await m.compile(['greeter']);
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
      'missing deps: error type lists affected keys with missing key errors',
      () => {
        const broken = Module({
          greeting: toFactory([symKey, numKey], (s: string, b: boolean) => [
            s,
            b,
          ]),
        });
        expectTypeOf(errOf(broken)).toEqualTypeOf<{
          readonly greeting:
            | {
                message: 'missing key';
                ctx: { key: typeof numKey; trace: readonly ['greeting'] };
              }
            | {
                message: 'missing key';
                ctx: { key: typeof symKey; trace: readonly ['greeting'] };
              };
        }>();
      },
    );

    typeTest(
      'type mismatch: error type lists affected keys with type mismatch errors',
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
          readonly greeting: {
            message: 'type mismatch';
            ctx: {
              key: 'excited';
              expected: boolean;
              got: string;
              trace: readonly ['greeting'];
            };
          };
        }>();
      },
    );

    typeTest(
      'circular dep: error type lists affected keys with circular dependency errors',
      () => {
        const cyclic = Module({
          a: toFactory(['b'], async (x: string) => x),
          b: toFactory(['a'], async (x: string) => x),
        });
        const err = errOf(cyclic);
        expectTypeOf(err.a).toMatchTypeOf<{
          message: 'circular dependency';
          ctx: object;
        }>();
        expectTypeOf(err.b).toMatchTypeOf<{
          message: 'circular dependency';
          ctx: object;
        }>();
      },
    );

    typeTest(
      'wire() and compile() on a module with missing deps are compile errors',
      () => {
        const broken = Module({
          greeting: toFactory([symKey, numKey], (s: string, b: boolean) => [
            s,
            b,
          ]),
        });
        // @ts-expect-error — symKey and numKey are missing from the module
        broken.wire();
        // @ts-expect-error — symKey and numKey are missing from the module
        broken.compile();
      },
    );

    typeTest(
      'wire(keys) and compile(keys) are compile errors only for keys with wiring errors',
      () => {
        const partiallyBroken = Module({
          count: toValue(42),
          greeting: toFactory([symKey, numKey], (s: string, b: boolean) => [
            s,
            b,
          ]),
        });
        // count has no deps — valid scope, no error
        partiallyBroken.wire(['count']);
        partiallyBroken.compile(['count']);
        // greeting has missing transitive deps — blocked
        // @ts-expect-error — symKey and numKey are transitively missing
        partiallyBroken.wire(['greeting']);
        // @ts-expect-error — symKey and numKey are transitively missing
        partiallyBroken.compile(['greeting']);
      },
    );
  });
});
