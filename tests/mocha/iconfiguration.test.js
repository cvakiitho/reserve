'use strict'

const assert = require('./assert')
const { check, mock } = require('../../index')

function checkConfiguration (configuration, mapping) {
  if (mapping.skipCheck) {
    return
  }
  assert(() => configuration.handlers instanceof Object)
  assert(() => !!configuration.handlers.custom)
  assert(() => !!configuration.handlers.file)
  assert(() => !!configuration.handlers.status)
  assert(() => !!configuration.handlers.test)
  assert(() => !!configuration.handlers.url)
  assert(() => Array.isArray(configuration.mappings))
  assert(() => configuration.mappings[0] === mapping)
  // Read-only handlers
  delete configuration.handlers.custom
  assert(() => !!configuration.handlers.custom)
  const fileHandler = configuration.handlers.file
  configuration.handlers.file = configuration.handlers.custom
  assert(() => configuration.handlers.file === fileHandler)
  // Read-only mappings
  configuration.mappings.length = 0
  assert(() => configuration.mappings[0] === mapping)
}

const handler = {
  async validate (mapping, configuration) {
    checkConfiguration(configuration, mapping)
    if (mapping.ko) {
      throw new Error('mapping.ko')
    }
    assert(() => mapping.test === '$1')
    assert(() => mapping.match instanceof RegExp)
    mapping.ok = true
  },

  async redirect ({ configuration, mapping, redirect, response }) {
    checkConfiguration(configuration, mapping)
    response.writeHead(200)
    let answer = 'OK'
    if (redirect === 'count') {
      answer = (++mapping.count).toString()
    }
    if (redirect === 'inject') {
      const mappings = configuration.mappings;
      mappings.unshift({
        match: '.*',
        custom: async (request, response) => {
          response.setHeader('x-injected', 'true')
        }
      })
      await configuration.setMappings(mappings)
    }
    response.end(answer)
  }
}

describe('iconfiguration', () => {
  describe('validate', () => {
    it('passes mapping and configuration to the validate method', () => {
      return check({
        handlers: {
          test: handler
        },
        mappings: [{
          match: '(.*)',
          test: '$1'
        }]
      })
        .then(configuration => {
          assert(() => configuration.mappings[0].ok)
        })
    })

    it('invalidates mapping using exception', () => {
      return check({
        handlers: {
          test: handler
        },
        mappings: [{
          ko: true,
          test: '$1'
        }]
      })
        .then(assert.notExpected, reason => {
          assert(() => reason instanceof Error)
          assert(() => reason.message === 'mapping.ko')
        })
    })
  })

  describe('redirect', function () {
    let mocked

    before(async () => {
      mocked = await mock({
        handlers: {
          test: handler
        },
        mappings: [{
          match: '.*',
          custom: async (request, response) => {
            const timeout = request.headers['x-timeout']
            if (timeout) {
              return new Promise(resolve => {
                setTimeout(resolve, parseInt(timeout, 10))
              })
            }
          }
        }, {
          match: '(.*)',
          skipCheck: true,
          count: 0,
          test: '$1'
        }]
      })
    })

    it('gives access to the configuration', () => mocked.request('GET', 'test')
      .then(response => {
        assert(() => response.statusCode === 200)
        assert(() => response.toString() === 'OK')
      })
    )

    it('allows dynamic change of mappings (with synchronization)', () => Promise.all([
      mocked.request('GET', 'count', { 'x-timeout': 200 }),
      mocked.request('GET', 'count', { 'x-timeout': 100 }),
      mocked.request('GET', 'inject'), // Should wait for pending requests to complete
      mocked.request('GET', 'count')
    ])
      .then(responses => {
        assert(() => responses.every(response => response.statusCode === 200))
        assert(() => responses[0].toString() === '2')
        assert(() => responses[1].toString() === '1')
        assert(() => responses[2].toString() === 'OK')
        assert(() => responses[3].toString() === '3')
      })
    )
  })
})
