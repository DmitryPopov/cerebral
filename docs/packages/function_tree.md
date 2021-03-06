# function-tree

## Install
`npm install function-tree@next --save --save-exact`

## Description
Function-tree is the what Cerebral extends to create its signal implementation. Basically a function-tree allows you to execute a tree of functions. You can use the Cerebral debugger to debug function tree execution in any JS environment.

Function-tree is somewhat in the same family as Rxjs and Promises. The main difference is that Rxjs and Promises  are based on value transformation. That means only the value returned from the previous function is available in the next. This works when you indeed want to transform values, but events in your application are rarely about value transformation, they are about running side effects and going through one of multiple execution paths. Function tree embraces the fact that most of what we do in application development is running side effects.

Rxjs and Promises are also about execution control, but neither of them have declarative conditional execution paths, you have to write an *IF* or *SWITCH* statement or decouple streams. With function tree you are able to diverge the execution down paths just as declaratively as functions. This helps readability.

## API

### instantiate

```js
import FunctionTree from 'function-tree'
// Node:
// const FunctionTree = require('function-tree').FunctionTree

const ft = new FunctionTree({
  // add side effect libraries to context
})

ft.run([
// returns a promise
  function someFunc (context) {},
  function someOtherFunc (context) {}
], {
  foo: 'bar' // optional payload
})
.catch((error) => {
  // Current payload with execution details,
  // can be passed in to a new execution (will be indicated in debugger)
  error.payload

  // A serialized version of the error. Name, message and stack, or custom error serialization
  error.payload.error
})
```

You can also add multiple custom context providers by using an array:

```js
const ft = new FunctionTree([{
    // add side effect libraries to context
  },
  SomeCustomProvider()
])
```

## errors

### FunctionTreeError (base)
```js
import {FunctionTreeError} from 'function-tree'
// Node:
// const FunctionTreeError = require('function-tree').FunctionTreeError

// Error structure
{
  name: 'FunctionTreeError',
  message: 'Some function-tree error'
  stack: '...'  
}
```

### FunctionTreeExecutionError
```js
import {FunctionTreeExecutionError} from 'function-tree'
// Node:
// const FunctionTreeExecutionError = require('function-tree').FunctionTreeExecutionError

// Error structure
{
  name: 'FunctionTreeExecutionError',
  message: 'Some execution error'
  execution: {name: 'someName'},
  funcDetails: {name: 'someFunction', functionIndex: 5},
  payload: {foo: 'bar'},
  stack: '...'  
}
```

