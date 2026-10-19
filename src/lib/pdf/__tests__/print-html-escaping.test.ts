/**
 * GF31-AUD-011 — le document d'impression ne doit jamais exécuter la saisie.
 *
 * `printHtmlDocument` injecte le document par `doc.write()` dans une iframe de
 * **même origine** (voir `print-html.ts`) : tout `<script>` qui s'y trouve
 * s'exécute donc dans l'origine de l'application — et sous Electron, dans le
 * renderer, d'où part toute la surface IPC. L'ordre de réparation interpolait
 * pourtant sans échappement le nom du client, son téléphone, son adresse, la
 * marque et le modèle du véhicule, l'immatriculation, les notes, le libellé de
 * chaque ligne de main-d'œuvre, le nom et la référence de chaque pièce, ainsi
 * que l'URL de la signature dans un attribut `src`.
 *
 * Il suffisait donc d'enregistrer un client nommé `<img src=x onerror=…>` puis
 * d'imprimer : XSS stocké, déclenché par le garagiste lui-même.
 */
import { describe, it, expect } from 'vitest'
import { escapeHtml, safeImageSrc } from '@/lib/pdf/print-html'

describe('escapeHtml', () => {
  it('neutralise une balise script', () => {
    expect(escapeHtml('<script>alert(1)</script>'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('neutralise un gestionnaire d’événement injecté par une balise', () => {
    const charge = '<img src=x onerror="fetch(\'//evil\')">'
    const sortie = escapeHtml(charge)
    expect(sortie).not.toContain('<img')
    expect(sortie).not.toContain('"')
  })

  it('reste sûr À L’INTÉRIEUR d’un attribut quoté (guillemets simples ET doubles)', () => {
    // Une échappée qui oublierait l'apostrophe laisserait passer
    // `' onmouseover='alert(1)` dans un attribut quoté par des apostrophes.
    const sortie = escapeHtml(`" onmouseover="alert(1)" x='y`)
    expect(sortie).not.toContain('"')
    expect(sortie).not.toContain("'")
    expect(sortie).toContain('&quot;')
    expect(sortie).toContain('&#39;')
  })

  it('échappe l’esperluette AVANT le reste (pas de double décodage)', () => {
    expect(escapeHtml('&lt;script&gt;')).toBe('&amp;lt;script&amp;gt;')
  })

  it('rend la chaîne vide pour null / undefined plutôt que « null »', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })

  it('laisse intact un texte ordinaire, accents compris', () => {
    expect(escapeHtml('Sté Dupont & Fils — Citroën C3')).toBe('Sté Dupont &amp; Fils — Citroën C3')
  })
})

describe('safeImageSrc', () => {
  it('accepte une image inline produite par l’application', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
    expect(safeImageSrc(png)).toBe(png)
  })

  it('rejette javascript: et tout autre schéma', () => {
    expect(safeImageSrc('javascript:alert(1)')).toBe('')
    expect(safeImageSrc('https://evil.example/x.png')).toBe('')
    expect(safeImageSrc('data:text/html;base64,PHNjcmlwdD4=')).toBe('')
  })

  it('rejette une valeur qui tenterait de sortir de l’attribut', () => {
    expect(safeImageSrc('data:image/png;base64,AAA" onerror="alert(1)')).toBe('')
  })

  it('rejette null, undefined et une valeur non textuelle', () => {
    expect(safeImageSrc(null)).toBe('')
    expect(safeImageSrc(undefined)).toBe('')
    expect(safeImageSrc(42)).toBe('')
  })
})

/**
 * Garde de NON-RÉGRESSION à la source : le document imprimé ne doit plus jamais
 * interpoler une donnée saisie sans passer par `escapeHtml`. Un test sur le
 * helper seul ne protégerait pas d'un futur `${clientName}` réintroduit dans le
 * gabarit — c'est pourtant exactement la forme qu'avait le défaut.
 */
describe('GF31-AUD-011 — le gabarit d’impression n’interpole aucune saisie brute', () => {
  const CHAMPS_UTILISATEUR = [
    'clientName', 'clientPhone', 'clientAddress',
    'vehicleMake', 'vehicleModel', 'licensePlate',
    'notes', 'savedNumber',
    'w.description', 'p.name', 'p.reference',
    'existingSig',
  ]

  it('aucune interpolation brute d’un champ utilisateur dans WorkOrderModal', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const src = readFileSync(
      path.resolve(__dirname, '../../../components/WorkOrderModal.tsx'),
      'utf8',
    )
    const fautives: string[] = []
    for (const champ of CHAMPS_UTILISATEUR) {
      // `${champ}` ou `${champ || '…'}` — c'est-à-dire une interpolation du champ
      // SANS appel d'échappement autour. Écrit avec `String.raw` : une chaîne
      // ordinaire perdrait les antislashs et le motif ne trouverait plus rien,
      // ce qui rendrait ce garde-fou faussement vert.
      const nom = champ.replace('.', String.raw`\.`)
      const motif = new RegExp(String.raw`\$\{\s*` + nom + String.raw`\s*(\|\|[^}]*)?\}`)
      if (motif.test(src)) fautives.push(champ)
    }
    expect(fautives).toEqual([])
  })

  it('le gabarit importe bien les helpers d’échappement', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const src = readFileSync(
      path.resolve(__dirname, '../../../components/WorkOrderModal.tsx'),
      'utf8',
    )
    expect(src).toContain("escapeHtml as e")
    expect(src).toContain('safeImageSrc')
  })
})
