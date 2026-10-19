'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

/** Inspect every existing component, including parents of absent targets.
 * This refuses symlinks/junctions; it is NOT an atomic defence against a hostile
 * concurrent filesystem writer. Build workspaces must remain access-controlled.
 */
function refuseLinkedPath(target) {
  for (let current = path.resolve(target); current !== path.dirname(current); current = path.dirname(current)) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Packaging refuses symlink/junction paths')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}

/** A release template is not a fallback to a developer/customer database.
 * Read-only inspection; never deletes, resets or migrates any source DB. */
function copyPrismaResources(root, standalone) {
  const source = path.join(root, 'prisma')
  const template = path.join(source, 'garageflow-template.db')
  const schema = path.join(source, 'schema.prisma')
  const destination = path.join(standalone, 'prisma')
  for (const target of [template, schema, path.join(destination, 'schema.prisma'), path.join(destination, 'garageflow-template.db')]) {
    refuseLinkedPath(target)
  }
  for (const file of [template, schema]) {
    if (!fs.lstatSync(file).isFile()) throw new Error('Packaging requires regular Prisma template/schema files')
  }
  const db = new DatabaseSync(template, { readOnly: true })
  try {
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('Invalid release database template')
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
    for (const { name } of tables) {
      if (name.startsWith('sqlite_') || name === '_gf_migrations' || name === '_prisma_migrations') continue
      const quoted = '"' + name.replaceAll('"', '""') + '"'
      if (db.prepare(`SELECT 1 FROM ${quoted} LIMIT 1`).get()) {
        throw new Error('Release database template contains application data; packaging refused')
      }
    }
  } finally { db.close() }
  fs.mkdirSync(destination, { recursive: true })
  // Stale databases in build output must not silently survive the next package.
  // Refuse instead of deleting: inspection/remediation stays explicit.
  for (const name of fs.readdirSync(destination)) {
    if (/\.(db|sqlite|sqlite3)(-(wal|shm|journal))?$/i.test(name) && name !== 'garageflow-template.db') {
      throw new Error('Unexpected database in standalone/prisma; packaging refused')
    }
  }
  fs.copyFileSync(schema, path.join(destination, 'schema.prisma'))
  fs.copyFileSync(template, path.join(destination, 'garageflow-template.db'))
}
module.exports = { copyPrismaResources, refuseLinkedPath }
