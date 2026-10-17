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
import { ServerMisconfiguredError } from '@/lib/errors/apiErrors'

function getSecret(): string {
  const s = process.env.GF_DB_MAC_SECRET
  if (!s) {
    if (process.env.NODE_ENV === 'production') {
      throw new ServerMisconfiguredError('GF_DB_MAC_SECRET')
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
  // Licences MECHANIC : le parent et l'attribution sont critiques pour la
  // sécurité (changer mechanicId dans la base donnerait accès aux travaux d'un
  // autre mécanicien). Optionnels pour rester rétrocompatible.
  parentLicenseId?: string | null
  mechanicId?:      string | null
}

/**
 * Compute deterministic HMAC over the security-critical fields.
 *
 * Rétrocompatibilité : les champs MECHANIC (parentLicenseId, mechanicId) ne
 * sont ajoutés au message QUE s'ils sont non nuls. Les enregistrements
 * existants (licences Garage — les deux champs nuls) conservent exactement le
 * même message qu'avant, donc leurs MAC restent valides.
 */
export function computeRecordMac(r: RecordFields): string {
  const parts = [r.licenseId, r.token, r.status, r.expiryAt.toISOString(), r.hwid ?? '']
  if (r.parentLicenseId || r.mechanicId) {
    parts.push(r.parentLicenseId ?? '', r.mechanicId ?? '')
  }
  const msg = parts.join('\x00')
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
export type RecordMacVerdict = { ok: boolean; tampered: boolean; missing: boolean }

/**
 * L'intégrité de l'enregistrement est-elle EXPLOITABLE pour autoriser un droit ?
 *
 * `missing` (recordMac = NULL) doit être traité comme une altération, et non
 * comme un cas hérité tolérable : **tous** les chemins de création posent un MAC
 * (`/api/admin/licenses/create`, `/api/admin/licenses/generate`,
 * `/api/admin/licenses/revoke-by-key`, l'auto-enregistrement de
 * `/api/license/activate`). Un NULL en base n'est donc pas un vestige : c'est le
 * geste le plus simple pour qui sait écrire dans la base — effacer une colonne
 * plutôt que forger un HMAC — après quoi `status: 'revoked' → 'active'`,
 * `expiryAt` et `hwid` redeviennent librement modifiables. Tolérer `missing`
 * revenait donc à offrir un contournement complet de la protection
 * anti-altération (GF31-AUD-005).
 *
 * `mechanic-session.ts` et le chemin MÉCANICIEN de `/api/license/activate`
 * appliquaient déjà cette règle ; les chemins GARAGE (`activate`, `check`,
 * `status`) se contentaient d'un avertissement dans le journal.
 *
 * Remise en conformité d'un parc existant : `scripts/repair-after-secret-rotation.js`
 * recalcule le `recordMac` de chaque ligne (idempotent, parité avec ce module
 * garantie par `src/lib/__tests__/remac-script-parity.test.ts`).
 */
export function recordIntegrityUsable(v: RecordMacVerdict): boolean {
  return !v.tampered && !v.missing
}

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
