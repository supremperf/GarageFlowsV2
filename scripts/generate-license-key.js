#!/usr/bin/env node
/**
 * GarageFlow License Key Generator
 * ─────────────────────────────────
 * Run: node scripts/generate-license-key.js [customerId] [expiryYear]
 *
 * Example:
 *   node scripts/generate-license-key.js 1 2028
 *   → GF-0001-07D4-A3F9-7B21
 *
 * Keep the MASTER_SECRET identical to the one in electron/main.js!
 */

'use strict'

const crypto = require('crypto')

// ⚠️  Secret HMAC de génération des clés de licence — fourni par l'environnement,
//     jamais codé en dur dans le dépôt. Doit correspondre au secret embarqué
//     dans le client de validation (electron/main.js).
//     NB : ce schéma HMAC symétrique est déprécié (secret nécessairement présent
//     côté client = forgeable). Préférer la signature ECC (tokens GF2). Voir
//     docs/SECURITY.md.
const MASTER_SECRET = process.env.GF_LICENSE_MASTER_SECRET
if (!MASTER_SECRET || MASTER_SECRET.length < 16) {
  console.error(
    'Erreur : variable GF_LICENSE_MASTER_SECRET absente ou trop courte.\n' +
      'Définissez-la (openssl rand -hex 32) avant de générer une clé de licence.'
  )
  process.exit(1)
}

function generateKey(customerId, expiryYear) {
  const custHex = customerId.toString(16).toUpperCase().padStart(4, '0')
  const yearHex = expiryYear.toString(16).toUpperCase().padStart(4, '0')
  const payload = `${custHex}:${yearHex}:GARAGEFLOW`
  const hmac = crypto
    .createHmac('sha256', MASTER_SECRET)
    .update(payload)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase()
  return `GF-${custHex}-${yearHex}-${hmac.slice(0, 4)}-${hmac.slice(4, 8)}`
}

function validateKey(key) {
  const cleaned = key.replace(/[\s\-]/g, '').toUpperCase()
  if (!cleaned.startsWith('GF') || cleaned.length !== 18) return null

  const custHex = cleaned.slice(2, 6)
  const yearHex = cleaned.slice(6, 10)
  const keyHmac = cleaned.slice(10)
  const year = parseInt(yearHex, 16)

  const payload = `${custHex}:${yearHex}:GARAGEFLOW`
  const expected = crypto
    .createHmac('sha256', MASTER_SECRET)
    .update(payload)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase()

  if (keyHmac !== expected) return null
  return { customerId: parseInt(custHex, 16), expiryYear: year }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

if (args[0] === '--batch') {
  // Generate keys for customers 1..N for a given year
  const count = parseInt(args[1]) || 10
  const year  = parseInt(args[2]) || new Date().getFullYear() + 1
  console.log(`\n📦 Batch: ${count} keys for year ${year}\n`)
  for (let i = 1; i <= count; i++) {
    console.log(`  Customer ${String(i).padStart(4, '0')}: ${generateKey(i, year)}`)
  }
  console.log()
} else {
  const customerId  = parseInt(args[0]) || 1
  const expiryYear  = parseInt(args[1]) || new Date().getFullYear() + 1

  if (customerId < 1 || customerId > 65535) {
    console.error('Customer ID must be between 1 and 65535')
    process.exit(1)
  }
  if (expiryYear < 2024 || expiryYear > 2100) {
    console.error('Expiry year must be between 2024 and 2100')
    process.exit(1)
  }

  const key = generateKey(customerId, expiryYear)

  console.log(`\n🔑 GarageFlow License Key\n`)
  console.log(`  Customer ID : ${customerId}`)
  console.log(`  Expiry year : ${expiryYear}`)
  console.log(`  License key : \x1b[32m${key}\x1b[0m\n`)

  // Verify round-trip
  const check = validateKey(key)
  if (check) {
    console.log(`  ✅ Verification passed\n`)
  } else {
    console.error(`  ❌ Verification FAILED — check MASTER_SECRET\n`)
    process.exit(1)
  }
}
