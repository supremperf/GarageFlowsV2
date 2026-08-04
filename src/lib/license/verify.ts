/**
 * GarageFlow License Verifier v2 — ECDSA-SHA256 (ECC P-256)
 *
 * Security rationale:
 *  - Asymmetric crypto: the PUBLIC key is embedded here (safe to distribute).
 *    Without the PRIVATE key (kept secret on the server), it is mathematically
 *    impossible to forge a valid signature — unlike HMAC where anyone with the
 *    secret can mint keys.
 *  - P-256 (secp256r1): NIST standard, hardware-accelerated on most CPUs,
 *    equivalent to ~3072-bit RSA security, far smaller keys.
 *  - DER-encoded ECDSA output from Python's `cryptography` library is directly
 *    verified by Node.js crypto.createVerify() — no external deps needed.
 *  - Multiple independent validation steps (header / signature / expiry / type)
 *    make single-point bypasses harder.
 *  - Avoid returning a plain boolean — return a result object so callers cannot
 *    accidentally rely on a truthy value from an error path.
 */

import crypto from 'crypto'
import { getPublicKeyPem } from './public-key'

// Re-export so callers only need one import point
function _pubKey(): string { return getPublicKeyPem() }

// ─── License types ────────────────────────────────────────────────────────────
// 'mechanic' : licence SECONDAIRE réservée à un mécanicien, obligatoirement
// rattachée à une licence Garage parente (champ plid signé). Elle ne donne
// JAMAIS accès à l'application garage ni aux fonctions administratives.
export type LicenseType = 'trial' | 'premium' | 'enterprise' | 'admin' | 'mechanic'

export interface LicensePayload {
  lid:    string       // Unique license UUID
  cid:    string       // Customer identifier
  typ:    LicenseType  // License tier
  iss:    number       // Issued-at  (unix seconds)
  exp:    number       // Expiry     (unix seconds)
  seats:  number       // Max concurrent users
  hwid?:  string       // Optional hardware fingerprint (SHA-256 hex)
  wm:     string       // Watermark — opaque base64url blob
  ver:    string       // Schema version
  plid?:  string       // MECHANIC uniquement : lid de la licence Garage parente (OBLIGATOIRE)
  mn?:    string       // MECHANIC uniquement : nom du mécanicien suggéré (optionnel)
}

export interface VerifyResult {
  valid:      boolean
  payload?:   LicensePayload
  isAdmin?:   boolean
  isMechanic?: boolean
  reason?:    string
}

// ─── Internal helpers ─────────────────────────────────────────────────────────
function _b64urlDecode(s: string): Buffer {
  const pad = (4 - (s.length % 4)) % 4
  return Buffer.from(s + '='.repeat(pad), 'base64url')
}

/** Non-throwing JSON parse — returns null on any error */
function _safeJson(buf: Buffer): unknown | null {
  try { return JSON.parse(buf.toString('utf8')) } catch { return null }
}

// ─── Check 1: header integrity ────────────────────────────────────────────────
// Deliberately NOT inlined so it forms a separate call-site to bypass.
function _assertHeader(h: Record<string, unknown>): boolean {
  return (
    h['alg'] === 'ES256'  &&
    h['typ'] === 'GF-LIC' &&
    typeof h['v'] === 'number' && (h['v'] as number) >= 2
  )
}

// ─── Check 2: payload completeness ───────────────────────────────────────────
function _assertPayload(p: Record<string, unknown>): boolean {
  return (
    typeof p['lid']   === 'string' && p['lid'].length  > 0 &&
    typeof p['cid']   === 'string' && p['cid'].length  > 0 &&
    typeof p['typ']   === 'string' &&
    typeof p['iss']   === 'number' &&
    typeof p['exp']   === 'number' &&
    typeof p['seats'] === 'number' &&
    typeof p['wm']    === 'string' &&
    typeof p['ver']   === 'string'
  )
}

const _VALID_TYPES = new Set<string>(['trial', 'premium', 'enterprise', 'admin', 'mechanic'])

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Verify a GF2 license token.
 *
 * Token format: GF2.<header_b64url>.<payload_b64url>.<sig_b64url>
 *  - header:  {"alg":"ES256","typ":"GF-LIC","v":2}
 *  - payload: LicensePayload JSON
 *  - sig:     DER-encoded ECDSA-SHA256 signature over "<header>.<payload>"
 *
 * Returns { valid: false, reason } on any failure; never throws.
 */
