/**
 * Validation de FORMATS pour la facturation électronique.
 *
 * Deux niveaux :
 *  1. Validateurs d'identifiants français : SIREN (Luhn 9), SIRET (Luhn 14 +
 *     cohérence SIREN), n° TVA intracommunautaire FR (clé = (12 + 3×(SIREN mod
 *     97)) mod 97).
 *  2. Validation de PROFIL du document canonique (`validateForProfile`) —
 *     profil « minimum » (Factur-X MINIMUM / EN 16931 sous-ensemble) : champs
 *     obligatoires (BT-x), formats, et COHÉRENCE ARITHMÉTIQUE ENTIÈRE des
 *     totaux recalculée via la couche financière centrale (jamais de flottant
 *     local).
 *
 * Honnêteté : cette validation est STRUCTURELLE et ARITHMÉTIQUE. Elle ne
 * remplace pas la validation XSD/Schematron officielle Factur-X ni le contrôle
 * d'une plateforme agréée — voir docs/EINVOICING_FORMATS.md.
 */

import { taxCentsFromBasis, lineTotalCentsFromScaled, MAX_SCALED } from '@/lib/money'
import type { CanonicalEInvoice } from './document-model'

// ─── Identifiants français ────────────────────────────────────────────────────

/** Somme de Luhn d'une chaîne de chiffres (doublement 1 position sur 2 depuis la droite). */
function luhnSum(digits: string): number {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum
}

/**
 * SIREN valide : exactement 9 chiffres + somme de Luhn multiple de 10. La
 * sentinelle tout-zéros (Luhn-valide arithmétiquement) est rejetée : aucune
 * unité légale réelle ne porte 000000000.
 */
export function isValidSiren(siren: string): boolean {
  const s = siren.replace(/\s+/g, '')
  return /^\d{9}$/.test(s) && luhnSum(s) % 10 === 0 && s !== '000000000'
}

/**
 * SIRET valide : exactement 14 chiffres + Luhn multiple de 10, SIREN (9
 * premiers chiffres) non tout-zéros. (Exception historique La Poste non
 * gérée : hors périmètre d'un garage.)
 */
export function isValidSiret(siret: string): boolean {
  const s = siret.replace(/\s+/g, '')
  return /^\d{14}$/.test(s) && luhnSum(s) % 10 === 0 && !s.startsWith('000000000')
}

/**
 * N° TVA intracommunautaire FRANÇAIS : « FR » + clé 2 chiffres + SIREN 9
 * chiffres, avec clé = (12 + 3 × (SIREN mod 97)) mod 97 et SIREN Luhn-valide.
 * (Les clés alphanumériques historiques ne sont pas acceptées : les numéros
 * émis actuellement sont numériques.)
 */
export function isValidFrVatNumber(vat: string): boolean {
  const v = vat.replace(/\s+/g, '').toUpperCase()
  const m = v.match(/^FR(\d{2})(\d{9})$/)
  if (!m) return false
  const [, keyStr, siren] = m
  if (!isValidSiren(siren)) return false
  const expected = (12 + 3 * (Number(siren) % 97)) % 97
  return Number(keyStr) === expected
}

// ─── Validation de profil ─────────────────────────────────────────────────────

export type EInvoiceProfile = 'minimum'

export type IssueSeverity = 'error' | 'warning'

