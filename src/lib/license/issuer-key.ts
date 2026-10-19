/**
 * Clé privée d'ÉMISSION des licences, côté serveur — chargée ET vérifiée.
 *
 * Avant ce module, `POST /api/admin/licenses/generate` signait avec la première
 * clé trouvée (GF_PRIVATE_KEY, sinon keys/private.pem) sans jamais la comparer
 * à la clé publique embarquée. Une clé privée qui n'est pas celle de production
 * (paire générée localement, ancienne clé, variable mal recopiée) produisait
 * alors des licences « réussies » côté administration… que l'application
 * refuse toutes à l'activation. Le keygen, lui, refusait déjà ce cas
 * (`scripts/keygen_trust.py`, KEY_MISMATCH_OR_ANCHOR_UNAVAILABLE) : le serveur
 * applique désormais la même règle, avec la même empreinte (SHA-256 du SPKI DER,
 * cf. scripts/verify-license-issuer.mjs et /api/admin/diagnostics).
 *
 * Jamais de matériel de clé dans les erreurs : seulement des empreintes
 * PUBLIQUES (non secrètes par construction).
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getPublicKeyPem } from '@/lib/license/public-key'

export type IssuerKeyResult =
  | { ok: true; pem: string; fingerprint: string }
  | { ok: false; reason: 'absent' }
  | { ok: false; reason: 'unreadable'; source: IssuerSource }
  | { ok: false; reason: 'mismatch'; source: IssuerSource; issuerFingerprint: string; expectedFingerprint: string }

export type IssuerSource = 'GF_PRIVATE_KEY' | 'keys/private.pem'

export function spkiFingerprint(key: crypto.KeyObject | string): string {
  return crypto.createHash('sha256').update(crypto.createPublicKey(key).export({ type: 'spki', format: 'der' })).digest('hex')
}

interface LoadOptions {
  env?: Record<string, string | undefined>
  cwd?: string
  expectedPublicPem?: string
}

/** Même priorité qu'avant : GF_PRIVATE_KEY (base64 de PEM, ou PEM brut), puis keys/private.pem. */
export function loadIssuerPrivateKey(options: LoadOptions = {}): IssuerKeyResult {
  const env = options.env ?? process.env
  let pem: string | null = null
  let source: IssuerSource
  const raw = env.GF_PRIVATE_KEY?.trim()
  if (raw) {
    source = 'GF_PRIVATE_KEY'
    // Accepte le PEM brut comme /api/admin/diagnostics : sinon le diagnostic
    // annonçait « converged » pour une valeur que la signature ne savait pas lire.
    pem = /-----BEGIN/.test(raw) ? raw : Buffer.from(raw, 'base64').toString('utf8')
  } else {
    source = 'keys/private.pem'
    const keyPath = path.join(options.cwd ?? process.cwd(), 'keys', 'private.pem')
    if (!fs.existsSync(keyPath)) return { ok: false, reason: 'absent' }
    pem = fs.readFileSync(keyPath, 'utf8')
  }

  let issuer: crypto.KeyObject
  try {
    issuer = crypto.createPrivateKey(pem)
    if (issuer.asymmetricKeyType !== 'ec' || issuer.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      return { ok: false, reason: 'unreadable', source }
    }
  } catch {
    return { ok: false, reason: 'unreadable', source }
  }

  const issuerFingerprint = spkiFingerprint(issuer)
  const expectedFingerprint = spkiFingerprint(options.expectedPublicPem ?? getPublicKeyPem())
  if (issuerFingerprint !== expectedFingerprint) {
    return { ok: false, reason: 'mismatch', source, issuerFingerprint, expectedFingerprint }
  }
  return { ok: true, pem, fingerprint: issuerFingerprint }
}

/** Message d'administration (français), sans aucun secret. */
export function describeIssuerKeyFailure(result: Exclude<IssuerKeyResult, { ok: true }>): string {
  switch (result.reason) {
    case 'absent':
      return 'Clé privée d’émission introuvable : définissez GF_PRIVATE_KEY (PEM en base64) sur le serveur.'
    case 'unreadable':
      return `Clé privée d’émission illisible (${result.source}) : attendu une clé ECC P-256 au format PEM.`
    case 'mismatch':
      return (
        `Signature refusée : la clé privée d’émission (${result.source}, empreinte publique ` +
        `${result.issuerFingerprint.slice(0, 12)}…) n’est pas celle que l’application vérifie ` +
        `(${result.expectedFingerprint.slice(0, 12)}…). Une licence signée ainsi serait refusée à ` +
        'l’activation. Installez la clé privée de production (voir docs/VERIFICATION_CLE_EMETTRICE.md).'
      )
  }
}
