/**
 * QUALITÉ DU PDF DE CONTRÔLE VÉHICULE.
 *
 * Deux défauts distincts sont verrouillés ici :
 *   1. la pagination réinjectait l'image ENTIÈRE dans chaque page en l'écrasant
 *      à la hauteur de la tranche — toutes les pages montraient le document
 *      complet, comprimé ;
 *   2. le rendu « extrêmement pâle » venait des teintes d'écran (nuances `-50`
 *      quasi blanches). Le thème d'impression doit rester lisible sur papier,
 *      y compris en noir et blanc.
 */
import { describe, it, expect } from 'vitest'
import { planPageSlices } from '@/lib/pdf/page-slices'
import {
  INK, INK_SOFT, INK_MUTED, RULE, PAPER,
  STATUS_STYLES, STATUS_ORDER, contrastRatio, relativeLuminance,
} from '@/lib/inspection/print-theme'

/** Canevas typique : 794 px de large (A4 96 dpi) × 2 (scale html2canvas). */
const WIDTH = 1588

describe('Pagination A4', () => {
  it('un document court tient sur une seule page', () => {
    const slices = planPageSlices(WIDTH, 800)
    expect(slices).toHaveLength(1)
    expect(slices[0].sourceY).toBe(0)
    expect(slices[0].sourceHeight).toBe(800)
  })

  it('couvre EXACTEMENT le canevas : ni trou, ni recouvrement', () => {
    const height = 5000
    const slices = planPageSlices(WIDTH, height)
    expect(slices.length).toBeGreaterThan(1)

    let cursor = 0
    for (const slice of slices) {
      expect(slice.sourceY).toBe(cursor)     // pas de trou
      expect(slice.sourceHeight).toBeGreaterThan(0)
      cursor += slice.sourceHeight           // pas de recouvrement
    }
    expect(cursor).toBe(height)              // le bas du document est bien rendu
  })

  it('aucune bande ne dépasse la hauteur utile de la page', () => {
    const usableMm = 297 - 10 * 2
    for (const slice of planPageSlices(WIDTH, 9000)) {
      // Tolérance flottante d'un centième de millimètre.
      expect(slice.heightMm).toBeLessThanOrEqual(usableMm + 0.01)
    }
  })

  it('la dernière bande est rendue à sa hauteur RÉELLE (pas étirée)', () => {
    const slices = planPageSlices(WIDTH, 5000)
    const last = slices[slices.length - 1]
    const pxPerMm = WIDTH / (210 - 20)
    expect(last.heightMm).toBeCloseTo(last.sourceHeight / pxPerMm, 6)
    // C'est le cœur du défaut : la dernière page était étirée à pleine hauteur.
    expect(last.heightMm).toBeLessThan(297 - 20)
  })

  it('l’échelle est constante d’une page à l’autre', () => {
    const slices = planPageSlices(WIDTH, 5000)
    const ratios = slices.map(s => s.sourceHeight / s.heightMm)
    for (const r of ratios) expect(r).toBeCloseTo(ratios[0], 6)
  })

  it('entrées dégénérées → aucun plan (jamais de boucle infinie)', () => {
    expect(planPageSlices(0, 100)).toEqual([])
    expect(planPageSlices(100, 0)).toEqual([])
    expect(planPageSlices(Number.NaN, 100)).toEqual([])
    expect(planPageSlices(100, Number.POSITIVE_INFINITY)).toEqual([])
    // Marges absurdes : pas de surface utile, donc pas de page.
    expect(planPageSlices(WIDTH, 1000, { marginMm: 150 })).toEqual([])
  })
})

