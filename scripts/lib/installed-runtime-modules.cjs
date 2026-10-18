'use strict'
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { createRequire } = require('node:module')
/** Builder already collected the production dependency closure for app.asar.
 * Project it outside ASAR for the plain Node utility server. extraResources'
 * copy of the traced tree alone can omit runtime package entry files.
 * No dev dependency installation and no resolution fallback to the checkout.
 */
function projectRuntimeModules(resourcesPath) {
  const asar = require('@electron/asar')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-production-modules-'))
  try {
    asar.extractAll(path.join(resourcesPath, 'app.asar'), temp)
    const source = path.join(temp, 'node_modules')
    const standalone = path.join(resourcesPath, 'standalone')
    const destination = path.join(standalone, 'node_modules')
    if (!fs.statSync(source).isDirectory()) throw new Error('Collected production modules absent from ASAR')
    fs.mkdirSync(destination, { recursive: true })
    // Preserve the generated .prisma client and server client already copied
    // by postbuild. Merge in the full production closure, not just next.js.
    fs.cpSync(source, destination, { recursive: true, dereference: true })
    const resolver = createRequire(path.join(standalone, 'server.js'))
    for (const name of ['next', 'react', 'react-dom', '@prisma/client']) {
      const resolved = resolver.resolve(name), relative = path.relative(standalone, resolved)
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Runtime module resolves outside installed standalone: ' + name)
    }
    if (!fs.existsSync(path.join(destination, '.prisma', 'client', 'query_engine-windows.dll.node'))) throw new Error('Generated Windows Prisma Node-API library missing')
    return { runtimeModules: ['next', 'react', 'react-dom', '@prisma/client'], outsideAsar: true }
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
}
module.exports = { projectRuntimeModules }
