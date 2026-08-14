/**
 * GF-DUR-042 — une preuve signée dit qui a signé, jamais qui possède aujourd'hui.
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * `/api/sync/mechanic-status` propage une suspension ou une révocation de clé
 * mécanicien depuis un poste vers le cloud. Elle vérifiait le lien de parenté
 * sur la revendication SIGNÉE du jeton :
 *
 *     if (mv.payload.plid !== auth.licenseId) → 403
 *
 * `plid` est figé à l'émission du jeton. Si la clé mécanicien est ensuite
 * réattribuée à un autre garage, `parentLicenseId` change EN BASE — mais
 * l'ancien jeton continue de vérifier et de porter l'ancien parent. Son
 * détenteur pouvait donc encore suspendre ou révoquer une clé qui ne lui
 * appartient plus : un garage coupant l'accès du mécanicien d'un autre.
 *
 * Ce n'est pas un vol de données, c'est un déni de service transversal — la
 * catégorie qu'on repère le moins bien parce qu'aucune donnée ne fuit.
 *
 * ─── La correction ──────────────────────────────────────────────────────────
 * La base doit confirmer le lien AU MOMENT de l'écriture, dans la même
 * transaction. Le contrôle sur le jeton est conservé (il rejette tôt et sans
 * accès base) ; celui sur la ligne s'y ajoute.
 *
 * Même logique que `isGarageClaimedByAnotherLicense` dans les routes voisines :
 * la cryptographie atteste d'une signature passée, pas d'une propriété présente.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const lire = (rel: string) => fs.readFileSync(path.join(RACINE, rel), 'utf8')

describe('sync : le lien parent est confirmé EN BASE (GF-DUR-042)', () => {
  const src = lire('src/app/api/sync/mechanic-status/route.ts')

  it('le contrôle sur le JETON est conservé', () => {
    // Il rejette tôt, sans toucher la base : on ne le remplace pas, on l'épaule.
    expect(src).toMatch(/mv\.payload\.plid !== auth\.licenseId/)
  })

  it('la LIGNE en base doit aussi confirmer le parent', () => {
    expect(src).toMatch(/record\.parentLicenseId !== auth\.licenseId/)
  })

  it('ce contrôle est DANS la transaction, avant toute écriture', () => {
    const tx = src.slice(src.indexOf('prisma.$transaction'))
    const garde = tx.indexOf('record.parentLicenseId !== auth.licenseId')
    const ecriture = tx.indexOf('tx.licenseKey.update')
    expect(garde).toBeGreaterThan(-1)
    expect(garde, 'la garde doit précéder l’écriture').toBeLessThan(ecriture)
  })

  it('le refus est un 403, pas un conflit d’état', () => {
    // 409 laisserait croire à une course rejouable ; c'est une autorisation
    // qui manque.
    expect(src).toMatch(/code: 'PARENT_MISMATCH' \}, \{ status: 403 \}/)
  })
})

describe('sync : toutes les routes s’authentifient par licence GARAGE', () => {
  const ROUTES = ['jobs', 'portal', 'job-photo', 'mechanic-avatar', 'mechanic-status', 'mechanic-assignment']

  it('le corpus est complet — sinon ce garde ne prouverait rien', () => {
    const dir = path.join(RACINE, 'src/app/api/sync')
    const presentes = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== '__tests__')
      .map((e) => e.name).sort()
    expect(presentes, 'une route de synchronisation a été ajoutée : ajoutez-la ici').toEqual([...ROUTES].sort())
  })

  for (const r of ROUTES) {
    it(`/api/sync/${r} authentifie la licence garage`, () => {
      const src = lire(`src/app/api/sync/${r}/route.ts`)
      expect(src).toMatch(/authenticateGarageLicense\(/)
      // Et le `garageId` du CORPS n'est jamais l'identité retenue.
      if (/body\.garageId/.test(src)) {
        expect(src, 'le garageId du corps ne doit pas servir d’identité')
          .toMatch(/auth\.garageId|trustedGarageId/)
      }
    })
  }
})