export function verifyLicenseToken(token: string): VerifyResult {
  // ── Structure check ─────────────────────────────────────────────────────
  if (typeof token !== 'string' || !token.startsWith('GF2.')) {
    return { valid: false, reason: 'Format de licence invalide' }
  }

  const parts = token.split('.')
  if (parts.length !== 4) {
    return { valid: false, reason: 'Token malformé (doit contenir 4 segments)' }
  }

  const [, headerB64, payloadB64, sigB64] = parts

  // ── Header check ────────────────────────────────────────────────────────
  const headerBuf = _safeJson(_b64urlDecode(headerB64))
  if (!headerBuf || typeof headerBuf !== 'object') {
    return { valid: false, reason: 'En-tête de licence corrompu' }
  }
  if (!_assertHeader(headerBuf as Record<string, unknown>)) {
    return { valid: false, reason: 'Type de licence non reconnu (mauvais en-tête)' }
  }

  // ── Detect placeholder key ───────────────────────────────────────────────
  const pubKey = _pubKey()
  if (pubKey.includes('REPLACE_WITH_YOUR_PUBLIC_KEY')) {
    return { valid: false, reason: '[CONFIG] Clé publique non configurée — lancez: python scripts/keygen.py --init' }
  }

  // ── Cryptographic signature verification (ECDSA-SHA256, DER) ────────────
  //    This is the core security guarantee: only the holder of private.pem
  //    can produce a token that passes this check.
  const signingInput = `${headerB64}.${payloadB64}`
  let sigValid: boolean
  try {
    const sig      = _b64urlDecode(sigB64)
    const verifier = crypto.createVerify('SHA256')
    verifier.update(signingInput)
    // Node.js reads DER SEQUENCE by default — matches Python cryptography output
    sigValid = verifier.verify({ key: pubKey, format: 'pem' }, sig)
  } catch {
    return { valid: false, reason: 'Erreur de vérification cryptographique' }
  }

  if (!sigValid) {
    // Intentionally vague — don't reveal which check failed
    return { valid: false, reason: 'Licence invalide ou modifiée' }
  }

  // ── Payload parse ────────────────────────────────────────────────────────
  const rawPayload = _safeJson(_b64urlDecode(payloadB64))
  if (!rawPayload || typeof rawPayload !== 'object') {
    return { valid: false, reason: 'Données de licence corrompues' }
  }

  const p = rawPayload as Record<string, unknown>
  if (!_assertPayload(p)) {
    return { valid: false, reason: 'Champs de licence manquants ou invalides' }
  }

  // Assertion passed — safe to treat as LicensePayload for remaining checks
  const lic = p as unknown as LicensePayload

  // ── Type check ───────────────────────────────────────────────────────────
  // Message fixe : ne jamais refléter le contenu du payload dans la réponse.
  if (!_VALID_TYPES.has(lic.typ)) {
    return { valid: false, reason: 'Type de licence inconnu' }
  }

  // ── Expiry check (redundant — also in DB layer for revocation) ────────────
  const nowSec = Math.floor(Date.now() / 1000)
  if (lic.exp < nowSec) {
    const expDate = new Date(lic.exp * 1000).toLocaleDateString('fr-FR')
    return { valid: false, reason: `Licence expirée le ${expDate}` }
  }

  // ── Version sanity ────────────────────────────────────────────────────────
  if (!lic.ver.startsWith('2')) {
    return { valid: false, reason: 'Version de licence non supportée' }
  }

  // ── Règles MECHANIC ───────────────────────────────────────────────────────
  // Une clé mécanicien DOIT référencer sa licence Garage parente (plid signé) ;
  // sans parent, la clé est invalide — elle ne peut exister « seule ».
  // Une clé mécanicien n'est JAMAIS admin, quel que soit le reste du payload.
  const isMechanic = lic.typ === 'mechanic'
  if (isMechanic && (typeof lic.plid !== 'string' || lic.plid.length === 0)) {
    return { valid: false, reason: 'Licence mécanicien invalide' }
  }

  return {
    valid:      true,
    payload:    lic,
    isAdmin:    !isMechanic && lic.typ === 'admin',
    isMechanic,
  }
}

/** Empreinte matérielle attendue : digest SHA-256 en hexadécimal (64 caractères). */
const HWID_RE = /^[0-9a-f]{64}$/

/**
 * Normalise un HWID pour une comparaison stricte : retire les espaces de bord
 * et met en minuscules (un digest hex est insensible à la casse). Ne modifie
 * jamais la valeur au-delà de la casse/espaces (aucune tolérance sémantique).
 */
export function normalizeHwid(hwid: string | null | undefined): string {
  return String(hwid ?? '').trim().toLowerCase()
}

/** Le HWID est-il bien formé (SHA-256 hex de 64 caractères) après normalisation ? */
export function isValidHwidFormat(hwid: string | null | undefined): boolean {
  return HWID_RE.test(normalizeHwid(hwid))
}

/**
 * Comparaison STRICTE d'empreinte matérielle — AUCUNE tolérance partielle.
 *
 * Un HWID est un digest SHA-256 : par effet d'avalanche, le moindre changement
 * matériel modifie l'intégralité du hachage. Une « tolérance » de N % n'a donc
 * aucun sens cryptographique et affaiblit le lien (elle réduit l'espace de
 * recherche et laisse des machines au préfixe commun passer). La spécification
 * l'interdit explicitement.
 *
 * Règles :
 *  - les deux valeurs doivent être des HWID bien formés (sinon → false) ;
 *  - comparaison normalisée (casse/espaces) ET à temps constant
 *    (crypto.timingSafeEqual) pour ne pas divulguer d'information par timing ;
 *  - retourne true uniquement pour une correspondance EXACTE.
 *
 * NB : le fait qu'une licence soit « liée » (present/absent) est décidé par
 * l'appelant ; cette fonction ne renvoie jamais true pour un HWID vide.
 */
export function verifyHwid(storedHwid: string, currentHwid: string): boolean {
  const a = normalizeHwid(storedHwid)
  const b = normalizeHwid(currentHwid)
  if (!isValidHwidFormat(a) || !isValidHwidFormat(b)) return false
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

/**
 * Decode and return the watermark embedded in a (already-verified) payload.
 * Used for forensic tracing: if a cracked license appears online, the watermark
 * identifies which customer it was issued to.
 */
export function decodeWatermark(wm: string): { cid: string; label: string; issuedAt: Date } | null {
  try {
    const raw = JSON.parse(_b64urlDecode(wm).toString('utf8'))
    return {
      cid:      String(raw.c ?? ''),
      label:    String(raw.l ?? ''),
      issuedAt: new Date((raw.t ?? 0) * 1000),
    }
  } catch {
    return null
  }
}
