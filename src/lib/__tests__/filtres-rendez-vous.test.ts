/**
 * Filtres de la vue globale des rendez-vous — contrat de FORME.
 *
 * Ces tests existent à cause d'un défaut réel, trouvé par la vérification de
 * type de la CI mais INVISIBLE ici : le client Prisma n'étant pas généré dans
 * cet environnement, `prisma.appointment.*` y est typé `any`
 * (`node_modules/.prisma/client/index.d.ts` → `export declare const PrismaClient: any`).
 * Toute forme de filtre est donc acceptée localement, y compris celles que
 * Prisma refuse à l'exécution.
 *
 * C'était le cas : filtrer sur un jour exact produisait
 * `{ date: { date: '2026-10-16' } }` au lieu de `{ date: '2026-10-16' }` —
 * « Unknown argument `date` », requête en erreur, et la vue « Aujourd'hui » du
 * tableau de bord vide sans qu'aucun test ne bronche.
 *
 * Ces tests portent sur la forme produite, qui est exactement ce que Prisma
 * valide. Ils s'exécutent, eux, sans moteur de base de données.
 */
import { describe, expect, it } from 'vitest'
import { construireFiltreRendezVous } from '@/lib/portal/appointments'

describe('construireFiltreRendezVous — jour exact', () => {
  it('produit une VALEUR de date, jamais un filtre imbriqué', () => {
    const f = construireFiltreRendezVous({ date: '2026-10-16' })
    expect(f.date).toBe('2026-10-16')
    // La régression exacte : `{ date: { date: … } }`.
    expect(f.date).not.toEqual({ date: '2026-10-16' })
    expect(typeof f.date).toBe('string')
  })

  it('un jour exact l’emporte sur la période', () => {
    const f = construireFiltreRendezVous({ date: '2026-10-16', from: '2026-01-01', to: '2026-12-31' })
    expect(f.date).toBe('2026-10-16')
  })
})

describe('construireFiltreRendezVous — période', () => {
  it('`from` seul borne par le bas', () => {
    expect(construireFiltreRendezVous({ from: '2026-10-01' }).date).toEqual({ gte: '2026-10-01' })
  })

  it('`to` seul borne par le haut', () => {
    expect(construireFiltreRendezVous({ to: '2026-10-31' }).date).toEqual({ lte: '2026-10-31' })
  })

  it('les deux bornes cohabitent, et aucune propriété superflue n’est ajoutée', () => {
    const f = construireFiltreRendezVous({ from: '2026-10-01', to: '2026-10-31' })
    expect(f.date).toEqual({ gte: '2026-10-01', lte: '2026-10-31' })
    expect(Object.keys(f.date as object).sort()).toEqual(['gte', 'lte'])
  })

  it('sans date ni période, la clé est ABSENTE (aucun filtre implicite)', () => {
    expect('date' in construireFiltreRendezVous({})).toBe(false)
  })
})

describe('construireFiltreRendezVous — statuts', () => {
  it('un statut unique reste une chaîne', () => {
    expect(construireFiltreRendezVous({ statuts: ['confirmed'] }).status).toBe('confirmed')
  })

  it('plusieurs statuts passent en `in`', () => {
    expect(construireFiltreRendezVous({ statuts: ['requested', 'confirmed'] }).status)
      .toEqual({ in: ['requested', 'confirmed'] })
  })

  it('les statuts vides ou espacés sont ignorés', () => {
    const f = construireFiltreRendezVous({ statuts: ['', '  ', 'requested'] })
    expect(f.status).toBe('requested')
    expect('status' in construireFiltreRendezVous({ statuts: ['', ' '] })).toBe(false)
  })
})

describe('construireFiltreRendezVous — fiches, plaque, recherche', () => {
  it('les rattachements passent tels quels', () => {
    const f = construireFiltreRendezVous({ clientId: 'cli_1', vehicleId: 'veh_1' })
    expect(f.clientId).toBe('cli_1')
    expect(f.vehicleId).toBe('veh_1')
  })

  it('la plaque est une recherche partielle', () => {
    expect(construireFiltreRendezVous({ plate: 'AB' }).licensePlate).toEqual({ contains: 'AB' })
  })

  it('la recherche plein texte couvre client, plaque, véhicule et motif', () => {
    const f = construireFiltreRendezVous({ q: 'vidange' })
    expect(f.OR).toHaveLength(4)
    expect(f.OR?.map((o) => Object.keys(o)[0]).sort())
      .toEqual(['clientName', 'licensePlate', 'reason', 'vehicleModel'])
    for (const o of f.OR ?? []) {
      expect(Object.values(o)[0]).toEqual({ contains: 'vidange' })
    }
  })

  it('aucun filtre demandé = aucun filtre produit', () => {
    expect(construireFiltreRendezVous({})).toEqual({})
  })
})
