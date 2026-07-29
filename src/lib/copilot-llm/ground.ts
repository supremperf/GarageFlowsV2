/**
 * Anti-hallucination grounding guard. Pure & deterministic.
 *
 * The Copilot's numbers must come from the engines, never from the model. Given
 * a candidate phrasing and the allowed facts, `isGrounded` verifies that every
 * numeric figure in the phrasing also appears (by value, within tolerance) in
 * the facts. `enforceGrounding` returns the phrasing only when it is grounded,
 * otherwise the deterministic fallback. JS \s already covers NBSP/narrow-NBSP.
 */

/** Best-effort parse of a numeric token in either FR or EN formatting. */
export function parseLoose(token: string): number {
  let t = token.replace(/\s/g, '')
  const hasComma = t.includes(',')
  const hasDot = t.includes('.')
  if (hasComma && hasDot) {
    // Whichever separator is last is the decimal separator.
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.')
    else t = t.replace(/,/g, '')
  } else if (hasComma) {
    t = t.replace(/,/g, '.')
  } else if ((t.match(/\./g) ?? []).length > 1) {
    // Multiple dots → thousands separators.
    t = t.replace(/\./g, '')
  }
  return Number(t)
}

/** Extract every numeric value from free text (runs of digits + separators). */
export function extractNumbers(text: string): number[] {
  const matches = text.match(/-?\d[\d\s.,]*\d|-?\d/g) ?? []
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
