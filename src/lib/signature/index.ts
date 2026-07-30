/**
 * Reinforced electronic signature — public entry point.
 *
 * Seals a canonical document snapshot + signature image + evidentiary metadata
 * with a SHA-256 content hash and an HMAC integrity seal. Re-verification against
 * the current document auto-invalidates the signature if anything meaningful
 * changed after signing.
 */
export * from './types'
export { canonicalize } from './canonicalize'
export {
  SIGNATURE_ALGORITHM,
  sha256Hex,
  computeContentHash,
  computeImageHash,
  computeSeal,
  createCertificate,
  verifyCertificate,
} from './seal'
export { resolveSignatureKey } from './key'
export {
  buildSignableDocument,
  isSupportedEntityType,
  SUPPORTED_ENTITY_TYPES,
} from './document'
