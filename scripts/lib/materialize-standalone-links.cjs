'use strict'

/**
 * Next.js can preserve traced symlinks in `.next/standalone/node_modules`.
 * That is valid in the checkout (the link target may be the repository's root
 * `node_modules`) but invalid after electron-builder copies only the standalone
 * tree to `resources/standalone`: the link then points outside the installation
 * and Node reports `Cannot find module 'next'`.
 *
 * Turn symlinks under the standalone runtime's node_modules into real files and
 * directories before packaging. This makes the artifact self-contained and
 * portable to Windows regardless of how npm laid out the source dependencies.
 */
const fs = require('node:fs')
const path = require('node:path')

function materializeStandaloneLinks(appDir) {
  const nodeModulesDir = path.join(appDir, 'node_modules')
  if (!fs.existsSync(nodeModulesDir)) return []

  const replaced = []
  // Also handle the uncommon case where Next.js emits node_modules itself as a
  // link, not just individual packages beneath it.
  const rootTemporaryPath = `${nodeModulesDir}.gf-materialize-${process.pid}`
  try {
    if (fs.lstatSync(nodeModulesDir).isSymbolicLink()) {
      const realTarget = fs.realpathSync(nodeModulesDir)
      fs.rmSync(rootTemporaryPath, { recursive: true, force: true })
      fs.cpSync(realTarget, rootTemporaryPath, {
        recursive: true,
        dereference: true,
        preserveTimestamps: true,
        errorOnExist: true,
        force: false,
      })
      fs.unlinkSync(nodeModulesDir)
      fs.renameSync(rootTemporaryPath, nodeModulesDir)
      replaced.push('node_modules')
    }
  } catch (error) {
    fs.rmSync(rootTemporaryPath, { recursive: true, force: true })
    throw new Error(`Impossible d’embarquer le dossier node_modules du standalone : ${error.message}`)
  }

  const visit = (directory) => {
    let entries
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch (error) {
      throw new Error(`Impossible de lire ${path.relative(appDir, directory)} dans le standalone : ${error.message}`)
    }

    for (const entry of entries) {
      const targetPath = path.join(directory, entry.name)
      let stat
      try {
        stat = fs.lstatSync(targetPath)
      } catch (error) {
        throw new Error(`Impossible d’inspecter ${path.relative(appDir, targetPath)} : ${error.message}`)
      }

      if (stat.isSymbolicLink()) {
        let realTarget
        try {
          realTarget = fs.realpathSync(targetPath)
        } catch (error) {
          throw new Error(`Lien symbolique cassé dans le standalone : ${path.relative(appDir, targetPath)} (${error.message})`)
        }

        const temporaryPath = `${targetPath}.gf-materialize-${process.pid}`
        try {
          fs.rmSync(temporaryPath, { recursive: true, force: true })
          fs.cpSync(realTarget, temporaryPath, {
            recursive: true,
            dereference: true,
            preserveTimestamps: true,
            errorOnExist: true,
            force: false,
          })
          fs.unlinkSync(targetPath)
          fs.renameSync(temporaryPath, targetPath)
        } catch (error) {
          fs.rmSync(temporaryPath, { recursive: true, force: true })
          throw new Error(`Impossible d’embarquer la cible de ${path.relative(appDir, targetPath)} : ${error.message}`)
        }

        replaced.push(path.relative(appDir, targetPath).split(path.sep).join('/'))
        // Inspect the copied target too; packages may themselves contain links.
        const copiedStat = fs.lstatSync(targetPath)
        if (copiedStat.isDirectory()) visit(targetPath)
      } else if (stat.isDirectory()) {
        visit(targetPath)
      }
    }
  }

  visit(nodeModulesDir)
  return replaced
}

module.exports = { materializeStandaloneLinks }
