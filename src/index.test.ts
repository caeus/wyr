import { expect, suite, test } from 'vitest';
import { BindingKey, Wyr } from '.';

type TCO<T> =
  | {
      pending: true;
      continue: () => TCO<T>;
    }
  | {
      pending: false;
      value: T;
    };
function unfold<T>(tco: TCO<T>): T {
  let value = tco;
  while (value.pending) {
    value = value.continue();
  }
  return value.value;
}

suite('Module', () => {
  test('retrieve binding', async () => {
    const key: BindingKey<string> = Symbol('string');
    const module = Wyr.module()
      .bind(key)
      .to(Wyr.reifyFun([], async () => 'Hello'));

    const container = Wyr.container(module);
    const string = await container.get(key);
    expect(string).toEqual('Hello');
  });
  test('override module 0', async () => {
    const key: BindingKey<string> = Symbol('string');
    const module0 = Wyr.module()
      .bind(key)
      .to(Wyr.reifyFun([], async () => 'Hello'));
    const module1 = Wyr.module()
      .bind(key)
      .to(Wyr.reifyFun([], async () => 'Hola'));

    const container = Wyr.container(module0, module1);
    const string = await container.get(key);
    expect(string).toEqual('Hola');
  });
  test('override module 1', async () => {
    const key: BindingKey<string> = Symbol('string');
    const module0 = Wyr.module()
      .bind(key)
      .to(Wyr.reifyFun([], async () => 'Hello'));
    const module1 = Wyr.module()
      .bind(key)
      .to(Wyr.reifyFun([], async () => 'Hola'));

    const container = module0.mergeWith(module1).asContainer();
    const string = await container.get(key);
    expect(string).toEqual('Hola');
  });
  test('rejects circular deps', async () => {
    const key: BindingKey<string> = Symbol('string');
    const module0 = Wyr.module()
      .bind(key)
      .to(Wyr.reifyFun([key], async (str) => str));
    const container = Wyr.container(module0);
    await expect(container.get(key)).rejects.toThrow();
  });
  test('type inference creator', async () => {
    function complex(
      num: number,
      obj: { x: number },
      arr: [string, string],
    ): number {
      return 0;
    }
    const nk: BindingKey<number> = Symbol('nk');
    const ok: BindingKey<{ x: number }> = Symbol('ok');
    const ak: BindingKey<[string, string]> = Symbol('ak');
    Wyr.reifyFun([nk, ok, ak], (a, b, c) => complex(a, b, c)); // with it compiling, I'm more than happy
    Wyr.module()
      .bind(nk)
      .toFun([nk, ok, ak], async (a, b, c) => complex(a, b, c)); // it compiles...
  });
  test('type inference container.get', async () => {
    function complex(
      num: number,
      obj: { x: number },
      arr: [string, string],
    ): number {
      return 0;
    }
    const nk: BindingKey<number> = Symbol('nk');
    const ok: BindingKey<{ x: number }> = Symbol('ok');
    const ak: BindingKey<[string, string]> = Symbol('ak');
    Wyr.container()
      .get(nk)
      .then((s) => {
        const n: number = s;
      })
      .catch((e) => void e); // as long as it compiles

    Wyr.container()
      .get([nk, ok, ak])
      .then(([a, b, c]) => complex(a, b, c))
      .catch((e) => void e);
    Wyr.reifyFun([nk, ok, ak], (a, b, c) => complex(a, b, c)); // with it compiling, I'm more than happy
    Wyr.module()
      .bind(nk)
      .toFun([nk, ok, ak], async (a, b, c) => complex(a, b, c)); // it compiles...
  });
  test('parallelize multiple bindings', async () => {
    const keys = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(
      (n) => Symbol(`${n}`) as BindingKey<string>,
    );
    let _module = Wyr.module();
    for (const key of keys) {
      _module = _module
        .bind(key)
        .to(
          Wyr.reifyFun(
            [],
            async () =>
              new Promise((resolve) =>
                setTimeout(resolve, 500, key.description ?? ''),
              ),
          ),
        );
    }

    const key: BindingKey<string> = Symbol('string');
    const module = _module
      .bind(key)
      .to(Wyr.reifyFun(keys, async (...ss) => ss.join('')));
    const container = Wyr.container(module);
    const start = +new Date();
    const value = await container.get(key);
    expect(value).toEqual('0123456789');
    const end = +new Date();
    expect((end - start) / 500).toBeCloseTo(1, 0);
  });
});
