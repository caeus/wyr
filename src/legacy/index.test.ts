/* eslint-disable @typescript-eslint/no-unused-vars */
import { expect, suite, test } from 'vitest';
import { Wyr } from '..';

const string$: unique symbol = Symbol('string');
const overrideString$: unique symbol = Symbol('overrideString');
const number$: unique symbol = Symbol('number');
const object$: unique symbol = Symbol('object');
const tuple$: unique symbol = Symbol('tuple');
const computedNumber$: unique symbol = Symbol('computedNumber');
const slowOne$: unique symbol = Symbol('slowOne');
const slowTwo$: unique symbol = Symbol('slowTwo');
const cyclic$: unique symbol = Symbol('cyclic');

declare module '..' {
  interface Components {
    [string$]: string;
    [overrideString$]: string;
    [number$]: number;
    [object$]: { readonly x: number };
    [tuple$]: [string, string];
    [computedNumber$]: number;
    [slowOne$]: number;
    [slowTwo$]: number;
    [cyclic$]: string;
  }
}

suite('Wyr new API compatibility scenarios', () => {
  test('retrieves a function binding directly from a registry', async () => {
    const registry = Wyr()
      .bind(string$)
      .toFunction([], async () => 'Hello');

    const string = await registry.wire(string$);

    expect(string).toEqual('Hello');
  });

  test('merge overrides older bindings with newer bindings', async () => {
    const module0 = Wyr().bind(overrideString$).toValue('Hello');
    const module1 = Wyr().bind(overrideString$).toValue('Hola');

    const string = await module0.merge(module1).wire(overrideString$);

    expect(string).toEqual('Hola');
  });

  test('merge order keeps the right-hand registry authoritative', async () => {
    const module0 = Wyr().bind(overrideString$).toValue('Hello');
    const module1 = Wyr().bind(overrideString$).toValue('Hola');

    const string = await module1.merge(module0).wire(overrideString$);

    expect(string).toEqual('Hello');
  });

  test('rejects circular dependencies', async () => {
    const registry = Wyr()
      .bind(cyclic$)
      .toFunction([cyclic$], async (str) => str);

    await expect(registry.wire(cyclic$ as never)).rejects.toThrow(
      /circular dependency/i,
    );
  });

  test('infers dependency parameter types for functions', async () => {
    function complex(
      num: number,
      obj: { readonly x: number },
      arr: [string, string],
    ): number {
      return num + obj.x + arr.join('').length;
    }

    const registry = Wyr()
      .bind(number$)
      .toValue(1)
      .bind(object$)
      .toValue({ x: 2 })
      .bind(tuple$)
      .toValue(['a', 'bc'])
      .bind(computedNumber$)
      .toFunction([number$, object$, tuple$], (a, b, c) => complex(a, b, c));

    await expect(registry.wire(computedNumber$)).resolves.toBe(6);
  });

  test('infers result types for single, tuple, and record wiring', async () => {
    const registry = Wyr()
      .bind(number$)
      .toValue(1)
      .bind(object$)
      .toValue({ x: 2 })
      .bind(tuple$)
      .toValue(['left', 'right']);

    const num: number = await registry.wire(number$);
    const [obj, arr]: readonly [{ readonly x: number }, [string, string]] =
      await registry.wireTuple([object$, tuple$]);
    const record: {
      readonly answer: number;
      readonly pair: [string, string];
    } = await registry.wireRecord({ answer: number$, pair: tuple$ });

    expect(num).toEqual(1);
    expect(obj).toEqual({ x: 2 });
    expect(arr).toEqual(['left', 'right']);
    expect(record).toEqual({ answer: 1, pair: ['left', 'right'] });
  });

  test('parallelizes independent bindings requested as a tuple', async () => {
    const registry = Wyr()
      .bind(slowOne$)
      .toFunction([], async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return 1;
      })
      .bind(slowTwo$)
      .toFunction([], async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return 2;
      });

    const start = performance.now();
    const values = await registry.wireTuple([slowOne$, slowTwo$]);
    const elapsed = performance.now() - start;

    expect(values).toEqual([1, 2]);
    expect(elapsed).toBeLessThan(900);
  });

  test('allows overriding bindings by merging a replacement registry', async () => {
    const original = Wyr().bind(overrideString$).toValue('asd');
    const replacement = Wyr().bind(overrideString$).toValue('123');

    await expect(
      original.merge(replacement).wire(overrideString$),
    ).resolves.toBe('123');
  });

  test('forbids rebinding a key in the same registry chain', () => {
    expect(() =>
      Wyr()
        .bind(overrideString$)
        .toValue('123')
        .bind(overrideString$)
        .toValue('456'),
    ).toThrow(/already bound/i);
  });
});
