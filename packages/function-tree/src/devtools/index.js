import {FunctionTree} from '../'
import WebSocket from 'universal-websocket-client'
import Path from '../Path'
const VERSION = 'v1'

class DevtoolsClass {
  constructor (tree, options = {
    remoteDebugger: null
  }) {
    if (!Array.isArray(tree) && !(tree instanceof FunctionTree)) {
      throw new Error('Function-tree Devtools: You have to pass a function tree or array of function trees as first argument')
    }

    this.trees = Array.isArray(tree) ? tree : [tree]
    this.trees.forEach((tree) => tree.contextProviders.unshift(this.Provider(options)))
    this.VERSION = VERSION
    this.remoteDebugger = options.remoteDebugger || null
    this.backlog = []
    this.latestExecutionId = null
    this.isConnected = false
    this.ws = null
    this.reconnectInterval = 10000
    this.isResettingDebugger = false

    if (!this.remoteDebugger) {
      throw new Error('Function-tree Devtools: You have to pass in the "remoteDebugger" option')
    }

    this.sendInitial = this.sendInitial.bind(this)
    this.watchExecution = this.watchExecution.bind(this)

    this.init()
  }

  addListeners () {
    this.ws = new WebSocket(`ws://${this.remoteDebugger}`)
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      switch (message.type) {
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
      this.init()
      this.ws.onclose = () => {
        this.reconnect()
      }
    }, this.reconnectInterval)
  }
  init () {
    this.addListeners()

    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({type: 'ping'}))
      this.trees.forEach(this.watchExecution)
    }
    this.ws.onclose = () => {
      console.warn('Debugger application is not running on selected port... will reconnect automatically behind the scenes')
      this.reconnect()
    }
  }
  safeStringify (object) {
    const refs = []

    return JSON.stringify(object, (key, value) => {
      const isObject = (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      )

      if (isObject && refs.indexOf(value) > -1) {
        return '[CIRCULAR]'
      } else if (isObject) {
        refs.push(value)
      }

      return value
    })
  }
  sendMessage (stringifiedMessage) {
    this.ws.send(stringifiedMessage)
  }
  watchExecution (tree) {
    tree.on('start', (execution, payload) => {
      const message = JSON.stringify({
        type: 'executionStart',
        source: 'ft',
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
    tree.on('end', (execution) => {
      const message = JSON.stringify({
        type: 'executionEnd',
        source: 'ft',
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
    tree.on('pathStart', (path, execution, funcDetails) => {
      const message = JSON.stringify({
        type: 'executionPathStart',
        source: 'ft',
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
    tree.on('functionStart', (execution, funcDetails, payload) => {
      const message = this.safeStringify({
        type: 'execution',
        source: 'ft',
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
    tree.on('functionEnd', (execution, funcDetails, payload, result) => {
      if (!result || (result instanceof Path && !result.payload)) {
        return
      }

      const message = this.safeStringify({
        type: 'executionFunctionEnd',
        source: 'ft',
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
    tree.on('error', (error, execution, funcDetails) => {
      const message = JSON.stringify({
        type: 'executionFunctionError',
        source: 'ft',
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
  sendInitial () {
    const message = JSON.stringify({
      type: 'init',
      source: 'ft',
      version: this.VERSION
    })

    this.sendMessage(message)
    this.backlog.forEach((backlogItem) => {
      this.sendMessage(backlogItem)
    })

    this.backlog = []
    this.isConnected = true
  }
  /*
    Create the stringified message for the debugger. As we need to
    store mutations with the default true "storeMutations" option used
    by time travel and jumping between Cerebral apps, we are careful
    not doing unnecessary stringifying.
  */
  createExecutionMessage (debuggingData, context, functionDetails, payload) {
    const type = 'execution'
    const data = {
      execution: {
        executionId: context.execution.id,
        functionIndex: functionDetails.functionIndex,
        payload: payload,
        datetime: context.execution.datetime,
        data: debuggingData
      }
    }

    return this.safeStringify({
      type: type,
      source: 'ft',
      version: this.VERSION,
      data: data
    })
  }
  sendExecutionData (debuggingData, context, functionDetails, payload) {
    const message = this.createExecutionMessage(debuggingData, context, functionDetails, payload)

    if (this.isConnected) {
      this.sendMessage(message)
    } else {
      this.backlog.push(message)
    }
  }
  Provider (options) {
    const sendExecutionData = this.sendExecutionData.bind(this)
    function provider (context, functionDetails, payload) {
      context.debugger = {
        send (data) {
          sendExecutionData(data, context, functionDetails, payload)
        },
        wrapProvider (providerKey) {
          const provider = context[providerKey]

          context[providerKey] = Object.keys(provider).reduce((wrappedProvider, key) => {
            const originalFunc = provider[key]

            wrappedProvider[key] = (...args) => {
              context.debugger.send({
                method: `${providerKey}.${key}`,
                args: args
              })

              return originalFunc.apply(provider, args)
            }

            return wrappedProvider
          }, {})
        }
      }

      return context
    }

    return provider
  }
}

export function Devtools (...args) {
  return new DevtoolsClass(...args)
}

export default Devtools
