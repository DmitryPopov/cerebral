import {convertObjectWithTemplates, processResponse} from '../utils'

function httpPatchFactory (url, body = {}) {
  function httpPatch ({http, path, resolve}) {
    return processResponse(http.patch(resolve.value(url), convertObjectWithTemplates(body, resolve)), path)
  }

  return httpPatch
}

export default httpPatchFactory
