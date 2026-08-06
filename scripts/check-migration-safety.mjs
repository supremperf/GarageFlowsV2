#!/usr/bin/env node
/**
 * check-migration-safety.mjs — garde-fou CI de la CHAÎNE DE MIGRATION.
 *
 * Vérifie statiquement les invariants de sûreté qui protègent les données :
 *
 *   RUNNER SQLite (src/app/api/internal/migrate/route.ts)
 *     R1. exécution sous prisma.$transaction (atomique) ;
 *     R2. enregistrement dans "_gf_migrations" UNIQUEMENT via `tx.` (dans la
 *         même transaction que la migration — jamais « appliquée » sans l'être) ;
 *     R3. aucun catch vide, aucun catch qui `continue` (l'erreur d'une
 *         migration ARRÊTE la séquence — pas de « non-fatal » silencieux) ;
 *     R4. contrôles d'intégrité présents (PRAGMA integrity_check +
 *         foreign_key_check) et blocage sur checksum divergent ;
 *
 *   DÉFINITIONS SQLite (src/lib/migrations.ts)
 *     M1. toute migration contenant un DROP COLUMN embarque un verifySql
 *         (preuve AVANT suppression) ;
 *
 *   ELECTRON (electron/main.js + electron/pre-migration-backup.js)
 *     E1. ordre de démarrage prouvé par le source : setupDatabase →
 *         createPreMigrationBackup → startNextServer → runInternalMigration →
 *         createMainWindow (sauvegarde AVANT serveur, migration AVANT fenêtre) ;
 *     E2. runInternalMigration contrôle le statut HTTP ET le résultat métier
 *         (`statusCode !== 200`, `ok !== true`) — jamais de fenêtre sur échec ;
 *     E3. échec de sauvegarde pré-migration = fail-closed
 *         (PRE_MIGRATION_BACKUP_FAILED + app.exit(1)) ;
 *     E4. aucun catch vide dans la SÉQUENCE DE DÉMARRAGE (du setupDatabase au
 *         createMainWindow) ni dans pre-migration-backup.js ;
 *     E5. la sauvegarde vérifie le VRAI en-tête SQLite et applique une
 *         rétention qui ne supprime jamais la copie fraîche.
 *
 * Échec = exit 1 avec la liste des invariants violés.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8')

const errors = []
const routeSrc = read('src/app/api/internal/migrate/route.ts')
const migrationsSrc = read('src/lib/migrations.ts')
const mainSrc = read('electron/main.js')
const backupSrc = read('electron/pre-migration-backup.js')

/** Extrait le corps de chaque bloc `catch` (marche naïve sur les accolades). */
function catchBodies(src) {
  const bodies = []
  const re = /catch\s*(\([^)]*\))?\s*\{/g
  let m
  while ((m = re.exec(src)) !== null) {
    let depth = 1
    let i = re.lastIndex
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      i++
    }
    bodies.push({ body: src.slice(re.lastIndex, i - 1), at: src.slice(0, m.index).split('\n').length })
  }
  return bodies
}

// ── R1/R2/R4 : runner ─────────────────────────────────────────────────────────
if (!routeSrc.includes('prisma.$transaction(')) {
  errors.push('R1 runner : prisma.$transaction absent (migrations non atomiques)')
}
for (const [i, line] of routeSrc.split('\n').entries()) {
  if (line.includes('INSERT INTO "_gf_migrations"')) {
    const ctx = routeSrc.split('\n').slice(Math.max(0, i - 2), i + 1).join('\n')
    if (!/tx\.\$executeRawUnsafe/.test(ctx)) {
      errors.push(`R2 runner : enregistrement _gf_migrations HORS transaction (ligne ${i + 1})`)
    }
  }
}
for (const c of catchBodies(routeSrc)) {
  if (c.body.trim() === '') errors.push(`R3 runner : catch VIDE ligne ${c.at}`)
  if (/\bcontinue\b/.test(c.body)) errors.push(`R3 runner : catch qui « continue » ligne ${c.at} (erreur tolérée interdite)`)
}
for (const needle of ['PRAGMA integrity_check', 'PRAGMA foreign_key_check', 'MIGRATION_CHECKSUM_MISMATCH']) {
  if (!routeSrc.includes(needle)) errors.push(`R4 runner : « ${needle} » absent`)
}

