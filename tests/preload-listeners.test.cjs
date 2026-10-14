'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'), { EventEmitter } = require('node:events')
// Unit contract of bridge registration only: NOT an Electron runtime/E2E test.
const registrations = [
  ['onLicenseError', 'license-error'], ['windowAPI.onMaximizedChange', 'win:maximized-change'],
  ['windowAPI.onFullscreenChange', 'win:fullscreen-change'], ['onDesktopExportDone', 'app:desktop-export-done'],
  ['onLicenseRevoked', 'license:revoked'], ['onLicenseReactivated', 'license:reactivated'],
  ['onOnlineStatus', 'app:online-status'], ['onEntitlements', 'entitlements:update'],
  ['onNotifications', 'notifications:update'],
]
for (const [name, channel] of registrations) test(`cleanup ${name} preserves other subscribers`, () => {
  const ipcRenderer = new EventEmitter(); let api
  vm.runInNewContext(fs.readFileSync('electron/preload.js', 'utf8'), {
    require: module => { assert.equal(module, 'electron'); return { ipcRenderer, contextBridge: { exposeInMainWorld: (_, value) => { api = value } } } },
  })
  const subscribe = name.split('.').reduce((obj, key) => obj[key], api)
  const a = [], b = [], first = subscribe(value => a.push(value)), second = subscribe(value => b.push(value))
  ipcRenderer.emit(channel, {}, 'first')
  first(); first()
  ipcRenderer.emit(channel, {}, 'second')
  assert.deepEqual(a, ['first']); assert.deepEqual(b, ['first', 'second'])
  second(); assert.equal(ipcRenderer.listenerCount(channel), 0)
})
