# Wyr

**Pronounced**: *wire*  
**Wyr** is a zero-crap, zero-dependency, lightweight, and typesafe dependency injection framework for TypeScript. It’s designed to be simple yet powerful, with full support for asynchronous bindings.

## Features

- **Typesafe**: Enjoy TypeScript’s type safety when defining and retrieving dependencies.
- **Async Bindings**: Seamlessly handle asynchronous creation of dependencies.

## Installation

To install Wyr, run:

```bash
npm install --save wyr-ts
```
## Basic Usage

### Creating a Module and Binding Dependencies
Wyr uses modules to define bindings. Each binding has a unique key and a creator that builds the dependency.

```typescript
import Wyr, { BindingKey } from 'wyr-ts';

// Create a new module
const module = Wyr.module();

// Define binding keys for the dependencies
const userRepoKey: BindingKey<UserRepo> = Symbol('UserRepo');
const userEventEmitterKey: BindingKey<UserEventEmitter> = Symbol('UserEventEmitter');
const userServiceKey: BindingKey<UserService> = Symbol('UserService');

// Bind the UserEventEmitter
module.bind(userEventEmitterKey).toClass([],UserEventEmitter);

// Bind the UserRepo
module.bind(userRepoKey).toClass([],UserRepo);

// Bind the  UserService that depends on UserRepo and UserEventEmitter
module.bind(userServiceKey).toClass([userRepoKey, userEventEmitterKey],UserService);

// Create a container from the module
const container = module.asContainer();

// Retrieve multiple dependencies, including the UserService and UserEventEmitter
const [userService, userEventEmitter] = await container.get(userServiceKey, userEventEmitterKey);

// Use the UserService and UserEventEmitter
userService.performAction();

```
#### Explanation:
**Binding Keys**: userRepoKey, loggerKey, and userServiceKey uniquely identify each service.

**Creators**: Internally we bind keys to creators. Creators are but a reified version of a function, in which each param is associated with a key (and a known type)

**Retrieving Dependencies**: Multiple keys can be passed to `container.get(...)` to retrieve a tuple of dependencies, in this case UserService and UserEventEmitter.

#### Merging Modules
Sometimes it comes in handy to group multiple bindings into a module, and create a container out of multiple modules.
Modules can be merged, allowing you to compose dependencies from different parts of your application.

```typescript
const anotherModule = Wyr.module();
// Merge modules together
module.mergeWith(anotherModule);
```
and a container can be created out of multiple modules like this:
```typescript
const container = Wyr.container(module1,module2,module3)
```

### License
Wyr is licensed under the MIT License.