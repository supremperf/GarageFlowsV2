/**
 * CONTRASTE DES CHAMPS — non-régression du bug « texte blanc sur fond blanc »
 * de la modale « Contrôle véhicule ».
 *
 * Ce test ne relit pas le CSS source : il COMPILE réellement globals.css avec
 * Tailwind et la configuration du projet, puis REJOUE LA CASCADE sur l'arbre
 * exact de la modale :
 *
 *     <html class="dark" data-theme="dark">   ← posé par applyTheme() pour le
 *       <div class="gf-surface-light bg-white">   thème par défaut
 *         <input>                             ← Client / Véhicule / Plaque / Km
 *
 * C'est ce chemin précis qui échouait : `.dark input {color:#f8fafc!important}`
 * et `.bg-white input {color:#111827!important}` ont la MÊME spécificité (0,1,1)
 * et sont toutes deux `!important` — la dernière déclarée gagnait, et c'était la
 * blanche. Le test vérifie donc le VAINQUEUR de la cascade, pas la présence
 * d'une règle.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'

const ROOT = path.resolve(__dirname, '../../..')

let css = ''

beforeAll(async () => {
  const postcss = (await import('postcss')).default
  const tailwind = (await import('tailwindcss')).default
  const source = fs.readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8')
  const result = await postcss([
    tailwind({ config: path.join(ROOT, 'tailwind.config.ts') }),
  ]).process(source, { from: path.join(ROOT, 'src/app/globals.css') })
  // Les commentaires sont retirés AVANT analyse : un commentaire contenant des
  // virgules serait sinon pris pour une liste de sélecteurs.
  css = result.css.replace(/\/\*[\s\S]*?\*\//g, '')
}, 120_000)

// ── Mini-modèle d'éléments + moteur de cascade ────────────────────────────────

interface El { tag: string; classes: string[]; attrs: Record<string, string>; parent?: El }

const html: El = { tag: 'html', classes: ['dark'], attrs: { 'data-theme': 'dark' } }
const htmlLight: El = { tag: 'html', classes: ['light'], attrs: { 'data-theme': 'light' } }

function surface(root: El, classes: string[]): El {
  return { tag: 'div', classes, attrs: {}, parent: root }
}
function field(parent: El, classes: string[] = [], tag = 'input'): El {
  return { tag, classes, attrs: {}, parent }
}

/**
 * Découpe un compound en jetons, en tenant compte des ÉCHAPPEMENTS Tailwind
 * (`.bg-\[\#111827\]`, `.hover\:bg-white`) : un `\x` vaut le littéral `x` et ne
 * démarre jamais un nouveau jeton.
 */
function tokenizeCompound(compound: string): string[] {
  const tokens: string[] = []
  let cur = ''
  let i = 0
  const push = () => { if (cur) tokens.push(cur); cur = '' }
  while (i < compound.length) {
    const ch = compound[i]
    if (ch === '\\') { cur += compound[i + 1] ?? ''; i += 2; continue }
    if (ch === '[') {
      push()
      cur = '['
      i++
      while (i < compound.length && compound[i] !== ']') {
        if (compound[i] === '\\') { cur += compound[i + 1] ?? ''; i += 2; continue }
        cur += compound[i]; i++
      }
      cur += ']'; i++
      push()
      continue
    }
    if (ch === '.' || ch === '#' || ch === ':') { push(); cur = ch; i++; continue }
    cur += ch
    i++
  }
  push()
  return tokens
}

/** Un compound simple (`div.bg-white`, `[data-theme=light]`, `input`) matche-t-il ? */
function matchesCompound(el: El, compound: string): boolean {
  const tokens = tokenizeCompound(compound.trim())
  if (tokens.length === 0) return false
  for (const tk of tokens) {
    if (tk.startsWith('.')) {
      if (!el.classes.includes(tk.slice(1))) return false
    } else if (tk.startsWith('#')) {
      if (el.attrs.id !== tk.slice(1)) return false
    } else if (tk.startsWith('[')) {
      const m = tk.match(/^\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]$/)
      if (!m) return false
      const [, name, value] = m
      if (el.attrs[name] === undefined) return false
      if (value !== undefined && el.attrs[name] !== value) return false
    } else if (tk.startsWith(':')) {
      // `:root` ne s'applique qu'à la racine ; tout autre pseudo (hover,
      // ::placeholder, :disabled…) est hors du périmètre de ce test.
      if (tk !== ':root' || el.tag !== 'html') return false
    } else if (/^[a-zA-Z*]/.test(tk)) {
      if (tk !== '*' && el.tag !== tk) return false
    } else {
      return false // jeton inattendu ⇒ on ne prétend pas matcher
    }
  }
  return true
}

