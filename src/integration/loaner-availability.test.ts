/**
 * GF31-AUD-022 — véhicules de prêt : disponibilité, dates et montants.
 *
 * §64 exige explicitement que deux réservations simultanées du même véhicule sur
 * la même période ne puissent pas aboutir toutes les deux. Aucun contrôle
 * n'existait : `POST /api/loaner-reservations` créait la ligne sans jamais
 * regarder les réservations en cours.
 *
 * Deux défauts voisins, dans la même route :
 *  - les dates n'étaient validées que côté navigateur : une période inversée
 *    (fin avant début) était acceptée, et une date illisible persistée en
 *    `Invalid Date` ;
 *  - `toScaled`/`toCents` renvoient 0 pour une valeur non finie — repli défensif
 *    justifié dans la couche monétaire, mais qui enregistrait silencieusement un
 *    tarif et une caution à **0 €** sur une saisie fautive. Le garage perdait la
 *    recette et la caution sans le moindre message.
 *
 * Base SQLite réelle + vraie route.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-loaner.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)()
  return { ...actual, withAuth: (fn: unknown) => fn, requireSession: async () => h.session }
})

let prisma: any
let POST: (req: Request) => Promise<Response>
let PATCH: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let DELETE_VEHICULE: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let garageId = ''
let vehicleId = ''

function reserver(corps: Record<string, unknown>) {
  return POST(new Request('http://localhost/api/loaner-reservations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corps),
  }))
}

function modifier(id: string, corps: Record<string, unknown>) {
  return PATCH(
    new Request(`http://localhost/api/loaner-reservations/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps),
    }),
    { params: { id } },
  )
}

function supprimerVehicule(id: string) {
  return DELETE_VEHICULE(new Request(`http://localhost/api/loaner-vehicles/${id}`, { method: 'DELETE' }), {
    params: { id },
  })
}

/** Crée une réservation nominale et rend sa ligne. */
async function reservationNominale(extra: Record<string, unknown> = {}) {
  const res = await reserver({ vehicleId, ...NOMINAL, ...extra })
  expect(res.status).toBe(201)
  return res.json()
}

/** Réservation nominale : du 10 au 15 juin. */
const NOMINAL = {
  clientName: 'Client A',
  startDate: '2026-06-10T08:00:00.000Z',
  endDate: '2026-06-15T18:00:00.000Z',
}

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST } = (await import('@/app/api/loaner-reservations/route')) as any)
  ;({ PATCH } = (await import('@/app/api/loaner-reservations/[id]/route')) as any)
  ;({ DELETE: DELETE_VEHICULE } = (await import('@/app/api/loaner-vehicles/[id]/route')) as any)

  garageId = (await prisma.garage.create({ data: { name: 'Prêt', slug: 'aud-022' } })).id
  vehicleId = (await prisma.loanerVehicle.create({
    data: { garageId, name: 'Clio de prêt', licensePlate: 'AA-123-BB' },
  })).id
  h.session = { user: { id: 'u', role: 'OWNER', garageId } }
}, 180_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

beforeEach(async () => {
  await prisma.loanerReservation.deleteMany({ where: { garageId } })
})

