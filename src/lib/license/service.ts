/**
 * License service — the ONE place all license business logic lives.
 *
 * Every API route (admin + client) delegates here, and every operation the
 * central server is responsible for is implemented here:
 *   create · activate · validate · renew · change HWID · suspend · revoke ·
 *   expire · delete
 *
 * The server (PostgreSQL via licenseDb) is always the source of truth. Clients
 * only ever receive an *evaluation* — never write authority.
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { licenseDb, licenseAuthorityConfigured } from '@/lib/license-db'
import { verifyLicenseToken, verifyHwid, type LicensePayload } from '@/lib/license/verify'
import type { LicenseKey } from '@/generated/license-client'

// ─── Constants ─────────────────────────────────────────────────────────────────
export const LICENSE_TYPES = ['trial', 'premium', 'enterprise', 'admin'] as const
export type LicenseType = (typeof LICENSE_TYPES)[number]

export const LICENSE_STATUSES = ['active', 'revoked', 'suspended'] as const
export type LicenseStatus = (typeof LICENSE_STATUSES)[number]

export function isLicenseType(v: unknown): v is LicenseType {
  return typeof v === 'string' && (LICENSE_TYPES as readonly string[]).includes(v)
}
export function isLicenseStatus(v: unknown): v is LicenseStatus {
  return typeof v === 'string' && (LICENSE_STATUSES as readonly string[]).includes(v)
}

// ─── Result helpers ─────────────────────────────────────────────────────────────
export type ServiceResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

function fail(status: number, error: string): { ok: false; status: number; error: string } {
  return { ok: false, status, error }
}

/** Guard used at the top of every mutating service call. */
function ensureAuthority(): { ok: false; status: number; error: string } | null {
  if (!licenseAuthorityConfigured()) {
    return fail(503, "Cette instance n'est pas le serveur de licences (LICENSE_DATABASE_URL absente).")
  }
  return null
}

// ─── Evaluation (pure) ──────────────────────────────────────────────────────────
export type EvalStatus = 'active' | 'revoked' | 'suspended' | 'expired' | 'unknown'
export interface Evaluation {
  allowed: boolean
  status: EvalStatus
  reason?: string
  licenseType?: string
  expiryAt?: string
  seats?: number
  isAdmin?: boolean
}

/** Apply status + expiry rules to a stored record. The server's last word. */
export function evaluate(record: LicenseKey): Evaluation {
  const base = {
    licenseType: record.licenseType,
    expiryAt: record.expiryAt.toISOString(),
    seats: record.seats,
    isAdmin: record.isAdmin,
  }
  if (record.status === 'revoked') {
    return { allowed: false, status: 'revoked', reason: 'Cette licence a été révoquée.', ...base }
  }
  if (record.status === 'suspended') {
    return { allowed: false, status: 'suspended', reason: 'Cette licence est temporairement suspendue.', ...base }
  }
  if (record.expiryAt.getTime() < Date.now()) {
    return { allowed: false, status: 'expired', reason: 'Cette licence a expiré.', ...base }
  }
  return { allowed: true, status: 'active', ...base }
}

// ─── Audit events ───────────────────────────────────────────────────────────────
type EventInput = {
  action: string
  fromStatus?: string | null
  toStatus?: string | null
  ip?: string | null
  hwid?: string | null
  detail?: string | null
}

async function recordEvent(licenseId: string, e: EventInput): Promise<void> {
  try {
    await licenseDb.licenseEvent.create({
      data: {
        licenseId,
        action: e.action,
        fromStatus: e.fromStatus ?? null,
        toStatus: e.toStatus ?? null,
        ip: e.ip ?? null,
        hwid: e.hwid ?? null,
        detail: e.detail ?? null,
      },
    })
  } catch {
    // Never let audit logging break a license operation.
  }
}

// ─── Token signing (server-side, optional) ──────────────────────────────────────
function b64u(buf: Buffer): string {
  return buf.toString('base64url')
}

