#!/usr/bin/env node
/**
 * GarageFlows — Database Restore Script
 *
 * Usage:
 *   node scripts/restore.js                  # interactive: list and choose a backup
 *   node scripts/restore.js --list           # list all available backups
 *   node scripts/restore.js --file <path>    # restore a specific backup file
 *   node scripts/restore.js --latest         # restore the most recent hourly backup
 *
 * The script reads backup files from the Electron userData directory (same path
 * that electron/main.js uses). It NEVER overwrites the backup — it copies the
 * current DB to a safety `.pre-restore-*.bak` first, VALIDATES the chosen backup
 * is a real SQLite file, then replaces garageflow.db. If the copy leaves an
 * invalid DB it ROLLS BACK from the safety copy.
 *
 * IMPORTANT: Close GarageFlows before running this script.
 */

'use strict'

const fs   = require('fs')
const path = require('path')
const os   = require('os')

// ── Resolve Electron userData path ───────────────────────────────────────────
// Épinglé sur le nom HISTORIQUE « GarageFlow » (singulier) : c'est le dossier
// userData réel de l'app (electron/user-data-path.js), conservé pour ne pas
// perdre les installations existantes malgré le productName « GarageFlows ».

function getAppDataPath() {
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.APPDATA ?? os.homedir(), 'GarageFlow')
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'GarageFlow')
    default:
      return path.join(os.homedir(), '.config', 'GarageFlow')
  }
}

const APP_DATA = process.env.GF_APP_DATA ?? getAppDataPath()
const DB_PATH  = path.join(APP_DATA, 'garageflow.db')
const BAK_DIR  = path.join(APP_DATA, 'backups')

// SQLite magic : « SQLite format 3\0 ». On compare les 15 premiers octets en hex
// (pas d'octet nul dans la comparaison) — identique à electron/main.js.
const SQLITE_MAGIC_HEX = '53514c69746520666f726d61742033'

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidSqliteFile(filePath) {
  try {
    const stat = fs.statSync(filePath)
    if (stat.size < 512) return false
    const buf = Buffer.alloc(15)
    const fd  = fs.openSync(filePath, 'r')
    try { fs.readSync(fd, buf, 0, 15, 0) } finally { fs.closeSync(fd) }
    return buf.toString('hex') === SQLITE_MAGIC_HEX
  } catch {
    return false
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function listBackups(bakDir = BAK_DIR) {
  const tiers = ['hourly', 'daily', 'weekly']
  const backups = []

  for (const tier of tiers) {
    const dir = path.join(bakDir, tier)
    if (!fs.existsSync(dir)) continue
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('garageflow_') && f.endsWith('.db'))
      .sort()
      .reverse()
    for (const f of files) {
      const full = path.join(dir, f)
      const stat = fs.statSync(full)
      backups.push({ tier, file: f, full, mtime: stat.mtime, size: stat.size })
    }
  }

  return backups
}

function printBackups(backups) {
  if (!backups.length) {
    console.log('Aucun backup disponible dans', BAK_DIR)
    return
  }
  console.log(`\n${'#'.padEnd(4)} ${'Tier'.padEnd(8)} ${'Fichier'.padEnd(35)} ${'Taille'.padEnd(10)} Modifié`)
  console.log('─'.repeat(80))
  backups.forEach((b, i) => {
    const idx   = String(i + 1).padEnd(4)
    const tier  = b.tier.padEnd(8)
    const file  = b.file.padEnd(35)
    const size  = formatSize(b.size).padEnd(10)
    const mtime = b.mtime.toLocaleString('fr-FR')
    console.log(`${idx} ${tier} ${file} ${size} ${mtime}`)
  })
  console.log()
}

/**
 * Interprète la saisie interactive. Pur/testable.
 * @returns {{kind:'quit'}|{kind:'invalid'}|{kind:'index', index:number}}
 */
function parseSelection(answer, count) {
  const a = String(answer ?? '').trim().toLowerCase()
  if (a === 'q' || a === '') return { kind: 'quit' }
  const n = Number.parseInt(a, 10)
  if (!Number.isInteger(n) || n < 1 || n > count) return { kind: 'invalid' }
  return { kind: 'index', index: n - 1 }
}

/**
 * Restaure `backupPath` vers `dbPath` de façon SÛRE :
 *  1. refuse une archive absente ou non-SQLite (jamais d'écrasement à l'aveugle) ;
 *  2. copie de sécurité de la base courante AVANT toute écriture ;
 *  3. copie l'archive, VÉRIFIE que la base résultante est un SQLite valide ;
 *  4. en cas d'échec, ROLLBACK depuis la copie de sécurité.
 * Ne fait JAMAIS process.exit — renvoie un résultat structuré (testable).
 */
function doRestore(backupPath, opts = {}) {
  const dbPath = opts.dbPath || DB_PATH
  const now    = opts.now || Date.now

  if (!fs.existsSync(backupPath)) {
    return { ok: false, error: 'BACKUP_NOT_FOUND', message: `fichier introuvable: ${backupPath}` }
  }
  if (!isValidSqliteFile(backupPath)) {
    return { ok: false, error: 'BACKUP_INVALID', message: `archive non valide (pas une base SQLite): ${backupPath}` }
  }

  let safetyPath = null
  if (fs.existsSync(dbPath)) {
    safetyPath = `${dbPath}.pre-restore-${now()}.bak`
    fs.copyFileSync(dbPath, safetyPath)
  }

  try {
    fs.copyFileSync(backupPath, dbPath)
    if (!isValidSqliteFile(dbPath)) throw new Error('la base restaurée est invalide après copie')
    return { ok: true, dbPath, backupPath, safetyPath }
  } catch (err) {
    let rolledBack = false
    if (safetyPath && fs.existsSync(safetyPath)) {
      try { fs.copyFileSync(safetyPath, dbPath); rolledBack = true } catch { /* laisser l'erreur d'origine primer */ }
    }
    return { ok: false, error: 'RESTORE_FAILED', message: err.message, safetyPath, rolledBack }
  }
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve))
}