describe('GF31-AUD-022 — disponibilité du véhicule de prêt (§64)', () => {
  it('refuse une seconde réservation qui chevauche la première', async () => {
    expect((await reserver({ vehicleId, ...NOMINAL })).status).toBe(201)

    const chevauche = await reserver({
      vehicleId, clientName: 'Client B',
      startDate: '2026-06-12T08:00:00.000Z', // au milieu de la première
      endDate: '2026-06-20T18:00:00.000Z',
    })
    expect(chevauche.status).toBe(409)
    expect((await chevauche.json()).code).toBe('VEHICLE_UNAVAILABLE')
    expect(await prisma.loanerReservation.count({ where: { vehicleId } })).toBe(1)
  })

  it.each([
    ['englobante', '2026-06-01T00:00:00.000Z', '2026-06-30T00:00:00.000Z'],
    ['incluse', '2026-06-11T00:00:00.000Z', '2026-06-12T00:00:00.000Z'],
    ['débordant à gauche', '2026-06-05T00:00:00.000Z', '2026-06-11T00:00:00.000Z'],
    ['débordant à droite', '2026-06-14T00:00:00.000Z', '2026-06-18T00:00:00.000Z'],
  ])('refuse une période %s', async (_l, startDate, endDate) => {
    await reserver({ vehicleId, ...NOMINAL })
    expect((await reserver({ vehicleId, clientName: 'B', startDate, endDate })).status).toBe(409)
  })

  it('accepte une période strictement ADJACENTE (aucun chevauchement)', async () => {
    await reserver({ vehicleId, ...NOMINAL })
    const apres = await reserver({
      vehicleId, clientName: 'Client C',
      startDate: '2026-06-15T18:00:00.000Z', // commence quand l'autre finit
      endDate: '2026-06-18T18:00:00.000Z',
    })
    expect(apres.status).toBe(201)
  })

  it('une réservation ANNULÉE ou RENDUE libère le véhicule', async () => {
    const premiere = await (await reserver({ vehicleId, ...NOMINAL })).json()
    await prisma.loanerReservation.update({ where: { id: premiere.id }, data: { status: 'cancelled' } })

    expect((await reserver({ vehicleId, clientName: 'B', ...{ startDate: NOMINAL.startDate, endDate: NOMINAL.endDate } })).status).toBe(201)
  })

  it('un AUTRE véhicule reste réservable sur la même période', async () => {
    await reserver({ vehicleId, ...NOMINAL })
    const autre = (await prisma.loanerVehicle.create({
      data: { garageId, name: 'Twingo de prêt', licensePlate: 'CC-456-DD' },
    })).id
    expect((await reserver({ vehicleId: autre, clientName: 'B', ...{ startDate: NOMINAL.startDate, endDate: NOMINAL.endDate } })).status).toBe(201)
  })

  it('deux réservations CONCURRENTES du même véhicule : une seule aboutit', async () => {
    const [a, b] = await Promise.all([
      reserver({ vehicleId, clientName: 'Concurrent A', ...{ startDate: NOMINAL.startDate, endDate: NOMINAL.endDate } }),
      reserver({ vehicleId, clientName: 'Concurrent B', ...{ startDate: NOMINAL.startDate, endDate: NOMINAL.endDate } }),
    ])
    const codes = [a.status, b.status].sort()
    expect(codes).toEqual([201, 409])
    expect(await prisma.loanerReservation.count({ where: { vehicleId } })).toBe(1)
  })
})

describe('GF31-AUD-022 — dates', () => {
  it('refuse une période inversée', async () => {
    const r = await reserver({
      vehicleId, clientName: 'X',
      startDate: '2026-06-20T00:00:00.000Z',
      endDate: '2026-06-10T00:00:00.000Z',
    })
    expect(r.status).toBe(400)
    expect(await prisma.loanerReservation.count({ where: { vehicleId } })).toBe(0)
  })

  it('refuse une date illisible plutôt que de persister « Invalid Date »', async () => {
    const r = await reserver({ vehicleId, clientName: 'X', startDate: 'pas-une-date', endDate: '2026-06-10T00:00:00.000Z' })
    expect(r.status).toBe(400)
    expect(await prisma.loanerReservation.count({ where: { vehicleId } })).toBe(0)
  })

  /**
   * Correction de ma propre correction (§179) : la première version de
   * GF31-AUD-022 refusait « fin == début » comme une durée nulle. Or
   * l'interface saisit des dates SANS heure et propose — en chiffrant son
   * prix — le prêt « du 10 au 10 » : la règle interdisait donc le prêt du
   * jour même, cas d'usage courant. Seule l'inversion est un défaut de saisie.
   */
  it('accepte le prêt d’une journée (fin = début) — cas d’usage réel', async () => {
    const r = await reserver({ vehicleId, clientName: 'Journée', startDate: '2026-06-10', endDate: '2026-06-10' })
    expect(r.status).toBe(201)
  })

  it('mais cette journée OCCUPE bien le véhicule (pas d’intervalle vide)', async () => {
    expect((await reserver({ vehicleId, clientName: 'A', startDate: '2026-06-10', endDate: '2026-06-10' })).status).toBe(201)
    const second = await reserver({ vehicleId, clientName: 'B', startDate: '2026-06-10', endDate: '2026-06-10' })
    expect(second.status).toBe(409)
    expect(await prisma.loanerReservation.count({ where: { vehicleId } })).toBe(1)
  })

  it('le lendemain reste libre après un prêt d’une journée', async () => {
    expect((await reserver({ vehicleId, clientName: 'A', startDate: '2026-06-10', endDate: '2026-06-10' })).status).toBe(201)
    expect((await reserver({ vehicleId, clientName: 'B', startDate: '2026-06-11', endDate: '2026-06-11' })).status).toBe(201)
  })
})