/** Load the ECC private key from env (base64 PEM) or keys/private.pem. */
export function loadPrivateKeyPem(): string | null {
  if (process.env.GF_PRIVATE_KEY) {
    try {
      return Buffer.from(process.env.GF_PRIVATE_KEY, 'base64').toString('utf8')
    } catch {
      return null
    }
  }
  const keyPath = path.join(process.cwd(), 'keys', 'private.pem')
  if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath, 'utf8')
  return null
}

interface SignInput {
  customerId: string
  licenseType: LicenseType
  years: number
  seats: number
  hwid?: string | null
  label?: string | null
  lid?: string // reuse an existing lid (renewal keeps the same license identity)
}

/** Sign a fresh GF2 token. Returns the token and the payload it carries. */
export function signToken(privKeyPem: string, input: SignInput): { token: string; payload: LicensePayload } {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + input.years * 365 * 24 * 3600
  const lid = input.lid ?? crypto.randomUUID()
  const wm = b64u(
    Buffer.from(JSON.stringify({ c: input.customerId, t: now, r: crypto.randomBytes(6).toString('hex'), l: input.label ?? '' })),
  )
  const payload: LicensePayload = {
    lid,
    cid: input.customerId,
    typ: input.licenseType,
    iss: now,
    exp,
    seats: input.seats,
    wm,
    ver: '2.0',
    ...(input.hwid ? { hwid: input.hwid } : {}),
  }
  const header = { alg: 'ES256', typ: 'GF-LIC', v: 2 }
  const headerB64 = b64u(Buffer.from(JSON.stringify(header)))
  const payloadB64 = b64u(Buffer.from(JSON.stringify(payload)))
  const signer = crypto.createSign('SHA256')
  signer.update(`${headerB64}.${payloadB64}`)
  const sig = signer.sign({ key: privKeyPem, format: 'pem' })
  return { token: `GF2.${headerB64}.${payloadB64}.${b64u(sig)}`, payload }
}

// ─── CREATE ──────────────────────────────────────────────────────────────────────
export interface CreateInput {
  token?: string // pre-signed token (Keygen path — recommended)
  customerId?: string
  licenseType?: string
  years?: number
  seats?: number
  hwid?: string | null
  label?: string | null
  notes?: string | null
}

/**
 * Register a license on the central server. Two modes:
 *  1. A signed `token` is supplied (Keygen already signed it) → verify + store.
 *  2. Generation params supplied → server signs (requires GF_PRIVATE_KEY).
 * Duplicates (same licenseId or token) are rejected.
 */
export async function createLicense(input: CreateInput, ctx?: { ip?: string | null }): Promise<ServiceResult<LicenseKey>> {
  const guard = ensureAuthority()
  if (guard) return guard

  let token = input.token?.trim()
  let payload: LicensePayload

  if (token) {
    const v = verifyLicenseToken(token)
    if (!v.valid || !v.payload) return fail(400, v.reason ?? 'Token de licence invalide')
    payload = v.payload
  } else {
    const priv = loadPrivateKeyPem()
    if (!priv) return fail(400, 'Aucun token fourni et aucune clé privée serveur (GF_PRIVATE_KEY) pour signer.')
    if (!input.customerId || !input.licenseType) return fail(400, 'customerId et licenseType sont requis.')
    if (!isLicenseType(input.licenseType)) return fail(400, `Type de licence invalide: ${input.licenseType}`)
    const years = Math.max(1, Math.min(10, input.years ?? 1))
    const seats = Math.max(1, input.seats ?? 1)
    const signed = signToken(priv, {
      customerId: input.customerId,
      licenseType: input.licenseType,
      years,
      seats,
      hwid: input.hwid ?? null,
      label: input.label ?? null,
    })
    token = signed.token
    payload = signed.payload
  }

  const existing = await licenseDb.licenseKey.findFirst({
    where: { OR: [{ licenseId: payload.lid }, { token }] },
  })
  if (existing) return fail(409, 'Cette licence est déjà enregistrée sur le serveur.')

  const hwid = payload.hwid ?? input.hwid ?? null
  const record = await licenseDb.licenseKey.create({
    data: {
      licenseId: payload.lid,
      token,
      customerId: payload.cid,
      licenseType: payload.typ,
      status: 'active',
      expiryAt: new Date(payload.exp * 1000),
      seats: payload.seats ?? 1,
      isAdmin: payload.typ === 'admin',
      hwid,
      label: input.label ?? null,
      notes: input.notes ?? null,
    },
  })
  await recordEvent(payload.lid, { action: 'created', toStatus: 'active', hwid, ip: ctx?.ip })
  return { ok: true, data: record }
}

