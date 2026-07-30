import { describe, it, expect } from 'vitest'
import {
  parseLoose,
  extractNumbers,
  isGrounded,
  enforceGrounding,
  ruleClassify,
  classifyIntent,
  phraseAnswer,
  buildClassifyMessages,
  buildPhraseMessages,
  type IntentSpec,
  type LlmProvider,
  type PhraseInput,
} from '../index'

const INTENTS: IntentSpec[] = [
  { id: 'revenue_today', label: "Chiffre d'affaires du jour", keywords: ['chiffre affaires', 'ca', 'recette', 'encaisse'] },
  { id: 'low_stock', label: 'Pièces à commander', keywords: ['stock', 'rupture', 'commander', 'reappro'] },
  { id: 'quotes_pending', label: 'Devis en attente', keywords: ['devis', 'attente', 'relance'] },
]

// A test-only scripted provider (NOT a production mock) to exercise the seam.
function scripted(opts: { classify?: unknown; phrase?: string | null; throwOn?: 'classify' | 'phrase' }): LlmProvider {
  return {
    id: 'scripted',
    name: 'Scripted',
    async classify() {
      if (opts.throwOn === 'classify') throw new Error('boom')
      return (opts.classify ?? null) as never
    },
    async phrase() {
      if (opts.throwOn === 'phrase') throw new Error('boom')
      return opts.phrase ?? null
    },
  }
}

describe('parseLoose / extractNumbers', () => {
  it('parses FR and EN numeric formats', () => {
    expect(parseLoose('1 234,56')).toBe(1234.56)
    expect(parseLoose('12 000')).toBe(12000)
    expect(parseLoose('93,6')).toBe(93.6)
    expect(parseLoose('93.6')).toBe(93.6)
    expect(parseLoose('1.000.000')).toBe(1000000)
  })

  it('extracts every figure from text', () => {
    expect(extractNumbers("CA 12 000 € sur 3 factures, marge 59%")).toEqual([12000, 3, 59])
  })

  it('reads grouped thousands as their true magnitude (not 1/1000th)', () => {
    // Regression: a grouping separator must not collapse a thousands figure.
    expect(parseLoose('90,000')).toBe(90000)
    expect(parseLoose('2.000')).toBe(2000)
    expect(parseLoose('150.000')).toBe(150000)
    expect(parseLoose('1,234,567')).toBe(1234567)
    expect(parseLoose('1,5')).toBe(1.5) // 1 trailing digit → decimal
    expect(parseLoose('12,50')).toBe(12.5)
  })

  it('never merges distinct whitespace- or comma-separated figures', () => {
    expect(extractNumbers('12 000 3')).toEqual([12000, 3])
    expect(extractNumbers('100, 200, 999')).toEqual([100, 200, 999])
    expect(extractNumbers('1 234,56 8')).toEqual([1234.56, 8])
  })
})

describe('grounding guard', () => {
  const facts = "Chiffre d'affaires HT du jour : 1 234,56 € sur 3 factures payées."

  it('accepts a phrasing that only uses figures from the facts', () => {
    expect(isGrounded('Vous avez encaissé 1234,56 € via 3 factures aujourd’hui.', facts)).toBe(true)
  })

  it('rejects a phrasing that introduces an invented figure', () => {
    expect(isGrounded('Vous avez encaissé 1 234,56 € et 5 000 € de plus.', facts)).toBe(false)
  })

  it('treats number-free phrasings as grounded', () => {
    expect(isGrounded('Belle journée pour l’atelier.', facts)).toBe(true)
  })

  it('rejects a fabricated grouped-thousands figure that used to collapse (security)', () => {
    // "90,000" must NOT be accepted just because "90" appears in the facts.
    expect(isGrounded('Total : 90,000 €', 'Diagnostic : 90 min')).toBe(false)
    expect(isGrounded('Coût : 2.000 €', "Main d'œuvre : 2 h")).toBe(false)
  })

  it('rejects a fabricated figure hidden in a comma-separated list (security)', () => {
    // The list must not evaporate to [] and pass vacuously.
    expect(isGrounded('Montants : 100, 200, 999', 'Montants autorisés : 100 et 200')).toBe(false)
  })

  it('rejects a stray digit glued to a valid amount by whitespace (security)', () => {
    expect(isGrounded('1 234,56 8 €', '1 234,56 €')).toBe(false)
  })

  it('enforceGrounding keeps a good phrasing and swaps a bad one for the fallback', () => {
    expect(enforceGrounding('3 factures', facts, 'REPLI')).toBe('3 factures')
    expect(enforceGrounding('42 factures', facts, 'REPLI')).toBe('REPLI')
  })
})