/**
 * Le planning hebdomadaire interrogeait `startDate` OU `endDate` dans la
 * fenêtre : une réservation qui ENGLOBE la semaine affichée n'était donc jamais
 * renvoyée. Un véhicule sorti pour trois semaines apparaissait « libre » toute
 * la période, sauf la semaine de départ et celle de retour.
 */
describe('GF31-AUD-031 — fenêtre du planning', () => {
  const listerSemaine = async (du: string, au: string) => {
    const { GET } = (await import('@/app/api/loaner-reservations/route')) as any
    const res = await GET(new Request(`http://localhost/api/loaner-reservations?startDate=${du}&endDate=${au}`))
    return res.json()
  }

  it('affiche une réservation qui englobe la semaine consultée', async () => {
    await reserver({ vehicleId, clientName: 'Long prêt', startDate: '2026-06-01T08:00:00.000Z', endDate: '2026-06-30T18:00:00.000Z' })
    const semaine = await listerSemaine('2026-06-10', '2026-06-16')
    expect(semaine).toHaveLength(1)
    expect(semaine[0].clientName).toBe('Long prêt')
  })

  it('affiche une réservation qui commence le DERNIER jour de la fenêtre', async () => {
    await reserver({ vehicleId, clientName: 'Départ tardif', startDate: '2026-06-16T08:00:00.000Z', endDate: '2026-06-20T18:00:00.000Z' })
    expect(await listerSemaine('2026-06-10', '2026-06-16')).toHaveLength(1)
  })

  it('n’affiche pas une réservation hors fenêtre', async () => {
    await reserver({ vehicleId, clientName: 'Ailleurs', startDate: '2026-07-01T08:00:00.000Z', endDate: '2026-07-05T18:00:00.000Z' })
    expect(await listerSemaine('2026-06-10', '2026-06-16')).toHaveLength(0)
  })
})

describe('GF31-AUD-022 — montants', () => {
  it.each([
    ['tarif journalier non numérique', { dailyRate: 'quarante euros' }],
    ['caution non numérique', { depositAmount: 'cinq cents' }],
    ['tarif négatif', { dailyRate: -10 }],
  ])('refuse %s au lieu de l’enregistrer à 0 €', async (_l, extra) => {
    const r = await reserver({ vehicleId, ...NOMINAL, ...extra })
    expect(r.status).toBe(400)
    expect(await prisma.loanerReservation.count({ where: { vehicleId } })).toBe(0)
  })

  it('enregistre exactement un montant valide', async () => {
    const r = await reserver({ vehicleId, ...NOMINAL, dailyRate: 39.9, depositAmount: 500 })
    expect(r.status).toBe(201)
    const ligne = await prisma.loanerReservation.findFirst({ where: { vehicleId } })
    expect(ligne.dailyRateTenThousandths).toBe(399000)
    expect(ligne.depositAmountCents).toBe(50000)
  })

  it('accepte l’absence de montant (champs facultatifs)', async () => {
    expect((await reserver({ vehicleId, ...NOMINAL })).status).toBe(201)
    const ligne = await prisma.loanerReservation.findFirst({ where: { vehicleId } })
    expect(ligne.dailyRateTenThousandths).toBeNull()
    expect(ligne.depositAmountCents).toBeNull()
  })
})

