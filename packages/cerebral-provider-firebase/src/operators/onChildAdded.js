import {convertObjectWithTemplates} from '../helpers'

function onChildAddedFactory (path, signal, options = {}) {
  function onChildAdded ({firebase, resolve}) {
    firebase.onChildAdded(resolve.value(path), resolve.path(signal), convertObjectWithTemplates(options, resolve))
  }

  return onChildAdded
}

export default onChildAddedFactory
