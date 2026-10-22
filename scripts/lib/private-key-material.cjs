'use strict'
const crypto = require('node:crypto')

// PEM bodies are not a reliable single-line regex target: short Ed25519 keys,
// wrapped blocks, and JSON-escaped newlines all occur in real source/artifacts.
// Parse a complete, matching PEM block and ask OpenSSL to validate the key;
// encrypted private-key blocks are recognized structurally without requesting
// or logging a passphrase. Public-key blocks and marker literals are not keys.
function containsPrivateKeyMaterial(input) {
  if (typeof input !== 'string' || !input.includes('PRIVATE KEY-----')) return false
  const text = input.replace(/\\r\\n|\\n|\\r/g, '\n')
  const pattern = /-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/g
  for (const match of text.matchAll(pattern)) {
    const body = match[2].replace(/^(?:Proc-Type|DEK-Info):[^\r\n]*(?:\r?\n|$)/gm, '')
    if (!/^[A-Za-z0-9+/=\s]+$/.test(body)) continue
    const der = Buffer.from(body.replace(/\s/g, ''), 'base64')
    if (match[1] === 'OPENSSH PRIVATE KEY' && der.subarray(0, 15).equals(Buffer.from('openssh-key-v1\0'))) return true

    // Encrypted PEM is sensitive even though its private key cannot be parsed
    // without a passphrase. Validate the ASN.1 sequence before rejecting it.
    const encryptedPem = match[1] === 'ENCRYPTED PRIVATE KEY'
      || /^Proc-Type: 4,ENCRYPTED$/m.test(match[2])
    if (encryptedPem && der.length > 16 && der[0] === 0x30) return true

    try {
      if (crypto.createPrivateKey(match[0]).type === 'private') return true
    } catch { /* malformed PEM, public material, or encrypted legacy format */ }
  }
  return false
}

module.exports = { containsPrivateKeyMaterial }
