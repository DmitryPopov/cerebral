/* global WebSocket File FileList Blob ImageData */
import {delay, throwError} from '../utils'
import Path from 'function-tree/lib/Path'
const PLACEHOLDER_INITIAL_MODEL = 'PLACEHOLDER_INITIAL_MODEL'
const PLACEHOLDER_DEBUGGING_DATA = '$$DEBUGGING_DATA$$'
const VERSION = 'v1'

/*
  Connects to the Cerebral debugger
  - Triggers events with information from function tree execution
  - Stores data related to time travel, if activated
*/
class Devtools {
  constructor (options = {
    storeMutations: true,
    preventExternalMutations: true,
    preventPropsReplacement: false,
    bigComponentsWarning: 10,
    remoteDebugger: null,
    allowedTypes: []
  }) {
    this.VERSION = VERSION
    this.debuggerComponentsMap = {}
    this.debuggerComponentDetailsId = 1
    this.storeMutations = typeof options.storeMutations === 'undefined' ? true : options.storeMutations
    this.preventExternalMutations = typeof options.preventExternalMutations === 'undefined' ? true : options.preventExternalMutations
    this.preventPropsReplacement = options.preventPropsReplacement || false
    this.bigComponentsWarning = options.bigComponentsWarning || 10
    this.remoteDebugger = options.remoteDebugger || null

    if (!this.remoteDebugger) {
      throwError('You have to pass "remoteDebugger" property')
    }

    this.backlog = []
    this.mutations = []
    this.initialModelString = null
    this.isConnected = false
    this.controller = null
    this.originalRunTreeFunction = null
    this.reconnectInterval = 5000
    this.ws = null
    this.isResettingDebugger = false
    this.allowedTypes = []
      .concat(typeof File === 'undefined' ? [] : File)
      .concat(typeof FileList === 'undefined' ? [] : FileList)
      .concat(typeof Blob === 'undefined' ? [] : Blob)
      .concat(typeof ImageData === 'undefined' ? [] : ImageData)
      .concat(typeof RegExp === 'undefined' ? [] : RegExp)
      .concat(options.allowedTypes || [])

    this.sendInitial = this.sendInitial.bind(this)
    this.sendComponentsMap = delay(this.sendComponentsMap, 50)
  }
  /*
    To remember state Cerebral stores the initial model as stringified
    object. Since the model is mutable this is necessary. The debugger
    passes the execution id of the signal that was double clicked. This
    execution id is searched backwards in the array of mutations done.
    This is necessary as multiple mutations can be done on the same execution.
    Then all mutations are replayed to the model and all the components
    will be rerendered using the "flush" event and "force" flag.

    It will also replace the "run" method of the controller to
    prevent any new signals firing off when in "remember state"
  */
  remember (index) {
    this.controller.model.state = JSON.parse(this.initialModelString)

    if (index === 0) {
      this.controller.run = this.originalRunTreeFunction
    } else {
      this.controller.run = (name) => {
        console.warn(`The signal "${name}" fired while debugger is remembering state, it was ignored`)
      }
    }

    for (let x = 0; x < this.mutations.length - index; x++) {
      const mutation = JSON.parse(this.mutations[x].data)
      this.controller.model[mutation.method](...mutation.args)
    }

    this.controller.flush(true)
    this.controller.emit('remember', JSON.parse(this.mutations[index].data).datetime)
  }
  /*

  */
  reset () {
    this.controller.model.state = JSON.parse(this.initialModelString)
    this.backlog = []
    this.mutations = []
    this.controller.flush(true)
  }
  /*
    Sets up the listeners to Chrome Extension or remote debugger
  */
  addListeners () {
    this.ws = new WebSocket(`ws://${this.remoteDebugger}`)
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      switch (message.type) {
        case 'changeModel':
          this.controller.model.set(message.data.path, message.data.value)
          this.controller.flush()
          break
        case 'remember':
          if (!this.storeMutations) {
            console.warn('Cerebral Devtools - You tried to time travel, but you have turned of storing of mutations')
          }
          this.remember(message.data)
          break
        case 'reset':
          this.reset()
          break
        case 'pong':
          this.sendInitial()
          break
        case 'ping':
          this.sendInitial()
          break
      }
    }
  }
  reconnect () {
    setTimeout(() => {
      this.init(this.controller)
      this.ws.onclose = () => {
        this.reconnect()
      }
    }, this.reconnectInterval)
  }
  /*
    The debugger might be ready or it might not. The initial communication
    with the debugger requires a "ping" -> "pong" to identify that it
    is ready to receive messages.
    1. Debugger is open when app loads
      - Devtools sends "ping"
      - Debugger sends "pong"
      - Devtools sends "init"
    2. Debugger is opened after app load
      - Debugger sends "ping"
      - Devtools sends "init"
  */
  init (controller) {
    this.controller = controller
    this.originalRunTreeFunction = controller.run

    if (this.storeMutations) {
      this.initialModelString = JSON.stringify(controller.model.get())
    }

    this.addListeners()

    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({type: 'ping'}))
    }
    this.ws.onclose = () => {
      console.warn('Could not connect to the debugger, please make sure it is running... automatically retrying in the background')
      this.reconnect()
    }

    this.watchExecution()
  }
  /*
    Sends message to chrome extension or remote debugger
  */
  sendMessage (stringifiedMessage) {
    this.ws.send(stringifiedMessage)
  }
  /*
    Watches function tree for execution of signals. This is passed to
    debugger to prevent time travelling when executing. It also tracks
    latest executed signal for "remember" to know when signals can be
    called again
  */
  watchExecution () {
    this.controller.on('start', (execution, payload) => {
      const message = JSON.stringify({
        type: 'executionStart',
        source: 'c',
        data: {
          execution: {
            executionId: execution.id,
            name: execution.name,
            staticTree: execution.staticTree,
            datetime: execution.datetime,
            executedBy: (payload && payload._execution) ? payload._execution : null
          }
        }
      })

      if (this.isConnected) {
        this.sendMessage(message)
      } else {
        this.backlog.push(message)
      }
    })
    this.controller.on('end', (execution) => {
      const message = JSON.stringify({
        type: 'executionEnd',
        source: 'c',
        data: {
          execution: {
            executionId: execution.id
          }
        }
      })
      this.latestExecutionId = execution.id

      if (this.isConnected) {
        this.sendMessage(message)
      } else {
        this.backlog.push(message)
      }
    })
    this.controller.on('pathStart', (path, execution, funcDetails) => {
      const message = JSON.stringify({
        type: 'executionPathStart',
        source: 'c',
        data: {
          execution: {
            executionId: execution.id,
            functionIndex: funcDetails.functionIndex,
            path
          }
        }
      })

      if (this.isConnected) {
        this.sendMessage(message)
      } else {
        this.backlog.push(message)
      }
    })
    this.controller.on('functionStart', (execution, funcDetails, payload) => {
      const message = JSON.stringify({
        type: 'execution',
        source: 'c',
        data: {
          execution: {
            executionId: execution.id,
            functionIndex: funcDetails.functionIndex,
            payload,
            data: null
          }
        }
      })

      if (this.isConnected) {
        this.sendMessage(message)
      } else {
        this.backlog.push(message)
      }
    })
    this.controller.on('functionEnd', (execution, funcDetails, payload, result) => {
      if (!result || (result instanceof Path && !result.payload)) {
        return
      }

      const message = JSON.stringify({
        type: 'executionFunctionEnd',
        source: 'c',
        data: {
          execution: {
            executionId: execution.id,
            functionIndex: funcDetails.functionIndex,
            output: result instanceof Path ? result.payload : result
          }
        }
      })

      if (this.isConnected) {
        this.sendMessage(message)
      } else {
        this.backlog.push(message)
      }
    })
    this.controller.on('error', (error, execution, funcDetails) => {
      const message = JSON.stringify({
        type: 'executionFunctionError',
        source: 'c',
        data: {
          execution: {
            executionId: execution.id,
            functionIndex: funcDetails.functionIndex,
            error: {
              name: error.name,
              message: error.message,
              stack: error.stack,
              func: funcDetails.function.toString()
            }
          }
        }
      })

      if (this.isConnected) {
        this.sendMessage(message)
      } else {
        this.backlog.push(message)
      }
    })
  }
  /*
    Sends multiple message in one batch to debugger, causing debugger
    also to synchronously run all updates before rendering
  */
  sendBulkMessage (messages) {
    const message = JSON.stringify({
      type: 'bulk',
      source: 'c',
      version: this.VERSION,
      data: {
        messages
      }
    })

    this.sendMessage(message)
  }
  /*
    Send initial model. If model has already been stringified we reuse it. Any
    backlogged executions will also be triggered
  */
  sendInitial () {
    const initialModel = this.controller.model.get()
    const message = JSON.stringify({
      type: 'init',
      source: 'c',
      version: this.VERSION,
      data: {
        initialModel: this.initialModelString ? PLACEHOLDER_INITIAL_MODEL : initialModel
      }
    }).replace(`"${PLACEHOLDER_INITIAL_MODEL}"`, this.initialModelString)

    this.isResettingDebugger = true
    this.sendMessage(message)
    this.sendBulkMessage(this.backlog)
    this.isResettingDebugger = false

    this.backlog = []

    this.isConnected = true

    this.sendMessage(JSON.stringify({
      type: 'components',
      source: 'c',
      data: {
        map: this.debuggerComponentsMap,
        render: {
          components: []
        }
      }
    }))
  }
  /*
    Create the stringified message for the debugger. As we need to
    store mutations with the default true "storeMutations" option used
    by time travel and jumping between Cerebral apps, we are careful
    not doing unnecessary stringifying.
  */
  createExecutionMessage (debuggingData, context, functionDetails, payload) {
    const type = 'execution'
    let mutationString = ''

    if (this.storeMutations && debuggingData && debuggingData.type === 'mutation') {
      mutationString = JSON.stringify(debuggingData)
    }

    const data = {
      execution: {
        executionId: context.execution.id,
        functionIndex: functionDetails.functionIndex,
        payload: payload,
        datetime: context.execution.datetime,
        data: mutationString ? PLACEHOLDER_DEBUGGING_DATA : debuggingData
      }
    }

    if (mutationString) {
      this.mutations.push({
        executionId: context.execution.id,
        data: mutationString
      })
    }

    return JSON.stringify({
      type: type,
      source: 'c',
      version: this.VERSION,
      data: data
    }).replace(`"${PLACEHOLDER_DEBUGGING_DATA}"`, mutationString)
  }
  /*
    Sends execution data to the debugger. Whenever a signal starts
    it will send a message to the debugger, but any functions in the
    function tree might also use this to send debugging data. Like when
    mutations are done or any wrapped methods run.
  */
  sendExecutionData (debuggingData, context, functionDetails, payload) {
    const message = this.createExecutionMessage(debuggingData, context, functionDetails, payload)

    if (this.isConnected) {
      this.sendMessage(message)
    } else {
      this.backlog.push(message)
    }
  }
  /*
    The container will listen to "flush" events from the controller
    and send an event to debugger about initial registered components
  */
  extractComponentName (component) {
    return component.constructor.displayName.replace('CerebralWrapping_', '')
  }
  /*
    Updates the map the represents what active state paths and
    components are in your app. Used by the debugger
  */
  updateComponentsMap (component, nextDeps, prevDeps) {
    const componentDetails = {
      name: this.extractComponentName(component),
      renderCount: component.renderCount || 0,
      id: component.componentDetailsId || this.debuggerComponentDetailsId++
    }

    if (arguments.length === 1) {
      componentDetails.renderCount++
    }

    component.componentDetailsId = componentDetails.id
    component.renderCount = componentDetails.renderCount

    if (prevDeps) {
      for (const depsKey in prevDeps) {
        const debuggerComponents = this.debuggerComponentsMap[depsKey]

        for (let x = 0; x < debuggerComponents.length; x++) {
          if (debuggerComponents[x].id === component.componentDetailsId) {
            debuggerComponents.splice(x, 1)
            if (debuggerComponents.length === 0) {
              delete this.debuggerComponentsMap[depsKey]
            }
            break
          }
        }
      }
    }

    if (nextDeps) {
      for (const depsKey in nextDeps) {
        this.debuggerComponentsMap[depsKey] = (
          this.debuggerComponentsMap[depsKey]
            ? this.debuggerComponentsMap[depsKey].concat(componentDetails)
            : [componentDetails]
        )
      }
    }
  }
  /*
    Sends components map to debugger. It is debounced (check constructor).
    It needs to wait because React updates async. Instead of tracking
    callbacks we just wait 50ms as it is not that important when
    debugger updates
  */
  sendComponentsMap (componentsToRender, changes, start, end) {
    this.sendMessage(JSON.stringify({
      type: 'components',
      source: 'c',
      data: {
        map: this.debuggerComponentsMap,
        render: {
          start: start,
          duration: end - start,
          changes: changes,
          components: componentsToRender.map(this.extractComponentName)
        }
      }
    }))
  }
}

export default function (...args) {
  return new Devtools(...args)
}
