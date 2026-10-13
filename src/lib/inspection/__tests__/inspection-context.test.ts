/**
 * CONTRÔLE VÉHICULE — résolution du contexte par les identifiants métier.
 *
 * Défaut reproduit sur la base réelle du poste : l'intervention « Pauline /
 * Renault Twingo / FZ-319-BZ » produisait une inspection avec `vehicleId = NULL`
 * et `mileage = NULL`, car la modale ne recopiait que les libellés affichés et
 * ne recevait jamais d'identifiant véhicule.
 *
 * Ces tests couvrent les cas listés au cahier des charges : véhicule complet,
 * véhicule partiel, kilométrage absent, rapprochement par plaque, saisie
 * manuelle, et surtout l'isolation entre deux garages détenant des plaques
 * proches.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

interface VehicleRow {
  id: string; garageId: string; licensePlate: string; make: string; model: string
  mileage: number | null; clientId: string; client: { id: string; name: string } | null
}
interface JobRow {
  id: string; garageId: string; customerName: string; vehicleModel: string
  licensePlate: string | null; mileageAtVisit: number | null; vehicleId: string | null
}

const db = vi.hoisted(() => ({ jobs: [] as unknown[], vehicles: [] as unknown[] }))

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => v === undefined || row[k] === v)
}

vi.mock('@/lib/db', () => ({
  prisma: {
    job: {
      findFirst: async (a: { where: Record<string, unknown> }) =>
        (db.jobs as Record<string, unknown>[]).find(j => matches(j, a.where)) ?? null,
    },
    vehicle: {
      findFirst: async (a: { where: Record<string, unknown> }) =>
        (db.vehicles as Record<string, unknown>[]).find(v => matches(v, a.where)) ?? null,
      findMany: async (a: { where: Record<string, unknown> }) =>
        (db.vehicles as Record<string, unknown>[]).filter(v => matches(v, a.where)),
    },
  },
  isPostgresDatabase: () => false,
}))

let resolveInspectionContext: typeof import('@/lib/inspection/context').resolveInspectionContext
beforeAll(async () => {
  ;({ resolveInspectionContext } = await import('@/lib/inspection/context'))
})

const GARAGE = 'garage-A'
const OTHER = 'garage-B'

function vehicle(over: Partial<VehicleRow> = {}): VehicleRow {
  return {
    id: 'veh-twingo', garageId: GARAGE, licensePlate: 'FZ-319-BZ',
    make: 'Renault', model: 'Twingo', mileage: 128_400,
    clientId: 'cli-pauline', client: { id: 'cli-pauline', name: 'Pauline' },
    ...over,
  }
}
function job(over: Partial<JobRow> = {}): JobRow {
  return {
    id: 'job-vidange', garageId: GARAGE, customerName: 'Pauline',
    vehicleModel: 'Renault Twingo', licensePlate: 'FZ-319-BZ',
    mileageAtVisit: null, vehicleId: null,
    ...over,
  }
}

beforeEach(() => { db.jobs = []; db.vehicles = [] })

describe('A — intervention + client + véhicule complet', () => {
  it('rattache le véhicule et remonte kilométrage et fiche client', async () => {
    db.jobs = [job({ vehicleId: 'veh-twingo' })]
    db.vehicles = [vehicle()]

    const ctx = await resolveInspectionContext(GARAGE, 'job-vidange')
    expect(ctx).toEqual({
      jobId: 'job-vidange',
      vehicleId: 'veh-twingo',
      clientId: 'cli-pauline',
      clientName: 'Pauline',
      vehicleModel: 'Renault Twingo',
      licensePlate: 'FZ-319-BZ',
      mileage: 128_400,
    })
  })
})

describe('D — plaque existante, Job.vehicleId absent', () => {
  it('rapproche par immatriculation (le cas réel du poste)', async () => {
    db.jobs = [job()] // vehicleId NULL, comme en base
    db.vehicles = [vehicle()]

    const ctx = await resolveInspectionContext(GARAGE, 'job-vidange')
    expect(ctx?.vehicleId).toBe('veh-twingo')
    expect(ctx?.mileage).toBe(128_400)
  })

  it('rapproche malgré une casse/ponctuation différente', async () => {
    db.jobs = [job({ licensePlate: 'fz319bz' })]
    db.vehicles = [vehicle({ licensePlate: 'FZ-319-BZ' })]

    const ctx = await resolveInspectionContext(GARAGE, 'job-vidange')
    expect(ctx?.vehicleId).toBe('veh-twingo')
    // La plaque canonique de la fiche l'emporte sur la saisie libre.
    expect(ctx?.licensePlate).toBe('FZ-319-BZ')
  })
})

describe('B — véhicule partiellement renseigné / absent', () => {
  it('retombe sur les libellés de l’intervention quand aucune fiche n’existe', async () => {
    db.jobs = [job()]
    db.vehicles = [] // état réel constaté : table Vehicle vide

    const ctx = await resolveInspectionContext(GARAGE, 'job-vidange')
    expect(ctx).toEqual({
      jobId: 'job-vidange', vehicleId: null, clientId: null,
      clientName: 'Pauline', vehicleModel: 'Renault Twingo',
      licensePlate: 'FZ-319-BZ', mileage: null,
    })
  })

  it('tolère une fiche véhicule sans modèle', async () => {
    db.jobs = [job({ vehicleId: 'veh-twingo' })]
    db.vehicles = [vehicle({ make: 'Renault', model: '' })]

    const ctx = await resolveInspectionContext(GARAGE, 'job-vidange')
    // Le libellé de la fiche est vide → repli sur celui de l'intervention.
    expect(ctx?.vehicleModel).toBe('Renault Twingo')
    expect(ctx?.vehicleId).toBe('veh-twingo')
  })
})

describe('C — kilométrage', () => {
  it('absent partout → null (jamais 0)', async () => {
    db.jobs = [job()]
    db.vehicles = [vehicle({ mileage: null })]
    expect((await resolveInspectionContext(GARAGE, 'job-vidange'))?.mileage).toBeNull()
  })

  it('le relevé de la visite prime sur le dernier kilométrage du véhicule', async () => {
    db.jobs = [job({ mileageAtVisit: 232_010 })]
    db.vehicles = [vehicle({ mileage: 128_400 })]
    expect((await resolveInspectionContext(GARAGE, 'job-vidange'))?.mileage).toBe(232_010)
  })
})

describe('F — deux garages, plaques proches : ISOLATION', () => {
  it('ne rattache jamais le véhicule d’un autre garage', async () => {
    db.jobs = [job()]
    // Même plaque, autre garage : la contrainte @@unique([licensePlate, garageId])
    // autorise ce doublon — il ne doit JAMAIS traverser.
    db.vehicles = [vehicle({ id: 'veh-autre', garageId: OTHER, mileage: 999_999 })]

    const ctx = await resolveInspectionContext(GARAGE, 'job-vidange')
    expect(ctx?.vehicleId).toBeNull()
    expect(ctx?.mileage).toBeNull()
  })

  it('refuse une intervention hors du garage', async () => {
    db.jobs = [job({ garageId: OTHER })]
    expect(await resolveInspectionContext(GARAGE, 'job-vidange')).toBeNull()
  })

  it('ignore un Job.vehicleId pointant hors du garage et retombe sur la plaque', async () => {
    db.jobs = [job({ vehicleId: 'veh-autre' })]
    db.vehicles = [
      vehicle({ id: 'veh-autre', garageId: OTHER, mileage: 999_999 }),
      vehicle({ id: 'veh-twingo', garageId: GARAGE, mileage: 128_400 }),
    ]

    const ctx = await resolveInspectionContext(GARAGE, 'job-vidange')
    expect(ctx?.vehicleId).toBe('veh-twingo')
    expect(ctx?.mileage).toBe(128_400)
  })
})

describe('ouverture depuis un véhicule (sans intervention)', () => {
  it('résout le contexte à partir de la fiche', async () => {
    db.vehicles = [vehicle()]
    const ctx = await resolveInspectionContext(GARAGE, null, 'veh-twingo')
    expect(ctx).toEqual({
      jobId: null, vehicleId: 'veh-twingo', clientId: 'cli-pauline',
      clientName: 'Pauline', vehicleModel: 'Renault Twingo',
      licensePlate: 'FZ-319-BZ', mileage: 128_400,
    })
  })

  it('refuse un véhicule d’un autre garage', async () => {
    db.vehicles = [vehicle({ garageId: OTHER })]
    expect(await resolveInspectionContext(GARAGE, null, 'veh-twingo')).toBeNull()
  })

  it('sans identifiant, aucun contexte', async () => {
    expect(await resolveInspectionContext(GARAGE)).toBeNull()
  })
})
