#!/usr/bin/env node
'use strict'

/**
 * PREUVE DE ROTATION DES SECRETS — « aucun secret exposé n'est sûr sans preuve ».
 *
 * Des secrets ont été exposés dans l'historique git (docs/SECRETS_ROTATION.md).
 * Tant qu'ils ne sont pas rotés, ils restent EXPLOITABLES. Ce script produit une
 * preuve EXÉCUTABLE de la rotation : il calcule l'empreinte SHA-256 du secret
 * ACTUEL (lu dans l'environnement d'exécution) et la compare aux empreintes des
 * valeurs COMPROMISES (scripts/compromised-secrets.json). Une correspondance =
 * le secret de production est ENCORE la valeur compromise → rotation NON faite.
 *
 * SÉCURITÉ : aucune VALEUR de secret n'est jamais affichée ni écrite. Seules des
 * empreintes (fonctions à sens unique) transitent. À exécuter dans
 * l'environnement de production (ou une session CI disposant des variables) pour
 * produire l'artefact de preuve.
 *
 * Codes de sortie :
 *   0 — aucun secret compromis détecté. ATTENTION : si AUCUN secret listé n'est
 *       présent dans l'environnement, l'outil le DIT (« NON VÉRIFIÉ ») et sort
 *       quand même en 0 — c'est une absence de preuve, pas une preuve. Utilisez
 *       --require-all pour transformer cette absence en échec (code 2) ;
 *   1 — au moins un secret ACTUEL correspond à une valeur compromise (ROTATION MANQUANTE) ;
 *   2 — avec --require-all : un secret listé est absent de l'environnement (preuve incomplète).
 *
 * Usage : node scripts/verify-rotation.mjs [--require-all] [--manifest <chemin>]
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex')
}

/**
 * Compare les secrets actuels (env) aux empreintes compromises (entries).
 * @param {Array<{env:string, sha256Prefix:string, action?:string}>} entries
 * @param {Record<string,string|undefined>} env
 * @returns {{compromised:Array, rotated:Array, unverified:Array}}
 */
export function checkRotation(entries, env) {
  const compromised = []
  const rotated = []
  const unverified = []
  for (const e of entries) {
    const val = env[e.env]
    if (val === undefined || val === null || val === '') {
      unverified.push({ env: e.env })
      continue
    }
    const fp = sha256Hex(val)
    const prefix = String(e.sha256Prefix || '').toLowerCase()
    if (prefix && fp.startsWith(prefix)) {
      compromised.push({ env: e.env, action: e.action || 'rotation requise' })
    } else {
      rotated.push({ env: e.env, currentPrefix: fp.slice(0, 8) })
    }
  }
  return { compromised, rotated, unverified }
}

// ── CLI ───────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2)
  const requireAll = args.includes('--require-all')
  const mIdx = args.indexOf('--manifest')
  const manifestPath = mIdx >= 0 ? args[mIdx + 1] : path.join(__dirname, 'compromised-secrets.json')

  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (err) {
    console.error(`[verify-rotation] Manifeste illisible : ${manifestPath}\n${err.message}`)
    process.exit(1)
  }
  const entries = Array.isArray(manifest.entries) ? manifest.entries : []
  const { compromised, rotated, unverified } = checkRotation(entries, process.env)

  console.log('── Preuve de rotation des secrets ─────────────────────────────')
  for (const r of rotated) console.log(`  ✅ ${r.env} : roté (empreinte actuelle ${r.currentPrefix}… ≠ compromise)`)
  for (const u of unverified) console.log(`  ⚠️  ${u.env} : ABSENT de l'environnement — rotation non vérifiable ici`)
  for (const c of compromised) console.log(`  ❌ ${c.env} : ENCORE la valeur compromise → ${c.action}`)

  if (compromised.length > 0) {
    console.error(`\n[verify-rotation] ÉCHEC : ${compromised.length} secret(s) NON roté(s). Historique exposé encore exploitable.`)
    process.exit(1)
  }
  if (requireAll && unverified.length > 0) {
    console.error(`\n[verify-rotation] INCOMPLET : ${unverified.length} secret(s) absent(s) (--require-all). Exécuter dans l'environnement de production.`)
    process.exit(2)
  }
  // Zéro rotation prouvée n'est PAS un succès : c'est une absence de preuve.
  // « OK » sur 0 vérifié se lit comme « rotation faite », alors que l'outil n'a
  // simplement trouvé aucun secret à comparer dans cet environnement.
  if (rotated.length === 0) {
    console.log(
      `\n[verify-rotation] NON VÉRIFIÉ : aucune rotation n'a pu être contrôlée ici — ` +
      `0 prouvé(s) roté(s), ${unverified.length} non vérifiable(s) faute de secret présent. ` +
      `Ce résultat ne prouve RIEN : relancez l'outil DANS l'environnement cible, ` +
      `avec --require-all pour exiger la preuve complète.`,
    )
    process.exit(0)
  }
  console.log(`\n[verify-rotation] OK : aucun secret actuel ne correspond à une valeur compromise (${rotated.length} prouvé(s) roté(s), ${unverified.length} non vérifiable(s)).`)
  process.exit(0)
}

// N'exécute la CLI que si lancé directement (pas à l'import depuis les tests).
// `pathToFileURL` est OBLIGATOIRE : sous Windows, process.argv[1] est un chemin
// natif (C:\...) et `file://${argv[1]}` ne correspond JAMAIS à import.meta.url
// (file:///C:/...). La garde échouait donc en silence : `npm run verify:rotation`
// sortait 0 sans avoir comparé une seule empreinte — un vert trompeur sur un
// contrôle de sécurité.
if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
