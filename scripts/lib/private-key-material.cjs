'use strict'
const crypto = require('node:crypto')
// Complements the existing conservative prefix rule: multiline PEM and short
// Ed25519 PKCS8 keys must not evade detection because no line is 100 chars long.
function containsPrivateKeyMaterial(input) {
  if (!input.includes('PRIVATE KEY-----')) return false
  const text = input.replace(/\\r\\n|\\n|\\r/g, '\n')
  const pattern = /-----BEGIN ((?:EC |RSA |OPENSSH |ENCRYPTED )?PRIVATE KEY)-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END \1-----/g
  for (const match of text.matchAll(pattern)) {
    const der = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
    if (match[1] === 'OPENSSH PRIVATE KEY' && der.subarray(0, 15).equals(Buffer.from('openssh-key-v1\0'))) return true
    // An encrypted PKCS8 must be rejected without requesting a passphrase.
    if (match[1] === 'ENCRYPTED PRIVATE KEY' && der.length > 16 && der[0] === 0x30) return true
    try { if (crypto.createPrivateKey(match[0]).type === 'private') return true } catch { /* not key material */ }
  }
  return false
}
module.exports = { containsPrivateKeyMaterial }
