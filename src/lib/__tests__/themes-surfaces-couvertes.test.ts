/**
 * GF-014 — un fond codé en dur qu'aucun thème ne rattrape rend l'écran illisible.
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * Le thème clair rattrapait les fonds sombres par une LISTE LITTÉRALE de classes
 * (`[data-theme="light"] .bg-\[\#111827\]`, `…/90`, `…/80`). Huit fonds employés
 * dans vingt-trois fichiers n'y figuraient pas — dont `bg-[#111827]/95`, la carte
 * des écrans de CONNEXION, d'ACTIVATION DE LICENCE et de tout le portail client.
 *
 * Sur ces écrans, deux règles globales s'appliquaient quand même :
 * `[data-theme="light"] .text-white { color:#0f172a }` et
 * `input,textarea,select { color: var(--input-text) }` (#0f172a en clair). Le
 * fond, lui, restait quasi noir : l'utilisateur tapait son mot de passe et ne
 * voyait rien apparaître — contraste calculé 1,12:1. Le titre « Connexion »
 * disparaissait de même.
 *
 * Les thèmes « Night Shift » et « True Tone » n'avaient AUCUNE liste : ils ne
 * changeaient donc quasiment rien, alors qu'ils sont proposés à l'utilisateur.
 *
 * ─── Ce que ce garde vérifie ────────────────────────────────────────────────
 * La PROPRIÉTÉ, pas la liste : tout fond sombre codé en dur dans un composant
 * doit être rattaché à un jeton de thème. Une nouvelle nuance ajoutée demain
 * échoue ici plutôt que dans les mains d'un garagiste.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const CSS = fs.readFileSync(path.join(RACINE, 'src/app/globals.css'), 'utf8')

/** Fonds arbitraires écrits en dur dans les composants : `bg-[#xxxxxx]` (+ variante). */
const MOTIF = /\bbg-\[#([0-9a-fA-F]{3,8})\](\/(?:\[[^\]]+\]|\d+))?/g

function fichiers(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (['node_modules', '__tests__'].includes(e.name)) continue
      fichiers(p, acc)
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) acc.push(p)
  }
  return acc
}

/** Luminance relative approchée — assez pour dire « ce fond est sombre ». */
function estSombre(hex: string): boolean {
  const h = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex.slice(0, 6)
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.25
}

/** La BASE de la classe est-elle rattachée à un jeton, ou surchargée en clair ? */
function couverte(base: string): boolean {
  // Rattachement par sélecteur d'attribut : `[class*="bg-[#111827]"]`.
  if (CSS.includes(`[class*="${base}"]`)) return true
  // Surcharge littérale héritée : `.bg-\[\#111827\]`.
  const echappee = base.replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/#/g, '\\#')
  return CSS.includes(`.${echappee}`)
}

function inventaire() {
  const parBase = new Map<string, Set<string>>()
  for (const f of fichiers(path.join(RACINE, 'src'))) {
    const src = fs.readFileSync(f, 'utf8')
    for (const m of Array.from(src.matchAll(MOTIF))) {
      const base = `bg-[#${m[1]}]`
      if (!estSombre(m[1])) continue
      if (!parBase.has(base)) parBase.set(base, new Set())
      parBase.get(base)!.add(path.relative(RACINE, f).replace(/\\/g, '/'))
    }
  }
  return parBase
}

describe('thèmes — toute surface sombre codée en dur est rattachée (GF-014)', () => {
  it('le détecteur trouve bien des fonds à couvrir (auto-contrôle)', () => {
    const bases = inventaire()
    expect(bases.size, 'aucun fond détecté — le détecteur ne cherche plus au bon endroit').toBeGreaterThan(5)
    expect(Array.from(bases.keys()), 'la carte des écrans de connexion doit être dans l’inventaire')
      .toContain('bg-[#111827]')
  })

  it('aucun fond sombre n’échappe aux thèmes', () => {
    const orphelins = Array.from(inventaire())
      .filter(([base]) => !couverte(base))
      .map(([base, f]) => `${base} — ${Array.from(f).slice(0, 3).join(', ')}${f.size > 3 ? ` (+${f.size - 3})` : ''}`)
    expect(
      orphelins,
      'ces fonds restent sombres quel que soit le thème : le texte y devient illisible',
    ).toEqual([])
  })

  it('les quatre thèmes définissent le jeu COMPLET de jetons de surface', () => {
    const JETONS = [
      '--surface-app', '--surface-app-deep', '--surface-card', '--surface-card-alt',
      '--surface-card-deep', '--surface-panel', '--surface-panel-alt',
      '--surface-panel-strong', '--surface-dropdown',
    ]
    const blocs: Record<string, string> = {}
    for (const [nom, motif] of [
      ['sombre (défaut)', /:root\s*\{([\s\S]*?)\}/],
      ['clair', /\[data-theme="light"\]\s*\{([\s\S]*?)\}/],
      ['night-shift', /\[data-theme="night-shift"\]\s*\{([\s\S]*?)\}/],
      ['true-tone', /\[data-theme="true-tone"\]\s*\{([\s\S]*?)\}/],
    ] as [string, RegExp][]) {
      const m = CSS.match(motif)
      expect(m, `bloc de thème « ${nom} » introuvable`).toBeTruthy()
      blocs[nom] = m![1]
    }
    for (const [nom, corps] of Object.entries(blocs)) {
      const manquants = JETONS.filter((j) => !corps.includes(`${j}:`))
      expect(manquants, `thème « ${nom} » : jetons de surface manquants`).toEqual([])
    }
  })

  it('en thème SOMBRE, les jetons valent exactement les couleurs d’origine', () => {
    // C'est la garantie de non-régression visuelle : le rattachement ne doit
    // rien changer sur le thème par défaut.
    const bloc = CSS.match(/:root\s*\{([\s\S]*?)\}/)![1]
    const attendu: Record<string, string> = {
      '--surface-app': '#0f1629',
      '--surface-app-deep': '#0a0f1e',
      '--surface-card': '#111827',
      '--surface-panel': '#161f38',
      '--surface-dropdown': '#1a2235',
    }
    for (const [jeton, couleur] of Object.entries(attendu)) {
      expect(bloc, `${jeton} doit valoir ${couleur} en thème sombre`)
        .toMatch(new RegExp(`${jeton}\\s*:\\s*${couleur}\\s*;`, 'i'))
    }
  })
})
