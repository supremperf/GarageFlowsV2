/**
 * TOTP (RFC 6238) / HOTP (RFC 4226) — two-factor authentication for the client
 * portal. Pure Node crypto, no third-party dependency. Compatible with Google
 * Authenticator, Authy, 1Password, etc. via the standard `otpauth://` URI.
 *
 * Verified against the RFC 6238 test vectors (see totp.test.ts).
 */

import crypto from 'crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 base32 encode (no padding) — used for the shared secret. */
export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i]
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

/** RFC 4648 base32 decode (tolerant of spacing, padding and lower case). */
export function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i])
    if (idx === -1) throw new Error('Invalid base32 character')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export type TotpAlgorithm = 'sha1' | 'sha256' | 'sha512'

export interface TotpOptions {
  digits?: number
  /** Time step in seconds. */
  period?: number
  algorithm?: TotpAlgorithm
}

/** HOTP (RFC 4226): counter-based one-time password. */
function hotp(secret: Buffer, counter: number, digits: number, algorithm: TotpAlgorithm): string {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const hmac = crypto.createHmac(algorithm, secret).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return (code % 10 ** digits).toString().padStart(digits, '0')
}

/** Generate the current TOTP token for a base32 secret. */
export function generateTotp(secretBase32: string, atMs: number = Date.now(), opts: TotpOptions = {}): string {
  const { digits = 6, period = 30, algorithm = 'sha1' } = opts
  const counter = Math.floor(atMs / 1000 / period)
  return hotp(base32Decode(secretBase32), counter, digits, algorithm)
}

export interface VerifyTotpOptions extends TotpOptions {
  /** Number of steps of clock drift accepted on either side (default 1). */
  window?: number
  atMs?: number
}

/** Verify a submitted token against a base32 secret (timing-safe, with drift window). */
export function verifyTotp(token: string, secretBase32: string, opts: VerifyTotpOptions = {}): boolean {
  const { digits = 6, period = 30, algorithm = 'sha1', window = 1, atMs = Date.now() } = opts
  const clean = token.replace(/\s+/g, '')
  if (!new RegExp(`^\\d{${digits}}$`).test(clean)) return false

  const counter = Math.floor(atMs / 1000 / period)
  const secret = base32Decode(secretBase32)
  const submitted = Buffer.from(clean)
  for (let w = -window; w <= window; w++) {
    const expected = Buffer.from(hotp(secret, counter + w, digits, algorithm))
    if (expected.length === submitted.length && crypto.timingSafeEqual(expected, submitted)) return true
  }
  return false
}

/** Generate a new random base32 secret (default 20 bytes = 160 bits, per RFC). */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(crypto.randomBytes(bytes))
}

/** Build the standard `otpauth://totp/...` provisioning URI (for the QR code). */
export function otpauthURL(params: {
  secret: string
  label: string
  issuer: string
  digits?: number
  period?: number
  algorithm?: TotpAlgorithm
}): string {
  const { secret, label, issuer, digits = 6, period = 30, algorithm = 'sha1' } = params
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: algorithm.toUpperCase(),
    digits: String(digits),
    period: String(period),
  })
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?${query.toString()}`
}
