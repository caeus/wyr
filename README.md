# wyr-ts

Deterministic dependency graphs for TypeScript.

`wyr-ts` is a small dependency wiring library for explicit, immutable provider graphs. You declare providers up front, compose modules with `merge`, and ask a module to `wire` or `compile` all keys or a scoped subset. The TypeScript type system validates missing dependencies, mismatched dependency types, and circular dependency graphs at the call site.

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

| Method              | Purpose                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `wire()`            | Returns a `LazyContainer` over all keys. Each `.get(key)` returns a `Promise`.                 |
| `wire([keys])`      | Returns a `LazyContainer` scoped to the given keys and their transitive dependencies.           |
| `compile()`         | Resolves all keys eagerly and returns a `Promise<EagerContainer>`. Each `.get(key)` is synchronous. |
| `compile([keys])`   | Resolves the given keys and their transitive dependencies eagerly.                              |
| `merge(module)`     | Returns a new module where providers from the argument replace providers with the same keys.    |

## Defining keys

Provider keys can be any JavaScript `PropertyKey`: `string`, `number`, or `symbol`. Use literal keys (`as const`) or `unique symbol`s when you want TypeScript to track the graph precisely.

```ts
const database = Symbol('database'); // symbol key
const answer = 42 as const;          // number key

const services = Module({
  // Inline string key — wire with services.wire(['myService'])
  myService: toValue({ ready: true }),

  // Symbol key — wire with services.wire([database])
  [database]: toValue({ connected: true }),

  // Numeric key — wire with services.wire([answer])
  [answer]: toValue('the answer'),
});
```

## Basic usage

```ts
import { Module, toFactory, toValue } from 'wyr-ts';

const database = Symbol('database');
const repo = Symbol('repo');

const app = Module({
  config: toValue({ url: 'postgres://localhost/app' }),

  [database]: toFactory(['config'], async (cfg: { url: string }) => ({
    query: async (sql: string) => ({ sql, url: cfg.url }),
  })),

  [repo]: toFactory(
    [database],
    (db: { query: (sql: string) => Promise<unknown> }) => ({
      findUser: (id: string) => db.query(`select * from users where id = ${id}`),
    }),
  ),
});

const container = await app.compile([repo]);
const userRepo = container.get(repo);
await userRepo.findUser('42');
```

`toFactory` receives dependencies as positional parameters in the same order as its key tuple. Factories may be synchronous or asynchronous.

## LazyContainer vs EagerContainer

`wire` returns a `LazyContainer` — calling `.get(key)` triggers resolution on demand and returns a `Promise`. Dependencies resolved in the same `wire` call share memoized promises.

`compile` resolves everything up front and returns an `EagerContainer` — `.get(key)` is synchronous and returns the value directly. Use `compile` when you want all values ready before proceeding.

```ts
// Lazy — resolves on demand
const lazy = app.wire(['config', repo]);
const cfg = await lazy.get('config');

// Eager — resolves everything first
const eager = await app.compile(['config', repo]);
const cfg2 = eager.get('config'); // synchronous
```

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

const greetings = Module({
  message: toValue('hello'),
  excited: toValue(true),
  greeter: toClass(['message', 'excited'], Greeter),
});

const container = await greetings.compile(['greeter']);
container.get('greeter').shout(); // "hello!"
```

## Composing modules with `merge`

`merge` returns a new module. Providers from the module passed to `merge` replace providers with matching keys from the base module.

```ts
const app = Module({
  config: toValue({ url: 'postgres://localhost/app' }),
});

const testOverrides = Module({
  config: toValue({ url: 'postgres://localhost/test' }),
});

const testApp = app.merge(testOverrides);
const container = await testApp.compile(['config']);
container.get('config').url; // 'postgres://localhost/test'
```

The original modules are not mutated.

## Type safety

`wyr-ts` encodes each provider's dependency input types and output type. Calling `wire()` or `compile()` is a compile error unless the full graph is valid. Calling `wire([keys])` or `compile([keys])` is a compile error unless the transitive subgraph for those keys is valid.

TypeScript checks that:

- every requested key exists in the module,
- every transitive dependency key exists,
- dependency output types satisfy the factory parameter types, and
- dependency graphs are not circular.

```ts
const broken = Module({
  greeting: toFactory(['name'], (s: string) => s),
  // 'name' is never provided
});

// Type error: 'name' is missing from the module.
broken.wire();
broken.compile();

// But unrelated valid keys are still accessible:
const partial = Module({
  count: toValue(42),
  greeting: toFactory(['name'], (s: string) => s),
});

partial.wire(['count']);    // ok — 'count' has no deps
partial.compile(['count']); // ok

// @ts-expect-error — 'name' is transitively missing
partial.wire(['greeting']);
```

The `_graphErr` phantom field on a module surfaces the full error map for invalid graphs — hover over a module variable in your IDE to inspect wiring problems per key.

Runtime guards still reject missing providers and circular dependencies if you bypass the type system with casts.

## Runtime behavior

- A module is immutable after creation.
- Every `wire` or `compile` call uses a fresh resolution container.
- Within a single call, shared dependencies are resolved once (memoized promises).
- Independent dependencies are resolved concurrently with `Promise.all`.
- Factory errors are not swallowed; they reject the `compile` promise or the individual `.get()` promise on a `LazyContainer`.

## Development

```bash
npx vitest run   # run tests
npx eslint src   # lint
npx tsc --noEmit # type-check
```

## License

MIT