// ─── STATUS (revoke / suspend / reactivate) ──────────────────────────────────────
export async function setStatus(
  licenseId: string,
  status: LicenseStatus,
  ctx?: { ip?: string | null },
): Promise<ServiceResult<LicenseKey>> {
  const guard = ensureAuthority()
  if (guard) return guard
  if (!licenseId) return fail(400, 'licenseId manquant.')
  if (!isLicenseStatus(status)) return fail(400, `Statut invalide — autorisés: ${LICENSE_STATUSES.join(', ')}.`)

  const record = await licenseDb.licenseKey.findUnique({ where: { licenseId } })

  // Not yet registered: create a tombstone so a revoke/suspend issued *before*
  // the client ever activates is still enforced the moment it does.
  if (!record) {
    if (status === 'active') return fail(404, 'Licence introuvable.')
    const created = await licenseDb.licenseKey.create({
      data: {
        licenseId,
        token: `pending:${licenseId}`,
        customerId: 'pending',
        licenseType: 'trial',
        status,
        expiryAt: new Date('2099-12-31T23:59:59.000Z'),
        revokedAt: status === 'revoked' ? new Date() : null,
        label: status === 'revoked' ? 'Révoquée avant activation' : 'Suspendue avant activation',
      },
    })
    await recordEvent(licenseId, { action: status === 'revoked' ? 'revoked' : 'suspended', toStatus: status, ip: ctx?.ip, detail: 'tombstone' })
    return { ok: true, data: created }
  }

  const action = status === 'revoked' ? 'revoked' : status === 'suspended' ? 'suspended' : 'reactivated'
  const updated = await licenseDb.licenseKey.update({
    where: { licenseId },
    data: {
      status,
      revokedAt: status === 'revoked' ? new Date() : status === 'active' ? null : undefined,
    },
  })
  await recordEvent(licenseId, { action, fromStatus: record.status, toStatus: status, ip: ctx?.ip })
  return { ok: true, data: updated }
}

// ─── UPDATE (label / notes / seats / HWID change / renewal) ──────────────────────
export interface UpdateInput {
  label?: string | null
  notes?: string | null
  seats?: number
  hwid?: string | null
  status?: LicenseStatus
  years?: number // renewal (server re-signs, keeps same licenseId) — needs GF_PRIVATE_KEY
  token?: string // renewal via an externally re-signed token (same licenseId)
  expiryAt?: string // direct expiry override (bookkeeping)
}