/**
 * GF31-AUD-026 — la modification échappait à TOUTES les règles de la création.
 *
 * `PATCH /api/loaner-reservations/[id]` recopiait le corps champ par champ sans
 * la moindre validation. Trois conséquences, toutes reproduites ci-dessous :
 *
 *  1. `status` verbatim : une valeur hors énumération (« en cours ») faisait
 *     sortir le prêt des vues ET des garde-fous, qui filtrent tous sur
 *     ['reserved','active'] ;
 *  2. la garantie §64 (un véhicule, un prêt à la fois) ne tenait que sur la
 *     CRÉATION : déplacer une réservation sur une période prise la contournait ;
 *  3. dates et montants n'étaient plus contrôlés du tout, alors que le POST les
 *     refuse depuis GF31-AUD-022.
 */
describe('GF31-AUD-026 — modification d’une réservation', () => {
  it('refuse un statut hors énumération au lieu de l’écrire verbatim', async () => {
    const r = await reservationNominale()
    const res = await modifier(r.id, { status: 'en cours' })
    expect(res.status).toBe(400)
    const ligne = await prisma.loanerReservation.findUnique({ where: { id: r.id } })
    expect(ligne.status).toBe('reserved')
  })

  it.each(['reserved', 'active', 'returned', 'cancelled'])('accepte le statut légitime %s', async (statut) => {
    const r = await reservationNominale()
    const res = await modifier(r.id, { status: statut })
    expect(res.status).toBe(200)
    expect((await prisma.loanerReservation.findUnique({ where: { id: r.id } })).status).toBe(statut)
  })

  it('refuse de déplacer une réservation sur une période déjà occupée (§64 sur le chemin PATCH)', async () => {
    const premiere = await reservationNominale()
    const seconde = await reserver({
      vehicleId, clientName: 'Client B',
      startDate: '2026-07-01T08:00:00.000Z',
      endDate: '2026-07-05T18:00:00.000Z',
    })
    expect(seconde.status).toBe(201)
    const b = await seconde.json()

    const res = await modifier(b.id, { startDate: NOMINAL.startDate, endDate: NOMINAL.endDate })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('VEHICLE_UNAVAILABLE')
    // La ligne n'a pas bougé.
    const ligne = await prisma.loanerReservation.findUnique({ where: { id: b.id } })
    expect(ligne.startDate.toISOString()).toBe('2026-07-01T08:00:00.000Z')
    expect(premiere.id).not.toBe(b.id)
  })

  it('ranimer une réservation annulée qui recouvre une autre est refusé', async () => {
    const annulee = await reservationNominale()
    await modifier(annulee.id, { status: 'cancelled' })
    // Le véhicule étant libéré, un autre client réserve la même période.
    const autre = await reserver({ vehicleId, ...NOMINAL, clientName: 'Client B' })
    expect(autre.status).toBe(201)

    const res = await modifier(annulee.id, { status: 'reserved' })
    expect(res.status).toBe(409)
    expect((await prisma.loanerReservation.findUnique({ where: { id: annulee.id } })).status).toBe('cancelled')
  })

  it('déplacer une réservation sur une période LIBRE reste possible', async () => {
    const r = await reservationNominale()
    const res = await modifier(r.id, {
      startDate: '2026-08-01T08:00:00.000Z',
      endDate: '2026-08-03T18:00:00.000Z',
    })
    expect(res.status).toBe(200)
  })

  it('ne se déclare pas en conflit avec elle-même (mise à jour sans changement de période)', async () => {
    const r = await reservationNominale()
    expect((await modifier(r.id, { notes: 'RAS', status: 'active' })).status).toBe(200)
  })

  it.each([
    ['période inversée', { startDate: '2026-06-20T00:00:00.000Z', endDate: '2026-06-10T00:00:00.000Z' }],
    ['date illisible', { startDate: 'pas-une-date' }],
    ['tarif non numérique', { dailyRate: 'quarante' }],
    ['caution négative', { depositAmount: -5 }],
    ['kilométrage non numérique', { mileageIn: 'abc' }],
  ])('refuse %s', async (_l, corps) => {
    const r = await reservationNominale()
    expect((await modifier(r.id, corps)).status).toBe(400)
  })

  it('borne les montants au domaine des colonnes Int (pas de dépassement 32 bits)', async () => {
    const r = await reservationNominale()
    expect((await modifier(r.id, { dailyRate: 1e30 })).status).toBe(400)
    expect((await reserver({
      vehicleId, clientName: 'X',
      startDate: '2027-01-01T00:00:00.000Z', endDate: '2027-01-02T00:00:00.000Z',
      dailyRate: 1e30,
    })).status).toBe(400)
  })

  it('enregistre un statut « returned » avec son horodatage', async () => {
    const r = await reservationNominale()
    expect((await modifier(r.id, { status: 'returned' })).status).toBe(200)
    expect((await prisma.loanerReservation.findUnique({ where: { id: r.id } })).returnedAt).toBeInstanceOf(Date)
  })
})

