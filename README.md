# wyr-ts

Deterministic dependency graphs for TypeScript.

`wyr-ts` is a small dependency wiring library for explicit, immutable provider graphs. You declare providers up front, compose modules with `override`, and ask a module to `wire` one key, an ordered tuple of keys, or a named record of keys. The TypeScript type system validates missing dependencies, mismatched dependency types, and circular dependency graphs at the call site.

## Installation

```bash
npm install wyr-ts
```

```ts
import { Module, toClass, toFactory, toValue } from 'wyr-ts';
```

## API at a glance

| Export                | Purpose                                                                            |
| --------------------- | ---------------------------------------------------------------------------------- |
| `Module(providers)`   | Creates an immutable module from a record of providers.                            |
| `toValue(value)`      | Registers a dependency-free constant or promise-backed value.                      |
| `toFactory(keys, fn)` | Registers a factory whose positional arguments are resolved from `keys`.           |
| `toClass(keys, ctor)` | Registers a class constructor whose positional arguments are resolved from `keys`. |

A module exposes:

| Method                | Purpose                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `wire(key)`           | Resolves one provider key.                                                                                 |
| `wire([keyA, keyB])`  | Resolves an ordered tuple of keys in one shared wiring pass.                                               |
| `wire({ name: key })` | Resolves a named record of keys in one shared wiring pass.                                                 |
| `override(module)`    | Returns a new module where the other module's providers replace providers with the same keys.              |
| `snapshot(keys)`      | Resolves keys once and returns a new module containing those resolved values as dependency-free providers. |

## Defining keys

Provider keys can be any JavaScript `PropertyKey`: `string`, `number`, or `symbol`. A `$` suffix is not required; examples often use plain names, inline string keys, numeric keys, and symbols. Use literal keys (`as const`) or `unique symbol`s when you want TypeScript to track the graph precisely.

```ts
const config = 'config' as const; // string key
const answer = 42 as const; // number key
const database = Symbol('database'); // symbol key

class DefaultMyService {}

const services = Module({
  // A named string constant key. Wire it later with services.wire(config).
  [config]: toValue({ env: 'production' }),

  // An inline string key. Wire it later with services.wire('myService').
  myService: toClass([], DefaultMyService),

  // A numeric key. Wire it later with services.wire(42).
  [answer]: toValue('the answer'),

  // A symbol key. Wire it later with services.wire(database).
  [database]: toValue({ connected: true }),
});
```

## Basic usage

```ts
import { Module, toFactory, toValue } from 'wyr-ts';

const config = 'config' as const;
const database = Symbol('database');
const repo = Symbol('repo');

const app = Module({
  [config]: toValue({ url: 'postgres://localhost/app' }),

  [database]: toFactory([config], async (appConfig: { url: string }) => {
    return {
      query: async (sql: string) => ({ sql, url: appConfig.url }),
    };
  }),

  [repo]: toFactory(
    [database],
    (db: { query: (sql: string) => Promise<unknown> }) => {
      return {
        findUser: (id: string) =>
          db.query(`select * from users where id = ${id}`),
      };
    },
  ),
});

const userRepo = await app.wire(repo);
await userRepo.findUser('42');
```

`toFactory` receives dependencies as positional parameters in the same order as its key tuple. Factories may be synchronous or asynchronous.

## Wiring multiple keys

Each `wire` call creates a fresh internal container. Dependencies resolved during that call share memoized promises, so shared dependencies are only constructed once per call and independent providers run in parallel.

### Tuple output

```ts
const [appConfig, userRepo] = await app.wire([config, repo]);
```

Tuple wiring preserves input order and returns a typed tuple of resolved values.

### Record output

```ts
const wired = await app.wire({
  config,
  repo,
});

wired.config.url;
await wired.repo.findUser('42');
```

Record wiring preserves your chosen output names and returns a typed object.

## Class providers

Use `toClass` when a provider should instantiate a class. Constructor arguments are resolved from the key tuple in order.

```ts
class Greeter {
  constructor(
    private readonly message: string,
    private readonly excited: boolean,
  ) {}

  shout(): string {
    return this.excited ? `${this.message}!` : this.message;
  }
}

const excited = Symbol('excited');

const greetings = Module({
  message: toValue('hello'),
  [excited]: toValue(true),
  greeter: toClass(['message', excited], Greeter),
});

const greeter = await greetings.wire('greeter');
greeter.shout(); // "hello!"
```

## Composing modules with `override`

`override` returns a new module. Providers from the module passed to `override` replace providers with matching keys from the base module.

```ts
const feature = Module({
  [config]: toValue({ url: 'postgres://localhost/app' }),
});

const testOverrides = Module({
  [config]: toValue({ url: 'postgres://localhost/test' }),
});

const testFeature = feature.override(testOverrides);
const testConfig = await testFeature.wire(config);
// testConfig.url === 'postgres://localhost/test'
```

The original modules are not mutated.

## Snapshotting resolved values

`snapshot(keys)` resolves the requested keys once using a shared wiring pass, then returns a new module that contains only those keys as `toValue` providers. This is useful when you want to freeze expensive setup or carry a subset of already-resolved bindings forward.

```ts
const snapshot = await app.snapshot([config, repo]);

const sameConfig = await snapshot.wire(config);
const sameRepo = await snapshot.wire(repo);
```

Only snapshotted keys are available on the returned module. Upstream providers used to build them are not included unless you snapshot those keys too.

## Type safety

`wyr-ts` encodes each provider's dependency input types and output type. When you wire a key, tuple, or record, TypeScript checks that:

- every requested key exists in the module,
- every transitive dependency key exists,
- dependency output types satisfy the factory parameter types, and
- dependency graphs are not circular.

For example, this graph cannot be wired without an unsafe cast because `needsDb` depends on `database`, but the module does not provide `database`:

```ts
const database = Symbol('database');
const needsDb = Symbol('needsDb');

const broken = Module({
  [needsDb]: toFactory([database], (db: { query: () => unknown }) => db),
});

// Type error: the transitive dependency graph is not wireable.
await broken.wire(needsDb);
```

Runtime guards still reject missing providers and circular dependencies if you bypass the type system with casts.

## Runtime behavior

- A module is immutable after creation.
- Every `wire` call uses a fresh memoization container.
- Within a single `wire` or `snapshot` call, shared dependencies are resolved once.
- Independent dependencies are resolved concurrently with `Promise.all`.
- Factory errors are not swallowed; they reject the `wire` or `snapshot` promise.

## Development

This repository uses `make` targets:

```bash
make test    # run Vitest
make lint    # run ESLint
make build   # lint, test, then compile declarations and JavaScript
make docs    # generate TypeDoc documentation
```

## License

MIT
