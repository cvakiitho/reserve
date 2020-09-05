'use strict'

const fs = require('fs')
const mime = require('../detect/mime')
const path = require('path')
const util = require('util')

const defaultMimeType = mime.getType('bin')
const statAsync = util.promisify(fs.stat)
const readdirAsync = util.promisify(fs.readdir)

function sendFile (request, response, filePath, stat) {
  return new Promise((resolve, reject) => {
    response.writeHead(200, {
      'Content-Type': mime.getType(path.extname(filePath)) || defaultMimeType,
      'Content-Length': stat.size
    })
    if (request.method === 'HEAD') {
      response.end()
      resolve()
    } else {
      response.on('finish', resolve)
      fs.createReadStream(filePath)
        .on('error', reject)
        .pipe(response)
    }
  })
}

function sendIndex (request, response, folderPath) {
  const indexPath = path.join(folderPath, 'index.html')
  return statAsync(indexPath)
    .then(stat => sendFile(request, response, indexPath, stat))
}

async function checkCaseSensitivePath (filePath) {
  const folderPath = path.dirname(filePath)
  if (folderPath && folderPath !== filePath) {
    const name = path.basename(filePath)
    const names = await readdirAsync(folderPath)
    if (!names.includes(name)) {
      throw new Error('Not found')
    }
    return checkCaseSensitivePath(folderPath)
  }
}

module.exports = {
  schema: {
    'case-sensitive': {
      type: 'boolean',
      defaultValue: false
    },
    'ignore-if-not-found': {
      type: 'boolean',
      defaultValue: false
    }
  },
  method: 'GET,HEAD',
  redirect: ({ request, mapping, redirect, response }) => {
    let filePath = /([^?#]+)/.exec(unescape(redirect))[1] // filter URL parameters & hash
    if (!path.isAbsolute(filePath)) {
      filePath = path.join(mapping.cwd, filePath)
    }
    const directoryAccess = !!filePath.match(/(\\|\/)$/) // Test known path separators
    if (directoryAccess) {
      filePath = filePath.substring(0, filePath.length - 1)
    }
    return statAsync(filePath)
      .then(async stat => {
        if (mapping['case-sensitive']) {
          await checkCaseSensitivePath(filePath)
        }
        const isDirectory = stat.isDirectory()
        if (isDirectory ^ directoryAccess) {
          return 404 // Can't ignore if not found
        }
        if (isDirectory) {
          return sendIndex(request, response, filePath)
        }
        return sendFile(request, response, filePath, stat)
      })
      .catch(() => {
        if (!mapping['ignore-if-not-found']) {
          return 404
        }
      })
  }
}
