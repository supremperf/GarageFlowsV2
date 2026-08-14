/**
 * GF-DUR-027 — un fichier de route n'exporte QUE ce que Next.js autorise.
 *
 * ─── Le défaut que ce garde empêche de revenir ──────────────────────────────
 * `src/app/api/portal/auth/password/route.ts` exportait une fonction utilitaire
 * (`motDePasseAcceptable`) et une constante à côté de son `PUT`. L'App Router
 * n'accepte, dans un fichier de route, que ses verbes HTTP et une courte liste
 * d'options de segment. Tout autre export fait ÉCHOUER `next build` :
 *
 *     Type error: Property 'motDePasseAcceptable' is incompatible with
 *     index signature. […] is not assignable to type 'never'.
 *
 * ─── Pourquoi 2 800 tests verts ne l'ont pas vu ─────────────────────────────
 * Parce qu'aucun n'exerce l'étape de build. Les tests importent la route
 * directement — un export supplémentaire leur est même commode. Le contrôle
 * n'existe que dans la vérification de types que Next.js génère lui-même, à un
 * moment que la suite ne traverse jamais.
 *
 * Et l'aval en dépend entièrement : sans `next build`, pas de paquet Electron,
 * pas de déploiement PWA, pas de mise à jour du parc. Un défaut qui bloque tout
 * en aval et qu'aucun test ne voit mérite son propre garde — celui-ci lit les
 * fichiers, comme le fera Next.js.
 *
 * ─── Ce que le garde NE fait pas ────────────────────────────────────────────
 * Il ne remplace pas `next build` : il n'attrape que cette famille-là. Elle
 * suffit à justifier son existence, parce qu'elle est silencieuse, facile à
 * réintroduire (« je mets le helper à côté de son seul appelant »), et qu'elle
 * ne se manifeste qu'au moment le plus coûteux.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const APP = path.join(RACINE, 'src/app')

/**
 * Exports tolérés par Next.js dans un `route.ts`.
 * Source : verbes HTTP + options de segment de l'App Router (Next 14).
 */
const AUTORISES = new Set([
  'GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS',
  'dynamic', 'dynamicParams', 'revalidate', 'fetchCache', 'runtime',
  'preferredRegion', 'maxDuration', 'generateStaticParams',
])

function fichiersRoute(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) fichiersRoute(p, acc)
    else if (e.name === 'route.ts' || e.name === 'route.tsx') acc.push(p)
  }
  return acc
}

/** Retire commentaires et littéraux de gabarit — un `export` cité n'en est pas un. */
function sansCommentaires(src: string): string {
  return src.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Noms exportés par un module, hors `export default` et ré-exports. */
function nomsExportes(src: string): string[] {
  const noms: string[] = []
  const propre = sansCommentaires(src)
  // export const X / export function X / export async function X / export class X
  for (const m of Array.from(propre.matchAll(/^\s*export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm))) {
    noms.push(m[1])
  }
  // export { A, B as C }
  for (const m of Array.from(propre.matchAll(/^\s*export\s*\{([^}]*)\}/gm))) {
    for (const morceau of m[1].split(',')) {
      const t = morceau.trim()
      if (!t) continue
      const alias = t.split(/\s+as\s+/i)
      noms.push((alias[1] ?? alias[0]).trim())
    }
  }
  return noms
}

describe('les fichiers de route n’exportent que ce que Next.js accepte', () => {
  const routes = fichiersRoute(APP)

  it('le corpus est non vide — sinon ce garde ne prouverait rien', () => {
    expect(routes.length).toBeGreaterThan(50)
  })

  it('aucun export interdit dans aucun route.ts', () => {
    const fautifs: string[] = []
    for (const f of routes) {
      const src = fs.readFileSync(f, 'utf8')
      // Les types ne sont pas émis : `export type X` / `export interface X` ne
      // gênent pas le build. On ne retient que les valeurs.
      const propre = sansCommentaires(src).replace(/^\s*export\s+(?:type|interface)\s+[\s\S]*?(?=^\s*(?:export|const|function|async|class|import|\/\*|$))/gm, '')
      for (const nom of nomsExportes(propre)) {
        if (!AUTORISES.has(nom)) {
          fautifs.push(`${path.relative(RACINE, f).replace(/\\/g, '/')} → ${nom}`)
        }
      }
    }
    expect(fautifs, 'déplacez ces symboles dans src/lib/ : ils font échouer `next build`').toEqual([])
  })
})

/**
 * Deuxième membre de la même famille : `useSearchParams` sans frontière Suspense.
 *
 * `next build` refuse de prérendre une page qui l'appelle hors d'un `<Suspense>` :
 *
 *     useSearchParams() should be wrapped in a suspense boundary
 *     at page "/clients/password"
 *
 * C'est arrivé sur la page de définition du mot de passe du portail — celle qui
 * sert à débloquer un client enfermé dehors. Le build de TOUTE l'application
 * s'arrêtait dessus. `/login` portait pourtant déjà le motif correct : ce n'est
 * pas une subtilité inconnue du dépôt, seulement une étape oubliée que rien ne
 * rappelait.
 */
describe('aucune page n’appelle useSearchParams hors d’une frontière Suspense', () => {
  function pages(dir: string, acc: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) pages(p, acc)
      else if (/^page\.tsx?$/.test(e.name)) acc.push(p)
    }
    return acc
  }

  it('chaque page concernée porte un <Suspense> ou se déclare dynamique', () => {
    const fautives: string[] = []
    for (const f of pages(path.join(RACINE, 'src/app'))) {
      const src = sansCommentaires(fs.readFileSync(f, 'utf8'))
      if (!/useSearchParams\s*\(/.test(src)) continue
      // Deux échappatoires acceptées par Next : encadrer d'un <Suspense>, ou
      // renoncer au prérendu de la page.
      const protege = /<Suspense[\s>]/.test(src) || /export const dynamic\s*=\s*'force-dynamic'/.test(src)
      if (!protege) fautives.push(path.relative(RACINE, f).replace(/\\/g, '/'))
    }
    expect(fautives, 'ces pages font échouer `next build` au prérendu').toEqual([])
  })
})
