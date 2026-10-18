/**
 * GF-034 — l'instantané portail dépassait le plafond de son propre récepteur.
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * `buildPortalSnapshot` autorisait 24 photos de 400 Kio, soit 9,6 Mio bruts —
 * près de 13 Mio en base64. `POST /api/sync/portal` refuse, lui, tout instantané
 * dépassant 4 Mio sérialisés (413 `PAYLOAD_TOO_LARGE`). Pire, la borne PAR
 * photo ne s'appliquait qu'à la relecture disque : une photo venue de la
 * colonne `base64` passait sans contrôle. Or c'est le cas NORMAL — toute photo
 * de mécanicien arrive sur le poste avec `photoPath: null` et un base64 plein.
 *
 * Résultat : une SEULE photo de mécanicien un peu lourde suffisait à rendre le
 * portail définitivement indisponible pour l'intervention, sous un message qui
 * imputait le blocage au réseau (« rouvrez cette fiche une fois la connexion
 * rétablie ») alors qu'un 413 ne se résout jamais tout seul.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../.tmp-portail-borne.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

/** Plafond du RÉCEPTEUR (`src/app/api/sync/portal/route.ts`). */
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024

let prisma: any
let buildPortalSnapshot: (jobId: string, garageId: string) => Promise<any>
let garageId = ''
let mecanicienId = ''
let jobId = ''

/** Data-URL d'une image de `octets` octets décodés (approximation suffisante). */
const photoDe = (octets: number) =>
  `data:image/jpeg;base64,${'A'.repeat(Math.ceil(octets / 3) * 4)}`

beforeAll(async () => {
  const { prepareTestDb } = await import('../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ buildPortalSnapshot } = (await import('@/lib/portal/snapshot')) as any)

  garageId = (await prisma.garage.create({ data: { name: 'Portail', slug: 'portail-borne' } })).id
  mecanicienId = (await prisma.mechanic.create({
    data: { garageId, name: 'Jean', avatar: 'J', color: '#123456' },
  })).id
  jobId = (await prisma.job.create({
    data: {
      garageId, mechanicId: mecanicienId, customerName: 'Client Portail',
      vehicleModel: 'Clio', repairType: 'oil_change', estimatedDuration: 60,
      startTime: '09:00', date: '2026-08-14',
    },
  })).id
}, 180_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

beforeEach(async () => { await prisma.jobPhoto.deleteMany({}) })

/** Taille sérialisée de l'instantané, telle que la mesure le récepteur. */
const tailleSerialisee = (r: any) => Buffer.byteLength(JSON.stringify(r.payload), 'utf8')

describe('GF-034 — l’instantané tient dans ce que le serveur accepte', () => {
  it('une photo de mécanicien LOURDE n’envoie plus un instantané refusable', async () => {
    // Photo de 3 Mo en colonne `base64`, `photoPath` nul : le cas nominal
    // d'une photo remontée depuis la PWA. Elle échappait à toute borne.
    await prisma.jobPhoto.create({
      data: {
        jobId, garageId, mechanicId: mecanicienId, phase: 'during',
        base64: photoDe(3 * 1024 * 1024), photoPath: null,
      },
    })

    const r = await buildPortalSnapshot(jobId, garageId)
    expect(r).toBeTruthy()
    expect(
      tailleSerialisee(r),
      'le récepteur refuse en bloc au-delà de 4 Mio — 413 systématique',
    ).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES)
    expect(r.photosOmitted, 'l’omission doit être signalée, jamais silencieuse').toBe(1)
    expect(r.payload.photos).toHaveLength(0)
  })

  it('vingt-quatre photos moyennes tiennent encore dans le plafond', async () => {
    // Chacune sous la borne par photo (400 Kio décodés), mais leur SOMME
    // dépasse le budget global de 3,5 Mio : 24 × 150 Kio décodés font ~4,8 Mio
    // une fois encodés. La démonstration est la même qu'à 380 Kio pièce, pour
    // un tiers des écritures — ce test écrivait 12 Mo en base et devenait
    // instable sous charge (dépassement de délai, jamais une vraie régression).
    for (let i = 0; i < 24; i++) {
      await prisma.jobPhoto.create({
        data: {
          jobId, garageId, mechanicId: mecanicienId, phase: 'during',
          base64: photoDe(150 * 1024), photoPath: null,
        },
      })
    }

    const r = await buildPortalSnapshot(jobId, garageId)
    expect(tailleSerialisee(r)).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES)
    expect(r.payload.photos.length, 'quelques photos passent quand même').toBeGreaterThan(0)
    expect(r.photosOmitted, 'le reste est compté').toBeGreaterThan(0)
    expect(r.payload.photos.length + r.photosOmitted).toBe(24)
  })

  it('des photos LÉGÈRES passent toutes — la borne ne bride pas le cas normal', async () => {
    for (let i = 0; i < 6; i++) {
      await prisma.jobPhoto.create({
        data: {
          jobId, garageId, mechanicId: mecanicienId, phase: 'during',
          base64: photoDe(80 * 1024), photoPath: null,
        },
      })
    }

    const r = await buildPortalSnapshot(jobId, garageId)
    expect(r.payload.photos, 'six photos de 80 Ko doivent toutes passer').toHaveLength(6)
    expect(r.photosOmitted).toBe(0)
    expect(tailleSerialisee(r)).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES)
  })

  it('aucun chemin de fichier du poste ne part vers le cloud', async () => {
    await prisma.jobPhoto.create({
      data: {
        jobId, garageId, mechanicId: mecanicienId, phase: 'during',
        base64: photoDe(50 * 1024), photoPath: null,
      },
    })
    const r = await buildPortalSnapshot(jobId, garageId)
    for (const p of r.payload.photos as Array<Record<string, unknown>>) {
      expect(p.photoPath).toBeNull()
    }
  })

  it('l’intervention d’un AUTRE garage reste inaccessible', async () => {
    const autre = await prisma.garage.create({ data: { name: 'Voisin', slug: 'portail-voisin' } })
    expect(await buildPortalSnapshot(jobId, autre.id)).toBeNull()
    await prisma.garage.delete({ where: { id: autre.id } })
  })
})
