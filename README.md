<img src="./wyr_logo.png" alt="wyr logo" width="100%" />

# @caeus/wyr


Deterministic dependency graphs for TypeScript.

`@caeus/wyr` is a small dependency wiring library for explicit, immutable provider graphs. You declare providers up front, compose modules with `merge`, tree-shake with `shake`, and resolve everything with `compile`. The TypeScript type system validates missing dependencies, mismatched dependency types, and circular dependency graphs at the call site.

## Installation

```bash
npm install @caeus/wyr
```

```ts
import { Module, toClass, toFactory, toValue } from '@caeus/wyr';
```

## API at a glance

| Export                       | Purpose                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `Module(providers)`          | Creates an immutable module from a record of providers.                                 |
| `toValue(value, tags?)`      | Registers a dependency-free constant or promise-backed value.                           |
| `toFactory(deps, fn, tags?)` | Registers a factory whose positional arguments are resolved from keys or tag selectors. |
| `toClass(deps, ctor, tags?)` | Registers a class constructor with the same dependency and tag behavior.                |
| `GraphErr<Graph>`            | Type-level error map: every problematic key mapped to its problems. See below.          |
| `AnyGraph`                   | Base constraint for a record of providers; useful for generic utilities.                |

Type-level only:

| Export                 | Purpose                                                                           |
| ---------------------- | --------------------------------------------------------------------------------- |
| `ValidModule<Exports>` | Contract for a module that compiles and exposes at least `Exports`. See below.    |
| `Compilation<Graph>`   | `Ok<Resolved<Graph>>` if the graph wires up, otherwise `Failed<GraphErr<Graph>>`. |
| `Resolved<Graph>`      | Maps each binding key to the type its provider resolves to.                       |
| `Ok<T>` / `Failed<E>`  | The two branches of a compilation result.                                         |
| `compilation`          | The phantom field key. Type-only — import it with `import type`.                  |
| `ShakenGraph<G, Keys>` | The transitive closure of `Keys` within `G`, as produced by `shake`.              |
| `TransitiveKeys<G, K>` | `K` plus every key it transitively depends on.                                    |
| `TagDependency<Tag>`   | A `{ tag: Tag }` selector used as a factory or constructor dependency.            |
| `Dependency`           | A direct `PropertyKey` dependency or a tag selector.                              |
| `TaggedKeys<G, Tag>`   | The keys of every provider in `G` carrying `Tag`.                                 |
| `TaggedValues<G, Tag>` | A record mapping every tagged provider key to its resolved value type.            |

A module exposes:

| Method          | Purpose                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `shake(keys)`   | Returns a new module scoped to the given keys and their transitive dependencies.               |
| `compile()`     | Resolves all keys eagerly and returns a `Promise<Container>`. Each `.get(key)` is synchronous. |
| `merge(module)` | Returns a new module where providers from the argument replace providers with the same keys.   |

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
import { Module, toFactory, toValue } from '@caeus/wyr';

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

## Multibindings with tags

A provider can carry any number of `PropertyKey` tags. Pass them as an array or readonly set. A dependency written as `{ tag }` resolves every provider carrying that tag and injects a record keyed by the providers' actual binding keys.

```ts
const handler = Symbol('handler');

const app = Module({
  json: toValue((input: string) => JSON.parse(input), [handler]),
  text: toValue((input: string) => input, [handler]),

  handlers: toFactory(
    [{ tag: handler }],
    (handlers: {
      json: (input: string) => unknown;
      text: (input: string) => string;
    }) => handlers,
  ),
});

const container = await app.shake(['handlers']).compile();
container.get('handlers').json('{"ready":true}');
```

Tag selection has these semantics:

- matching providers are resolved concurrently,
- an unmatched tag injects `{}`,
- the record is unordered,
- string and symbol binding keys are preserved, while number keys follow JavaScript's normal string coercion,
- `shake` retains all matching providers and their transitive dependencies,
- a provider that depends on one of its own tags forms a cycle, and
- replacing a provider with `merge` replaces its tags too.

Use `Reflect.ownKeys(record)` when you need to enumerate symbol-keyed bindings. `Object.keys`, `Object.values`, and `Object.entries` only include enumerable string keys.

Tag records are statically checked when the factory parameter is annotated. `TaggedKeys<Graph, Tag>` and `TaggedValues<Graph, Tag>` expose the same selection at the type level.

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

`@caeus/wyr` encodes each provider's dependency input types and output type. Calling `compile()` is a compile error unless the full graph is valid. Calling `shake(keys).compile()` is a compile error unless the transitive subgraph for those keys is valid.

TypeScript checks that:

