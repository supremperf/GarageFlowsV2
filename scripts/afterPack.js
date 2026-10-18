'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  electron-builder — hook afterPack
//
//  Après l'assemblage de l'application (asar + ressources) et AVANT la
//  fabrication de l'installateur NSIS, on génère le manifeste d'intégrité signé
//  (HMAC-SHA256) qui couvre les fichiers critiques réellement empaquetés.
//
//  Le hook s'exécute après l'empaquetage mais avant la SIGNATURE du .exe : le
//  manifeste ne couvre volontairement PAS le .exe (qui sera signé et donc
//  modifié ensuite) — uniquement app.asar, les modules déballés et les
//  ressources, qui ne bougent plus après ce point.
//
//  En cas d'erreur : le build ÉCHOUE (throw). Un installateur de production sans
//  manifeste d'intégrité est un build défectueux — le runtime en « enforce »
//  bloque un manifeste absent, donc on ne doit JAMAIS livrer sans lui.
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path')

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context
  const version = packager.appInfo.version

  const resourcesPath =
    electronPlatformName === 'darwin'
      ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(appOutDir, 'resources')

  // Complete the installed Node server's production closure BEFORE sealing resources.
  const { projectRuntimeModules } = require('./lib/installed-runtime-modules.cjs')
  const runtime = projectRuntimeModules(resourcesPath)
  console.log('  ✓ Standalone production modules projected outside ASAR:', runtime.runtimeModules.join(', '))

  // ── Durcissement des Electron Fuses sur le binaire packagé ──────────────────
  // Grave les bits qui désactivent RunAsNode, --inspect, NODE_OPTIONS, etc. Échec
  // BLOQUANT : un binaire non durci est un build défectueux.
  const { flipFuses } = require('@electron/fuses')
  const { fusePlan } = require(path.join(__dirname, 'fuse-config.js'))
  const productFilename = packager.appInfo.productFilename
  const electronBinary =
    electronPlatformName === 'darwin'
      ? path.join(appOutDir, `${productFilename}.app`, 'Contents', 'MacOS', productFilename)
      : path.join(appOutDir, `${productFilename}${electronPlatformName === 'win32' ? '.exe' : ''}`)
  await flipFuses(electronBinary, fusePlan)
  console.log('  ✓ Electron Fuses appliqués (RunAsNode off, --inspect off, OnlyLoadAppFromAsar, …)')

  const integrity = require(path.join(__dirname, '..', 'electron', 'integrity.js'))
  let manifest
  try {
    manifest = integrity.writeManifest(resourcesPath, version)
  } catch (err) {
    // Échec BLOQUANT : pas de manifeste => le build packagé serait refusé au
    // démarrage (enforce). On préfère casser le build ici, visiblement.
    throw new Error(
      "Manifeste d'intégrité non généré — build interrompu. Cause : " + (err && err.message),
    )
  }
  if (!manifest || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("Manifeste d'intégrité vide — build interrompu (aucun fichier critique couvert).")
  }
  console.log(
    `  ✓ Manifeste d'intégrité : ${manifest.files.length} fichier(s) critique(s) signé(s) → ${integrity.MANIFEST_NAME}`,
  )
}
