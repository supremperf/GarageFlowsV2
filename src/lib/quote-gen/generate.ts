/**
 * Quote assembly. Pure & deterministic.
 *
 * For each operation: a labour line (estimated minutes → hours billed up to the
 * configured step, × the hourly rate) and one line per default part. Forgotten-
 * parts suggestions are attached separately as optional lines and are NOT
 * counted in the totals — the user opts them in explicitly. All money is rounded
 * to cents with a float-safe rule; margin is revenue − parts cost (labour cost
 * is not modelled).
 */
import type {
  GenerateQuoteOptions,
  QuoteLine,
  QuoteOperation,
  QuoteProposal,
  QuoteSuggestionInput,
  SuggestionLine,
} from './types'
import { toCents, fromCents, lineCents, taxCentsFromBasis } from '@/lib/money'

/** Arrondi au centime — délègue à la couche financière centrale (centimes exacts). */
export function roundMoney(n: number): number {
  return fromCents(toCents(n))
}

/** Billed hours: minutes → hours, rounded UP to the step (min one step when > 0). */
export function billedHours(minutes: number, stepHours: number): number {
  if (minutes <= 0) return 0
  const step = stepHours > 0 ? stepHours : 0.25
  const hours = minutes / 60
  const stepped = Math.ceil(hours / step - 1e-9) * step
  return Math.round(stepped * 100) / 100
}

export function generateQuote(
  operations: QuoteOperation[],
  suggestions: QuoteSuggestionInput[],
  options: GenerateQuoteOptions,
): QuoteProposal {
  const vatRate = options.vatRate ?? 20
  const currency = options.currency ?? 'EUR'
  const step = options.laborStepHours ?? 0.25

  const lines: QuoteLine[] = []
  const warnings: string[] = []
  let laborMinutes = 0

  // Sanitise the rate: an invalid (NaN/negative) rate must never flow into money.
  const rawRate = options.laborRatePerHour
  const rate = Number.isFinite(rawRate) && rawRate > 0 ? rawRate : 0

  if (operations.length === 0) warnings.push('Aucune opération à chiffrer.')
  if (rate <= 0) warnings.push('Taux horaire de main-d’œuvre non défini.')

  for (const op of operations) {
    laborMinutes += Math.max(0, op.laborMinutes)
    const hours = billedHours(op.laborMinutes, step)
    if (hours > 0) {
      // Round the unit price once and reuse it so quantity × unitPrice === lineTotal.
      const unitRate = roundMoney(rate)
      lines.push({
        kind: 'labor',
        description: `Main-d’œuvre — ${op.label}`,
        quantity: hours,
        unitPrice: unitRate,
        unitCost: 0,
        lineTotalHT: fromCents(lineCents(unitRate, hours)),
        isLabor: true,
        repairType: op.repairType,
      })
    }
    for (const p of op.parts ?? []) {
      if (!(Number.isFinite(p.unitPrice) && p.unitPrice > 0)) warnings.push(`Prix manquant pour « ${p.name} ».`)
      const price = Number.isFinite(p.unitPrice) && p.unitPrice > 0 ? p.unitPrice : 0
      const cost = Number.isFinite(p.unitCost) && (p.unitCost ?? 0) > 0 ? (p.unitCost as number) : 0
      const unitPrice = roundMoney(price)
      lines.push({
        kind: 'part',
        description: p.name,
        reference: p.reference ?? null,
        quantity: p.quantity,
        unitPrice,
        unitCost: roundMoney(cost),
        lineTotalHT: fromCents(lineCents(unitPrice, p.quantity)),
        isLabor: false,
        repairType: op.repairType,
      })
    }
  }

  const suggestionLines: SuggestionLine[] = suggestions.map((s) => {
    const priced = s.unitPrice != null && Number.isFinite(s.unitPrice) && s.unitPrice >= 0
    const unit = priced ? roundMoney(s.unitPrice as number) : null
    return {
      name: s.name,
      reference: s.reference ?? null,
      quantity: s.quantity,
      unitPrice: unit,
      lineTotalHT: unit != null ? fromCents(lineCents(unit, s.quantity)) : null,
      reason: s.reason,
    }
  })

  const laborHT = roundMoney(lines.filter((l) => l.isLabor).reduce((s, l) => s + l.lineTotalHT, 0))
  const partsHT = roundMoney(lines.filter((l) => !l.isLabor).reduce((s, l) => s + l.lineTotalHT, 0))
  // TVA/TTC via la règle centrale (centimes entiers, arrondi unique) :
  // TTC = HT + TVA garanti au centime, comme les factures/devis persistés.
  const subtotalHTCents = toCents(laborHT) + toCents(partsHT)
  const vatCents = taxCentsFromBasis(subtotalHTCents, vatRate)
  const subtotalHT = fromCents(subtotalHTCents)
  const vat = fromCents(vatCents)
  const totalTTC = fromCents(subtotalHTCents + vatCents)
  const estimatedCostHT = fromCents(lines.reduce((s, l) => s + lineCents(l.unitCost, l.quantity), 0))
  const marginHT = roundMoney(subtotalHT - estimatedCostHT)
  const marginPct = subtotalHT > 0 ? Math.round((marginHT / subtotalHT) * 1000) / 10 : null
  const suggestionsHT = roundMoney(suggestionLines.reduce((s, l) => s + (l.lineTotalHT ?? 0), 0))

  return {
    lines,
    suggestions: suggestionLines,
    totals: { laborHT, partsHT, subtotalHT, vatRate, vat, totalTTC, estimatedCostHT, marginHT, marginPct, suggestionsHT, currency },
    laborMinutes,
    warnings,
  }
}
