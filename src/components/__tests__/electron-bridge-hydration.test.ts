/**
 * Régression : erreurs d'hydratation React #418 / #423 au démarrage sous Electron.
 *
 * ── Le défaut ────────────────────────────────────────────────────────────────
 *
 * React hydrate en comparant le PREMIER rendu client au HTML produit par le
 * serveur. Le serveur n'a pas de `window` ; le client, sous Electron, voit déjà
 * `window.electronAPI` dès son premier rendu. Tout composant qui lit `window`
 * PENDANT le rendu produit donc deux sorties différentes et fait échouer
 * l'hydratation :
 *   #418 « Hydration failed because the initial UI does not match what was
 *         rendered on the server »
 *   #423 « There was an error while hydrating […] the entire root will switch
 *         to client rendering » — React JETTE le HTML serveur et re-rend TOUT.
 *
 * Observé en continu dans garageflow.log depuis le 30/07/2026, à chaque
 * démarrage : `NotificationCenter` (layout racine → toutes les pages) et
 * `WindowControls` (Header → pages authentifiées) pilotaient un `return null`
 * à partir de `window.electronAPI` lu au rendu.
 *
 * ── Ce qui est vérifié ───────────────────────────────────────────────────────
 *
 * 1. Le comportement RÉEL du correctif (`useElectronApi`) : rendu par
 *    `renderToString`, qui n'exécute jamais les effets et modélise donc
 *    exactement le premier rendu.
 * 2. Un TÉMOIN reproduisant l'ancien patron, qui doit être détecté comme
 *    divergent — sans lui, un test toujours vert ne prouverait rien.
 * 3. Des gardes de source sur les trois composants corrigés. Les importer
 *    directement est impossible ici : `tsconfig.json` fixe `jsx: "preserve"`
 *    (Next.js compile lui-même le JSX), donc Vitest ne transforme pas les
 *    `.tsx` ; y remédier imposerait une dépendance supplémentaire
 *    (@vitejs/plugin-react) et invaliderait le SBOM et l'audit de licences.
 *    On verrouille donc la source, comme le fait déjà electron-loopback.test.ts.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createElement, useState } from 'react'
import { renderToString } from 'react-dom/server'
import fs from 'fs'
import path from 'path'

import { useElectronApi } from '@/lib/use-electron-api'

/** Pont Electron minimal. */
const FAKE_BRIDGE = { isElectron: true, getNotifications: async () => ({ notifications: [] }) }

/**
 * Rend `element` comme le ferait le PREMIER rendu, avec ou sans pont Electron.
 * En environnement node `window` est absent : le définir simule le client,
 * l'omettre simule le serveur.
 */
function firstRender(element: Parameters<typeof renderToString>[0], withBridge: boolean): string {
  const g = globalThis as unknown as { window?: unknown }
  const had = 'window' in g
  const previous = g.window
  try {
    if (withBridge) g.window = { electronAPI: FAKE_BRIDGE }
    else delete g.window
    return renderToString(element)
  } finally {
    if (had) g.window = previous
    else delete g.window
  }
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window
})

// ── 1. Comportement réel du correctif ───────────────────────────────────────
describe('useElectronApi — neutralité du premier rendu', () => {
  function Probe() {
    const api = useElectronApi()
    return createElement('i', null, api === null ? 'absent' : 'present')
  }

  it('renvoie null au premier rendu MÊME quand window.electronAPI existe', () => {
    expect(firstRender(createElement(Probe), true)).toContain('absent')
  })

  it('produit exactement la même sortie avec et sans pont', () => {
    expect(firstRender(createElement(Probe), true)).toBe(firstRender(createElement(Probe), false))
  })
})

// ── 2. Témoin : la méthode de détection a bien du mordant ───────────────────
describe('témoin — l’ancien patron est bien détecté comme divergent', () => {
  it('lire window pendant le rendu fait diverger les deux sorties', () => {
    // Reproduit le code d'origine de NotificationCenter. Si cette assertion
    // venait à passer, les tests ci-dessus seraient verts à tort.
    function AncienPatron() {
      const [, setOpen] = useState(false)
      void setOpen
      const api =
        typeof window === 'undefined'
          ? null
          : ((globalThis as { window?: { electronAPI?: { getNotifications?: unknown } } }).window
              ?.electronAPI ?? null)
      if (!api?.getNotifications) return null
      return createElement('div', null, 'cloche')
    }

    const sansPont = firstRender(createElement(AncienPatron), false)
    const avecPont = firstRender(createElement(AncienPatron), true)

    expect(sansPont).toBe('')
    expect(avecPont).toContain('cloche')
    expect(avecPont).not.toBe(sansPont) // ← la divergence que React refuse
  })
})

// ── 3. Gardes de source sur les composants corrigés ─────────────────────────
describe('composants du chemin d’hydratation — aucune lecture de window au rendu', () => {
  const ROOT = path.resolve(__dirname, '../..')

  /** Fichiers dont le rendu dépendait de la présence du pont Electron. */
  const GUARDED = [
    // Layout racine → présent sur toutes les pages, dont /login.
    'components/NotificationCenter.tsx',
    // Header → toutes les pages authentifiées.
    'components/WindowControls.tsx',
    // Le provider pilote hasModule(), donc le rendu de ses descendants.
    'lib/entitlements.tsx',
  ]

  for (const rel of GUARDED) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')

    it(`${rel} passe par useElectronApi`, () => {
      expect(src).toContain('useElectronApi')
    })

    it(`${rel} ne lit plus window.electronAPI hors d’un effet`, () => {
      // Toute lecture directe du pont doit avoir disparu de ces fichiers :
      // useElectronApi est le SEUL point d'accès autorisé (il diffère la
      // lecture après montage). La regex couvre `window.electronAPI` et
      // `(window as any).electronAPI`.
      expect(src).not.toMatch(/window[^\n]{0,40}\)?\s*\.\s*electronAPI/)
    })
  }
})