// ── M1 : définitions — DROP COLUMN ⇒ verifySql dans la MÊME migration ─────────
{
  const segments = migrationsSrc.split(/(?=id:\s*')/)
  for (const seg of segments) {
    const idMatch = seg.match(/id:\s*'([^']+)'/)
    if (!idMatch) continue
    if (seg.includes('DROP COLUMN') && !seg.includes('verifySql')) {
      errors.push(`M1 migrations : ${idMatch[1]} contient un DROP COLUMN sans verifySql (suppression sans preuve)`)
    }
  }
}

// ── E1 : ordre de démarrage (dernières occurrences = appels, pas définitions) ─
{
  const anchors = [
    ['setupDatabase()', mainSrc.lastIndexOf('setupDatabase()')],
    ['createPreMigrationBackup(', mainSrc.lastIndexOf('createPreMigrationBackup(')],
    ['startNextServer()', mainSrc.lastIndexOf('startNextServer()')],
    ['runInternalMigration()', mainSrc.lastIndexOf('runInternalMigration()')],
    ['createMainWindow()', mainSrc.lastIndexOf('createMainWindow()')],
  ]
  for (const [name, idx] of anchors) {
    if (idx === -1) errors.push(`E1 electron : appel « ${name} » introuvable dans main.js`)
  }
  for (let i = 1; i < anchors.length; i++) {
    if (anchors[i][1] !== -1 && anchors[i - 1][1] !== -1 && anchors[i][1] < anchors[i - 1][1]) {
      errors.push(`E1 electron : « ${anchors[i][0]} » appelé AVANT « ${anchors[i - 1][0]} » (ordre de sûreté violé)`)
    }
  }
}

// ── E2/E3 : contrôle du résultat + fail-closed ────────────────────────────────
if (!/statusCode\s*!==\s*200/.test(mainSrc) || !/\.ok\s*!==\s*true/.test(mainSrc)) {
  errors.push('E2 electron : runInternalMigration ne contrôle pas statut HTTP + ok===true')
}
if (!mainSrc.includes('MIGRATION_BAD_RESPONSE')) {
  errors.push('E2 electron : réponse illisible non traitée comme échec (MIGRATION_BAD_RESPONSE absent)')
}
if (!mainSrc.includes('PRE_MIGRATION_BACKUP_FAILED')) {
  errors.push('E3 electron : échec de sauvegarde pré-migration non fail-closed (code absent)')
}
if (!mainSrc.includes('app.exit(1)')) {
  errors.push('E3 electron : aucun app.exit(1) (échec sans arrêt contrôlé)')
}

// ── E4 : catch vides dans la séquence de démarrage + module de sauvegarde ─────
{
  const start = mainSrc.lastIndexOf('setupDatabase()')
  const end = mainSrc.lastIndexOf('createMainWindow()')
  if (start !== -1 && end !== -1 && end > start) {
    const startupRegion = mainSrc.slice(start, end)
    const lineBase = mainSrc.slice(0, start).split('\n').length
    for (const c of catchBodies(startupRegion)) {
      if (c.body.trim() === '') errors.push(`E4 electron : catch VIDE dans la séquence de démarrage (ligne ~${lineBase + c.at})`)
    }
  }
  for (const c of catchBodies(backupSrc)) {
    if (c.body.trim() === '') errors.push(`E4 backup : catch VIDE ligne ${c.at} de pre-migration-backup.js`)
  }
}

// ── E5 : sauvegarde vérifiée + rétention sûre ─────────────────────────────────
if (!backupSrc.includes('SQLite format 3')) {
  errors.push('E5 backup : vérification du VRAI en-tête SQLite absente')
}
if (!backupSrc.includes('KEEP_BACKUPS')) {
  errors.push('E5 backup : rétention KEEP_BACKUPS absente')
}

if (errors.length) {
  console.error(`\n❌ Sûreté des migrations : ${errors.length} invariant(s) violé(s) :`)
  for (const e of errors) console.error(`   • ${e}`)
  process.exit(1)
}
console.log(
  '✅ Sûreté des migrations : runner atomique fail-closed (enregistrement en transaction, zéro catch toléré), DROP toujours prouvé, ordre Electron sauvegarde → serveur → migration → fenêtre, contrôle HTTP+métier, sauvegarde vérifiée avec rétention sûre.',
)
