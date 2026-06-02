import { describe, expect, expectTypeOf, test } from 'vitest';
import { Wyr } from '.';

const bool$: unique symbol = Symbol('bool');
const num$: unique symbol = Symbol('num');
const str$: unique symbol = Symbol('str');
const tuple$: unique symbol = Symbol('tuple');
const greeter$: unique symbol = Symbol('greeter');
const request$: unique symbol = Symbol('request');

class Greeter {
  constructor(
    private readonly message: string,
    private readonly excited: boolean,
  ) {}

  shout(): string {
    return this.excited ? `${this.message}!` : this.message;
  }
}

type Request = {
  readonly greeting: string;
  readonly answer: number;
};

declare module '.' {
  interface Components {
    [bool$]: boolean;
    [num$]: number;
    [str$]: string;
    [tuple$]: readonly [string, boolean];
    [greeter$]: Greeter;
    [request$]: Request;
  }
}

const base = Wyr().bind(bool$).toValue(true).bind(num$).toValue(42);

const app = base
  .bind(str$)
  .toFunction([bool$], (excited) => (excited ? 'hola!' : 'hola'))
  .bind(tuple$)
  .toFunction([str$, bool$], (message, excited) => [message, excited])
  .bind(greeter$)
  .toClass([str$, bool$], Greeter)
  .bind(request$)
  .toFunction([str$, num$], (greeting, answer) => ({ greeting, answer }));

describe('Wyr API 2.0', () => {
  test('creates immutable registries with bind().toValue() and bind().toFunction()', async () => {
    await expect(app.wire(tuple$)).resolves.toStrictEqual(['hola!', true]);
    await expect(base.wire(num$)).resolves.toBe(42);

    await expect(base.wire(str$ as never)).rejects.toThrow(
      /No binding registered for key/i,
    );
  });

  test('infers dependency and result types from component keys', async () => {
    const resolvedTuple = app.wireTuple([str$, bool$, num$]);
    expectTypeOf(resolvedTuple).toEqualTypeOf<
      Promise<readonly [string, boolean, number]>
    >();

    const resolvedRecord = app.wireRecord({ greeting: str$, answer: num$ });
    expectTypeOf(resolvedRecord).toEqualTypeOf<
      Promise<{ readonly greeting: string; readonly answer: number }>
    >();

    await expect(resolvedTuple).resolves.toStrictEqual(['hola!', true, 42]);
    await expect(resolvedRecord).resolves.toStrictEqual({
      greeting: 'hola!',
      answer: 42,
    });
  });

  test('wireRecord resolves named dependency maps', async () => {
    await expect(
      app.wireRecord({ request: request$, tuple: tuple$ }),
    ).resolves.toStrictEqual({
      request: { greeting: 'hola!', answer: 42 },
      tuple: ['hola!', true],
    });
  });

  test('merge() composes registries and lets the merged-in registry override keys', async () => {
    const overrides = Wyr()
      .bind(bool$)
      .toValue(false)
      .bind(str$)
      .toFunction([bool$], (excited) => (excited ? 'hello!' : 'hello'));

    const merged = app.merge(overrides);

    await expect(merged.wire(bool$)).resolves.toBe(false);
    await expect(merged.wire(str$)).resolves.toBe('hello');
    await expect(app.wire(str$)).resolves.toBe('hola!');
  });

  test('wireTuple starts independent bindings in parallel', async () => {
    const slowGraph = Wyr()
      .bind(str$)
      .toFunction([], async () => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return 'slow string';
      })
      .bind(bool$)
      .toFunction([], async () => {
        await new Promise((resolve) => setTimeout(resolve, 130));
        return true;
      });

    const start = performance.now();
    const result = await slowGraph.wireTuple([str$, bool$]);
    const elapsed = performance.now() - start;

    expect(result).toStrictEqual(['slow string', true]);
    expect(elapsed).toBeLessThan(220);
  });

  test('shares resolved dependencies inside a single wiring request', async () => {
    let invocations = 0;
    const graph = Wyr()
      .bind(str$)
      .toFunction([], () => {
        invocations += 1;
        return 'cached per wire';
      })
      .bind(tuple$)
      .toFunction([str$], (message) => [message, true])
      .bind(request$)
      .toFunction([str$, num$], (greeting, answer) => ({ greeting, answer }))
      .bind(num$)
      .toValue(7);

    await expect(
      graph.wireRecord({ tuple: tuple$, request: request$ }),
    ).resolves.toStrictEqual({
      tuple: ['cached per wire', true],
      request: { greeting: 'cached per wire', answer: 7 },
    });
    expect(invocations).toBe(1);

    await graph.wire(str$);
    expect(invocations).toBe(2);
  });

  test('rejects missing dependencies at runtime when the type guard is bypassed', async () => {
    const missingDep = Wyr()
      .bind(tuple$)
      .toFunction([str$, bool$], (s, b) => [s, b]);

    await expect(missingDep.wire(tuple$ as never)).rejects.toThrow(
      /No binding registered for key/i,
    );
  });

  test('rejects circular dependencies at runtime when the type guard is bypassed', async () => {
    const cyclic = Wyr()
      .bind(str$)
      .toFunction([tuple$], ([line]) => line)
      .bind(tuple$)
      .toFunction([str$, bool$], (line, flag) => [line, flag])
      .bind(bool$)
      .toValue(true);

    await expect(cyclic.wire(tuple$ as never)).rejects.toThrow(
      /circular dependency/i,
    );
  });

  test('propagates factory errors', async () => {
    const kaboom = new Error('kaboom');
    const graph = Wyr()
      .bind(str$)
      .toFunction([], async () => {
        throw kaboom;
      })
      .bind(tuple$)
      .toFunction([str$, bool$], (message, excited) => [message, excited])
      .bind(bool$)
      .toValue(true);

    await expect(graph.wire(tuple$)).rejects.toThrow(kaboom);
  });

  test('snapshot() materializes resolved keys as value bindings', async () => {
    let invocations = 0;
    const graph = Wyr()
      .bind(bool$)
      .toValue(true)
      .bind(str$)
      .toFunction([bool$], (excited) => {
        invocations += 1;
        return excited ? 'snapshot!' : 'snapshot';
      });

    const snapshot = await graph.snapshot(str$, bool$);

    expect(invocations).toBe(1);
    await expect(snapshot.wire(str$)).resolves.toBe('snapshot!');
    await expect(snapshot.wire(bool$)).resolves.toBe(true);
    await snapshot.wire(str$);
    expect(invocations).toBe(1);
  });

  test('bind().toClass() wires class constructors', async () => {
    const greeter = await app.wire(greeter$);

    expect(greeter).toBeInstanceOf(Greeter);
    expect(greeter.shout()).toBe('hola!!');
  });

  test('rejects duplicate bindings on the same registry', () => {
    expect(() => app.bind(str$).toValue('duplicate')).toThrow(/already bound/i);
  });
});
