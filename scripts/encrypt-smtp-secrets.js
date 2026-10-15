#!/usr/bin/env node
'use strict'

/**
 * Migration de données — chiffrement au repos des mots de passe SMTP.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Chiffre en place (AES-256-GCM) les valeurs `Garage.smtpPass` encore stockées
 * EN CLAIR. Idempotent : une valeur déjà chiffrée (préfixe « GFSEC1: ») est
 * détectée et ignorée. Fonctionne pour les deux bases (SQLite desktop et
 * PostgreSQL serveur) via le client Prisma configuré par DATABASE_URL.
 *
 * SÉCURITÉ / SÛRETÉ :
 *   • Sauvegardez la base AVANT (le script le rappelle et refuse sans --yes).
 *   • --dry-run : n'écrit rien, affiche seulement le nombre de lignes à traiter.
 *   • Aucun secret n'est affiché (ni clé, ni mot de passe).
 *   • Nécessite GF_SMTP_CIPHER_KEY (« openssl rand -base64 32 »).
 *
 * Usage :
 *   node scripts/encrypt-smtp-secrets.js --dry-run
 *   node scripts/encrypt-smtp-secrets.js --yes
 *   node scripts/encrypt-smtp-secrets.js --yes --schema prisma/server/schema.prisma
 *
 * Rotation de clé :
 *   1. GF_SMTP_CIPHER_KEY = NOUVELLE clé, GF_SMTP_CIPHER_KEY_OLD = ancienne ;
 *   2. node scripts/encrypt-smtp-secrets.js --yes --rotate  (rechiffre tout) ;
 *   3. après validation humaine, retirez GF_SMTP_CIPHER_KEY_OLD.
 */

const crypto = require('crypto')

const PREFIX = 'GFSEC1:'
const ALGO = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_BYTES = 32

function fail(msg) {
  console.error(`❌  ${msg}`)
  process.exit(1)
}

function decodeKey(b64) {
  const key = Buffer.from(String(b64 || ''), 'base64')
  if (key.length !== KEY_BYTES) fail(`Clé invalide : ${KEY_BYTES} octets base64 requis (décodé ${key.length}).`)
  return key
}
function kidOf(key) {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 8)
}
function isEncrypted(v) {
  return typeof v === 'string' && v.startsWith(PREFIX)
}
function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()])
  const tag = cipher.getAuthTag()
  const env = { v: 1, alg: ALGO, kid: kidOf(key), iv: iv.toString('base64'), tag: tag.toString('base64'), ct: ct.toString('base64') }
  return PREFIX + Buffer.from(JSON.stringify(env), 'utf8').toString('base64')
}
function decryptWithKeys(stored, keys) {
  const env = JSON.parse(Buffer.from(stored.slice(PREFIX.length), 'base64').toString('utf8'))
  const key = keys.find((k) => kidOf(k) === env.kid)
  if (!key) throw new Error('aucune clé ne correspond (kid)')
  const d = crypto.createDecipheriv(ALGO, key, Buffer.from(env.iv, 'base64'), { authTagLength: 16 })
  d.setAuthTag(Buffer.from(env.tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(env.ct, 'base64')), d.final()]).toString('utf8')
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const yes = args.includes('--yes')
  const rotate = args.includes('--rotate')
  const schemaIdx = args.indexOf('--schema')
  const schema = schemaIdx >= 0 ? args[schemaIdx + 1] : null

  const primaryRaw = process.env.GF_SMTP_CIPHER_KEY
  if (!primaryRaw) fail('GF_SMTP_CIPHER_KEY absente. Générez « openssl rand -base64 32 » puis réexécutez.')
  const primary = decodeKey(primaryRaw)
  const oldKeys = (process.env.GF_SMTP_CIPHER_KEY_OLD || '')
    .split(',').map((s) => s.trim()).filter(Boolean).map(decodeKey)
  const allKeys = [primary, ...oldKeys]

  if (!dryRun && !yes) {
    fail('Refus par sécurité. Sauvegardez la base, puis relancez avec --yes (ou --dry-run pour simuler).')
  }

  // Le client Prisma est chargé paresseusement (après la validation des args).
  const { PrismaClient } = schema && schema.includes('server')
    ? require('../src/generated/server-client')
    : require('@prisma/client')
  const prisma = new PrismaClient()

  let processed = 0
  let encrypted = 0
  let rotated = 0
  let skipped = 0
  try {
    const rows = await prisma.garage.findMany({ select: { id: true, smtpPass: true } })
    for (const row of rows) {
      const val = row.smtpPass
      if (val == null || val === '') { continue }
      processed++
      if (isEncrypted(val)) {
        if (rotate) {
          // Rechiffre avec la clé primaire courante (rotation).
          const clear = decryptWithKeys(val, allKeys)
          if (!dryRun) await prisma.garage.update({ where: { id: row.id }, data: { smtpPass: encrypt(clear, primary) } })
          rotated++
        } else {
          skipped++
        }
        continue
      }
      // Valeur en clair → chiffrer.
      if (!dryRun) await prisma.garage.update({ where: { id: row.id }, data: { smtpPass: encrypt(val, primary) } })
      encrypted++
    }
  } finally {
    await prisma.$disconnect()
  }

  const mode = dryRun ? '(simulation, aucune écriture)' : ''
  console.log(`✅  SMTP secrets ${mode}`)
  console.log(`    lignes avec mot de passe : ${processed}`)
  console.log(`    chiffrées (étaient en clair) : ${encrypted}`)
  if (rotate) console.log(`    rechiffrées (rotation) : ${rotated}`)
  console.log(`    déjà chiffrées, ignorées : ${skipped}`)
}

main().catch((e) => fail(e.message))
