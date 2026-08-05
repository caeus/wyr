# wyr-ts

Deterministic dependency graphs for TypeScript.

`wyr-ts` is a small dependency wiring library for explicit, immutable provider graphs. You declare providers up front, compose modules with `merge`, tree-shake with `shake`, and resolve everything with `compile`. The TypeScript type system validates missing dependencies, mismatched dependency types, and circular dependency graphs at the call site.

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
| `GraphErr<Graph>`     | Type-level error map: keys with wiring problems mapped to their error details.     |
| `AnyGraph`            | Base constraint for a record of providers; useful for generic utilities.           |

A module exposes:

| Method          | Purpose                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------- |
| `shake(keys)`   | Returns a new module scoped to the given keys and their transitive dependencies.             |
| `compile()`     | Resolves all keys eagerly and returns a `Promise<Container>`. Each `.get(key)` is synchronous. |
| `merge(module)` | Returns a new module where providers from the argument replace providers with the same keys. |

## Defining keys

Provider keys can be any JavaScript `PropertyKey`: `string`, `number`, or `symbol`. Use literal keys (`as const`) or `unique symbol`s when you want TypeScript to track the graph precisely.

```ts
const database = Symbol('database'); // symbol key
const answer = 42 as const;          // number key

const services = Module({
  // Inline string key
  myService: toValue({ ready: true }),

  // Symbol key
  [database]: toValue({ connected: true }),

  // Numeric key
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

const container = await app.shake([repo]).compile();
const userRepo = container.get(repo);
await userRepo.findUser('42');
```

`toFactory` receives dependencies as positional parameters in the same order as its key tuple. Factories may be synchronous or asynchronous.

## Tree-shaking with `shake`

`shake(keys)` returns a new module containing only the given keys and their transitive dependencies. Use it to avoid resolving providers you don't need.

```ts
const container = await app.shake([repo]).compile();
// Only 'config', 'database', and 'repo' are resolved.
// Any other keys in the module are excluded.
```

Calling `compile()` without `shake` resolves every key in the module.

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

const container = await greetings.shake(['greeter']).compile();
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
const container = await testApp.compile();
container.get('config').url; // 'postgres://localhost/test'
```

The original modules are not mutated.

## Type safety

`wyr-ts` encodes each provider's dependency input types and output type. Calling `compile()` is a compile error unless the full graph is valid. Calling `shake(keys).compile()` is a compile error unless the transitive subgraph for those keys is valid.

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

// @ts-expect-error — 'name' is missing from the module
broken.compile();

// But unrelated valid keys are still accessible after shake:
const partial = Module({
  count: toValue(42),
  greeting: toFactory(['name'], (s: string) => s),
});

partial.shake(['count']).compile(); // ok — 'count' has no deps

// @ts-expect-error — 'name' is transitively missing
partial.shake(['greeting']).compile();
```

The `validity?` phantom field on a module is typed as `GraphErr<Graph>`, which surfaces the full error map for invalid graphs — hover over a module variable in your IDE to inspect wiring problems per key.

Runtime guards still reject missing providers and circular dependencies if you bypass the type system with casts.

## Runtime behavior

- A module is immutable after creation.
- Every `compile` call uses a fresh resolution container.
- Within a single call, shared dependencies are resolved once (memoized promises).
- Independent dependencies are resolved concurrently with `Promise.all`.
- Factory errors are not swallowed; they reject the `compile` promise.

## Development

```bash
npx vitest run   # run tests
npx eslint src   # lint
npx tsc --noEmit # type-check
```

## License

MIT
