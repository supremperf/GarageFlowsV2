/**
 * GF31-AUD-010 — le verrou d'immutabilité doit être VERROUILLANT.
 *
 * `PATCH /api/invoices/[id]` et `PATCH /api/quotes/[id]` re-contrôlent bien le
 * verrou d'immutabilité **à l'intérieur** de la transaction, avec un commentaire
 * « ANTI-TOCTOU ». Mais cette relecture était un simple `findFirst` : elle ne
 * verrouille rien.
 *
 * Sous SQLite (poste), les écritures étant sérialisées, cela suffit. Sous
 * **PostgreSQL** (PWA / multi-instance) en isolation READ COMMITTED — celle par
 * défaut de Prisma — deux transactions concurrentes lisent toutes deux l'état
 * « draft », franchissent toutes deux le verrou, puis écrivent l'une après
 * l'autre : la première valide le document, la seconde réécrit ses lignes
 * par-dessus un document déjà émis. Pour un devis, la course a lieu entre le
 * garage qui modifie et le client qui accepte depuis le portail.
 *
 * Le dépôt applique déjà le bon dispositif dans `PATCH /api/admin/licenses/[id]`
 * (`SELECT … FOR UPDATE` conditionné à `isPostgresDatabase()`), justement pour
 * « sérialiser les éditions concurrentes ».
 *
 * ─── Portée de ce contrôle ──────────────────────────────────────────────────
 * Il vérifie la présence et l'ORDRE du verrou dans la source. La démonstration
 * du comportement concurrent exige une vraie base PostgreSQL : elle relève des
 * suites `*.postgres.int.test.ts`, ignorées sans `TEST_POSTGRES_URL` — et non
 * exécutables dans un environnement sans identifiants (cf. BASELINE §4).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const API = path.resolve(__dirname, '../../app/api')

const DOCUMENTS = [
  ['facture', 'invoices/[id]/route.ts', 'Invoice', 'tx.invoice.findFirst'],
  ['devis', 'quotes/[id]/route.ts', 'Quote', 'tx.quote.findFirst'],
] as const

describe('GF31-AUD-010 — verrou de ligne avant la relecture anti-TOCTOU', () => {
  it.each(DOCUMENTS)('%s : pose un SELECT … FOR UPDATE sur PostgreSQL', (_libelle, rel, table) => {
    const src = readFileSync(path.join(API, rel), 'utf8')
    expect(src).toContain('isPostgresDatabase()')
    expect(src).toContain(`FROM "${table}" WHERE "id" = `)
    expect(src).toContain('FOR UPDATE')
  })

  it.each(DOCUMENTS)('%s : le verrou précède la relecture (sinon il ne sert à rien)', (_libelle, rel, _table, relecture) => {
    const src = readFileSync(path.join(API, rel), 'utf8')
    const iVerrou = src.indexOf('FOR UPDATE')
    const iRelecture = src.indexOf(relecture)
    expect(iVerrou).toBeGreaterThan(-1)
    expect(iRelecture).toBeGreaterThan(-1)
    expect(iVerrou).toBeLessThan(iRelecture)
  })

  it.each(DOCUMENTS)('%s : le verrou est bien DANS la transaction', (_libelle, rel) => {
    const src = readFileSync(path.join(API, rel), 'utf8')
    const iTx = src.indexOf('$transaction')
    const iVerrou = src.indexOf('FOR UPDATE')
    expect(iTx).toBeGreaterThan(-1)
    expect(iVerrou).toBeGreaterThan(iTx)
  })

  it('le modèle de référence du dépôt est inchangé (licences)', () => {
    // Si ce dispositif disparaissait de la route qui l'a introduit, les deux
    // ci-dessus perdraient leur justification.
    const src = readFileSync(path.join(API, 'admin/licenses/[id]/route.ts'), 'utf8')
    expect(src).toContain('FOR UPDATE')
  })
})
