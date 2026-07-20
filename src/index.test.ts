import { describe, expect, test } from 'vitest';
import { AnyGraph, GraphErr, Module, toClass, toFactory, toValue } from '.';

declare function errOf<Graph extends AnyGraph>(
  module: Module<Graph>,
): GraphErr<Graph>;

const typeTest = (s: string, _: () => void): void =>
  test(s, () => {
    expectTypeOf(_).toBeFunction();
  });

const bool$: 0 = 0 as const;
const num$: '1' = '1' as const;
const str$: unique symbol = Symbol('str');
const str_bool$ = 'str_bool' as const;
const greeter$: unique symbol = Symbol('$greeter');

class Greeter {
  constructor(
    private readonly message: string,
    private readonly excited: boolean,
  ) {}

  shout(): string {
    return this.excited ? `${this.message}!` : this.message;
  }
}

const module0 = Module({
  [bool$]: toValue(true),
});
const module1 = Module({
  [num$]: toValue(42),
  [str$]: toFactory([], async () => 'hola'),
  [str_bool$]: toFactory([str$, bool$], async (s: string, b: boolean) => [
    s,
    b,
  ]),
}).merge(module0);

describe('Module', () => {
  describe('wire (LazyContainer)', () => {
    test('no keys — covers all keys, .get returns promise of correct value', async () => {
      const container = module1.wire();
      await expect(container.get(str$)).resolves.toBe('hola');
      await expect(container.get(bool$)).resolves.toBe(true);
      await expect(container.get(num$)).resolves.toBe(42);
    });

    test('scoped keys — container includes targets and transitives', async () => {
      const container = module1.wire([str_bool$]);
      await expect(container.get(str_bool$)).resolves.toStrictEqual([
        'hola',
        true,
      ]);
      // transitives are accessible too
      await expect(container.get(str$)).resolves.toBe('hola');
      await expect(container.get(bool$)).resolves.toBe(true);
    });

    test('memoises — factory invoked only once across multiple .get calls', async () => {
      let invocations = 0;
      const m = Module({
        [str$]: toFactory([], async () => {
          invocations += 1;
          return 'hola';
        }),
      });
      const container = m.wire();
      await container.get(str$);
      await container.get(str$);
      expect(invocations).toBe(1);
    });

    test('rejects when a dependency is absent', async () => {
      const missingDep = Module({
        [str_bool$]: toFactory([str$, bool$], (s, b) => [s, b]),
      });
      // compile surfaces the error since it awaits resolution
      await expect(
        (missingDep as never as typeof module1).compile([str_bool$]),
      ).rejects.toThrow(/No provider registered for key/i);
    });

    test('rejects circular dependencies', async () => {
      const cyclic = Module({
        [bool$]: toValue(true),
        [str$]: toFactory([str_bool$], async ([line]) => line),
        [str_bool$]: toFactory([str$, bool$], async (line, flag) => [
          line,
          flag,
        ]),
      });
      await expect(
        (cyclic as never as typeof module1).compile([str_bool$]),
      ).rejects.toThrow(/circular dependency/i);
    });

    test('bubbles up factory exceptions', async () => {
      const kaboom = new Error('kaboom');
      const failing = Module({
        [bool$]: toValue(true),
        [str$]: toFactory([], async () => {
          throw kaboom;
        }),
        [str_bool$]: toFactory([str$, bool$], async (s, b) => [s, b]),
      });
      await expect(failing.compile([str_bool$])).rejects.toThrow(kaboom);
    });
  });

  describe('LazyContainer', () => {
    test('get throws for a key not in the container', () => {
      const container = module1.wire([str_bool$]);
      expect(() => container.get(num$ as never)).toThrow(
        /Key not in container/i,
      );
    });
  });

  describe('compile (EagerContainer)', () => {
    test('no keys — covers all keys, .get is synchronous', async () => {
      const container = await module1.compile();
      expect(container.get(str$)).toBe('hola');
      expect(container.get(bool$)).toBe(true);
      expect(container.get(num$)).toBe(42);
    });

    test('scoped keys — container includes targets and transitives', async () => {
      const container = await module1.compile([str_bool$]);
      expect(container.get(str_bool$)).toStrictEqual(['hola', true]);
      expect(container.get(str$)).toBe('hola');
      expect(container.get(bool$)).toBe(true);
    });

    test('resolves dependencies in parallel', async () => {
      const slowModule = Module({
        [str$]: toFactory([], async () => {
          await new Promise((r) => setTimeout(r, 120));
          return 'hola';
        }),
        [bool$]: toFactory([], async () => {
          await new Promise((r) => setTimeout(r, 130));
          return true;
        }),
      });

      const start = performance.now();
      const container = await slowModule.compile();
      const elapsed = performance.now() - start;

      expect(container.get(str$)).toBe('hola');
      expect(container.get(bool$)).toBe(true);
      expect(elapsed).toBeLessThan(200);
    });

    test('get throws for a key not in the container', async () => {
      const container = await module1.compile([str_bool$]);
      expect(() => container.get(num$ as never)).toThrow(
        /Key not in container/i,
      );
    });

    test('get returns value synchronously, not a Promise', async () => {
      const container = await module1.compile();
      const value = container.get(str$);
      expect(value).not.toBeInstanceOf(Promise);
      expect(value).toBe('hola');
    });
  });

  describe('merge', () => {
    test('prefers bindings from the argument module', async () => {
      const base = Module({ [bool$]: toValue(false) });
      const patch = Module({ [bool$]: toValue(true) });
      const merged = base.merge(patch);
      const container = await merged.compile([bool$]);
      expect(container.get(bool$)).toBe(true);
    });
  });

  describe('toClass', () => {
    test('wires class constructors', async () => {
      const m = Module({
        [bool$]: toValue(true),
        [str$]: toFactory([], async () => 'hola'),
        [greeter$]: toClass([str$, bool$], Greeter),
      });
      const container = await m.compile([greeter$]);
      const greeter = container.get(greeter$);
      expect(greeter).toBeInstanceOf(Greeter);
      expect(greeter.shout()).toBe('hola!');
    });
  });

  describe('types', () => {
    typeTest('valid module has empty error type', () => {
      expectTypeOf(errOf(module1)).toEqualTypeOf<{}>();
    });

    typeTest(
      'missing deps: error type lists affected keys with missing key errors',
      () => {
        const broken = Module({
          [str_bool$]: toFactory([str$, bool$], (s: string, b: boolean) => [
            s,
            b,
          ]),
        });
        expectTypeOf(errOf(broken)).toEqualTypeOf<{
          readonly str_bool:
            | {
                message: 'missing key';
                ctx: { key: typeof bool$; trace: readonly ['str_bool'] };
              }
            | {
                message: 'missing key';
                ctx: { key: typeof str$; trace: readonly ['str_bool'] };
              };
        }>();
      },
    );

    typeTest(
      'type mismatch: error type lists affected keys with type mismatch errors',
      () => {
        const mismatched = Module({
          [bool$]: toValue('not a boolean' as string),
          [str$]: toFactory([], async () => 'hola'),
          [str_bool$]: toFactory(
            [str$, bool$],
            async (s: string, b: boolean) => [s, b],
          ),
        });
        expectTypeOf(errOf(mismatched)).toEqualTypeOf<{
          readonly str_bool: {
            message: 'type mismatch';
            ctx: {
              key: 0;
              expected: boolean;
              got: string;
              trace: readonly ['str_bool'];
            };
          };
        }>();
      },
    );

    typeTest(
      'circular dep: error type lists affected keys with circular dependency errors',
      () => {
        const cyclic = Module({
          [bool$]: toValue(true),
          [str$]: toFactory([str_bool$], async (x: string) => x),
          [str_bool$]: toFactory(
            [str$, bool$],
            async (s: string, b: boolean) => [s, b],
          ),
        });
        const err = errOf(cyclic);
        expectTypeOf(err.str_bool).toMatchTypeOf<{
          message: 'circular dependency';
          ctx: object;
        }>();
        expectTypeOf(err[str$]).toMatchTypeOf<{
          message: 'type mismatch';
          ctx: object;
        }>();
      },
    );

    typeTest(
      'wire() and compile() on a module with missing deps are compile errors',
      () => {
        const broken = Module({
          [str_bool$]: toFactory([str$, bool$], (s: string, b: boolean) => [
            s,
            b,
          ]),
        });
        // @ts-expect-error — str$ and bool$ are missing from the module
        broken.wire();
        // @ts-expect-error — str$ and bool$ are missing from the module
        broken.compile();
      },
    );

    typeTest(
      'wire(keys) and compile(keys) are compile errors only for keys with wiring errors',
      () => {
        const partiallyBroken = Module({
          [num$]: toValue(42),
          [str_bool$]: toFactory([str$, bool$], (s: string, b: boolean) => [
            s,
            b,
          ]),
        });
        // num$ has no deps — valid scope, no error
        partiallyBroken.wire([num$]);
        partiallyBroken.compile([num$]);
        // str_bool$ has missing transitive deps — blocked
        // @ts-expect-error — str$ and bool$ are transitively missing
        partiallyBroken.wire([str_bool$]);
        // @ts-expect-error — str$ and bool$ are transitively missing
        partiallyBroken.compile([str_bool$]);
      },
    );
  });
});
