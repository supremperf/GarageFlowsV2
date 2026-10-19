/**
 * GF-002 (moitié interface) — une fiche d'intervention ne demande qu'UN lien
 * portail, et n'en propose la diffusion que s'il est publié.
 *
 * Deux composants appelaient `/api/portal/generate` chacun de leur côté pour le
 * MÊME jobId : `<JobQRCode>` et `usePortalUrl`. Sur un poste installé chaque
 * appel publie l'instantané au cloud ; la publication révoquant alors la
 * précédente, le QR code affiché pointait déjà vers un lien mort.
 *
 * Le serveur ne révoque plus (l'instantané vivant est réemployé), mais la
 * duplication reste un défaut en soi : deux requêtes concurrentes pour la même
 * chose, et deux sources d'URL qui peuvent diverger à la prochaine évolution.
 * Ce garde-fou fige la forme corrigée.
 *
 * Il vérifie aussi que `cloudPublished` — le champ par lequel le serveur avoue
 * qu'il n'a PAS publié — est réellement lu. Il ne l'était par personne :
 * l'interface affichait un lien inutilisable comme si de rien n'était.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const lire = (rel: string) => fs.readFileSync(path.join(RACINE, rel), 'utf8')

/**
 * Retire les commentaires pour ne compter que du code réel.
 *
 * ORDRE IMPOSÉ : les lignes `//` d'abord, les blocs ensuite (GF-DUR-046). Faire
 * l'inverse laisse un `/*` écrit dans un commentaire de ligne ouvrir un faux
 * bloc qui avale le code suivant — et ce garde-fou conclurait alors à tort qu'il
 * n'y a plus qu'un seul appelant.
 */
function sansCommentaires(src: string): string {
  return src
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
}

/** Tous les fichiers .ts/.tsx de src/, hors tests. */
function sources(dir = path.join(RACINE, 'src'), acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue
      sources(p, acc)
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) acc.push(p)
  }
  return acc
}

describe('lien portail — une seule génération par fiche (GF-002)', () => {
  it('un seul appel à /api/portal/generate dans tout le code client', () => {
    const appelants = sources()
      .map((f) => ({ rel: path.relative(RACINE, f).replace(/\\/g, '/'), src: sansCommentaires(fs.readFileSync(f, 'utf8')) }))
      .flatMap(({ rel, src }) => {
        const n = (src.match(/['"`]\/api\/portal\/generate['"`]/g) ?? []).length
        return n ? [{ rel, n }] : []
      })

    expect(appelants, 'un seul module doit générer le lien portail').toEqual([
      { rel: 'src/components/JobQRCode.tsx', n: 1 },
    ])
  })

  it('le composant QR code n’émet plus de requête : il reçoit l’URL', () => {
    const src = sansCommentaires(lire('src/components/JobQRCode.tsx'))
    const debut = src.indexOf('export function JobQRCode')
    expect(debut, 'composant JobQRCode introuvable').toBeGreaterThan(-1)
    expect(src.slice(debut), 'JobQRCode ne doit contenir aucun fetch').not.toMatch(/\bfetch\s*\(/)
    expect(src.slice(debut), 'JobQRCode doit recevoir l’URL en propriété').toMatch(/url\s*[,:}]/)
  })

  it('le champ cloudPublished du serveur est réellement lu', () => {
    // Le serveur le renvoie exprès pour que l'interface puisse dire la vérité
    // au lieu d'annoncer un faux succès (cf. /api/portal/generate).
    expect(sansCommentaires(lire('src/components/JobQRCode.tsx'))).toContain('cloudPublished')
  })

  it('la fiche d’intervention passe par le hook unique', () => {
    const src = sansCommentaires(lire('src/components/job-modal/JobModalFooter.tsx'))
    expect(src).toContain('usePortalLink')
    expect(src, 'l’ancien hook dupliquant la requête ne doit plus être utilisé').not.toContain('usePortalUrl')
  })

  it('un lien non publié n’est ni copiable ni encodé en QR code', () => {
    const src = sansCommentaires(lire('src/components/job-modal/JobModalFooter.tsx'))
    // La condition de diffusion doit dépendre de l'état, pas de la seule
    // présence d'une URL — une URL est renvoyée même quand la publication a
    // échoué.
    expect(src).toMatch(/etat\s*===\s*'pret'/)
    expect(src, 'le QR code doit être alimenté par l’URL conditionnée').toMatch(/JobQRCode[\s\S]{0,80}url=\{/)
    expect(src, 'un avertissement doit être affiché quand la publication a échoué')
      .toContain('jmPortalNotPublished')
  })
})
