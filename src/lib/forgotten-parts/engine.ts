/**
 * ForgottenPartsEngine — explainable rules-based recommender.
 *
 * Deterministic: given the operations (+ optional job parts, garage habits and
 * catalog prices) it returns ranked recommendations, each with a confidence
 * level, a justification and an estimated financial impact.
 */
import { DEFAULT_RULES } from './rules'
import type {
  AnalyzeInput,
  ConfidenceLevel,
  Recommendation,
  RuleDef,
} from './types'

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics (combining marks)
    .toLowerCase()
    .trim()
}

function levelFromScore(score: number): ConfidenceLevel {
  if (score >= 0.8) return 'high'
  if (score >= 0.55) return 'medium'
  return 'low'
}

function key(name: string, reference?: string): string {
  return reference ? `ref:${normalize(reference)}` : `name:${normalize(name)}`
}

export class ForgottenPartsEngine {
  constructor(private readonly rules: RuleDef[] = DEFAULT_RULES) {}

  analyze(input: AnalyzeInput): Recommendation[] {
    const currency = input.currency ?? 'EUR'
    const ops = input.operations.filter(Boolean)
    const normOps = ops.map((o) => ({ raw: o, norm: normalize(o) }))

    const already = new Set<string>()
    for (const p of input.partsOnJob ?? []) {
      if (p.name) already.add(key(p.name, undefined))
      if (p.reference) already.add(key('', p.reference))
    }
    const habits = new Set((input.garageHabits ?? []).map((h) => normalize(h)))
    // Normalize catalog keys so callers can pass natural names/references.
    const catalog = new Map<string, number>()
    if (input.catalog) {
      input.catalog.forEach((v, k) => catalog.set(normalize(k), v))
    }

    const acc = new Map<string, Recommendation>()

    for (const rule of this.rules) {
      const matchedOps = normOps.filter((o) => rule.match.some((m) => o.norm.includes(normalize(m))))
      if (matchedOps.length === 0) continue
      const triggeredBy = Array.from(new Set(matchedOps.map((o) => o.raw)))

      for (const rec of rule.recommends) {
        const k = rec.reference ? key('', rec.reference) : key(rec.name, undefined)
        if (already.has(k)) continue

        const nName = normalize(rec.name)
        const inHabit = habits.has(nName) || (rec.reference ? habits.has(normalize(rec.reference)) : false)

        let score = rec.baseConfidence
        if (rec.category === 'manufacturer' || rec.category === 'safety') score += 0.05
        if (triggeredBy.length >= 2) score += 0.05
        if (inHabit) score += 0.15
        score = Math.min(1, Math.round(score * 100) / 100)

        const qty = rec.qty ?? 1
        const price =
          (rec.reference ? catalog.get(normalize(rec.reference)) : undefined) ??
          catalog.get(nName) ??
          null
        const total = price != null ? Math.round(price * qty * 100) / 100 : null

        const justification = inHabit
          ? `${rec.reason} (habituellement ajouté dans votre garage.)`
          : rec.reason

        const candidate: Recommendation = {
          name: rec.name,
          reference: rec.reference,
          category: rec.category,
          confidence: levelFromScore(score),
          score,
          justification,
          triggeredBy,
          estimatedImpact: { unitPrice: price, qty, total, currency },
        }

        const existing = acc.get(k)
        if (!existing) {
          acc.set(k, candidate)
        } else {
          // Keep the stronger score; union the triggering operations.
          const merged = existing.score >= candidate.score ? existing : candidate
          merged.triggeredBy = Array.from(new Set([...existing.triggeredBy, ...candidate.triggeredBy]))
          acc.set(k, merged)
        }
      }
    }

    return Array.from(acc.values()).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const bt = b.estimatedImpact.total ?? 0
      const at = a.estimatedImpact.total ?? 0
      if (bt !== at) return bt - at
      return a.name.localeCompare(b.name)
    })
  }
}
