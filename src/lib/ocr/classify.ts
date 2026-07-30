/**
 * Document-type classification from raw OCR text. Pure & deterministic.
 *
 * Keyword scoring per type, plus structural signals (a plate or VIN present in a
 * short document strongly implies a plate / VIN sticker rather than a full
 * registration certificate). The type with the highest score wins; all-zero
 * scores yield `unknown`.
 */
import { accentInsensitive } from './normalize'
import { findVin } from './vin-scan'
import { findPlate } from './plate-scan'
import type { ClassifyResult, DocumentType } from './types'

const KEYWORDS: Partial<Record<DocumentType, string[]>> = {
  carte_grise: [
    'certificat d immatriculation',
    'numero d identification',
    'carte grise',
    'genre national',
    'premiere immatriculation',
    'puissance fiscale',
  ],
  invoice: [
    'facture',
    'total ttc',
    'total ht',
    'montant ht',
    'tva',
    'bon de commande',
    'net a payer',
  ],
  odometer: ['kilometrage', 'compteur', 'releve', 'odometre'],
}

/** Accent- & punctuation-insensitive key (so « d'identification » matches). */
function kw(s: string): string {
  return accentInsensitive(s).replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Count how many of a type's keywords appear as whole words in the normalised
 * text. Space-padding enforces word boundaries so « releve » does not match
 * inside « prelevement ».
 */
function keywordScore(haystack: string, keywords: string[]): number {
  const padded = ` ${haystack} `
  let score = 0
  for (const k of keywords) if (padded.includes(` ${kw(k)} `)) score += 1
  return score
}

export function classifyDocument(text: string): ClassifyResult {
  const hay = kw(text)
  const compact = text.replace(/\s+/g, ' ').trim()
  const isShort = compact.length <= 48

  const invoiceKw = keywordScore(hay, KEYWORDS.invoice ?? [])
  const carteKw = keywordScore(hay, KEYWORDS.carte_grise ?? [])
  const hasCurrency = /€|\beur\b|\beuros?\b/.test(hay)

  const scores: Partial<Record<DocumentType, number>> = {
    carte_grise: carteKw * 2,
    invoice: invoiceKw * 2 + (hasCurrency ? 2 : 0),
    odometer: keywordScore(hay, KEYWORDS.odometer ?? []) * 2,
    plate: 0,
    vin_plate: 0,
  }

  const vin = findVin(text)
  const plate = findPlate(text)

  // Structural boosts: a lone VIN / plate on a short doc is a sticker, not a
  // certificate. On a long doc these signals are weak (the certificate carries
  // them too), so they only nudge.
  if (vin) scores.vin_plate = (scores.vin_plate ?? 0) + (isShort ? 5 : 1)
  if (plate) scores.plate = (scores.plate ?? 0) + (isShort ? 4 : 1)
  // Odometer needs a mileage anchor (a number just before "km"), not the bare
  // word — a repair invoice mentions "km" incidentally.
  if (/\d[\d.,\s]{0,12}km\b/i.test(text)) scores.odometer = (scores.odometer ?? 0) + (isShort ? 3 : 1)

  // Mileage vocabulary is incidental on an invoice or a certificate (both often
  // note the odometer reading); don't let it outrank the real document type.
  if (invoiceKw > 0 || hasCurrency || carteKw > 0) scores.odometer = 0

  // A VIN present anywhere corroborates a registration certificate a little.
  if (vin && (scores.carte_grise ?? 0) > 0) scores.carte_grise = (scores.carte_grise ?? 0) + 1

  let best: DocumentType = 'unknown'
  let bestScore = 0
  for (const [type, score] of Object.entries(scores) as [DocumentType, number][]) {
    if (score > bestScore) {
      bestScore = score
      best = type
    }
  }

  // Confidence: scale the winning score into [0,1] with a soft ceiling.
  const confidence = bestScore === 0 ? 0 : Math.min(1, 0.4 + bestScore * 0.12)
  return { type: bestScore === 0 ? 'unknown' : best, confidence, scores }
}
