# Wyr

**Pronounced**: _wire_  
**Wyr** is a zero-crap, zero-dependency, lightweight, and typesafe dependency injection framework for TypeScript. It’s designed to be simple yet powerful, with full support for asynchronous bindings.

## Features

- **Typesafe**: Enjoy TypeScript’s type safety when defining and retrieving dependencies.
- **Async Bindings**: First class support for async initialization and parallelization of initialization.
- **Thread-safe**: Modules are immutable and can be shared safely.

## Installation

To install Wyr, run:

```bash
npm install --save wyr-ts
```
## Core concepts

### Modules

A **Module** is where bindings are defined. You can create a module using `Wyr.module()`, which will create an empty module.
Modules are lightweight, immutable, and can be merged with other modules to combine bindings.
```typescript
const userModule = Wyr.module()
    .bind(UserService.key).toClass([UserRepo.key,UserEventEmitter.key],DefaultUserService)
    .bind(UserEventEmitter.key).toFun([KafkaFactory.key,DefaultUserEventEmitter.Config.key],createUserEventEmitter)
    .bind(UserRepo.key).toClass([MongoDatabase.key,MongoUserRepo.Config.key],MongoUserRepo)
```
### Containers
A **Container** is created from a module and is used to initialize and retrieve dependencies. Once you've defined bindings in multiple modules, you can get a container from it, to access the bound dependencies.
You cannot bind dependencies to a container, they have to be bound to a module.

```typescript
const container = Wyr.container(userModule,mongoModule,kafkaModule,httpModule)
//or
const container = userModule.mergedWith(mongoModule).mergedWith(kafkaModule).mergedWith(httpModule).asContainer()
```

### Binding keys
A **Bindking Key** is a unique identifier for each dependency.. You can create them using `Symbol` and a type annotation which ensures uniqueness and type safety

```typescript
namespace UserService{
    const key:BindingKey<UserService> = Symbol('UserService')
}
```
### Bindings
A **Binding** connects a binding key to a dependency (ie, a way to build it using other dependencies). You can bind a key to a dependency using `module.bind(key).toClass` or `module.bind(key).toFun` or `module.bind(key).toValue`.
Modules are immutable, so whenever you bind something, it will return a new module with the new binding in it. So it's important you chain bindings.
```typescript
const userModule = Wyr.module()
    .bind(UserService.key).toClass([UserRepo.key,UserEventEmitter.key],DefaultUserService)
    .bind(UserEventEmitter.key).toFun([KafkaFactory.key,DefaultUserEventEmitter.Config.key],createUserEventEmitter)
    .bind(UserRepo.key).toClass([MongoDatabase.key,MongoUserRepo.Config.key],MongoUserRepo)
```
### Retrieving dependencies.
You can retrieve dependencies from a container using the `.get` method. this method takes a key, or a tuple of keys, and will return a promise with the dependency, or a tuple of dependencies.
Tuple semantics were added to be able to leverage parallelization of initialization.
```typescript
const userService = await container.get(UserService.key) 
// OR
const [userService,kafkaFactory] = await container.get([UserService.key,KafkaFactory.key])
```

### License

Wyr is licensed under the MIT License.