/** Sélecteur descendant simple (espaces uniquement) évalué de droite à gauche. */
function matches(el: El, selector: string): boolean {
  if (/[>+~]/.test(selector)) return false // aucun dans les règles visées
  const parts = selector.trim().split(/\s+/)
  let node: El | undefined = el
  if (!matchesCompound(node, parts[parts.length - 1])) return false
  for (let i = parts.length - 2; i >= 0; i--) {
    node = node?.parent
    let found = false
    while (node) {
      if (matchesCompound(node, parts[i])) { found = true; break }
      node = node.parent
    }
    if (!found) return false
  }
  return true
}

/** Spécificité (a,b,c) condensée en un entier comparable. */
function specificity(selector: string): number {
  let ids = 0, cls = 0, tags = 0
  for (const compound of selector.trim().split(/\s+/)) {
    for (const tk of tokenizeCompound(compound)) {
      if (tk.startsWith('#')) ids++
      else if (tk.startsWith('.') || tk.startsWith('[') || tk.startsWith(':')) cls++
      else if (/^[a-zA-Z]/.test(tk)) tags++
    }
  }
  return ids * 10_000 + cls * 100 + tags
}

interface Decl { selector: string; value: string; important: boolean; order: number; spec: number }

/** Toutes les déclarations d'une propriété qui s'appliquent à `el`, dans l'ordre. */
function declarationsFor(el: El, property: string): Decl[] {
  const out: Decl[] = []
  let order = 0
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = ruleRe.exec(css))) {
    const selectorList = m[1].trim()
    const body = m[2]
    if (selectorList.startsWith('@')) continue
    order++
    // Propriété exacte (pas `-webkit-…` quand on demande `color`).
    const declRe = new RegExp(`(?:^|;)\\s*${property.replace(/[-[\]{}()*+?.,\\^$|#]/g, '\\$&')}\\s*:\\s*([^;]+)`, 'i')
    const dm = body.match(declRe)
    if (!dm) continue
    for (const sel of selectorList.split(',')) {
      const s = sel.trim()
      if (!matches(el, s)) continue
      const raw = dm[1].trim()
      out.push({
        selector: s,
        value: raw.replace(/!important$/i, '').trim(),
        important: /!important$/i.test(raw),
        order,
        spec: specificity(s),
      })
      break
    }
  }
  return out
}

/** Vainqueur de la cascade : !important, puis spécificité, puis ordre d'apparition. */
function winner(el: El, property: string): Decl | null {
  const decls = declarationsFor(el, property)
  if (decls.length === 0) return null
  return decls.reduce((best, d) => {
    if (d.important !== best.important) return d.important ? d : best
    if (d.spec !== best.spec) return d.spec > best.spec ? d : best
    return d.order >= best.order ? d : best
  })
}

/**
 * Valeur EFFECTIVE d'une variable CSS : l'élément le plus PROCHE qui la définit
 * l'emporte (héritage), et une valeur `var(--autre)` est substituée à son tour
 * DANS LE CONTEXTE de l'élément qui porte la déclaration — exactement la
 * sémantique CSS.
 */
function resolveVar(el: El, name: string, depth = 0): string | null {
  if (depth > 8) return null
  let node: El | undefined = el
  while (node) {
    const w = winner(node, name)
    if (w) {
      const ref = w.value.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)$/)
      if (ref) return resolveVar(node, ref[1], depth + 1) ?? (ref[2]?.trim() || null)
      return w.value
    }
    node = node.parent
  }
  return null
}

/** Luminance relative → contraste WCAG. */
function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

// ── Les tests ────────────────────────────────────────────────────────────────

