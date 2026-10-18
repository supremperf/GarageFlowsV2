'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
// Execute the actual production function with an instrumented filesystem.
const main = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8')
const source = main.slice(main.indexOf('function setupDatabase()'), main.indexOf('// ── Periodic license revocation check'))
function fixture({ exists, valid, copyError = false }) {
  const calls = { copied: [], exits: [], errors: [], renamed: [] }
  const context = { APP_DATA: '/fixture/data', PHOTOS_DIR: '/fixture/data/photos', DB_PATH: '/fixture/data/garageflow.db', ROOT: '/fixture/root',
    process: { resourcesPath: '/fixture/resources', exit: code => calls.exits.push(code) },
    app: { exit: code => calls.exits.push(code), quit: () => calls.exits.push('quit') },
    dialog: { showErrorBox: (...args) => calls.errors.push(args) }, ecarterSplash() {}, log() {}, path,
    isDbValid: file => file === '/fixture/data/garageflow.db' ? valid : true,
    fs: { constants: fs.constants, mkdirSync() {}, existsSync: file => file === '/fixture/data/garageflow.db' ? exists : true,
      renameSync: (...args) => calls.renamed.push(args), copyFileSync: (...args) => { calls.copied.push(args); if (copyError) throw Error('EEXIST') } },
  }
  vm.runInNewContext(source, context)
  return { result: context.setupDatabase(), calls }
}
test('a valid preexisting customer DB is never copied over or moved by startup', () => {
  const { result, calls } = fixture({ exists: true, valid: true })
  assert.equal(result, true); assert.equal(calls.copied.length, 0); assert.equal(calls.renamed.length, 0)
})
test('an unreadable customer DB remains exactly in place; no silent reset or rename', () => {
  const { result, calls } = fixture({ exists: true, valid: false })
  assert.equal(result, false); assert.equal(calls.copied.length, 0); assert.equal(calls.renamed.length, 0)
  assert.deepEqual(calls.exits, [1]); assert.equal(calls.errors.length, 1)
})
test('first-run DB copy is exclusive and a concurrent existing file is preserved', () => {
  const { result, calls } = fixture({ exists: false, valid: false, copyError: true })
  assert.equal(result, false); assert.equal(calls.copied[0][2], fs.constants.COPYFILE_EXCL)
  assert.deepEqual(calls.exits, [1])
})
