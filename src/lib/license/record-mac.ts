/**
 * HMAC-SHA256 integrity protection for LicenseKey DB records.
 *
 * Problem: the SQLite file is local and can be edited with any DB browser.
 * If someone changes status "revoked" → "active", they bypass revocation.
 *
 * Solution: sign the security-critical fields of each record with HMAC-SHA256.
 * The secret (GF_DB_MAC_SECRET) is derived from HWID in Electron so it's
 * machine-specific; on a server deployment it must be set via environment.
 *
 * Fields covered: licenseId, token, status, expiryAt, hwid.
 * Mutable-but-non-security fields (label, notes, lastSeenAt) are intentionally
 * excluded to avoid regenerating the MAC on every heartbeat.
 */

import crypto from 'crypto'

function getSecret(): string {
  const s = process.env.GF_DB_MAC_SECRET
  if (!s) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[record-mac] GF_DB_MAC_SECRET must be set in production')
    }
    // Dev fallback — never used in packaged Electron (which sets the env var)
    return 'gf-dev-record-mac-insecure-fallback'
  }
  return s
}

type RecordFields = {
  licenseId: string
  token:     string
  status:    string
  expiryAt:  Date
  hwid:      string | null
}

/** Compute deterministic HMAC over the security-critical fields. */
export function computeRecordMac(r: RecordFields): string {
  const msg = [r.licenseId, r.token, r.status, r.expiryAt.toISOString(), r.hwid ?? ''].join('\x00')
  return crypto.createHmac('sha256', getSecret()).update(msg).digest('hex')
}

type VerifyInput = RecordFields & { recordMac: string | null }

/**
 * Verify a record's MAC.
 * Returns:
 *  { ok: true,  tampered: false, missing: false } — valid MAC
 *  { ok: true,  tampered: false, missing: true  } — no MAC yet (legacy record)
 *  { ok: false, tampered: true,  missing: false } — MAC mismatch → DB tampered
 */
export function verifyRecordMac(r: VerifyInput): { ok: boolean; tampered: boolean; missing: boolean } {
  if (!r.recordMac) {
    return { ok: true, tampered: false, missing: true }
  }
  const expected = computeRecordMac(r)
  try {
    const stored   = Buffer.from(r.recordMac, 'hex')
    const computed = Buffer.from(expected,     'hex')
    if (stored.length !== computed.length) return { ok: false, tampered: true, missing: false }
    const ok = crypto.timingSafeEqual(stored, computed)
    return { ok, tampered: !ok, missing: false }
  } catch {
    return { ok: false, tampered: true, missing: false }
  }
}