describe('règle de couleur des champs : source UNIQUE', () => {
  it('le vainqueur de la cascade est toujours `var(--input-text)`', () => {
    const el = field(surface(html, ['gf-surface-light', 'bg-white']))
    expect(winner(el, 'color')?.value).toBe('var(--input-text)')
  })

  it('plus aucune règle `.dark input` ne force une couleur (cause du bug)', () => {
    expect(/\.dark\s+(input|select|textarea)[^{]*\{[^}]*color\s*:/.test(css)).toBe(false)
  })
})

describe('modale « Contrôle véhicule » — les 4 champs sont lisibles', () => {
  // Client / Véhicule / Immatriculation / Kilométrage : carte blanche, thème
  // sombre par défaut (celui où le bug se produisait).
  const cases: Array<[string, El]> = [
    ['thème sombre (défaut)', field(surface(html, ['gf-surface-light', 'bg-white']))],
    ['thème clair', field(surface(htmlLight, ['gf-surface-light', 'bg-white']))],
  ]

  for (const [label, el] of cases) {
    it(`${label} : texte sombre sur blanc, contraste AAA`, () => {
      const color = resolveVar(el, '--input-text')
      expect(color).toBe('#0f172a')
      expect(contrast(color!, '#ffffff')).toBeGreaterThan(7)
    })

    it(`${label} : placeholder lisible (AA)`, () => {
      const ph = resolveVar(el, '--input-placeholder')
      expect(contrast(ph!, '#ffffff')).toBeGreaterThanOrEqual(2.5)
    })
  }

  it('champ IMBRIQUÉ dans une carte claire teintée (ligne de checklist)', () => {
    // Le champ « observation » d'un point de contrôle vit dans un conteneur
    // `bg-emerald-50` lui-même dans la zone blanche : les variables héritent.
    const modal = surface(html, ['gf-surface-light', 'bg-white'])
    const row = surface(modal, ['bg-emerald-50'])
    expect(resolveVar(field(row), '--input-text')).toBe('#0f172a')
  })

  it('textarea (notes générales) suit la même règle', () => {
    const el = field(surface(html, ['gf-surface-light', 'bg-white']), [], 'textarea')
    expect(winner(el, 'color')?.value).toBe('var(--input-text)')
    expect(resolveVar(el, '--input-text')).toBe('#0f172a')
  })
})

describe('la correction ne casse AUCUN thème sombre', () => {
  const dark: Array<[string, El, string]> = [
    ['dark', html, '#f8fafc'],
    ['night-shift', { tag: 'html', classes: ['dark'], attrs: { 'data-theme': 'night-shift' } }, '#fde68a'],
    ['true-tone', { tag: 'html', classes: ['dark'], attrs: { 'data-theme': 'true-tone' } }, '#e0f2fe'],
  ]

  for (const [name, root, expected] of dark) {
    it(`thème « ${name} » : champ sur surface sombre garde sa couleur de thème`, () => {
      const el = field(surface(root, ['bg-[#111827]']))
      expect(resolveVar(el, '--input-text')).toBe(expected)
    })
  }

  it('un panneau sombre IMBRIQUÉ dans une carte claire rétablit le thème', () => {
    const el = field(surface(surface(html, ['bg-white']), ['gf-surface-dark']))
    expect(resolveVar(el, '--input-text')).toBe('#f8fafc')
  })
})

describe('surfaces claires reconnues', () => {
  const light = ['bg-white', 'bg-gray-50', 'bg-gray-100', 'bg-slate-50', 'bg-emerald-50', 'bg-amber-50', 'bg-red-50', 'bg-blue-50', 'invoice-light', 'gf-surface-light']
  for (const cls of light) {
    it(`« ${cls} » impose un texte de champ sombre`, () => {
      expect(resolveVar(field(surface(html, [cls])), '--input-text')).toBe('#0f172a')
    })
  }

  it('un champ portant LUI-MÊME la classe de fond clair est couvert', () => {
    // Cas de la recherche « Stock pièces » : `bg-white` posé sur l'input.
    const el = field(surface(html, ['bg-[#111827]']), ['bg-white'])
    expect(resolveVar(el, '--input-text')).toBe('#0f172a')
  })
})
