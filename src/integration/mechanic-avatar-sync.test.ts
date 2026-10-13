/**
 * GF-PLAN-009 — propagation POSTE → CLOUD de la photo de profil.
 *
 * Ce test exerce la VRAIE route `/api/sync/mechanic-avatar` sur une base réelle,
 * avec un vrai stockage disque. L'authentification du poste par sa licence
 * garage est simulée (elle est éprouvée par les tests de `garage-auth`) ; tout
 * le reste — validation, idempotence, ordre d'arrivée, isolation — est réel.
 *
 * Ce qui est vérifié tient en une phrase : le cloud ne croit pas le poste sur
 * parole.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-avatar-sync.db')
const PHOTOS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-avatar-sync-'))
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.GF_PHOTOS_DIR = PHOTOS_DIR

/** Poste authentifié : `garageId` de CONFIANCE rendu par la licence garage. */
const h = vi.hoisted(() => ({ auth: null as unknown }))
vi.mock('@/lib/sync/garage-auth', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  authenticateGarageLicense: async () => h.auth,
}))
vi.mock('@/lib/security/rate-limit', () => ({
  clientIpFrom: () => 'ip-test',
  enforceRateLimit: async () => ({ ok: true }),
  rateLimitResponse: () => new Response('rl', { status: 429 }),
}))
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }))

let syncPOST: (req: Request) => Promise<Response>
let prisma: any
let garageA: string
let garageB: string
let jean: string
let mecanoB: string