export async function updateLicense(
  licenseId: string,
  patch: UpdateInput,
  ctx?: { ip?: string | null },
): Promise<ServiceResult<LicenseKey>> {
  const guard = ensureAuthority()
  if (guard) return guard
  if (!licenseId) return fail(400, 'licenseId manquant.')

  const record = await licenseDb.licenseKey.findUnique({ where: { licenseId } })
  if (!record) return fail(404, 'Licence introuvable.')

  const data: Record<string, unknown> = {}
  const events: EventInput[] = []

  if (patch.label !== undefined) data.label = patch.label
  if (patch.notes !== undefined) data.notes = patch.notes
  if (patch.seats !== undefined) data.seats = Math.max(1, patch.seats)

  // HWID change
  if (patch.hwid !== undefined && (patch.hwid ?? null) !== (record.hwid ?? null)) {
    data.hwid = patch.hwid
    events.push({ action: 'hwid_changed', hwid: patch.hwid, ip: ctx?.ip, detail: `from ${record.hwid ?? '∅'}` })
  }

  // Status change delegated for correct revokedAt handling + event
  if (patch.status !== undefined && patch.status !== record.status) {
    const r = await setStatus(licenseId, patch.status, ctx)
    if (!r.ok) return r
  }

  // Renewal — externally re-signed token (must keep the same licenseId)
  if (patch.token) {
    const v = verifyLicenseToken(patch.token.trim())
    if (!v.valid || !v.payload) return fail(400, v.reason ?? 'Token de renouvellement invalide.')
    if (v.payload.lid !== licenseId) return fail(400, 'Le token de renouvellement ne correspond pas à cette licence.')
    data.token = patch.token.trim()
    data.expiryAt = new Date(v.payload.exp * 1000)
    data.licenseType = v.payload.typ
    data.seats = v.payload.seats ?? record.seats
    events.push({ action: 'renewed', ip: ctx?.ip, detail: `exp ${new Date(v.payload.exp * 1000).toISOString()}` })
  } else if (patch.years) {
    // Renewal — server re-signs, keeping the same licenseId/customer/type
    const priv = loadPrivateKeyPem()
    if (!priv) return fail(400, 'Renouvellement serveur impossible: aucune clé privée (GF_PRIVATE_KEY).')
    const years = Math.max(1, Math.min(10, patch.years))
    const signed = signToken(priv, {
      customerId: record.customerId,
      licenseType: record.licenseType as LicenseType,
      years,
      seats: record.seats,
      hwid: (data.hwid as string | null | undefined) ?? record.hwid,
      label: record.label,
      lid: licenseId,
    })
    data.token = signed.token
    data.expiryAt = new Date(signed.payload.exp * 1000)
    events.push({ action: 'renewed', ip: ctx?.ip, detail: `+${years}y` })
  } else if (patch.expiryAt !== undefined) {
    const d = new Date(patch.expiryAt)
    if (isNaN(d.getTime())) return fail(400, 'expiryAt invalide.')
    data.expiryAt = d
    events.push({ action: 'renewed', ip: ctx?.ip, detail: `expiry set ${d.toISOString()}` })
  }

  const updated =
    Object.keys(data).length > 0
      ? await licenseDb.licenseKey.update({ where: { licenseId }, data })
      : await licenseDb.licenseKey.findUnique({ where: { licenseId } })

  for (const e of events) await recordEvent(licenseId, e)
  return { ok: true, data: updated as LicenseKey }
}

// ─── DELETE ──────────────────────────────────────────────────────────────────────
export async function deleteLicense(licenseId: string, ctx?: { ip?: string | null }): Promise<ServiceResult<{ licenseId: string }>> {
  const guard = ensureAuthority()
  if (guard) return guard
  if (!licenseId) return fail(400, 'licenseId manquant.')
  try {
    await licenseDb.licenseKey.delete({ where: { licenseId } })
    // Event cascades away with the license; nothing to record on the row itself.
    void ctx
    return { ok: true, data: { licenseId } }
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === 'P2025') return fail(404, 'Licence introuvable.')
    throw err
  }
}

// ─── ACTIVATE (strict — never auto-creates authority) ────────────────────────────
export interface ActivateResult {
  ok: boolean
  reason?: string
  status?: EvalStatus
  isAdmin?: boolean
  licenseType?: string
  expiryAt?: string
  seats?: number
  lid?: string
}

/**
 * Activate a signed token against the server.
 * The token signature is verified by the caller (via verifyLicenseToken).
 * The license MUST already exist on the server (created by the Keygen) — the
 * client is never the source of truth, so an unknown token is rejected.
 */