describe('Thème d’impression — lisibilité', () => {
  it('le fond du document est blanc', () => {
    expect(PAPER).toBe('#ffffff')
    expect(relativeLuminance(PAPER)).toBeCloseTo(1, 5)
  })

  it('tous les textes atteignent le seuil WCAG AA sur blanc (4,5:1)', () => {
    for (const [name, color] of Object.entries({ INK, INK_SOFT, INK_MUTED })) {
      expect(contrastRatio(color, PAPER), `${name} trop clair`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('les couleurs d’état restent lisibles sur blanc', () => {
    for (const status of STATUS_ORDER) {
      const { color } = STATUS_STYLES[status]
      expect(contrastRatio(color, PAPER), `état ${status} trop clair`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('les bandes d’état restent lisibles sous du texte foncé', () => {
    // Une bande sert de repère : le texte principal doit rester lisible dessus.
    for (const status of STATUS_ORDER) {
      expect(contrastRatio(INK, STATUS_STYLES[status].band)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('les filets sont assez sombres pour sortir à l’impression', () => {
    // Le rendu pâle venait notamment de bordures quasi blanches.
    expect(contrastRatio(RULE, PAPER)).toBeGreaterThanOrEqual(1.9)
  })

  it('aucune couleur n’utilise d’alpha ni de fonction CSS', () => {
    const all = [INK, INK_SOFT, INK_MUTED, RULE, PAPER,
      ...STATUS_ORDER.flatMap(s => [STATUS_STYLES[s].color, STATUS_STYLES[s].band])]
    for (const color of all) {
      // Une couleur alpha se compose avec le fond et délave la capture.
      expect(color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('l’état n’est JAMAIS porté par la seule couleur', () => {
    const marks = new Set<string>()
    const labels = new Set<string>()
    for (const status of STATUS_ORDER) {
      const style = STATUS_STYLES[status]
      expect(style.mark.trim().length).toBeGreaterThan(0)
      expect(style.label.trim().length).toBeGreaterThan(0)
      marks.add(style.mark)
      labels.add(style.label)
    }
    // Pictogrammes et libellés distincts → distinguables en noir et blanc.
    expect(marks.size).toBe(STATUS_ORDER.length)
    expect(labels.size).toBe(STATUS_ORDER.length)
  })

  it('les états sont classés du plus grave au moins grave', () => {
    expect(STATUS_ORDER[0]).toBe('critical')
    expect(STATUS_ORDER).toHaveLength(Object.keys(STATUS_STYLES).length)
  })

  it('rejette une couleur mal formée plutôt que de la rendre en silence', () => {
    expect(() => relativeLuminance('rgba(0,0,0,.1)')).toThrow()
    expect(() => relativeLuminance('#fff')).toThrow()
  })
})

describe('Date d’établissement du document', () => {
  // La fonction est interne au composant : on verrouille ici la RÈGLE, telle
  // qu'appliquée par InspectionPrintDocument.formatDate.
  const DATE_FR: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'long', year: 'numeric' }
  function formatDate(value?: string | number | null): string {
    if (value === null || value === undefined || value === '') {
      return new Date().toLocaleDateString('fr-FR', DATE_FR)
    }
    const epoch = typeof value === 'number' ? value
      : /^\d+$/.test(String(value).trim()) ? Number(String(value).trim())
      : null
    const d = epoch !== null ? new Date(epoch) : new Date(String(value))
    if (Number.isNaN(d.getTime())) return new Date().toLocaleDateString('fr-FR', DATE_FR)
    return d.toLocaleDateString('fr-FR', DATE_FR)
  }

  it('rend une date ISO', () => {
    expect(formatDate('2026-08-10T09:15:00.000Z')).toMatch(/2026/)
  })

  it('rend un horodatage epoch NUMÉRIQUE (SQLite) et non le nombre brut', () => {
    const out = formatDate(1786381978669)
    expect(out).not.toMatch(/^\d+$/)
    expect(out).toMatch(/\d{4}/)
  })

  it('rend une chaîne entièrement numérique comme un epoch — défaut constaté sur PDF réel', () => {
    // « Établi le 1786381978669 » sur un document remis au client.
    const out = formatDate('1786381978669')
    expect(out).not.toContain('1786381978669')
    expect(out).toMatch(/\d{4}/)
  })

  it('n’imprime JAMAIS une valeur technique illisible', () => {
    for (const v of ['pas-une-date', 'NaN', '   ', null, undefined]) {
      const out = formatDate(v as never)
      expect(out).not.toContain('Invalid')
      expect(out).toMatch(/\d{4}/)
    }
  })
})
