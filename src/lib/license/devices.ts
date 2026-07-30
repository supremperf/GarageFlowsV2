/**
 * Gestion des appareils par licence — activation atomique, jetons d'appareil.
 *
 * Garanties de sécurité :
 *  - deviceToken : 32 octets CSPRNG (256 bits d'entropie), retourné UNE SEULE
 *    fois au client ; seul son HMAC-SHA256 (tokenHash) est persisté ;
 *  - HWID : normalisé puis haché (HMAC-SHA256) avant stockage — jamais en clair ;
 *  - comparaisons à temps constant (crypto.timingSafeEqual) ;
 *  - plafond de sièges (LicenseKey.seats) appliqué dans UNE transaction :
 *      - PostgreSQL : verrou pessimiste `SELECT … FOR UPDATE` sur la ligne de
 *        licence — deux activations concurrentes sont sérialisées, le plafond
 *        ne peut pas être dépassé (prouvé par test de concurrence) ;
 *      - SQLite (Electron mono-poste) : écrivain unique + re-comptage de
 *        contrôle dans la transaction (rollback si dépassement) ;
 *  - révocation : un appareil révoqué reste révoqué (un administrateur doit le
 *    réinitialiser) ; une licence révoquée invalide immédiatement tous ses
 *    jetons (vérification du statut licence à chaque validation).
 */

import crypto from 'crypto'
import { prisma, isPostgresDatabase } from '@/lib/db'
import { isPwaProduction } from '@/lib/env'
import { getAuthSecret, isWeakSecret } from '@/lib/auth-secret'
import { normalizeHwid, isValidHwidFormat } from '@/lib/license/verify'

// ─── Pepper (clé HMAC) ───────────────────────────────────────────────────────

/**
 * Clé HMAC des hachés d'appareil (tokenHash / hwidHash).
 * - Production PWA : DEVICE_TOKEN_PEPPER fort OBLIGATOIRE (validé aussi au
 *   démarrage par src/lib/env.ts) ;
 * - Electron / dev : repli sur le secret d'installation (NEXTAUTH_SECRET,
 *   unique par poste) — jamais de constante en dur.
 */
export function getDevicePepper(): string {
  const p = process.env.DEVICE_TOKEN_PEPPER
  if (p && !isWeakSecret(p)) return p
  if (isPwaProduction()) {
    throw new Error(
      'DEVICE_TOKEN_PEPPER absent ou faible en production PWA. ' +
        'Configurez un secret aléatoire fort (openssl rand -base64 32).',
    )
  }
  return getAuthSecret()
}

// ─── Primitives jeton / HWID ─────────────────────────────────────────────────

/** Jeton d'appareil opaque : 32 octets CSPRNG → base64url (43 caractères). */
export function generateDeviceToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/** HMAC-SHA256 avec séparation de domaine — seul ce haché est persisté. */
export function hashDeviceToken(token: string): string {
  return crypto
    .createHmac('sha256', getDevicePepper())
    .update(`gf-device-token:${token}`)
    .digest('hex')
}

/** HMAC-SHA256 du HWID normalisé — jamais le HWID brut en base. */
export function hashHwid(hwid: string): string {
  return crypto
    .createHmac('sha256', getDevicePepper())
    .update(`gf-hwid:${normalizeHwid(hwid)}`)
    .digest('hex')
}

// ─── Identifiant d'installation PWA ──────────────────────────────────────────
// Un navigateur ne fournit pas de HWID matériel. Chaque installation PWA génère
// donc, côté client, un identifiant d'installation aléatoire (256 bits CSPRNG,
// base64url) stocké de façon persistante (localStorage) — NON intrusif (aucune
// empreinte de navigateur), unique par installation/profil, remplacé proprement
// si les données du navigateur sont effacées. Le serveur le traite exactement
// comme un HWID : il ne stocke que son HMAC (jamais la valeur brute) et il
// consomme un siège comme un appareil Electron.

/** Format attendu : base64url de 32 octets (43 caractères) → 256 bits. */
const INSTALL_ID_RE = /^[A-Za-z0-9_-]{43}$/