describe('ruleClassify', () => {
  it('classifies by keyword hits', () => {
    expect(ruleClassify('quel est mon chiffre affaires', INTENTS).intentId).toBe('revenue_today')
    expect(ruleClassify('quelles pièces en rupture de stock', INTENTS).intentId).toBe('low_stock')
  })

  it('returns unknown when nothing matches', () => {
    expect(ruleClassify('bonjour', INTENTS).intentId).toBe('unknown')
  })
})

describe('classifyIntent', () => {
  it('uses a valid provider classification', async () => {
    const r = await classifyIntent('peu importe', INTENTS, scripted({ classify: { intentId: 'quotes_pending', confidence: 0.9 } }))
    expect(r.intentId).toBe('quotes_pending')
    expect(r.source).toBe('llm')
  })

  it('rejects a hallucinated intent id and falls back deterministically', async () => {
    const r = await classifyIntent('chiffre affaires', INTENTS, scripted({ classify: { intentId: 'not_a_real_intent', confidence: 1 } }))
    expect(r.intentId).toBe('revenue_today')
    expect(r.source).toBe('fallback')
  })

  it('falls back when the provider throws', async () => {
    const r = await classifyIntent('stock rupture', INTENTS, scripted({ throwOn: 'classify' }))
    expect(r.intentId).toBe('low_stock')
    expect(r.source).toBe('fallback')
  })

  it('works with no provider at all', async () => {
    const r = await classifyIntent('devis en attente', INTENTS, null)
    expect(r.intentId).toBe('quotes_pending')
    expect(r.source).toBe('fallback')
  })
})

describe('phraseAnswer', () => {
  const input: PhraseInput = {
    query: 'quel est mon CA du jour ?',
    facts: "Chiffre d'affaires HT du jour : 1 234,56 € sur 3 factures.",
    fallback: "Chiffre d'affaires HT du jour : 1 234,56 € sur 3 factures.",
  }

  it('uses a grounded provider phrasing', async () => {
    const r = await phraseAnswer(input, scripted({ phrase: 'Aujourd’hui, 1234,56 € encaissés sur 3 factures.' }))
    expect(r.source).toBe('llm')
    expect(r.text).toMatch(/1234,56/)
  })

  it('rejects a hallucinated figure and returns the deterministic fallback', async () => {
    const r = await phraseAnswer(input, scripted({ phrase: 'Vous avez encaissé 9 999 € aujourd’hui.' }))
    expect(r.source).toBe('fallback_ungrounded')
    expect(r.text).toBe(input.fallback)
  })

  it('falls back when the provider throws or returns empty', async () => {
    expect((await phraseAnswer(input, scripted({ throwOn: 'phrase' }))).source).toBe('fallback')
    expect((await phraseAnswer(input, scripted({ phrase: null }))).source).toBe('fallback')
  })

  it('returns the fallback verbatim with no provider', async () => {
    const r = await phraseAnswer(input, null)
    expect(r.text).toBe(input.fallback)
    expect(r.source).toBe('fallback')
  })

  it('does NOT treat a number typed only in the query as grounded', async () => {
    // Query says 9999; facts do not. A phrasing echoing 9999 must be rejected.
    const q: PhraseInput = { query: 'et si je facturais 9999 € ?', facts: 'CA du jour : 100 €.', fallback: 'CA du jour : 100 €.' }
    const r = await phraseAnswer(q, scripted({ phrase: 'Vous pourriez encaisser 9999 € aujourd’hui.' }))
    expect(r.source).toBe('fallback_ungrounded')
  })

  it('falls back when a provider hangs (timeout), not blocking forever', async () => {
    const hanging: LlmProvider = { id: 'hang', name: 'Hang', phrase: () => new Promise<string>(() => {}) }
    const r = await phraseAnswer(input, hanging, { timeoutMs: 10 })
    expect(r.source).toBe('fallback')
    expect(r.text).toBe(input.fallback)
  })
})

describe('prompt builders', () => {
  it('constrains the classifier to the known intent ids', () => {
    const msgs = buildClassifyMessages('mon CA', INTENTS)
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toMatch(/revenue_today/)
    expect(msgs[0].content).toMatch(/unknown/)
  })

  it('instructs the phraser to only use the given facts', () => {
    const msgs = buildPhraseMessages({ query: 'q', facts: 'CA 100 €', fallback: 'repli' })
    expect(msgs[0].content).toMatch(/n.invente aucun|QUE les chiffres/i)
    expect(msgs[1].content).toMatch(/CA 100/)
  })
})
