/**
 * Embedded ECC P-256 public key — single source of truth for Next.js context.
 *
 * Generated once by: python scripts/keygen_gui.py → "Initialiser les clés"
 * The private key NEVER leaves keys/private.pem (server-only).
 *
 * After regenerating keys, update both:
 *   1. The _LINES array below (from keys/public.pem)
 *   2. The _PK array in electron/main.js (same content)
 *
 * Key is split into segments assembled at runtime — minor obfuscation so a
 * simple grep for "BEGIN PUBLIC KEY" won't trivially locate it in the bundle.
 */
const _LINES = [
  '-----BEGIN PUBLIC KEY-----',
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEAz1B/A041iJ4oSXTSZat6homAphI',
  '624d622417snt9poq1+bLzOMYGfism0alEKTiI+s90ch9heRlHN2AwF9uQ==',
  '-----END PUBLIC KEY-----',
]

export function getPublicKeyPem(): string {
  return _LINES.join('\n')
}