/** Génère un identifiant d'installation PWA (utilisable aussi côté serveur/tests). */
export function generateInstallId(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/** L'identifiant d'installation est-il bien formé (256 bits base64url) ? */
export function isValidInstallId(id: string | null | undefined): boolean {
  return INSTALL_ID_RE.test(String(id ?? '').trim())
}

/** HMAC-SHA256 de l'identifiant d'installation — jamais la valeur brute en base. */
export function hashInstallId(id: string): string {
  return crypto
    .createHmac('sha256', getDevicePepper())
    .update(`gf-pwa-install:${String(id).trim()}`)
    .digest('hex')
}

/** Comparaison à temps constant de deux hex de même longueur. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

// ─── Erreurs métier typées ───────────────────────────────────────────────────

/** Plafond d'appareils atteint pour la licence. */
export class DeviceLimitError extends Error {
  constructor(public readonly seats: number) {
    super(`Nombre maximal d'appareils atteint (${seats}).`)
    this.name = 'DeviceLimitError'
  }
}

/** L'appareil (licence + HWID) a été révoqué par un administrateur. */
export class DeviceRevokedError extends Error {
  constructor() {
    super('Cet appareil a été révoqué pour cette licence.')
    this.name = 'DeviceRevokedError'
  }
}

/** Identifiant d'appareil mal formé (HWID SHA-256 64 hex OU install id PWA). */
export class InvalidHwidError extends Error {
  constructor() {
    super('Identifiant d\'appareil invalide.')
    this.name = 'InvalidHwidError'
  }
}

// ─── Activation atomique ─────────────────────────────────────────────────────

export interface ActivateDeviceInput {
  /** LicenseKey.licenseId (lid du token signé). */
  licenseId: string
  /** Plafond de sièges de la licence (LicenseKey.seats). */
  seats: number
  /** HWID brut (Electron) — exactement l'un de hwid / installId doit être fourni. */
  hwid?: string
  /** Identifiant d'installation PWA (navigateur) — alternative au HWID. */
  installId?: string
  platform?: string
  appVersion?: string
  name?: string
}

/**
 * Résout l'empreinte d'appareil (HWID matériel OU install id PWA) en un HMAC
 * unique stocké dans LicenseDevice.hwidHash. Les deux domaines HMAC sont
 * distincts : un HWID et un install id ne peuvent jamais entrer en collision.
 */
function resolveFingerprint(input: ActivateDeviceInput): { hash: string; platform: string } {
  if (input.hwid) {
    const h = normalizeHwid(input.hwid)
    if (!isValidHwidFormat(h)) throw new InvalidHwidError()
    return { hash: hashHwid(h), platform: input.platform?.slice(0, 64) ?? 'desktop' }
  }
  if (input.installId) {
    if (!isValidInstallId(input.installId)) throw new InvalidHwidError()
    return { hash: hashInstallId(input.installId), platform: input.platform?.slice(0, 64) ?? 'pwa' }
  }
  // Aucun identifiant d'appareil : refus (jamais de siège « fantôme »).
  throw new InvalidHwidError()
}

export interface ActivateDeviceResult {
  /** Jeton en clair — retourné UNE SEULE fois, jamais persisté tel quel. */
  deviceToken: string
  deviceId: string
  /** true si l'appareil existait déjà (rotation de jeton). */
  rotated: boolean
}

/**
 * Enregistre (ou ré-enregistre) l'appareil et émet un jeton — ATOMIQUE.
 *
 * Toute la séquence verrou → recherche → comptage → écriture s'exécute dans
 * une transaction unique ; le jeton précédent de l'appareil est invalidé par
 * rotation (tokenHash remplacé).
 */
export async function activateDevice(input: ActivateDeviceInput): Promise<ActivateDeviceResult> {
  // Empreinte d'appareil : HWID (Electron) OU install id PWA — jamais aucune.
  const { hash: hwidH, platform } = resolveFingerprint(input)

  const seats = Math.max(1, input.seats)
  const token = generateDeviceToken()
  const tokenH = hashDeviceToken(token)
  const meta = {
    platform,
    appVersion: input.appVersion?.slice(0, 32) ?? null,
    name:       input.name?.slice(0, 64) ?? null,
  }

  const result = await prisma.$transaction(async (tx) => {
    if (isPostgresDatabase()) {
      // Verrou pessimiste : sérialise les activations concurrentes d'une même
      // licence — le count/create ci-dessous ne peut plus être en course.
      await tx.$executeRaw`SELECT "id" FROM "LicenseKey" WHERE "licenseId" = ${input.licenseId} FOR UPDATE`
    }

    const existing = await tx.licenseDevice.findUnique({
      where: { licenseId_hwidHash: { licenseId: input.licenseId, hwidHash: hwidH } },
    })

    if (existing) {
      if (existing.status === 'revoked') throw new DeviceRevokedError()

      // Réactivation d'un appareil auto-désactivé : re-consomme un siège.
      if (existing.status !== 'active') {
        const active = await tx.licenseDevice.count({
          where: { licenseId: input.licenseId, status: 'active' },
        })
        if (active >= seats) throw new DeviceLimitError(seats)
      }

      await tx.licenseDevice.update({
        where: { id: existing.id },
        data: {
          tokenHash:  tokenH, // rotation : l'ancien jeton devient invalide
          status:     'active',
          lastSeenAt: new Date(),
          ...meta,
        },
      })
      await tx.licenseDeviceEvent.create({
        data: {
          licenseId: input.licenseId,
          deviceId:  existing.deviceId,
          action:    existing.status === 'active' ? 'rotated' : 'reactivated',
        },
      })
      return { deviceToken: token, deviceId: existing.deviceId, rotated: true }
    }

    // Nouvel appareil : plafond de sièges appliqué sous verrou.
    const active = await tx.licenseDevice.count({
      where: { licenseId: input.licenseId, status: 'active' },
    })
    if (active >= seats) throw new DeviceLimitError(seats)

    const created = await tx.licenseDevice.create({
      data: {
        licenseId: input.licenseId,
        hwidHash:  hwidH,
        tokenHash: tokenH,
        status:    'active',
        ...meta,
      },
    })

    // Filet de sécurité (SQLite sans FOR UPDATE) : re-comptage dans la même
    // transaction — un dépassement annule TOUTE l'activation (rollback).
    const after = await tx.licenseDevice.count({
      where: { licenseId: input.licenseId, status: 'active' },
    })
    if (after > seats) throw new DeviceLimitError(seats)

    await tx.licenseDeviceEvent.create({
      data: { licenseId: input.licenseId, deviceId: created.deviceId, action: 'activated' },
    })
    return { deviceToken: token, deviceId: created.deviceId, rotated: false }
  })

  return result
}

/** Journalise (hors transaction, best-effort) un refus d'activation. */
export async function recordDeviceDenial(licenseId: string, action: 'limit_denied' | 'revoked_denied'): Promise<void> {
  try {
    await prisma.licenseDeviceEvent.create({ data: { licenseId, action } })
  } catch {
    // best-effort : le refus est déjà retourné au client
  }
}

// ─── Validation de jeton ─────────────────────────────────────────────────────

export type DeviceTokenFailure =
  | 'device_unknown'       // jeton inconnu (rotation, base réinitialisée…) → ré-activation
  | 'device_revoked'       // appareil révoqué / désactivé → blocage
  | 'device_hwid_mismatch' // jeton présenté depuis une autre machine → blocage
  | 'license_unknown'
  | 'license_revoked'
  | 'license_suspended'
  | 'license_expired'

export type ValidateDeviceTokenResult =
  | { ok: true; licenseId: string; deviceId: string }
  | { ok: false; code: DeviceTokenFailure }

/**
 * Valide un jeton d'appareil présenté lors d'un heartbeat.
 * Une licence révoquée/suspendue/expirée invalide IMMÉDIATEMENT ses jetons.
 */
export async function validateDeviceToken(
  token: string,
  opts: { hwid?: string; installId?: string } = {},
): Promise<ValidateDeviceTokenResult> {
  const tokenH = hashDeviceToken(token)
  const device = await prisma.licenseDevice.findUnique({ where: { tokenHash: tokenH } })
  if (!device) return { ok: false, code: 'device_unknown' }

  // Défense en profondeur : recomparaison à temps constant du haché.
  if (!timingSafeEqualHex(device.tokenHash, tokenH)) return { ok: false, code: 'device_unknown' }

  if (device.status !== 'active') return { ok: false, code: 'device_revoked' }

  // Vérification d'empreinte optionnelle : le jeton doit venir de la même
  // machine (HWID Electron) ou de la même installation (install id PWA).
  if (opts.hwid !== undefined) {
    if (!isValidHwidFormat(opts.hwid) || !timingSafeEqualHex(device.hwidHash, hashHwid(opts.hwid))) {
      return { ok: false, code: 'device_hwid_mismatch' }
    }
  }
  if (opts.installId !== undefined) {
    if (!isValidInstallId(opts.installId) || !timingSafeEqualHex(device.hwidHash, hashInstallId(opts.installId))) {
      return { ok: false, code: 'device_hwid_mismatch' }
    }
  }

  const license = await prisma.licenseKey.findUnique({ where: { licenseId: device.licenseId } })
  if (!license) return { ok: false, code: 'license_unknown' }
  if (license.status === 'revoked') return { ok: false, code: 'license_revoked' }
  if (license.status === 'suspended') return { ok: false, code: 'license_suspended' }
  if (license.expiryAt.getTime() < Date.now()) return { ok: false, code: 'license_expired' }

  // Heartbeat accepté : horodatages best-effort (jamais bloquants).
  try {
    await prisma.licenseDevice.update({
      where: { id: device.id },
      data:  { lastSeenAt: new Date() },
    })
  } catch {
    /* best-effort */
  }

  return { ok: true, licenseId: device.licenseId, deviceId: device.deviceId }
}

// ─── Révocation / désactivation / liste ──────────────────────────────────────

/** Révocation administrative — l'appareil ne peut plus se réactiver seul. */
export async function revokeDevice(deviceId: string, reason?: string): Promise<boolean> {
  const device = await prisma.licenseDevice.findUnique({ where: { deviceId } })
  if (!device) return false
  await prisma.$transaction([
    prisma.licenseDevice.update({
      where: { id: device.id },
      data: {
        status:       'revoked',
        revokedAt:    new Date(),
        revokeReason: reason?.slice(0, 200) ?? null,
      },
    }),
    prisma.licenseDeviceEvent.create({
      data: { licenseId: device.licenseId, deviceId, action: 'revoked' },
    }),
  ])
  return true
}

/** Réinitialisation administrative — libère le siège ET ré-autorise la machine. */
export async function resetDevice(deviceId: string): Promise<boolean> {
  const device = await prisma.licenseDevice.findUnique({ where: { deviceId } })
  if (!device) return false
  await prisma.$transaction([
    prisma.licenseDevice.delete({ where: { id: device.id } }),
    prisma.licenseDeviceEvent.create({
      data: { licenseId: device.licenseId, deviceId, action: 'reset' },
    }),
  ])
  return true
}

/** Auto-désactivation par le client (libère le siège, machine ré-activable). */
export async function deactivateByToken(token: string): Promise<boolean> {
  const tokenH = hashDeviceToken(token)
  const device = await prisma.licenseDevice.findUnique({ where: { tokenHash: tokenH } })
  if (!device || device.status !== 'active') return false
  await prisma.$transaction([
    prisma.licenseDevice.update({
      where: { id: device.id },
      data:  { status: 'deactivated' },
    }),
    prisma.licenseDeviceEvent.create({
      data: { licenseId: device.licenseId, deviceId: device.deviceId, action: 'deactivated' },
    }),
  ])
  return true
}

export interface DeviceSummary {
  deviceId: string
  status: string
  name: string | null
  platform: string | null
  appVersion: string | null
  firstActivatedAt: Date
  lastSeenAt: Date
  revokedAt: Date | null
}

/** Liste pseudonymisée (jamais de hwidHash/tokenHash exposé). */
export async function listDevices(licenseId: string): Promise<DeviceSummary[]> {
  const devices = await prisma.licenseDevice.findMany({
    where:   { licenseId },
    orderBy: { firstActivatedAt: 'asc' },
    select: {
      deviceId: true,
      status: true,
      name: true,
      platform: true,
      appVersion: true,
      firstActivatedAt: true,
      lastSeenAt: true,
      revokedAt: true,
    },
  })
  return devices
}

/** Nombre d'appareils actifs (pour l'admin / le statut). */
export async function countActiveDevices(licenseId: string): Promise<number> {
  return prisma.licenseDevice.count({ where: { licenseId, status: 'active' } })
}
