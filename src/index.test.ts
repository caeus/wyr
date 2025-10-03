import { describe, expect, test } from 'vitest';
import { Wyr } from '.';

const bool$: unique symbol = Symbol('bool');
const num$: unique symbol = Symbol('num');
const str$: unique symbol = Symbol('str');
const str_bool$: unique symbol = Symbol('str_bool');
const greeter$: unique symbol = Symbol('greeter');

class Greeter {
  constructor(
    private readonly message: string,
    private readonly excited: boolean,
  ) {}

  shout(): string {
    return this.excited ? `${this.message}!` : this.message;
  }
}

declare module '.' {
  interface Components {
    [bool$]: boolean;
    [num$]: number;
    [str$]: string;
    [str_bool$]: [string, boolean];
    [greeter$]: Greeter;
  }
}

export const module0 = Wyr().bind(bool$).toValue(true);
export const module1 = Wyr()
  .bind(num$)
  .toValue(42)
  .bind(str$)
  .toFunction([], async () => 'hola')
  .bind(str_bool$)
  .toFunction([str$, bool$], (s, b) => [s, b])
  .merge(module0);

describe('Wyr', () => {
  test('wires a value binding', async () => {
    await expect(module1.wire(str_bool$)).resolves.toStrictEqual([
      'hola',
      true,
    ]);
  });
  test('wireTuple resolves ordered dependencies', async () => {
    await expect(module1.wireTuple([str$, bool$])).resolves.toStrictEqual([
      'hola',
      true,
    ]);
  });
  test('wireRecord resolves a named map', async () => {
    await expect(
      module1.wireRecord({ greeting: str$, answer: num$ }),
    ).resolves.toStrictEqual({ greeting: 'hola', answer: 42 });
  });
  test('merge prefers bindings from the newer module', async () => {
    const base = Wyr().bind(bool$).toValue(false);
    const override = Wyr().bind(bool$).toValue(true);
    const merged = base.merge(override);

    await expect(merged.wire(bool$)).resolves.toBe(true);
  });
  test('wireTuple runs dependencies in parallel', async () => {
    const slowStr = Wyr()
      .bind(str$)
      .toFunction([], async () => {
        await new Promise((r) => setTimeout(r, 120));
        return 'hola';
      });
    const slowBool = slowStr.bind(bool$).toFunction([], async () => {
      await new Promise((r) => setTimeout(r, 130));
      return true;
    });
    const start = performance.now();
    const result = await slowBool.wireTuple([str$, bool$]);
    const elapsed = performance.now() - start;

    expect(result).toStrictEqual(['hola', true]);
    expect(elapsed).toBeLessThan(200); // should be ~130ms, not 250ms+
  });
  test('rejects when a dependency is absent', async () => {
    const missingDep = Wyr()
      .bind(str_bool$)
      .toFunction([str$, bool$], (s, b) => [s, b]);
    // had to do type assertion, to allow it to compile
    await expect(missingDep.wire(str_bool$ as never)).rejects.toThrow(
      /No binding registered for key/i,
    );
  });
  test('rejects circular dependencies', async () => {
    const cyclic = Wyr()
      .bind(bool$)
      .toValue(true)
      .bind(str$)
      .toFunction([str_bool$], async ([line]) => line)
      .bind(str_bool$)
      .toFunction([str$, bool$], async (line, flag) => [line, flag]);

    await expect(cyclic.wire(str_bool$ as never)).rejects.toThrow(
      /circular dependency/i,
    );
  });
  test('bubbles up factory exceptions', async () => {
    const kaboom = new Error('kaboom');

    const failing = Wyr()
      .bind(bool$)
      .toValue(true)
      .bind(str$)
      .toFunction([], async () => {
        throw kaboom;
      })
      .bind(str_bool$)
      .toFunction([str$, bool$], async (s, b) => [s, b]);

    await expect(failing.wire(str_bool$)).rejects.toThrow(kaboom);
  });
  test('bind.toClass wires class constructors', async () => {
    const module = Wyr()
      .bind(bool$)
      .toValue(true)
      .bind(str$)
      .toFunction([], async () => 'hola')
      .bind(greeter$)
      .toClass([str$, bool$], Greeter);

    const greeter = await module.wire(greeter$);

    expect(greeter).toBeInstanceOf(Greeter);
    expect(greeter.shout()).toBe('hola!');
  });
});