export interface ValidationIssue {
  /** Identifiant stable de règle (ex. GF-EI-003). */
  ruleId: string
  /** Champ EN 16931 concerné (BT-x / BG-x) quand pertinent. */
  bt?: string
  severity: IssueSeverity
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Caractères INTERDITS en XML 1.0 (contrôles C0 hors TAB/LF/CR, non-caractères
 * FFFE/FFFF) — l'échappement ne peut pas les représenter : ils doivent être
 * REJETÉS en amont, sinon le XML émis serait mal formé.
 */
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/
/** Surrogate isolé (non appairé) : illégal en XML comme en UTF-8 sérialisé. */
const LONE_SURROGATE = /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/

/** Contient un caractère non représentable en XML 1.0 ? */
function hasXmlForbiddenChars(s: string): boolean {
  return XML_FORBIDDEN.test(s) || LONE_SURROGATE.test(s)
}

/**
 * Vide « visuellement » : blancs ET caractères de largeur nulle (U+200B-200D,
 * U+FEFF) ignorés — un nom composé uniquement d'invisibles n'est pas un nom.
 */
function isBlank(s: string | undefined | null): boolean {
  return !s || s.replace(/[\u200B-\u200D\uFEFF]/g, '').trim() === ''
}

/** La date est-elle une vraie date calendaire au format YYYY-MM-DD ? */
function isRealIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false
  const [y, mo, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

/**
 * Valide le document canonique pour le profil demandé. Renvoie TOUTES les
 * violations (pas d'arrêt au premier échec) pour un diagnostic complet.
 */
export function validateForProfile(doc: CanonicalEInvoice, profile: EInvoiceProfile = 'minimum'): ValidationResult {
  // Un seul profil supporté à ce stade ; le paramètre existe pour l'extension
  // (basic/EN16931 complets exigeront des règles supplémentaires, pas moins).
  void profile

  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const err = (ruleId: string, message: string, bt?: string) => errors.push({ ruleId, bt, severity: 'error', message })
  const warn = (ruleId: string, message: string, bt?: string) => warnings.push({ ruleId, bt, severity: 'warning', message })

  // — Caractères non représentables en XML 1.0 (rejet en amont, GF-EI-050) —
  const textFields: Array<[string, string | undefined]> = [
    ['numéro de facture (BT-1)', doc.invoiceNumber],
    ['nom du vendeur (BT-27)', doc.seller.name],
    ["nom de l'acheteur (BT-44)", doc.buyer.name],
    ...(doc.seller.addressLines ?? []).map((a, i): [string, string] => [`adresse vendeur ligne ${i + 1}`, a]),
    ...(doc.buyer.addressLines ?? []).map((a, i): [string, string] => [`adresse acheteur ligne ${i + 1}`, a]),
    ...doc.lines.map((l, i): [string, string] => [`libellé ligne ${i + 1} (BT-153)`, l.description]),
  ]
  for (const [label, value] of textFields) {
    if (value != null && hasXmlForbiddenChars(value)) {
      err('GF-EI-050', `Caractère interdit en XML 1.0 dans le champ ${label} (contrôle C0 ou surrogate isolé).`)
    }
  }

  // — Identité du document —
  if (isBlank(doc.invoiceNumber)) err('GF-EI-001', 'Numéro de facture obligatoire.', 'BT-1')
  if (doc.typeCode !== '380' && doc.typeCode !== '381') err('GF-EI-002', 'Type de document invalide (380 ou 381 attendu).', 'BT-3')
  if (!isRealIsoDate(doc.issueDate)) err('GF-EI-003', `Date d'émission invalide : « ${doc.issueDate} » (YYYY-MM-DD attendu).`, 'BT-2')
  if (doc.dueDate != null && !isRealIsoDate(doc.dueDate)) err('GF-EI-004', `Date d'échéance invalide : « ${doc.dueDate} ».`, 'BT-9')
  if (doc.currency !== 'EUR') err('GF-EI-005', 'Devise non supportée (EUR uniquement).', 'BT-5')

  // — Vendeur (obligations B2B françaises) —
  if (isBlank(doc.seller.name)) err('GF-EI-010', 'Raison sociale du vendeur obligatoire.', 'BT-27')
  if (!/^[A-Z]{2}$/.test(doc.seller.countryCode)) err('GF-EI-019', `Code pays vendeur invalide : « ${doc.seller.countryCode} » (ISO 3166-1 alpha-2 attendu).`, 'BT-40')
  if (!doc.seller.siret) {
    err('GF-EI-011', 'SIRET du vendeur obligatoire (paramètres du garage) pour émettre une facture électronique.', 'BT-30')
  } else if (!isValidSiret(doc.seller.siret)) {
    err('GF-EI-012', `SIRET du vendeur invalide : « ${doc.seller.siret} » (14 chiffres + clé de Luhn).`, 'BT-30')
  }
  if (doc.seller.siren && !isValidSiren(doc.seller.siren)) {
    err('GF-EI-013', `SIREN du vendeur invalide : « ${doc.seller.siren} ».`, 'BT-30')
  }
  if (doc.seller.siret && doc.seller.siren && !doc.seller.siret.startsWith(doc.seller.siren)) {
    err('GF-EI-014', 'Incohérence SIREN/SIRET vendeur (le SIRET doit commencer par le SIREN).', 'BT-30')
  }
  if (!doc.seller.vatNumber) {
    err('GF-EI-015', 'N° de TVA intracommunautaire du vendeur obligatoire.', 'BT-31')
  } else if (!isValidFrVatNumber(doc.seller.vatNumber)) {
    err('GF-EI-016', `N° de TVA vendeur invalide : « ${doc.seller.vatNumber} » (format FRkk + SIREN, clé vérifiée).`, 'BT-31')
  } else if (doc.seller.siren && doc.seller.vatNumber.replace(/\s+/g, '').toUpperCase().slice(4) !== doc.seller.siren) {
    err('GF-EI-017', 'Le n° de TVA vendeur ne correspond pas à son SIREN.', 'BT-31')
  }
  if (!doc.seller.addressLines?.length) warn('GF-EI-018', 'Adresse du vendeur absente (recommandée, obligatoire aux profils supérieurs).', 'BG-5')

  // — Acheteur —
  if (isBlank(doc.buyer.name)) err('GF-EI-020', "Nom de l'acheteur obligatoire.", 'BT-44')
  if (!doc.buyer.addressLines?.length) warn('GF-EI-021', "Adresse de l'acheteur absente (recommandée).", 'BG-8')
  if (!/^[A-Z]{2}$/.test(doc.buyer.countryCode)) err('GF-EI-022', `Code pays acheteur invalide : « ${doc.buyer.countryCode} ».`, 'BT-55')

  // — Lignes —
  if (doc.lines.length === 0) err('GF-EI-030', 'Au moins une ligne de facture est requise.', 'BG-25')
  doc.lines.forEach((l, i) => {
    if (isBlank(l.description)) err('GF-EI-031', `Ligne ${i + 1} : libellé obligatoire.`, 'BT-153')
    if (!Number.isSafeInteger(l.quantityScaled) || l.quantityScaled <= 0) err('GF-EI-032', `Ligne ${i + 1} : quantité invalide (entier positif en dix-millièmes attendu).`, 'BT-129')
    if (!Number.isSafeInteger(l.unitPriceScaled) || l.unitPriceScaled < 0) err('GF-EI-033', `Ligne ${i + 1} : prix unitaire invalide (entier positif ou nul en dix-millièmes attendu).`, 'BT-146')
    if (!Number.isSafeInteger(l.lineTotalCents)) err('GF-EI-034', `Ligne ${i + 1} : montant de ligne non entier.`, 'BT-131')
    // Bornes du domaine exact : au-delà de MAX_SCALED, la couche financière
    // renvoie 0 — sans cette règle, une ligne hors plage serait FACTURÉE 0,00 €
    // en silence (fail-open démontré en revue adversariale).
    if (Number.isSafeInteger(l.quantityScaled) && Math.abs(l.quantityScaled) > MAX_SCALED) {
      err('GF-EI-035', `Ligne ${i + 1} : quantité hors plage exacte (> MAX_SCALED).`, 'BT-129')
    }
    if (Number.isSafeInteger(l.unitPriceScaled) && Math.abs(l.unitPriceScaled) > MAX_SCALED) {
      err('GF-EI-035', `Ligne ${i + 1} : prix unitaire hors plage exacte (> MAX_SCALED).`, 'BT-146')
    }
    // Recalcul du montant de ligne par la couche centrale : un lineTotalCents
    // falsifié (ou calculé ailleurs) ne traverse pas le portail.
    const recomputed = lineTotalCentsFromScaled(l.unitPriceScaled, l.quantityScaled)
    if (Number.isSafeInteger(l.lineTotalCents) && l.lineTotalCents !== recomputed) {
      err('GF-EI-036', `Ligne ${i + 1} : montant incohérent (${l.lineTotalCents} c déclarés, ${recomputed} c recalculés depuis prix × quantité).`, 'BT-131')
    }
  })

  // — TVA & cohérence arithmétique (recalcul par la couche centrale) —
  if (!Number.isFinite(doc.taxRatePercent) || doc.taxRatePercent < 0 || doc.taxRatePercent > 100) {
    err('GF-EI-040', `Taux de TVA invalide : ${doc.taxRatePercent}.`, 'BT-119')
  }
  const expectedBasis = doc.lines.reduce((s, l) => s + (Number.isSafeInteger(l.lineTotalCents) ? l.lineTotalCents : 0), 0)
  if (doc.taxBasisCents !== expectedBasis) {
    err('GF-EI-041', `Assiette HT incohérente : ${doc.taxBasisCents} c déclarés, somme des lignes ${expectedBasis} c.`, 'BT-109')
  }
  const expectedTax = taxCentsFromBasis(doc.taxBasisCents, doc.taxRatePercent)
  if (doc.taxCents !== expectedTax) {
    err('GF-EI-042', `TVA incohérente : ${doc.taxCents} c déclarés, ${expectedTax} c attendus (assiette × taux, arrondi central).`, 'BT-110')
  }
  if (doc.grandTotalCents !== doc.taxBasisCents + doc.taxCents) {
    err('GF-EI-043', `Total TTC incohérent : ${doc.grandTotalCents} c ≠ ${doc.taxBasisCents} + ${doc.taxCents} c.`, 'BT-112')
  }
  // Négatif interdit UNIQUEMENT pour une facture (380) — un avoir (381)
  // portera légitimement des montants négatifs quand il sera supporté.
  if (doc.typeCode === '380' && doc.grandTotalCents < 0) err('GF-EI-044', 'Total TTC négatif interdit sur une facture (type 380).', 'BT-112')
  // Totaux dans le domaine entier sûr (une somme de lignes n'en sort pas sans
  // corruption en amont — ceinture et bretelles).
  for (const [label, v] of [['assiette (BT-109)', doc.taxBasisCents], ['TVA (BT-110)', doc.taxCents], ['TTC (BT-112)', doc.grandTotalCents]] as const) {
    if (!Number.isSafeInteger(v)) err('GF-EI-045', `Total non entier sûr : ${label} = ${v}.`)
  }

  return { valid: errors.length === 0, errors, warnings }
}
