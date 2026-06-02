import { describe, expect, test } from 'vitest';
import { Module, toClass, toFactory, toValue } from '.';

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
}).override(module0);

describe('Module', () => {
  test('wires a value binding', async () => {
    await expect(module1.wire(str_bool$)).resolves.toStrictEqual([
      'hola',
      true,
    ]);
  });
  test('wireTuple resolves ordered dependencies', async () => {
    await expect(module1.wire([str$, bool$])).resolves.toStrictEqual([
      'hola',
      true,
    ]);
  });
  test('wireRecord resolves a named map', async () => {
    await expect(
      module1.wire({ greeting: str$, answer: num$ }),
    ).resolves.toStrictEqual({ greeting: 'hola', answer: 42 });
  });
  test('merge prefers bindings from the newer module', async () => {
    const base = Module({ [bool$]: toValue(false) });
    const override = Module({ [bool$]: toValue(true) });
    const merged = base.override(override);

    await expect(merged.wire(bool$)).resolves.toBe(true);
  });
  test('wireTuple runs dependencies in parallel', async () => {
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
    const result = await slowModule.wire([str$, bool$]);
    const elapsed = performance.now() - start;

    expect(result).toStrictEqual(['hola', true]);
    expect(elapsed).toBeLessThan(200); // should be ~130ms, not 250ms+
  });
  test('rejects when a dependency is absent', async () => {
    const missingDep = Module({
      [str_bool$]: toFactory([str$, bool$], (s, b) => [s, b]),
    });
    // had to do type assertion, to allow it to compile
    await expect(missingDep.wire(str_bool$ as never)).rejects.toThrow(
      /No provider registered for key/i,
    );
  });
  test('rejects circular dependencies', async () => {
    const cyclic = Module({
      [bool$]: toValue(true),
      [str$]: toFactory([str_bool$], async ([line]) => line),
      [str_bool$]: toFactory([str$, bool$], async (line, flag) => [line, flag]),
    });

    await expect(cyclic.wire(str_bool$ as never)).rejects.toThrow(
      /circular dependency/i,
    );
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

    await expect(failing.wire(str_bool$)).rejects.toThrow(kaboom);
  });
  test('snapshot materializes keys into value bindings', async () => {
    let strInvocations = 0;

    const base = Module({
      [bool$]: toValue(true),
      [str$]: toFactory([bool$], async (exlamation) => {
        strInvocations += 1;
        if (exlamation) {
          return 'Hola!';
        }
        return 'hi';
      }),
    });

    const snap = await base.snapshot([str$, bool$]);

    expect(strInvocations).toBe(1);
    await expect(snap.wire(str$)).resolves.toBe('Hola!');
    await expect(snap.wire(bool$)).resolves.toBe(true);

    await snap.wire(str$);
    expect(strInvocations).toBe(1);

    await expect(snap.wire(num$ as never)).rejects.toThrow(
      /No provider registered for key/i,
    );
  });
  test('toClass wires class constructors', async () => {
    const module = Module({
      [bool$]: toValue(true),
      [str$]: toFactory([], async () => 'hola'),
      [greeter$]: toClass([str$, bool$], Greeter),
    });

    const greeter = await module.wire(greeter$);

    expect(greeter).toBeInstanceOf(Greeter);
    expect(greeter.shout()).toBe('hola!');
  });
});
