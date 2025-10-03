# 🕸️ wyr  
> A type-safe dependency planner for TypeScript.  
> No containers. No singletons. Just explicit graphs and compile-time guarantees.

---

### Why *wyr*?  
Most DI frameworks hide too much.  
They mutate containers, rely on decorators, and produce runtime surprises.  

**wyr** is different.  
It’s **stateless**, **immutable**, and **transparent**.  
You describe the graph; the compiler ensures it’s valid — no missing deps, no cycles.  
At runtime, wyr wires exactly what you ask for — **fresh**, **deterministic**, **parallel**.

---

### 🧠 Core ideas

| Concept | Description |
|----------|--------------|
| **Registry** | Immutable set of bindings — no containers, no state. |
| **Graph** | Typed dependencies, checked at compile time, never cyclic. |
| **Wire** | Ask for what you need; wyr figures out the order automatically. |
| **Parallelism** | Independent nodes wire in parallel for speed. |
| **Type Safety** | The compiler guarantees all dependencies exist and match. |
| **Determinism** | Same graph, same result — always reproducible. |


---

### ⚡ Example

```ts
type logger$ = typeof logger$, cfg$ = typeof cfg$, db$ = typeof db$, repo$ = typeof repo$, api$ = typeof api$

declare global {
  interface Services {
    [logger$]: Console
    [cfg$]: { url: string }
    [db$]: { query: (s: string) => unknown }
    [repo$]: ReturnType<typeof makeRepo>
    [api$]: ReturnType<typeof makeApi>
  }

}
const reg = Wyr()
  .bind(logger$).toValue(console)
  .bind(cfg$).toValue({ url: "postgres://..." })
  .bind(db$).toFunction([cfg$], cfg => openDb(cfg.url))
  .bind(repo$).toFunction([db$, logger$], (db, log) => makeRepo(db, log))
  .bind(api$).toFunction([repo$, logger$], (r, log) => makeApi(r, log))

// parallel by level, deterministic
const api = await reg.wire(api$)
const [repo, api2] = await reg.wireTuple([repo$, api$])
const rec = await reg.wireRecord({ repo: repo$, api: api$, db: db$ })
```
✅ Type errors for missing deps  
✅ Compile-time cycle detection  
✅ Parallel execution per level  
✅ No shared memory or hidden caching  

---

### 🧩 Composition

Registries are composable.  
You can merge, extend, or bind constants — all immutably.

```ts
const core = Wyr().bind(cfg$).toValue({ url: "postgres://..." })
const feature = Wyr().bind(repo$).toFunction([cfg$], makeRepo)
const app = core.merge(feature)
```

Every registry is **just data**.  
You can diff it, snapshot it, or reuse it.

---

### 🧭 Philosophy

- **Explicitness** — nothing is hidden, nothing is implicit  
- **Immutability** — registries never mutate; merges create new ones  
- **Determinism** — same graph, same plan, same result  
- **Transparency** — the wiring plan is visible and predictable  
- **Statelessness** — no containers, no caches, no lifetimes  

---

### 🧱 wyr vs DI

| | Classic DI | wyr |
|---|---|---|
| Container | ✅ | 🚫 |
| Singletons | ✅ | 🚫 |
| Hidden state | ✅ | 🚫 |
| Compile-time checks | ❌ | ✅ |
| Parallel build | ❌ | ✅ |
| Immutability | ❌ | ✅ |

---

### 🧪 Status  
Early but functional.  
Type-level validation is stable.  
Runtime planner is deterministic and parallel.  
Finalizers and teardown semantics are under design — they’ll just be nodes in the graph.

---

### 💬 Inspiration  
Build systems, graph planners, and the belief that **explicit beats magical**.  
wyr wires what you ask for — nothing more, nothing less.
