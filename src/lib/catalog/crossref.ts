/**
 * Cross-reference resolution — equivalence classes over part references.
 *
 * Each article declares a primary reference plus a list of equivalent numbers
 * (OE ↔ aftermarket). Two references are equivalent when they appear together on
 * any article; equivalence is transitive, so we build disjoint sets (union-find)
 * and expose the full class for any reference. Pure & deterministic.
 */
import { normalizeRef } from './normalize'
import type { CatalogArticle } from './types'

export class CrossRefIndex {
  /** normalised ref → root normalised ref. */
  private parent = new Map<string, string>()
  /** normalised ref → all original-cased spellings seen for it. */
  private spellings = new Map<string, Set<string>>()

  private find(x: string): string {
    let root = x
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root) as string
    }
    // Path compression.
    let cur = x
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur) as string
      this.parent.set(cur, root)
      cur = next
    }
    return root
  }

  private ensure(norm: string): void {
    if (!this.parent.has(norm)) {
      this.parent.set(norm, norm)
      this.spellings.set(norm, new Set())
    }
  }

  private union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    // Deterministic root: the lexicographically smaller normalised ref wins.
    if (ra <= rb) this.parent.set(rb, ra)
    else this.parent.set(ra, rb)
  }

  /** Record a reference and its original spelling. */
  add(ref: string): void {
    const norm = normalizeRef(ref)
    if (!norm) return
    this.ensure(norm)
    if (ref.trim()) this.spellings.get(norm)?.add(ref.trim())
  }

  /** Link every reference on an article into one equivalence class. */
  addArticle(article: CatalogArticle): void {
    const refs = [article.reference, ...article.crossRefs].filter(Boolean)
    const norms = refs.map((r) => {
      this.add(r)
      return normalizeRef(r)
    }).filter(Boolean)
    for (let i = 1; i < norms.length; i++) this.union(norms[0], norms[i])
  }

  /** True when the two references resolve to the same equivalence class. */
  areEquivalent(a: string, b: string): boolean {
    const na = normalizeRef(a)
    const nb = normalizeRef(b)
    if (!na || !nb) return false
    if (!this.parent.has(na) || !this.parent.has(nb)) return na === nb
    return this.find(na) === this.find(nb)
  }

  /**
   * All known spellings equivalent to `ref`, sorted. Includes `ref` itself
   * (its own spelling) even when the index has never seen it.
   */
  equivalents(ref: string): string[] {
    const norm = normalizeRef(ref)
    if (!norm) return []
    if (!this.parent.has(norm)) return [ref.trim()].filter(Boolean)
    const root = this.find(norm)
    const out = new Set<string>()
    for (const key of Array.from(this.parent.keys())) {
      if (this.find(key) !== root) continue
      const sp = this.spellings.get(key)
      if (sp && sp.size) for (const s of Array.from(sp)) out.add(s)
      else out.add(key)
    }
    return Array.from(out).sort((a, b) => a.localeCompare(b))
  }
}

/** Build a cross-reference index over a set of articles. */
export function buildCrossRefIndex(articles: CatalogArticle[]): CrossRefIndex {
  const idx = new CrossRefIndex()
  for (const a of articles) idx.addArticle(a)
  return idx
}
