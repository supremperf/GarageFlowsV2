/**
 * Encrypted backup service (Phase 1).
 *
 * Orchestrates snapshot → AES-256-GCM encrypt → store, plus verify and restore.
 * The encrypted envelope is written to disk under GF_BACKUP_DIR (so a backup
 * survives DB loss); metadata + the plaintext checksum live in BackupRecord for
 * history, versioning and automatic verification. The encryption key is either
 * GF_BACKUP_KEY (raw 32 bytes) or a per-request passphrase (scrypt).
 */

import fs from 'fs'
import path from 'path'
import type { BackupRecord } from '@prisma/client'
import { prisma } from '@/lib/db'
import { backupKey } from '@/lib/env'
import { logger } from '@/lib/logger'
import {
  encrypt, decrypt, encryptWithPassphrase, decryptWithPassphrase, sha256, parseRawKey, type EncryptedEnvelope,
} from './crypto'
import { snapshotGarage, restoreSnapshot, countTables, type GarageSnapshot } from './snapshot'

/** Directory where encrypted backup blobs are written. */
export function backupDir(): string {
  if (process.env.GF_BACKUP_DIR) return process.env.GF_BACKUP_DIR
  const photos = process.env.GF_PHOTOS_DIR
  const base = photos ? path.dirname(photos) : process.cwd()
  return path.join(base, 'backups')
}

function encryptPlaintext(plaintext: string, passphrase?: string): { env: EncryptedEnvelope; kdf: 'raw' | 'scrypt' } {
  if (passphrase) return { env: encryptWithPassphrase(plaintext, passphrase), kdf: 'scrypt' }
  const configured = backupKey()
  if (!configured) {
    throw new Error('Aucune clé de sauvegarde : définissez GF_BACKUP_KEY ou fournissez une passphrase.')
  }
  return { env: encrypt(plaintext, parseRawKey(configured)), kdf: 'raw' }
}

function decryptEnvelope(env: EncryptedEnvelope, passphrase?: string): Buffer {
  if (env.kdf === 'scrypt') {
    if (!passphrase) throw new Error('Cette sauvegarde est protégée par passphrase — passphrase requise.')
    return decryptWithPassphrase(env, passphrase)
  }
  const configured = backupKey()
  if (!configured) throw new Error('GF_BACKUP_KEY requise pour déchiffrer cette sauvegarde.')
  return decrypt(env, parseRawKey(configured))
}

/** Create an encrypted backup of a garage. */
export async function createBackup(
  garageId: string,
  opts: { passphrase?: string; note?: string } = {},
): Promise<BackupRecord> {
  const snapshot = await prisma.$transaction(tx => snapshotGarage(tx, garageId))
  const plaintext = JSON.stringify(snapshot)
  const checksum = sha256(plaintext)
  const { env, kdf } = encryptPlaintext(plaintext, opts.passphrase)
  const blob = JSON.stringify(env)

  const record = await prisma.backupRecord.create({
    data: {
      garageId,
      filename: 'pending',
      checksum,
      kdf,
      entityCounts: JSON.stringify(countTables(snapshot)),
      note: opts.note ?? null,
      status: 'completed',
    },
  })

  const filename = `gf-backup-${garageId}-${record.createdAt.toISOString().replace(/[:.]/g, '-')}-${record.id}.json`
  const dir = backupDir()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, filename), blob, { mode: 0o600 })

  return prisma.backupRecord.update({
    where: { id: record.id },
    data: { filename, sizeBytes: Buffer.byteLength(blob) },
  })
}

/** List a garage's backups, newest first. */
export function listBackups(garageId: string): Promise<BackupRecord[]> {
  return prisma.backupRecord.findMany({ where: { garageId }, orderBy: { createdAt: 'desc' }, take: 100 })
}

/** Read and parse the on-disk encrypted envelope for a record. */
function readEnvelope(record: BackupRecord): EncryptedEnvelope {
  const full = path.join(backupDir(), record.filename)
  const raw = fs.readFileSync(full, 'utf8')
  return JSON.parse(raw) as EncryptedEnvelope
}

export interface VerifyResult {
  ok: boolean
  checksumMatches: boolean
  counts: Record<string, number>
  error?: string
}

/**
 * Automatic verification / restore test: decrypt the backup, re-check the
 * plaintext checksum and parse the snapshot — WITHOUT touching the live data.
 */
export async function verifyBackup(garageId: string, id: string, passphrase?: string): Promise<VerifyResult> {
  const record = await prisma.backupRecord.findFirst({ where: { id, garageId } })
  if (!record) return { ok: false, checksumMatches: false, counts: {}, error: 'Sauvegarde introuvable' }
  try {
    const plaintext = decryptEnvelope(readEnvelope(record), passphrase).toString('utf8')
    const checksumMatches = sha256(plaintext) === record.checksum
    const snapshot = JSON.parse(plaintext) as GarageSnapshot
    const counts = countTables(snapshot)
    if (checksumMatches && record.status === 'completed') {
      await prisma.backupRecord.update({ where: { id: record.id }, data: { status: 'verified' } }).catch(() => {})
    }
    return { ok: checksumMatches, checksumMatches, counts }
  } catch (err) {
    logger.error('[backup] verify failed:', err)
    return { ok: false, checksumMatches: false, counts: {}, error: 'Déchiffrement/intégrité en échec' }
  }
}

/**
 * Restore a garage from a backup (atomic replace). Requires the caller to pass
 * `confirm === id` as an explicit safety acknowledgement, since this OVERWRITES
 * the garage's current data.
 */
export async function restoreBackup(
  garageId: string,
  id: string,
  opts: { passphrase?: string; confirm: string },
): Promise<{ ok: boolean; restored?: Record<string, number>; error?: string }> {
  const record = await prisma.backupRecord.findFirst({ where: { id, garageId } })
  if (!record) return { ok: false, error: 'Sauvegarde introuvable' }
  if (opts.confirm !== id) return { ok: false, error: 'Confirmation invalide (confirm doit égaler l’id de la sauvegarde).' }

  let snapshot: GarageSnapshot
  try {
    const plaintext = decryptEnvelope(readEnvelope(record), opts.passphrase).toString('utf8')
    if (sha256(plaintext) !== record.checksum) return { ok: false, error: 'Intégrité de la sauvegarde compromise — restauration annulée.' }
    snapshot = JSON.parse(plaintext) as GarageSnapshot
  } catch (err) {
    logger.error('[backup] restore decrypt failed:', err)
    return { ok: false, error: 'Déchiffrement en échec (clé/passphrase ?)' }
  }
  if (snapshot.garageId !== garageId) return { ok: false, error: 'La sauvegarde ne correspond pas à ce garage.' }

  const restored = await prisma.$transaction(tx => restoreSnapshot(tx, snapshot))
  await prisma.backupRecord.update({ where: { id: record.id }, data: { status: 'restored' } }).catch(() => {})
  return { ok: true, restored }
}

/** Return the raw encrypted blob for external/off-site storage. */
export async function readBackupBlob(garageId: string, id: string): Promise<{ filename: string; blob: string } | null> {
  const record = await prisma.backupRecord.findFirst({ where: { id, garageId } })
  if (!record) return null
  const blob = fs.readFileSync(path.join(backupDir(), record.filename), 'utf8')
  return { filename: record.filename, blob }
}
