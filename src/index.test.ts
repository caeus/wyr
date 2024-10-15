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
      .to(Wyr.creator()(async () => 'Hello'));

    const container = Wyr.container(module);
    const [string] = await container.get(key);
    expect(string == 'Hello').true;
  });
  test('override module 0', async () => {
    const key: BindingKey<string> = Symbol('string');
    const module0 = Wyr.module()
      .bind(key)
      .to(Wyr.creator()(async () => 'Hello'));
    const module1 = Wyr.module()
      .bind(key)
      .to(Wyr.creator()(async () => 'Hola'));

    const container = Wyr.container(module0, module1);
    const [string] = await container.get(key);
    expect(string == 'Hola').true;
  });
  test('override module 1', async () => {
    const key: BindingKey<string> = Symbol('string');
    const module0 = Wyr.module()
      .bind(key)
      .to(Wyr.creator()(async () => 'Hello'));
    const module1 = Wyr.module()
      .bind(key)
      .to(Wyr.creator()(async () => 'Hola'));

    const container = module0.mergeWith(module1).asContainer();
    const [string] = await container.get(key);
    expect(string == 'Hola').true;
  });
  test('rejects circular deps', async () => {
    const key: BindingKey<string> = Symbol('string');
    const module0 = Wyr.module()
      .bind(key)
      .to(Wyr.creator(key)(async (str) => str));
    const container = Wyr.container(module0);
    await expect(container.get(key)).rejects.toThrow();
  });
  test('parallelize multiple bindings', async () => {
    const keys = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(
      (n) => Symbol(`${n}`) as BindingKey<string>,
    );
    let _module = Wyr.module();
    for (const key of keys) {
      _module = _module
        .bind(key)
        .to(Wyr.creator()(async () => 
            new Promise(resolve=>setTimeout(resolve,500,key.description ?? ''))
            
    ));
    }

    const key: BindingKey<string> = Symbol('string');
    const module = _module
      .bind(key)
      .to(Wyr.creator(...keys)(async (...ss) => ss.join('')));
    const container = Wyr.container(module);
    const start = +new Date()
    const [value] =  await container.get(key)
     expect(value).toEqual("0123456789")
    const end = +new Date()
    expect((end-start)/500).toBeCloseTo(1,0)
  });
});
