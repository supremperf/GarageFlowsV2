#!/usr/bin/env node
'use strict'

/**
 * Vérification d'un manifeste de mise à jour AVEC LE VÉRIFICATEUR RÉEL du client.
 *
 * Le keygen ne réimplémente PAS la vérification : il appelle
 * `electron/update-verify.js`, le module embarqué dans chaque poste installé.
 * Un manifeste accepté ici est accepté par le client, à l'identique — c'est la
 * seule preuve qui vaille, et elle est rejouable (`node scripts/keygen-verify-update.cjs <fichier>`).
 *
 * Sortie : JSON sur stdout — jamais de clé, jamais de secret.
 *   { ok: true,  version, keyId, sha256, size, fileName, checks }
 *   { ok: false, reason,  code }
 *
 * Options :
 *   --current-version <x.y.z>   simule la version installée du poste (anti-downgrade)
 *   --channel <stable>          canal attendu
 *   --platform <win32>          plateforme attendue
 *   --arch <x64>                architecture attendue
 *   --manifest <chemin>         manifeste à vérifier (positionnel accepté)
 *   --public-keys <json>        ancres de confiance SUPPLÉMENTAIRES { keyId: PEM },
 *                               injectées pour une vérification ciblée (une clé de
 *                               recette, une clé attestée par l'opérateur). Elles ne
 *                               remplacent PAS les clés embarquées : elles s'y ajoutent,
 *                               pendant cet appel seulement, dans un processus dédié.
 */

const fs = require('node:fs')
const path = require('node:path')

const RACINE = path.resolve(__dirname, '..')

function args(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const cle = a.slice(2)
      const suivant = argv[i + 1]
      if (suivant === undefined || suivant.startsWith('--')) out[cle] = true
      else { out[cle] = suivant; i++ }
    } else out._.push(a)
  }
  return out
}

function main(argv) {
  const a = args(argv)
  const cible = a.manifest && a.manifest !== true ? a.manifest : a._[0]
  if (!cible) {
    process.stdout.write(JSON.stringify({ ok: false, code: 'USAGE', reason: 'manifeste non fourni' }) + '\n')
    return 2
  }
  const fichier = path.isAbsolute(cible) ? cible : path.join(process.cwd(), cible)
  if (!fs.existsSync(fichier)) {
    process.stdout.write(JSON.stringify({ ok: false, code: 'ABSENT', reason: 'Fichier introuvable : ' + fichier }) + '\n')
    return 2
  }
  let signé
  try {
    signé = JSON.parse(fs.readFileSync(fichier, 'utf8'))
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, code: 'JSON_INVALID', reason: 'Manifeste illisible (JSON invalide)' }) + '\n')
    return 2
  }

  const uv = require(path.join(RACINE, 'electron', 'update-verify.js'))

  // Ancre injectée : ajoutée aux clés embarquées, dans CE processus seulement.
  // Jamais une substitution : les clés du client restent actives.
  let ancreInjectee = null
  const brut = a['public-keys'] && a['public-keys'] !== true ? a['public-keys'] : null
  if (brut) {
    let supplément
    try {
      supplément = JSON.parse(fs.existsSync(brut) ? fs.readFileSync(brut, 'utf8') : brut)
    } catch {
      process.stdout.write(JSON.stringify({ ok: false, code: 'ANCHOR_INVALID', reason: 'Ancre de confiance illisible (JSON attendu)' }) + '\n')
      return 2
    }
    if (!supplément || typeof supplément !== 'object') {
      process.stdout.write(JSON.stringify({ ok: false, code: 'ANCHOR_INVALID', reason: 'Ancre de confiance invalide' }) + '\n')
      return 2
    }
    ancreInjectee = Object.keys(supplément)
    Object.assign(uv.PUBLIC_KEYS, supplément)
  }

  const résultat = uv.validateManifest(signé, {
    currentVersion: a['current-version'] && a['current-version'] !== true ? a['current-version'] : undefined,
    channel: a.channel && a.channel !== true ? a.channel : undefined,
    platform: a.platform && a.platform !== true ? a.platform : undefined,
    arch: a.arch && a.arch !== true ? a.arch : undefined,
  })

  if (!résultat.ok) {
    process.stdout.write(JSON.stringify({
      ok: false,
      code: 'MANIFEST_REFUSE',
      reason: résultat.reason,
      anchorInjected: ancreInjectee,
    }) + '\n')
    return 1
  }
  const m = résultat.manifest
  process.stdout.write(JSON.stringify({
    ok: true,
    version: m.version,
    keyId: m.keyId,
    sha256: m.sha256,
    size: m.size,
    fileName: m.fileName,
    channel: m.channel,
    platform: m.platform,
    architecture: m.architecture,
    releasedAt: m.releasedAt ?? null,
    checks: 'clé connue du client, signature Ed25519 valide, produit, plateforme, HTTPS, domaine autorisé, anti-downgrade',
    anchorInjected: ancreInjectee,
  }) + '\n')
  return 0
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2))
}

module.exports = { main }
