/* eslint-env mocha */
import FunctionTree from './'
import assert from 'assert'

describe('FunctionTreeExecution', () => {
  it('should pass error with payload property', (done) => {
    const ft = new FunctionTree([])

    ft.run([
      ({execution}) => {
        return Promise.reject(new Error('wuuut'))
      }
    ], {prop1: 'value', prop2: 'value'})
    .catch((error) => {
      assert.equal(error.message, 'wuuut')
      assert.equal(error.payload.error.name, 'Error')
      assert.equal(error.payload.error.message, 'wuuut')
      done()
    })
  })
  it('should stop if throw from async action', (done) => {
    const ft = new FunctionTree([])

    ft.run([
      ({execution}) => {
        return Promise.reject(new Error())
      },
      ({execution}) => {
        done(new Error('Should not continue execution.'))
      }
    ])
    .catch(() => {
      done()
    })
  })
  it('should pass error with payload property', (done) => {
    const ft = new FunctionTree([])

    ft.run([
      ({execution}) => {
        return Promise.reject(new Error('wuuut'))
      }
    ], {prop1: 'value', prop2: 'value'})
    .catch((error) => {
      assert.equal(error.message, 'wuuut')
      assert.equal(error.payload.error.name, 'Error')
      assert.equal(error.payload.error.message, 'wuuut')
      done()
    })
  })
  it('should throw to console if not catch handler', (done) => {
    const ft = new FunctionTree([])

    process.on('unhandledRejection', function handleRejection () {
      process.removeListener('unhandledRejection', handleRejection)
      done()
    })

    ft.run([
      ({execution}) => {
        throw new Error()
      },
      ({execution}) => {
        done(new Error('Should not continue execution.'))
      }
    ])
  })
  it('should pass final payload in event', (done) => {
    const ft = new FunctionTree([])
    ft.once('error', (_, execution, funcDetails, payload) => {
      setTimeout(() => {
        assert.deepEqual(payload, {prop1: 'value', prop2: 'updated'})
        done()
      })
    })

    ft.run({
      prop1: 'value',
      prop2: 'updated'
    }, [
      ({execution}) => {
        throw new Error()
      },
      ({execution}) => {
        done(new Error('Should not continue execution.'))
      }
    ]).catch(() => {})
  })
  it('should use error toJSON, if available, to serialize error', (done) => {
    const ft = new FunctionTree([])

    class CustomError {
      constructor (message) {
        this.name = 'CustomError'
        this.message = message
      }
      toJSON () {
        return this.message
      }
    }
    ft.run([
      () => {
        throw new CustomError('foo')
      }
    ], {})
    .catch((error) => {
      assert.ok(error instanceof CustomError)
      assert.equal(error.payload.error, 'foo')
      done()
    })
  })
})
