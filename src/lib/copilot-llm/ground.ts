/**
 * Anti-hallucination grounding guard. Pure & deterministic.
 *
 * The Copilot's numbers must come from the engines, never from the model. Given
 * a candidate phrasing and the allowed facts, `isGrounded` verifies that every
 * numeric figure in the phrasing also appears (by value, within tolerance) in
 * the facts. `enforceGrounding` returns the phrasing only when it is grounded,
 * otherwise the deterministic fallback. JS \s already covers NBSP/narrow-NBSP.
 */

/**
 * Parse ONE numeric token (already isolated by the tokenizer) to its value.
 * Disambiguates grouping vs decimal separators unambiguously so that e.g.
 * « 90,000 » and « 2.000 » read as 90000 / 2000 (grouping), not 90 / 2 — a
 * grounding guard must not let a thousands figure collapse onto an unrelated
 * small fact. A separator with exactly three trailing digits is grouping.
 */
export function parseLoose(token: string): number {
  const t = token.replace(/\s/g, '') // FR/NBSP grouping spaces are already validated by the tokenizer
  const commas = (t.match(/,/g) ?? []).length
  const dots = (t.match(/\./g) ?? []).length

  if (commas > 0 && dots > 0) {
    // Both present → the last separator is the decimal, the other groups.
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) return Number(t.replace(/\./g, '').replace(',', '.'))
    return Number(t.replace(/,/g, ''))
  }
  if (commas > 1) return Number(t.replace(/,/g, '')) // 1,234,567 → grouping
  if (dots > 1) return Number(t.replace(/\./g, '')) // 1.234.567 → grouping
  if (commas === 1) {
    const after = t.length - t.indexOf(',') - 1
    return after === 3 ? Number(t.replace(',', '')) : Number(t.replace(',', '.'))
  }
  if (dots === 1) {
    const after = t.length - t.indexOf('.') - 1
    return after === 3 ? Number(t.replace('.', '')) : Number(t)
  }
  return Number(t)
}

// A number token: FR-grouped thousands (1-3 digits + one-or-more « <space>ddd »
// groups, optional decimal), OR a compact run of digits/.,  (no whitespace, so
// two space-separated figures never merge and a list delimiter always splits).
const NUMBER_RE = /-?\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?|-?\d[\d.,]*\d|-?\d/g

/** Extract every numeric value from free text, never merging distinct figures. */
export function extractNumbers(text: string): number[] {
  const matches = text.match(NUMBER_RE) ?? []
  const out: number[] = []
  for (const m of matches) {
    const n = parseLoose(m)
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

/** Two figures match when they are numerically equal within a small tolerance. */
export function numbersMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.05, Math.abs(a) * 0.001)
}

/**
 * True when every number in `text` also appears in `allowedText`. Text with no
 * numbers is trivially grounded.
 */
export function isGrounded(text: string, allowedText: string): boolean {
  const allowed = extractNumbers(allowedText)
  const used = extractNumbers(text)
  return used.every((u) => allowed.some((a) => numbersMatch(u, a)))
}

/** Return `phrasing` when grounded in `facts`; otherwise the deterministic `fallback`. */
export function enforceGrounding(phrasing: string, facts: string, fallback: string): string {
  return isGrounded(phrasing, facts) ? phrasing : fallback
}