export async function activate(
  payload: LicensePayload,
  token: string,
  clientHwid: string | undefined,
  ctx?: { ip?: string | null },
): Promise<ActivateResult> {
  if (!licenseAuthorityConfigured()) {
    return { ok: false, reason: "Serveur de licences non configuré.", status: 'unknown' }
  }
  const record = await licenseDb.licenseKey.findUnique({ where: { licenseId: payload.lid } })
  if (!record) {
    return { ok: false, reason: 'Licence inconnue du serveur. Contactez votre revendeur.', status: 'unknown' }
  }

  // Reconcile a tombstone (created by an early revoke/suspend) with the real token.
  if (record.token.startsWith('pending:')) {
    await licenseDb.licenseKey.update({
      where: { licenseId: payload.lid },
      data: {
        token,
        customerId: payload.cid,
        licenseType: payload.typ,
        seats: payload.seats ?? 1,
        isAdmin: payload.typ === 'admin',
        expiryAt: new Date(payload.exp * 1000),
        hwid: record.hwid ?? payload.hwid ?? null,
      },
    })
    record.token = token
  }

  const verdict = evaluate(record)
  if (!verdict.allowed) {
    await recordEvent(payload.lid, { action: verdict.status, fromStatus: record.status, ip: ctx?.ip, hwid: clientHwid ?? null, detail: 'activation blocked' })
    return { ok: false, reason: verdict.reason, status: verdict.status }
  }

  // HWID binding — bind on first activation if the license is unbound.
  if (record.hwid) {
    if (clientHwid && !verifyHwid(record.hwid, clientHwid)) {
      return { ok: false, reason: 'Cette licence est liée à un autre matériel.', status: 'revoked' }
    }
  } else if (clientHwid) {
    await licenseDb.licenseKey.update({ where: { licenseId: payload.lid }, data: { hwid: clientHwid } })
    await recordEvent(payload.lid, { action: 'hwid_changed', hwid: clientHwid, ip: ctx?.ip, detail: 'bound on activation' })
  }

  await licenseDb.licenseKey.update({
    where: { licenseId: payload.lid },
    data: { activatedAt: record.activatedAt ?? new Date(), lastSeenAt: new Date() },
  })
  await recordEvent(payload.lid, { action: 'activated', toStatus: 'active', ip: ctx?.ip, hwid: clientHwid ?? null })

  return {
    ok: true,
    status: 'active',
    isAdmin: payload.typ === 'admin',
    licenseType: payload.typ,
    expiryAt: new Date(payload.exp * 1000).toISOString(),
    seats: payload.seats ?? 1,
    lid: payload.lid,
  }
}

// ─── VALIDATE (periodic heartbeat) ───────────────────────────────────────────────
/**
 * Evaluate a license by id for a periodic check. Definitive server answer:
 *  - found     → evaluate (active/revoked/suspended/expired)
 *  - not found → blocked (the authoritative server has no such license)
 * Bumps lastSeenAt on a successful validation.
 */
export async function validateById(licenseId: string, ctx?: { ip?: string | null; hwid?: string | null }): Promise<Evaluation> {
  if (!licenseAuthorityConfigured()) {
    // This node is not the authority — cannot make a judgement.
    return { allowed: true, status: 'unknown' }
  }
  const record = await licenseDb.licenseKey.findUnique({ where: { licenseId } })
  if (!record) {
    return { allowed: false, status: 'unknown', reason: 'Licence introuvable sur le serveur.' }
  }
  const verdict = evaluate(record)
  if (verdict.allowed) {
    await licenseDb.licenseKey.update({ where: { licenseId }, data: { lastSeenAt: new Date() } }).catch(() => {})
  }
  void ctx
  return verdict
}

// ─── Queries (admin) ─────────────────────────────────────────────────────────────
export async function listLicenses(): Promise<ServiceResult<LicenseKey[]>> {
  const guard = ensureAuthority()
  if (guard) return guard
  const rows = await licenseDb.licenseKey.findMany({ orderBy: [{ createdAt: 'desc' }] })
  return { ok: true, data: rows }
}

export async function getLicense(licenseId: string): Promise<ServiceResult<LicenseKey>> {
  const guard = ensureAuthority()
  if (guard) return guard
  const rec = await licenseDb.licenseKey.findUnique({ where: { licenseId } })
  if (!rec) return fail(404, 'Licence introuvable.')
  return { ok: true, data: rec }
}
