/**
 * GF-DUR-038 — le COMPTE de pagination est cloisonné, comme la liste.
 *
 * ─── La question posée ──────────────────────────────────────────────────────
 * Une liste paginée fait deux requêtes : les lignes, et le total. Si le total
 * est compté AVANT le cloisonnement — ou avec un `where` différent — la liste
 * reste correcte mais `totalCount` révèle le volume des autres garages. « 3
 * clients affichés sur 1 247 » en dit long sans montrer une seule ligne.
 *
 * ─── Ce qui a été constaté (14/08/2026) ─────────────────────────────────────
 * Aucune des cinq routes de liste n'a ce défaut : chacune construit UN objet
 * `where` commençant par `garageId: session.user.garageId`, et passe le MÊME
 * objet à `findMany` et à `count`. Les filtres client (`jobId`, `clientId`,
 * `status`, `q`, `plate`) s'y ajoutent sans jamais remplacer le cloisonnement :
 * un identifiant étranger ne fait que vider le résultat.
 *
 * Ce fichier fige donc un constat POSITIF. Il ne corrige rien ; il empêche que
 * la propriété se perde à la prochaine refonte d'une liste, où l'on écrit
 * facilement `count({ where: { status } })` en pensant filtrer.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')

/** Routes de liste paginée : lignes + total dans le même appel. */
const LISTES = [
  'src/app/api/clients/route.ts',
  'src/app/api/invoices/route.ts',
  'src/app/api/quotes/route.ts',
  'src/app/api/vehicles/route.ts',
  'src/app/api/jobs/route.ts',
]

function sansCommentaires(src: string): string {
  return src.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('pagination : le total est compté DANS le garage (GF-DUR-038)', () => {
  it('le corpus est non vide — sinon ce garde ne prouverait rien', () => {
    expect(LISTES.every((f) => fs.existsSync(path.join(RACINE, f)))).toBe(true)
  })

  for (const rel of LISTES) {
    it(`${rel.replace('src/app/api/', '').replace('/route.ts', '')} : where cloisonné, réutilisé par count`, () => {
      const src = sansCommentaires(fs.readFileSync(path.join(RACINE, rel), 'utf8'))

      // 1. Le `where` est ancré sur le garage de la SESSION — jamais sur une
      //    valeur reçue du client.
      expect(src, 'le where doit être ancré sur session.user.garageId')
        .toMatch(/const where[^=]*=\s*\{[\s\S]{0,120}garageId:\s*session\.user\.garageId/)

      // 2. Le compte réutilise CE `where`, et pas un autre littéral.
      expect(src, 'count doit recevoir le where cloisonné, pas un objet reconstruit')
        .toMatch(/\.count\(\{\s*where\s*(\}|,)/)

      // 3. Aucun `garageId` pris dans la requête : ce serait l'échappatoire.
      expect(src).not.toMatch(/garageId:\s*(body|params|searchParams|corps)\b/)
    })
  }
})