### devtools
Download the function tree standalone debugger for [Mac](https://drive.google.com/file/d/0B1pYKovu9Upyb1Bkdm5IbkdBN3c/view?usp=sharing), [Windows](https://drive.google.com/file/d/0B1pYKovu9UpyMGRRbG45dWR6R1k/view?usp=sharing) or [Linux](https://drive.google.com/file/d/0B1pYKovu9UpyMFQ5dEdnSy1aN0E/view?usp=sharing).

```js
import FunctionTree from 'function-tree'
import Devtools from 'function-tree/devtools'
// Node:
// const FunctionTree = require('function-tree').FunctionTree
// const Devtools = require('function-tree/devtools').Devtools

const ft = new FunctionTree([])

// Pass the instance of function-tree to debug. You can
// optionally pass an array of function-trees
if (process.env.NODE_ENV !== 'production') {
  Devtools(ft, {
    remoteDebugger: 'localhost:8585'
  })  
}
```

You can use it when creating providers to easily wrap their usage:

```js
function MyProvider (options = {}) {
  let cachedProvider = null

  function createProvider (context) {
    return {
      doSomething() {},
      doSomethingElse() {}
    }
  }

  return (context) => {
    context.myProvider = cachedProvider = (cachedProvider || createProvider(context))

    if (context.debugger) {
      context.debugger.wrapProvider('myProvider')
    }

    return context
  }
}
```

### sequence
You can use an array literal to define a sequence of functions.

```js
function someFunction (context) {}
function someOtherFunction (context) {}

module.exports = [
  someFunction,
  someOtherFunction
]
```

Or you can be explicit by using the **sequence** function:

```js
import {sequence} from 'function-tree'
// Node:
// const sequence = require('function-tree').sequence

function someFunction (context) {}
function someOtherFunction (context) {}

module.exports = sequence([
  someFunction,
  someOtherFunction
])
```

The first argument to **sequence** can be a string, which names the sequence. This will be shown in the debugger. If it is the root sequence it will be used as the name of the execution itself.

```js
import {sequence} from 'function-tree'
// Node:
// const sequence = require('function-tree').sequence

function someFunction (context) {}
function someOtherFunction (context) {}

module.exports = sequence('My awesome sequence', [
  someFunction,
  someOtherFunction
])
```

### parallel
```js
import {parallel} from 'function-tree'
// Node:
// const sequence = require('function-tree').parallel

function someFunction (context) {}
function someOtherFunction (context) {}

module.exports = parallel([
  someFunction,
  someOtherFunction
])
```

Even though **someFunction** returns a Promise, **someOtherFunction** will be run immediately.

### context

#### props

```js
import FunctionTree from 'function-tree'
// Node:
// const FunctionTree = require('function-tree').FunctionTree

function funcA (context) {
  context.props.foo // "bar"
}

const ft = new FunctionTree()
const tree = [
  funcA
]

ft.run(tree, {foo: 'bar'})
```

#### path
The path is only available on the context when the function can diverge the execution down a path.

```js
import FunctionTree from 'function-tree'
// Node:
// const FunctionTree = require('function-tree').FunctionTree

function funcA (context) {
  context.props.foo // "bar"

  return context.path.pathA({foo2: 'bar2'})
}

function funcB (context) {
  context.props.foo // "bar"
  context.props.foo2 // "bar2"

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({foo3: 'bar3'})
    }, 100)
  })
}

function funcC(context) {
  context.props.foo // "bar"
  context.props.foo2 // "bar2"
  context.props.foo3 // "bar3"
}

const ft = new FunctionTree([])
const tree = [
  funcA, {
    pathA: [
      funcB,
      funcC
    ],
    pathB: []
  }
]

ft.run(tree, {foo: 'bar'})
```

### error
```js
import FunctionTree from 'function-tree'
// Node:
// const FunctionTree = require('function-tree').FunctionTree
const ft = new FunctionTree([])

// As an event (async)
ft.on('error', function (error, execution, payload) {})

// As callback for single execution
// Triggers sync/async depending on where error occurs
ft.run(tree, (error) => {})

// As callback (sync)
ft.run(tree, (error, execution, payload) => {
  if (error) {
    // There is an error
  }
})
```

### provider
A provider gives you access to the current context and other information about the execution. It is required that you return the context or a mutated version of it.

```js
import FunctionTree from 'function-tree'
// Node:
// const FunctionTree = require('function-tree').FunctionTree

function MyProvider(context, functionDetails, payload) {
  context // Current context
  context.props // Input created by the PropsProvider (default)

  payload // The current payload (Used by PropsProvider)

  functionDetails.name // Name of the function
  functionDetails.functionIndex // The index of the function in the tree, like an ID
  functionDetails.function // A reference to the running function
  functionDetails.isParallel // If the function is running in parallel with others

  context.execution.name // Function tree id
  context.execution.id // Current execution id
  context.execution.staticTree // The static representation of the tree
  context.execution.datetime // Time of execution
  context.execution.functionTree // The function tree instance

  return context // Always return the changed context
}

const ft = new FunctionTree([
  MyProvider
])
```

Providers lets us do some pretty amazing things. The debugger for **function-tree** is actually just a provider that sends information to the debugger about execution and exposes an API for other providers to send their own data to the debugger.

#### StopExecutionProvider
By using a condition you can tell the function tree to stop executions.

```js
import {StopExecutionProvider} from 'function-tree'
// Node:
// const StopExecutionProvider = require('function-tree').StopExecutionProvider

const ft = new FunctionTree([
  StopExecutionProvider({
    nameOfExecution (context) {
      return context.props.stop
    }
  })
])
```

If the condition returns true the execution will throw an error and stop.

### events
The execute function is also an event emitter.

```js
import FunctionTree from 'function-tree'
// Node:
// const FunctionTree = require('function-tree').FunctionTree

const ft = new FunctionTree([])
const tree = [
  funcA
]

// When an error is thrown, also catches promise errors
ft.on('error', (error, execution, payload) => {})

// When a function tree is executed
ft.on('start', (execution, payload) => {})

// When a function tree execution has ended
ft.on('end', (execution, payload) => {})

// When a function tree goes down a path
ft.on('pathStart', (execution, payload) => {})

// When a function tree ends execution of a path
ft.on('pathEnd', (execution, payload) => {})

// When a function in a function tree starts executing
ft.on('functionStart', (execution, functionDetails, payload) => {})

// When a function in a function tree stops executing
ft.on('functionEnd', (execution, functionDetails, payload) => {})

// Triggers when an async function has been run
ft.on('asyncFunction', (execution, functionDetails, payload) => {})

// When a parallel execution is about to happen (array in array)
ft.on('parallelStart', (execution, payload, functionsToResolveCount) => {})

// When a function in parallel execution is done executing
ft.on('parallelProgress', (execution, payload, functionsStillResolvingCount) => {})

// When a parallel execution is done
ft.on('parallelEnd', (execution, payload, functionsExecutedCount) => {})

ft.run(tree)
```