- every requested key exists in the module,
- every transitive dependency key exists,
- dependency output types satisfy the factory parameter types, and
- tagged records satisfy their factory parameter types,
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

Runtime guards still reject missing providers and circular dependencies if you bypass the type system with casts.

## Reading `GraphErr`

`GraphErr<Graph>` maps each problematic key to a record of that key's problems. Keys with no problems do not appear, so a valid graph yields `{}`. Keys that are only *depended upon* appear too, even though no provider registers them — that is where an unprovided dependency is reported.

| Field              | Meaning                                                   | Payload                                  |
| ------------------ | --------------------------------------------------------- | ---------------------------------------- |
| `unprovided`       | Nothing in the graph provides this key.                   | `{ requiredBy }` — union of requesters   |
| `unmet`            | A dependency of this key has problems of its own.         | union of the offending dep keys          |
| `mismatched`       | A dependency resolves to a type this key cannot accept.   | record keyed by dep: `{ expected, got }` |
| `taggedMismatched` | A tag record does not satisfy the factory parameter type. | record keyed by tag: `{ expected, got }` |
| `circular`         | This key participates in a dependency cycle.              | the cycle, rotated to start on this key  |

```ts
const app = Module({
  db: toFactory(['config'], (c: Config) => new Db(c)), // 'config' never provided
  port: toValue('8080'),                                // a string
  server: toFactory(['db', 'port'], (d: Db, p: number) => new Server(d, p)),
});
```

`GraphErr<typeof app>` is:

```ts
{
  config: { unprovided: { requiredBy: 'db' } };
  db:     { unmet: 'config' };
  server: { unmet: 'db'; mismatched: { port: { expected: number; got: string } } };
}
```

Each defect is reported once, at the key responsible for it. `config` is named as the root cause a single time no matter how many bindings require it; `db` and `server` each point one hop back rather than repeating the root cause. `port` does not appear at all — it resolves fine, and the wrong expectation belongs to `server`, so a provider is never blamed for what a consumer expected of it. A key can carry several problems at once, as `server` does.

## The compilation ghost field

Every module carries a type-only phantom field holding its **compilation result**: what compiling the module would produce, or the errors compiling it would report.

```ts
readonly [compilation]?: Compilation<Graph>;
```

`Compilation<Graph>` is `Ok<Resolved<Graph>>` when the graph wires up, and `Failed<GraphErr<Graph>>` when it does not. Hover a module variable in your IDE to inspect either branch — a failed module shows the full error map, keyed by binding.

The field is declared, never assigned: nothing is emitted for it and it cannot be observed at runtime. `compile()` is gated on it — `Failed` has no `Ok` member, so it is never assignable to `Ok<unknown>`.

## Requiring a module

Because the ghost field carries the resolved types, a function can demand a module that compiles *and* exposes particular bindings, without naming the graph:

```ts
import { ValidModule } from '@caeus/wyr';

declare function boot(module: ValidModule<{ db: Db }>): Promise<void>;
```

`Exports` is a lower bound on the compiled container: extra bindings are allowed, and each named binding must resolve to a subtype of what you asked for. A module resolving `db` to a `PostgresDb` satisfies `ValidModule<{ db: Db }>`.

| Requirement                        | Written as                     |
| ---------------------------------- | ------------------------------ |
| any module that compiles           | `ValidModule`                  |
| compiles, and exposes `db`         | `ValidModule<{ db: unknown }>` |
| compiles, and `db` is a `Db`       | `ValidModule<{ db: Db }>`      |

```ts
const app = Module({
  db: toFactory([], async () => new PostgresDb()),
  logger: toValue(console),
});

const readDb = async (module: ValidModule<{ db: Db }>): Promise<Db> =>
  (await module.compile()).get('db');

readDb(app); // ok — 'logger' is extra, and PostgresDb is a Db

declare function needsCache(module: ValidModule<{ cache: Cache }>): void;

// @ts-expect-error — 'cache' is not a binding of this module
needsCache(app);
```

`ValidModule` exposes only `compile()`. A consumer that needs to compose further should take `Module<Graph>` instead.

## Runtime behavior

- A module is immutable after creation.
- Every `compile` call uses a fresh resolution container.
- Within a single call, shared dependencies are resolved once (memoized promises).
- Independent dependencies are resolved concurrently with `Promise.all`.
- Factory errors are not swallowed; they reject the `compile` promise.

## Development

Install the repository-pinned dagr launcher once:

```bash
.dagr/install.sh
```

Then run the build graph:

```bash
dagr run ci:test
dagr run ci:lint
dagr run ci:typecheck
dagr run ci:build
dagr run ci:docs
```

## License

MIT
