#!/usr/bin/env node
/**
 * Réparation APRÈS rotation des clés « au repos » (GF_DB_MAC_SECRET, DEVICE_TOKEN_PEPPER).
 *
 * Contexte : roter GF_DB_MAC_SECRET invalide TOUS les recordMac des LicenseKey →
 * verifyRecordMac renvoie `tampered` → /api/license/check et /api/license/activate
 * BLOQUENT toutes les licences (voir docs/POST_ROTATION_RECOVERY.md). Roter
 * DEVICE_TOKEN_PEPPER invalide tous les hachages d'appareil → ré-activation forcée
 * et inflation de sièges tant que les anciennes lignes restent `active`.
 *
 * Ce script, exécuté UNE FOIS contre la base de production (Neon) avec les
 * NOUVELLES valeurs en env, répare l'état :
 *   1. recalcule recordMac de chaque LicenseKey avec le GF_DB_MAC_SECRET courant ;
 *   2. (option --reset-devices) passe tous les appareils `active` à `deactivated`
 *      pour libérer les sièges — la machine se ré-activera proprement (nouveau
 *      hachage avec le nouveau pepper), les anciennes lignes ne comptant plus.
 *
 * SÉCURITÉ : ne s'exécute qu'avec --yes. N'écrit jamais de secret. Idempotent.
 *
 * Usage (PowerShell / bash), variables d'env = valeurs de PRODUCTION :
 *   DATABASE_URL="postgresql://…neon…"  \
 *   GF_DB_MAC_SECRET="<nouvelle valeur>" \
 *   node scripts/repair-after-secret-rotation.js --yes [--reset-devices]
 *
 * Dry-run (n'écrit rien, montre le nombre de lignes) : ométtre --yes.
 */
'use strict'
const crypto = require('crypto')

/**
 * MIROIR EXACT de src/lib/license/record-mac.ts::computeRecordMac.
 * Gardé en phase par le test src/lib/__tests__/remac-script-parity.test.ts
 * (échec du build/CI si la moindre divergence apparaît). NE PAS modifier l'une
 * sans l'autre.
 */
function computeRecordMac(secret, r) {
  const parts = [r.licenseId, r.token, r.status, new Date(r.expiryAt).toISOString(), r.hwid ?? '']
  if (r.parentLicenseId || r.mechanicId) {
    parts.push(r.parentLicenseId ?? '', r.mechanicId ?? '')
  }
  const msg = parts.join('\x00')
  return crypto.createHmac('sha256', secret).update(msg).digest('hex')
}

async function main() {
  const args = process.argv.slice(2)
  const confirmed = args.includes('--yes')
  const resetDevices = args.includes('--reset-devices')

  const secret = process.env.GF_DB_MAC_SECRET
  if (!secret || secret.trim().length < 16) {
    console.error('[repair] GF_DB_MAC_SECRET absent ou trop court. Exportez la NOUVELLE valeur de production.')
    process.exit(1)
  }
  if (!process.env.DATABASE_URL) {
    console.error('[repair] DATABASE_URL absent. Exportez l\'URL PostgreSQL (Neon) de production.')
    process.exit(1)
  }

  // Client PostgreSQL (serveur) généré depuis prisma/server/schema.prisma.
  let PrismaClient
  try {
    ({ PrismaClient } = require('../src/generated/server-client'))
  } catch (e) {
    console.error('[repair] Client serveur introuvable. Lancez d\'abord : npx prisma generate --schema prisma/server/schema.prisma')
    process.exit(1)
  }
  const prisma = new PrismaClient()

  try {
    // ── 1. Re-MAC de toutes les licences ─────────────────────────────────────
    const licenses = await prisma.licenseKey.findMany({
      select: { id: true, licenseId: true, token: true, status: true, expiryAt: true, hwid: true, parentLicenseId: true, mechanicId: true, recordMac: true },
    })
    let changed = 0, already = 0
    for (const l of licenses) {
      const mac = computeRecordMac(secret, l)
      if (mac === l.recordMac) { already++; continue }
      if (confirmed) {
        await prisma.licenseKey.update({ where: { id: l.id }, data: { recordMac: mac } })
      }
      changed++
    }
    console.log(`[repair] Licences : ${licenses.length} lues, ${changed} à recalculer, ${already} déjà cohérentes.`)
    console.log(confirmed ? `[repair] recordMac ${changed} licence(s) mis à jour ✅` : '[repair] DRY-RUN (ajoutez --yes pour écrire).')

    // ── 2. Réinitialisation des appareils (pepper roté) ──────────────────────
    if (resetDevices) {
      const activeCount = await prisma.licenseDevice.count({ where: { status: 'active' } })
      if (confirmed) {
        const res = await prisma.licenseDevice.updateMany({ where: { status: 'active' }, data: { status: 'deactivated' } })
        console.log(`[repair] Appareils : ${res.count} passés de active → deactivated (sièges libérés, ré-activation propre) ✅`)
      } else {
        console.log(`[repair] Appareils : ${activeCount} actif(s) seraient réinitialisés (DRY-RUN).`)
      }
    } else {
      console.log('[repair] (Appareils non touchés — ajoutez --reset-devices si DEVICE_TOKEN_PEPPER a été roté.)')
    }
  } finally {
    await prisma.$disconnect()
  }
}

module.exports = { computeRecordMac }

if (require.main === module) {
  main().catch((err) => {
    console.error('[repair] Échec :', err && err.message ? err.message : err)
    process.exit(1)
  })
}
