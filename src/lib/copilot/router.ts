/**
 * Intent classifier + slot extractor — pure, deterministic.
 */
import { INTENTS } from './intents'
import type { Classification, Confidence, Slots } from './types'
import { plierApostrophes } from '@/lib/text/apostrophes'

function normalize(s: string): string {
  // Les mots-clés portent l'apostrophe droite ; l'utilisateur tape presque
  // toujours la typographique. Sans ce pliage, « chiffre d’affaires » ne
  // reconnaissait aucune intention.
  return plierApostrophes(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

function extractSlots(raw: string): Slots {
  const slots: Slots = { text: raw.trim() }
  const upper = raw.toUpperCase()
  const vin = upper.match(/\b[A-HJ-NPR-Z0-9]{17}\b/)
  if (vin) slots.vin = vin[0]
  const obd = upper.match(/\b[PCBU][0-3][0-9A-F]{3}\b/)
  if (obd) slots.obdCode = obd[0]
  const days = raw.match(/(\d+)\s*jours?/i)
  if (days) slots.days = Number(days[1])
  return slots
}

function confidenceFromScore(score: number): Confidence {
  if (score >= 2) return 'high'
  if (score === 1) return 'medium'
  return 'low'
}

export function classify(text: string): Classification {
  const n = normalize(text)
  const slots = extractSlots(text)

  let best: { score: number; index: number } | null = null
  INTENTS.forEach((intent, index) => {
    let score = 0
    for (const kw of intent.keywords) {
      const nk = normalize(kw)
      const escaped = nk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(n)) score += nk.split(/\s+/).length
    }
    // A VIN/OBD in the text corroborates the matching read intent.
    if (intent.id === 'vin_decode' && slots.vin) score += 2
    if (intent.id === 'diagnostic' && slots.obdCode) score += 2
    if (score > 0 && (best === null || score > best.score)) {
      best = { score, index } // ties keep the earlier (read-first) intent
    }
  })

  if (!best) {
    return { intent: null, kind: 'unknown', confidence: 'low', slots }
  }
  const chosen = INTENTS[(best as { score: number; index: number }).index]
  return {
    intent: chosen.id,
    kind: chosen.kind,
    confidence: confidenceFromScore((best as { score: number }).score),
    slots,
  }
}