function png(largeur = 256, hauteur = 256): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(25)
  ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'ascii')
  ihdr.writeUInt32BE(largeur, 8); ihdr.writeUInt32BE(hauteur, 12)
  ihdr[16] = 8; ihdr[17] = 6
  return Buffer.concat([sig, ihdr, Buffer.alloc(32)])
}
const dataUrl = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`

const pousser = (corps: Record<string, unknown>) =>
  syncPOST(new Request('http://x/api/sync/mechanic-avatar', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps),
  }))

const autoriseSur = (garageId: string) => ({ ok: true, code: '', licenseId: `lic-${garageId}`, garageId })

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST: syncPOST } = (await import('@/app/api/sync/mechanic-avatar/route')) as any)

  garageA = (await prisma.garage.create({ data: { name: 'A', slug: 'a' } })).id
  garageB = (await prisma.garage.create({ data: { name: 'B', slug: 'b' } })).id
  const mk = async (garageId: string, name: string) =>
    (await prisma.mechanic.create({ data: { garageId, name, avatar: 'XX', color: '#123456' } })).id
  jean = await mk(garageA, 'Jean Dupont')
  mecanoB = await mk(garageB, 'Bruno Blanc')
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  fs.rmSync(PHOTOS_DIR, { recursive: true, force: true })
})

beforeEach(() => { h.auth = autoriseSur(garageA) })

describe('réception de la photo', () => {
  it('enregistre l\'image, écrit le fichier et rend une URL', async () => {
    const res = await pousser({
      garageLicense: 'GF2.x', garage: { id: garageA }, mechanic: { id: jean },
      image: dataUrl(png()), hash: 'empreinte-du-poste', updatedAt: '2026-08-13T10:00:00.000Z',
    })
    expect(res.status).toBe(200)
    const corps = await res.json()
    expect(corps.ok).toBe(true)
    expect(corps.avatarUrl).toMatch(/^\/api\/photos\/mechanics\//)

    const enBase = await prisma.mechanic.findUnique({ where: { id: jean } })
    expect(enBase.avatarPath).toBeTruthy()
    expect(fs.existsSync(path.join(PHOTOS_DIR, enBase.avatarPath))).toBe(true)
    // L'empreinte stockée est celle que CE serveur a calculée après nettoyage,
    // jamais celle annoncée par le poste.
    expect(enBase.avatarHash).not.toBe('empreinte-du-poste')
    expect(enBase.avatarHash).toHaveLength(64)
  })

  it('l\'horodatage du poste fait foi pour la date de mise à jour', async () => {
    const enBase = await prisma.mechanic.findUnique({ where: { id: jean } })
    expect(enBase.avatarUpdatedAt.toISOString()).toBe('2026-08-13T10:00:00.000Z')
  })
})

describe('le cloud ne croit pas le poste sur parole', () => {
  it('refuse une image invalide, même annoncée comme valide', async () => {
    const avant = await prisma.mechanic.findUnique({ where: { id: jean } })
    const res = await pousser({
      garageLicense: 'GF2.x', garage: { id: garageA }, mechanic: { id: jean },
      image: dataUrl(Buffer.from('<svg><script>alert(1)</script></svg>')),
      hash: 'peu-importe', updatedAt: '2026-08-13T12:00:00.000Z',
    })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_IMAGE')
    const apres = await prisma.mechanic.findUnique({ where: { id: jean } })
    expect(apres.avatarPath).toBe(avant.avatarPath)
  })

  it('un poste ne peut pas poser de photo sur un mécanicien d\'un AUTRE garage', async () => {
    // Le garageId de confiance vient de la licence, pas du corps : annoncer
    // `garage.id = garageB` ne change rien.
    h.auth = autoriseSur(garageA)
    const res = await pousser({
      garageLicense: 'GF2.x', garage: { id: garageB }, mechanic: { id: mecanoB },
      image: dataUrl(png()), hash: 'x', updatedAt: '2026-08-13T10:00:00.000Z',
    })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('MECHANIC_NOT_MIRRORED')
    expect((await prisma.mechanic.findUnique({ where: { id: mecanoB } })).avatarPath).toBeNull()
  })

  it('un refus d\'authentification bloque tout', async () => {
    h.auth = { ok: false, code: 'LICENSE_REVOKED' }
    const res = await pousser({
      garageLicense: 'GF2.x', garage: { id: garageA }, mechanic: { id: jean },
      image: dataUrl(png()), hash: 'x', updatedAt: '2026-08-13T13:00:00.000Z',
    })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('LICENSE_REVOKED')
  })

  it('un mécanicien inconnu du cloud ne se crée pas par une simple photo', async () => {
    const res = await pousser({
      garageLicense: 'GF2.x', garage: { id: garageA }, mechanic: { id: 'jamais-vu' },
      image: dataUrl(png()), hash: 'x', updatedAt: '2026-08-13T10:00:00.000Z',
    })
    expect(res.status).toBe(409)
    expect(await prisma.mechanic.count({ where: { id: 'jamais-vu' } })).toBe(0)
  })
})

describe('idempotence et ordre d\'arrivée', () => {
  it('une photo INCHANGÉE ne réécrit rien et garde la même URL', async () => {
    const avant = await prisma.mechanic.findUnique({ where: { id: jean } })
    const res = await pousser({
      garageLicense: 'GF2.x', garage: { id: garageA }, mechanic: { id: jean },
      image: dataUrl(png()), hash: avant.avatarHash, updatedAt: '2026-08-13T14:00:00.000Z',
    })
    const corps = await res.json()
    expect(corps.skipped).toBe('UNCHANGED')
    // URL inchangée : réécrire invaliderait les caches de toutes les surfaces
    // pour une image identique.
    expect(corps.avatarUrl).toBe(`/api/photos/${avant.avatarPath}`)
    const apres = await prisma.mechanic.findUnique({ where: { id: jean } })
    expect(apres.avatarPath).toBe(avant.avatarPath)
  })

  it('une propagation RETARDÉE n\'écrase pas une photo plus récente', async () => {
    // Une photo récente est en place…
    await pousser({
      garageLicense: 'GF2.x', garage: { id: garageA }, mechanic: { id: jean },
      image: dataUrl(png(300, 300)), hash: 'h-recent', updatedAt: '2026-08-13T20:00:00.000Z',
    })
    const recente = await prisma.mechanic.findUnique({ where: { id: jean } })

    // …et un rattrapage après reconnexion apporte une photo PLUS ANCIENNE.
    const res = await pousser({
      garageLicense: 'GF2.x', garage: { id: garageA }, mechanic: { id: jean },
      image: dataUrl(png(128, 128)), hash: 'h-ancien', updatedAt: '2026-08-13T09:00:00.000Z',
    })
    expect((await res.json()).skipped).toBe('STALE')

    const apres = await prisma.mechanic.findUnique({ where: { id: jean } })
    expect(apres.avatarPath).toBe(recente.avatarPath)
    expect(apres.avatarUpdatedAt.toISOString()).toBe('2026-08-13T20:00:00.000Z')
  })

  it('une photo plus RÉCENTE remplace bien l\'ancienne et nettoie le disque', async () => {
    const avant = await prisma.mechanic.findUnique({ where: { id: jean } })
    await pousser({
      garageLicense: 'GF2.x', garage: { id: garageA }, mechanic: { id: jean },
      image: dataUrl(png(200, 200)), hash: 'h-neuf', updatedAt: '2026-08-13T22:00:00.000Z',
    })
    const apres = await prisma.mechanic.findUnique({ where: { id: jean } })
    expect(apres.avatarPath).not.toBe(avant.avatarPath)
    expect(fs.existsSync(path.join(PHOTOS_DIR, apres.avatarPath))).toBe(true)
    expect(fs.existsSync(path.join(PHOTOS_DIR, avant.avatarPath))).toBe(false)
  })
})

describe('propagation du RETRAIT', () => {
  it('supprimer la photo sur le poste la retire du cloud et du disque', async () => {
    const avant = await prisma.mechanic.findUnique({ where: { id: jean } })
    expect(avant.avatarPath).toBeTruthy()

    const res = await pousser({
      garageLicense: 'GF2.x', garage: { id: garageA }, mechanic: { id: jean },
      image: null, hash: null, updatedAt: '2026-08-13T23:00:00.000Z',
    })
    expect((await res.json()).avatarUrl).toBeNull()

    const apres = await prisma.mechanic.findUnique({ where: { id: jean } })
    expect(apres.avatarPath).toBeNull()
    expect(apres.avatarHash).toBeNull()
    // Sans propagation du retrait, l'ancienne photo serait restée visible sur
    // les autres surfaces.
    expect(fs.existsSync(path.join(PHOTOS_DIR, avant.avatarPath))).toBe(false)
  })

  it('retirer une photo déjà absente est sans effet', async () => {
    const res = await pousser({
      garageLicense: 'GF2.x', garage: { id: garageA }, mechanic: { id: jean },
      image: null, hash: null, updatedAt: '2026-08-14T00:00:00.000Z',
    })
    expect((await res.json()).skipped).toBe('ALREADY_EMPTY')
  })
})