/**
 * GF31-AUD-027 — supprimer un véhicule de prêt effaçait tout son historique.
 *
 * `LoanerReservation.vehicle` est en `onDelete: Cascade`. Le seul garde-fou
 * comptait les réservations `reserved`/`active` : il protégeait le prêt en
 * cours, jamais les preuves passées (kilométrages, états des lieux, cautions).
 * Et comme `PATCH` écrivait `status` verbatim (GF31-AUD-026), il suffisait de
 * sortir la réservation vive de cette liste pour franchir le garde-fou.
 */
describe('GF31-AUD-027 — suppression d’un véhicule de prêt', () => {
  it('refuse de supprimer un véhicule qui a un historique, et le dit', async () => {
    const vhc = (await prisma.loanerVehicle.create({
      data: { garageId, name: 'Kangoo', licensePlate: 'HH-111-II' },
    })).id
    await prisma.loanerReservation.create({
      data: {
        garageId, vehicleId: vhc, clientName: 'Ancien client',
        startDate: new Date('2025-01-01'), endDate: new Date('2025-01-05'),
        status: 'returned', mileageIn: 120_000, depositAmountCents: 50_000,
      },
    })

    const res = await supprimerVehicule(vhc)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('VEHICLE_HAS_HISTORY')
    expect(await prisma.loanerReservation.count({ where: { vehicleId: vhc } })).toBe(1)
    expect(await prisma.loanerVehicle.findUnique({ where: { id: vhc } })).not.toBeNull()
  })

  it('le contournement par statut inventé est fermé de bout en bout', async () => {
    const vhc = (await prisma.loanerVehicle.create({
      data: { garageId, name: 'Berlingo', licensePlate: 'JJ-222-KK' },
    })).id
    const r = await (await reserver({
      vehicleId: vhc, clientName: 'Client en cours',
      startDate: '2026-09-01T08:00:00.000Z', endDate: '2026-09-05T18:00:00.000Z',
    })).json()

    // 1. Le garde-fou « réservations actives » répond présent.
    expect((await supprimerVehicule(vhc)).status).toBe(400)
    // 2. L'échappatoire d'origine — sortir la réservation de l'énumération.
    expect((await modifier(r.id, { status: 'actif' })).status).toBe(400)
    // 3. Même après une annulation légitime, l'historique protège le véhicule.
    expect((await modifier(r.id, { status: 'cancelled' })).status).toBe(200)
    expect((await supprimerVehicule(vhc)).status).toBe(409)
    expect(await prisma.loanerReservation.count({ where: { vehicleId: vhc } })).toBe(1)
  })

  it('un véhicule sans aucun prêt reste supprimable', async () => {
    const vhc = (await prisma.loanerVehicle.create({
      data: { garageId, name: 'Jamais prêté', licensePlate: 'LL-333-MM' },
    })).id
    expect((await supprimerVehicule(vhc)).status).toBe(200)
    expect(await prisma.loanerVehicle.findUnique({ where: { id: vhc } })).toBeNull()
  })
})
