/**
 * DiagnosticEngine — merges symptom and OBD evidence into ranked probable causes.
 * Deterministic and explainable: every cause cites what pointed to it.
 */
import { decodeObdCode } from './obd'
import { CAUSES, OBD_CODE_CAUSES, SUBSYSTEM_CAUSES, SYMPTOM_RULES } from './knowledge'
import type { Confidence, DiagnosticInput, DiagnosticResult, ProbableCause } from './types'

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

function confidenceFromScore(score: number): Confidence {
  if (score >= 0.7) return 'high'
  if (score >= 0.45) return 'medium'
  return 'low'
}

const HIGH_MILEAGE = 150_000

export function diagnose(input: DiagnosticInput): DiagnosticResult {
  const symptoms = (input.symptoms ?? []).filter(Boolean)
  const obdCodes = (input.obdCodes ?? []).filter(Boolean)
  const historyNorm = (input.history ?? []).map(normalize)

  const contributions = new Map<string, Set<string>>()
  const add = (causeId: string, source: string) => {
    if (!CAUSES[causeId]) return
    const set = contributions.get(causeId) ?? new Set<string>()
    set.add(source)
    contributions.set(causeId, set)
  }

  // Symptom evidence.
  for (const raw of symptoms) {
    const n = normalize(raw)
    for (const rule of SYMPTOM_RULES) {
      if (rule.match.some((m) => n.includes(normalize(m)))) {
        for (const c of rule.causes) add(c, `symptôme : « ${raw} »`)
      }
    }
  }

  // OBD evidence.
  const decodedCodes = obdCodes.map(decodeObdCode)
  for (const d of decodedCodes) {
    if (!d.valid) continue
    const byCode = OBD_CODE_CAUSES[d.code]
    if (byCode) {
      for (const c of byCode) add(c, `code ${d.code}`)
    } else if (d.system === 'powertrain') {
      const bySub = SUBSYSTEM_CAUSES[d.code[2]]
      if (bySub) for (const c of bySub) add(c, `code ${d.code} (${d.subsystem})`)
    }
  }

  // Score every collected cause.
  const causes: ProbableCause[] = []
  contributions.forEach((sources, id) => {
    const def = CAUSES[id]
    const justification = Array.from(sources)
    let score = Math.min(1, def.baseLikelihood + 0.15 * (sources.size - 1))

    if (def.wearRelated && (input.mileage ?? 0) >= HIGH_MILEAGE) {
      score = Math.min(1, score + 0.1)
      justification.push(`kilométrage élevé (${input.mileage} km)`)
    }
    const nameNorm = normalize(def.name)
    if (historyNorm.some((h) => h.length > 3 && (nameNorm.includes(h) || h.includes(nameNorm)))) {
      score = Math.min(1, score + 0.1)
      justification.push('antécédent sur ce véhicule')
    }

    causes.push({
      id,
      name: def.name,
      probability: Math.round(score * 100),
      confidence: confidenceFromScore(score),
      justification,
      recommendedChecks: def.checks,
      suspectedParts: def.parts ?? [],
      consumables: def.consumables ?? [],
      estimatedTimeMin: def.estimatedTimeMin,
      difficulty: def.difficulty,
    })
  })

  causes.sort((a, b) => {
    if (b.probability !== a.probability) return b.probability - a.probability
    if (a.estimatedTimeMin !== b.estimatedTimeMin) return a.estimatedTimeMin - b.estimatedTimeMin // cheaper checks first
    return a.name.localeCompare(b.name)
  })

  // Merged, de-duplicated check order across the top causes.
  const seen = new Set<string>()
  const recommendedCheckOrder: string[] = []
  for (const c of causes.slice(0, 5)) {
    for (const check of c.recommendedChecks) {
      const key = normalize(check)
      if (!seen.has(key)) {
        seen.add(key)
        recommendedCheckOrder.push(check)
      }
    }
  }

  const notes: string[] = []
  if (symptoms.length === 0 && obdCodes.length === 0) {
    notes.push('Aucun symptôme ni code fourni — précisez au moins un symptôme ou un code OBD.')
  }
  const invalid = decodedCodes.filter((d) => !d.valid)
  if (invalid.length) notes.push(`Code(s) OBD invalide(s) ignoré(s) : ${invalid.map((d) => d.code).join(', ')}.`)

  return { causes, decodedCodes, recommendedCheckOrder, notes }
}
