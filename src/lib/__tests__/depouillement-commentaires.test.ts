/**
 * GF-DUR-046 — un dépouillement de commentaires qui avale du code aveugle les
 * gardes qui s'en servent.
 *
 * ─── Comment le défaut s'est manifesté ──────────────────────────────────────
 * Un outil d'analyse concluait « `/api/admin/licenses/generate` n'a pas de
 * limitation de débit » sur une route qui venait d'en recevoir une. Cause : son
 * dépouillement retirait les blocs AVANT les lignes, et un commentaire de ligne
 * contenant un chemin à joker (`admin/licenses/` suivi d'une étoile) ouvrait un
 * faux bloc que la regex refermait 3 102 caractères plus loin — emportant
 * l'appel cherché.
 *
 * Cinq fichiers du dépôt déclenchent ce motif. Vérifié à l'époque : aucun
 * chemin `/api/…` ne disparaissait du corpus d'appelants, donc l'inventaire des
 * routes orphelines n'a jamais été faussé. Mais cela ne tenait qu'à l'endroit où
 * l'on écrit ses commentaires — pas à une propriété du code.
 *
 * ─── Et la correction évidente était FAUSSE ─────────────────────────────────
 * Inverser bêtement l'ordre a produit pire. Le dépouillement de
 * `routes-sans-appelant` filtrait aussi les lignes commençant par `*` : les
 * retirer AVANT les blocs supprime le marqueur de FERMETURE des blocs JSDoc,
 * qui courent alors jusqu'au suivant. Mesuré : 26 routes bien vivantes — dont
 * `/api/jobs/pulse` et le chrono du mécanicien — déclarées orphelines.
 *
 * La règle correcte est donc plus fine que « lignes d'abord » :
 *
 *   1. retirer les lignes ENTIÈREMENT en commentaire `//` ;
 *   2. retirer les blocs d'un seul tenant — leurs lignes `*` partent avec ;
 *   3. ne JAMAIS filtrer les lignes `*` avant l'étape 2.
 *
 * ─── Ce que ce fichier vérifie ──────────────────────────────────────────────
 * La propriété, sur des cas construits — pas la forme du code. Un
 * dépouillement correct doit préserver le code quel que soit ce qu'on écrit
 * dans les commentaires.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')

/** Le dépouillement de référence, tel qu'il doit être. */
function sansCommentaires(src: string): string {
  return src
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
}

describe('dépouillement des commentaires : le code survit (GF-DUR-046)', () => {
  it('un début de bloc écrit dans un commentaire de ligne n’avale rien', () => {
    // Le cas exact qui a menti : un chemin à joker dans un `//`.
    const src = [
      '// voir admin/licenses/*',
      "const garde = enforceRateLimit('admin')",
      '/** vraie doc */',
      'const suite = 1',
    ].join('\n')
    const propre = sansCommentaires(src)
    expect(propre, 'la ligne de code a été avalée').toContain('enforceRateLimit')
    expect(propre).toContain('const suite = 1')
  })

  it('un bloc JSDoc est retiré ENTIÈREMENT, fermeture comprise', () => {
    const src = ['/**', ' * prose', ' */', 'const code = 2'].join('\n')
    const propre = sansCommentaires(src)
    expect(propre).toContain('const code = 2')
    expect(propre).not.toContain('prose')
  })

  it('deux blocs successifs n’en forment pas un seul', () => {
    // C'est ce qui arrive quand on supprime les lignes `*` en premier : la
    // fermeture disparaît et le bloc court jusqu'au suivant.
    const src = ['/** un */', 'const entre = 3', '/** deux */', 'const apres = 4'].join('\n')
    const propre = sansCommentaires(src)
    expect(propre, 'le code entre deux blocs a disparu').toContain('const entre = 3')
    expect(propre).toContain('const apres = 4')
  })

  it('la prose reste bien retirée — le dépouillement sert encore à quelque chose', () => {
    const src = ['// on n’appelle PAS /api/license/deactivate', 'const x = 1'].join('\n')
    expect(sansCommentaires(src)).not.toContain('/api/license/deactivate')
  })
})

describe('aucun garde du dépôt n’utilise l’ordre dangereux', () => {
  function fichiers(dir: string, acc: string[] = []): string[] {
    if (!fs.existsSync(dir)) return acc
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (['node_modules', '.next', 'dist', '.git'].includes(e.name)) continue
        fichiers(p, acc)
      } else if (/\.test\.tsx?$/.test(e.name)) acc.push(p)
    }
    return acc
  }

  it('les blocs ne sont jamais retirés avant les lignes de commentaire', () => {
    // Détection par POSITION plutôt que par une regex d'échappement exact : une
    // première version cherchait l'enchaînement littéral et ne voyait pas la
    // mutation qu'elle prétendait attraper. On repère les deux motifs comme des
    // sous-chaînes, et on compare leur ordre quand ils sont dans le même
    // enchaînement (moins de 200 caractères d'écart).
    const BLOCS = '/\\/\\*[\\s\\S]*?\\*\\//g'
    const LIGNES = ['/^[ \\t]*\\/\\/.*$/gm', '/^\\s*\\/\\/.*$/gm']

    const fautifs: string[] = []
    for (const f of fichiers(path.join(RACINE, 'src'))) {
      const src = fs.readFileSync(f, 'utf8')
      const iBloc = src.indexOf(BLOCS)
      if (iBloc < 0) continue
      for (const l of LIGNES) {
        const iLigne = src.indexOf(l)
        if (iLigne < 0) continue
        if (iBloc < iLigne && iLigne - iBloc < 200) {
          fautifs.push(path.relative(RACINE, f).replace(/\\/g, '/'))
        }
      }
    }
    expect(
      Array.from(new Set(fautifs)),
      'retirez les lignes `//` AVANT les blocs — sinon un début de bloc écrit dans un commentaire avale le code',
    ).toEqual([])
  })
})
