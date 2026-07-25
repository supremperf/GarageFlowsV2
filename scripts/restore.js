#!/usr/bin/env node
/**
 * GarageFlow — Database Restore Script
 *
 * Usage:
 *   node scripts/restore.js                  # interactive: list and choose a backup
 *   node scripts/restore.js --list           # list all available backups
 *   node scripts/restore.js --file <path>    # restore a specific backup file
 *   node scripts/restore.js --latest         # restore the most recent hourly backup
 *
 * The script reads backup files from the Electron userData directory (same path
 * that electron/main.js uses). It NEVER overwrites the backup — it copies the
 * backup to a new .restore file first, then replaces garageflow.db.
 *
 * IMPORTANT: Close GarageFlow before running this script.
 */

'use strict'

const fs   = require('fs')
const path = require('path')
const os   = require('os')
const { execSync } = require('child_process')

// ── Resolve Electron userData path ───────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function listBackups() {
  const tiers = ['hourly', 'daily', 'weekly']
  const backups = []

  for (const tier of tiers) {
    const dir = path.join(BAK_DIR, tier)
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

function doRestore(backupPath) {
  if (!fs.existsSync(backupPath)) {
    console.error('Erreur: fichier introuvable:', backupPath)
    process.exit(1)
  }

  // Safety: back up the current DB first
  if (fs.existsSync(DB_PATH)) {
    const safetyPath = DB_PATH + `.pre-restore-${Date.now()}.bak`
    fs.copyFileSync(DB_PATH, safetyPath)
    console.log('Sauvegarde de sécurité créée:', safetyPath)
  }

  fs.copyFileSync(backupPath, DB_PATH)
  console.log('✅ Base de données restaurée depuis:', backupPath)
  console.log('   Destination:', DB_PATH)
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

if (args.includes('--list') || args.includes('-l')) {
  const backups = listBackups()
  printBackups(backups)
  process.exit(0)
}

if (args.includes('--latest')) {
  const backups = listBackups().filter(b => b.tier === 'hourly')
  if (!backups.length) { console.error('Aucun backup horaire disponible.'); process.exit(1) }
  doRestore(backups[0].full)
  process.exit(0)
}

const fileIdx = args.indexOf('--file')
if (fileIdx !== -1) {
  const filePath = args[fileIdx + 1]
  if (!filePath) { console.error('--file requiert un chemin de fichier.'); process.exit(1) }
  doRestore(path.resolve(filePath))
  process.exit(0)
}

// Interactive mode — prompt the user
const backups = listBackups()
printBackups(backups)

if (!backups.length) process.exit(1)

const readline = require('readline')
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

rl.question(`Entrez le numéro du backup à restaurer (1-${backups.length}) ou q pour quitter: `, answer => {
  rl.close()
  if (answer.toLowerCase() === 'q') { console.log('Annulé.'); process.exit(0) }

  const n = parseInt(answer)
  if (isNaN(n) || n < 1 || n > backups.length) {
    console.error('Numéro invalide.')
    process.exit(1)
  }

  const chosen = backups[n - 1]
  console.log(`\nRestauration de: ${chosen.full}`)
  rl.question('Confirmer ? (o/N): ', confirm => {
    rl.close()
    if (confirm.toLowerCase() !== 'o') { console.log('Annulé.'); process.exit(0) }
    doRestore(chosen.full)
  })
})
