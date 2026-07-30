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
//  En cas d'erreur : on n'échoue JAMAIS le build (avertissement seulement) →
//  au pire, pas de manifeste → la vérification runtime est simplement inactive.
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path')

exports.default = async function afterPack(context) {
  try {
    const { appOutDir, electronPlatformName, packager } = context
    const version = packager.appInfo.version

    const resourcesPath =
      electronPlatformName === 'darwin'
        ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
        : path.join(appOutDir, 'resources')

    const integrity = require(path.join(__dirname, '..', 'electron', 'integrity.js'))
    const manifest = integrity.writeManifest(resourcesPath, version)
    console.log(
      `  ✓ Manifeste d'intégrité : ${manifest.files.length} fichier(s) critique(s) signé(s) → ${integrity.MANIFEST_NAME}`,
    )
  } catch (err) {
    console.warn("  ⚠ Manifeste d'intégrité non généré (non bloquant) :", err && err.message)
  }
}