/**
 * Flux interactif DÉTERMINISTE : une SEULE interface readline, fermée UNE seule
 * fois (dans le finally). L'ancien code appelait rl.close() après la 1re question
 * puis rl.question() sur l'interface FERMÉE → la confirmation ne lisait jamais
 * l'entrée. Ctrl+C est géré proprement (SIGINT → annulation, exit 130).
 */
async function interactive() {
  const backups = listBackups()
  printBackups(backups)
  if (!backups.length) return 1

  const readline = require('readline')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.on('SIGINT', () => { console.log('\nAnnulé.'); rl.close(); process.exit(130) })

  try {
    const answer = await ask(rl, `Entrez le numéro du backup à restaurer (1-${backups.length}) ou q pour quitter: `)
    const sel = parseSelection(answer, backups.length)
    if (sel.kind === 'quit')    { console.log('Annulé.'); return 0 }
    if (sel.kind === 'invalid') { console.error('Numéro invalide.'); return 1 }

    const chosen = backups[sel.index]
    console.log(`\nRestauration de: ${chosen.full}`)
    const confirm = await ask(rl, 'Confirmer ? (o/N): ')
    if (confirm.trim().toLowerCase() !== 'o') { console.log('Annulé.'); return 0 }

    const res = doRestore(chosen.full)
    if (res.ok) {
      if (res.safetyPath) console.log('Sauvegarde de sécurité créée:', res.safetyPath)
      console.log('✅ Base de données restaurée depuis:', res.backupPath)
      console.log('   Destination:', res.dbPath)
      return 0
    }
    console.error('❌ Restauration échouée:', res.message + (res.rolledBack ? ' (base d\'origine restaurée)' : ''))
    return 1
  } finally {
    rl.close()
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--list') || args.includes('-l')) {
    printBackups(listBackups())
    return 0
  }

  if (args.includes('--latest')) {
    const backups = listBackups().filter(b => b.tier === 'hourly')
    if (!backups.length) { console.error('Aucun backup horaire disponible.'); return 1 }
    const res = doRestore(backups[0].full)
    if (res.ok) { console.log('✅ Base restaurée depuis:', res.backupPath); return 0 }
    console.error('❌', res.message); return 1
  }

  const fileIdx = args.indexOf('--file')
  if (fileIdx !== -1) {
    const filePath = args[fileIdx + 1]
    if (!filePath) { console.error('--file requiert un chemin de fichier.'); return 1 }
    const res = doRestore(path.resolve(filePath))
    if (res.ok) { console.log('✅ Base restaurée depuis:', res.backupPath); return 0 }
    console.error('❌', res.message); return 1
  }

  return interactive()
}

// Exécution CLI uniquement en invocation directe (pas à l'import pour les tests).
if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => { console.error(err); process.exit(1) })
}

module.exports = {
  getAppDataPath,
  isValidSqliteFile,
  formatSize,
  listBackups,
  parseSelection,
  doRestore,
}
