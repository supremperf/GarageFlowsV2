/**
 * Embedded ECC P-256 public key — single source of truth for Next.js context.
 *
 * Issuer: GF_PRIVATE_KEY (base64 PEM) on the server, or keys/private.pem
 * on the authorized Python signing workstation. Never package a private key.
 * Read-only checks: scripts/verify-license-issuer.mjs, check:public-key,
 * keys:check. See docs/VERIFICATION_CLE_EMETTRICE.md. No automatic rotation.
 * After an operator-approved change, keys:sync propagates the PUBLIC key;
 * do not edit just one anchor or regenerate keys as a diagnostic shortcut.
 *
 * Key is split into segments assembled at runtime — minor obfuscation so a
 * simple grep for "BEGIN PUBLIC KEY" won't trivially locate it in the bundle.
 */
const _LINES = [
  '-----BEGIN PUBLIC KEY-----',
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEXKiGHY7aFcS/uMbVz2hP2FptYJxH',
  'cAmacvNlLuzalHkssxU7kNZcY0T4UD1ilFOecW+d/YvnoDlRMxS5uTjWDA==',
  '-----END PUBLIC KEY-----',
]

export function getPublicKeyPem(): string {
  return _LINES.join('\n')
}
