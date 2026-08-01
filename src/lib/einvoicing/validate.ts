/**
 * Validation du cœur EN 16931 sur le document normalisé.
 *
 * Renvoie erreurs (bloquantes) et avertissements (non bloquants). Vérifie la
 * présence des champs obligatoires, le format des identifiants légaux, et la
 * COHÉRENCE arithmétique des totaux/TVA (en centimes entiers — exact).
 *
 * Ce validateur est *interne* et pédagogique ; il ne remplace pas la validation
 * d'une PDP agréée mais couvre les règles métier essentielles (BR-xx).
 */
import type { EInvoiceDocument, ValidationIssue, ValidationResult } from './types'

/** Vérifie un SIRET : 14 chiffres. La clé de Luhn est vérifiée à part (avertissement). */
function isSiretFormat(v: string): boolean {
  return /^\d{14}$/.test(v)
}

/** Clé de Luhn (SIRET/SIREN). Certains SIRET (ex. La Poste) échappent à Luhn → avertissement. */
function passesLuhn(v: string): boolean {
  let sum = 0
  for (let i = 0; i < v.length; i++) {
    let d = v.charCodeAt(v.length - 1 - i) - 48
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9 }
    sum += d
  }
  return sum % 10 === 0
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function validateDocument(doc: EInvoiceDocument): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const err = (code: string, field: string, message: string) => errors.push({ code, field, message })
  const warn = (code: string, field: string, message: string) => warnings.push({ code, field, message })

  // ── En-tête ────────────────────────────────────────────────────────────────
  if (!doc.id?.trim()) err('BR-01', 'id', 'Numéro de facture obligatoire.')
  if (!doc.issueDate || !ISO_DATE.test(doc.issueDate)) {
    err('BR-02', 'issueDate', "Date d'émission obligatoire au format YYYY-MM-DD.")
  }
  if (!doc.currency?.trim()) err('BR-05', 'currency', 'Devise obligatoire (ISO 4217).')
  if (doc.typeCode !== '380' && doc.typeCode !== '381') {
    err('BR-04', 'typeCode', 'Type de document invalide (380 facture / 381 avoir).')
  }
  if (doc.typeCode === '381' && !doc.precedingInvoiceRef?.trim()) {
    warn('GF-CN-REF', 'precedingInvoiceRef', "Un avoir (381) devrait référencer la facture d'origine.")
  }

  // ── Vendeur ──────────────────────────────────────────────────────────────
  if (!doc.seller?.name?.trim()) err('BR-06', 'seller.name', 'Nom du vendeur obligatoire.')
  const sellerSiret = doc.seller?.siret?.trim()
  const sellerVat = doc.seller?.vatNumber?.trim()
  if (!sellerSiret && !sellerVat) {
    err('GF-SELLER-ID', 'seller.siret', 'Identifiant légal vendeur obligatoire (SIRET ou n° TVA).')
  }
  if (sellerSiret) {
    if (!isSiretFormat(sellerSiret)) err('GF-SIRET-FMT', 'seller.siret', 'SIRET vendeur invalide (14 chiffres attendus).')
    else if (!passesLuhn(sellerSiret)) warn('GF-SIRET-LUHN', 'seller.siret', 'Clé de Luhn du SIRET vendeur non valide (vérifier).')
  }
  if (!sellerVat) warn('GF-SELLER-VAT', 'seller.vatNumber', 'N° TVA intracommunautaire vendeur recommandé.')

  // ── Acheteur ─────────────────────────────────────────────────────────────
  if (!doc.buyer?.name?.trim()) err('BR-07', 'buyer.name', "Nom de l'acheteur obligatoire.")
  const buyerSiret = doc.buyer?.siret?.trim()
  if (buyerSiret && !isSiretFormat(buyerSiret)) {
    err('GF-BUYER-SIRET-FMT', 'buyer.siret', 'SIRET acheteur invalide (14 chiffres attendus).')
  }
  if (!buyerSiret) {
    warn('GF-BUYER-ID', 'buyer.siret', "SIRET acheteur absent : requis pour une facture B2B (le schéma Client ne le stocke pas encore).")
  }

  // ── Lignes ───────────────────────────────────────────────────────────────
  if (!Array.isArray(doc.lines) || doc.lines.length === 0) {
    err('BR-16', 'lines', 'Au moins une ligne de facture obligatoire.')
  }
  for (const l of doc.lines ?? []) {
    const at = `lines[${l.id}]`
    if (!l.description?.trim()) err('BR-25', `${at}.description`, 'Description de ligne obligatoire.')
    if (!Number.isFinite(l.quantity)) err('BR-22', `${at}.quantity`, 'Quantité invalide.')
    if (!Number.isFinite(l.unitPriceCents)) err('BR-27', `${at}.unitPriceCents`, 'Prix unitaire invalide.')
    // Cohérence : net = round(quantité × PU_centimes).
    const expected = Math.round(l.unitPriceCents * (l.quantity ?? 0))
    if (l.netAmountCents !== expected) {
      err('GF-LINE-NET', `${at}.netAmountCents`, `Montant net incohérent (attendu ${expected}, reçu ${l.netAmountCents}).`)
    }
  }

  // ── Ventilation TVA + totaux (centimes entiers) ──────────────────────────
  for (const v of doc.vatBreakdown ?? []) {
    const expectedTax = Math.round((v.taxableAmountCents * v.vatRatePercent) / 100)
    if (v.taxAmountCents !== expectedTax) {
      err('BR-CO-14', `vat[${v.vatRatePercent}]`, `TVA incohérente (attendu ${expectedTax}, reçu ${v.taxAmountCents}).`)
    }
  }
  const t = doc.totals
  if (t) {
    const sumLines = (doc.lines ?? []).reduce((s, l) => s + l.netAmountCents, 0)
    if (t.lineTotalCents !== sumLines) err('BR-CO-10', 'totals.lineTotalCents', `Somme des lignes incohérente (attendu ${sumLines}).`)
    if (t.taxInclusiveCents !== t.taxExclusiveCents + t.taxAmountCents) {
      err('BR-CO-15', 'totals.taxInclusiveCents', 'TTC ≠ HT + TVA.')
    }
    const sumVat = (doc.vatBreakdown ?? []).reduce((s, v) => s + v.taxAmountCents, 0)
    if (t.taxAmountCents !== sumVat) err('BR-CO-13', 'totals.taxAmountCents', `Total TVA ≠ somme de la ventilation (attendu ${sumVat}).`)
  } else {
    err('GF-TOTALS', 'totals', 'Totaux manquants.')
  }

  return { valid: errors.length === 0, errors, warnings }
}
