'use strict'
const fs = require('node:fs')
const path = require('node:path')

/** Copy a legacy development database exclusively. NEVER remove its source,
 * its directory, or an existing canonical database (both may contain data).
 * An operator can reconcile duplicates after inspecting them independently.
 */
function preserveLegacyDevDb(prismaDir, log = console.log) {
  const source = path.join(prismaDir, 'prisma', 'dev.db')
  const destination = path.join(prismaDir, 'dev.db')
  try {
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL)
    log('✅  Base historique copiée vers prisma/dev.db ; original conservé dans prisma/prisma/dev.db.')
    return 'copied'
  } catch (error) {
    if (error.code === 'ENOENT') return 'absent'
    if (error.code === 'EEXIST') {
      log('ℹ️   Base historique conservée dans prisma/prisma/dev.db : prisma/dev.db existe déjà. Aucune suppression.')
      return 'preserved'
    }
    throw error
  }
}
module.exports = { preserveLegacyDevDb }
