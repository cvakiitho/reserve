'use strict'

const logError = require('./logError')
const interpolate = require('./interpolate')
const {
  $configurationInterface,
  $configurationRequests,
  $dispatcherEnd,
  $mappingMatch,
  $requestId,
  $requestPromise,
  $requestRedirectCount,
  $responseEnded
} = require('./symbols')

function hookEnd (response) {
  if (!response.end[$dispatcherEnd]) {
    const end = response.end
    response.end = function () {
      this[$responseEnded] = true
      return end.apply(this, arguments)
    }
    response.end[$dispatcherEnd] = true
  }
  return response
}

function emit (event, emitParameters, additionalParameters) {
  this.emit(event, { ...emitParameters, ...additionalParameters })
}

function emitError (reason) {
  try {
    emit.call(this.eventEmitter, 'error', this.emitParameters, { reason })
  } catch (e) {
    logError({ ...this.emitParameters, reason: e }) // Unhandled error
  }
}

function redirected () {
  const end = new Date()
  try {
    emit.call(this.eventEmitter, 'redirected', this.emitParameters, {
      end,
      timeSpent: end - this.emitParameters.start,
      statusCode: this.response.statusCode
    })
  } catch (reason) {
    emitError.call(this, reason)
  }
  this.resolve()
}

function error (reason) {
  let statusCode
  if (typeof reason === 'number') {
    statusCode = reason
  } else {
    statusCode = 500
  }
  emitError.call(this, reason)
  if (this.failed) {
    // Error during error: finalize the response (whatever it means)
    this.response.end()
    redirected.call(this)
  } else {
    this.failed = true
    dispatch.call(this, statusCode)
  }
}

function redispatch (url) {
  const redirectCount = ++this.request[$requestRedirectCount]
  if (redirectCount > this.configuration['max-redirect']) {
    error.call(this, 508)
  } else {
    dispatch.call(this, url)
  }
}

function redirecting ({ mapping, match, handler, type, redirect, url, index = 0 }) {
  try {
    emit.call(this.eventEmitter, 'redirecting', this.emitParameters, { type, redirect })
    return handler.redirect({
      configuration: this.configuration[$configurationInterface],
      mapping,
      match,
      redirect,
      request: this.request,
      response: hookEnd(this.response)
    })
      .then(result => {
        if (undefined !== result) {
          redispatch.call(this, result)
        } else if (this.response[$responseEnded]) {
          redirected.call(this)
        } else {
          dispatch.call(this, url, index + 1)
        }
      }, error.bind(this))
  } catch (e) {
    error.call(this, e)
  }
}

async function dispatch (url, index = 0) {
  if (typeof url === 'number') {
    return redirecting.call(this, {
      type: 'status',
      handler: this.configuration.handlers.status,
      redirect: url
    })
  }
  const length = this.configuration.mappings.length
  while (index < length) {
    const mapping = this.configuration.mappings[index]
    let match
    try {
      match = await mapping[$mappingMatch](this.request, url)
    } catch (reason) {
      return error.call(this, reason)
    }
    if (match) {
      if (['string', 'number'].includes(typeof match)) {
        return redispatch.call(this, match)
      }
      const { handler, redirect, type } = this.configuration.handler(mapping)
      return redirecting.call(this, { mapping, match, handler, type, redirect: interpolate(match, redirect), url, index })
    }
    ++index
  }
  error.call(this, 501)
}

module.exports = function (configuration, request, response) {
  const configurationRequests = configuration[$configurationRequests]
  const emitParameters = { id: ++configurationRequests.lastId, method: request.method, url: request.url, start: new Date() }
  let promiseResolver
  const requestPromise = new Promise(resolve => { promiseResolver = resolve })
  const context = { eventEmitter: this, emitParameters, configuration, request, response, resolve: promiseResolver }
  request[$requestId] = emitParameters.id
  request[$requestPromise] = requestPromise
  request[$requestRedirectCount] = 0
  request.on('aborted', emit.bind(this, 'aborted', emitParameters))
  request.on('close', emit.bind(this, 'closed', emitParameters))
  try {
    emit.call(this, 'incoming', emitParameters)
  } catch (reason) {
    error.call(context, reason)
    return requestPromise
  }
  return configurationRequests.hold
    .then(() => {
      configurationRequests.promises.push(requestPromise)
      dispatch.call(context, request.url)
      return requestPromise
    })
    .then(() => {
      configurationRequests.promises = configurationRequests.promises
        .filter(promise => promise !== requestPromise)
    })
}
