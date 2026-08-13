/**
 * GF-PLAN-004 / 005 / 006 — photo de profil, archivage et isolation multi-garage.
 *
 * Vraies routes, vraie base SQLite, vrai stockage sur disque. Seule
 * l'authentification est simulée — c'est le sujet de tests voisins, pas celui-ci.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-mechanic-avatar.db')
const PHOTOS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-avatars-'))
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.GF_PHOTOS_DIR = PHOTOS_DIR

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', () => ({
  withAuth: (fn: unknown) => fn,
  requireSession: async () => h.session,
}))
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))

let avatarPUT: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let avatarDELETE: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let mechanicPATCH: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let mechanicDELETE: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let mechanicsGET: (req: Request) => Promise<Response>
let photosGET: (req: Request, ctx: { params: { path: string[] } }) => Promise<Response>
let prisma: any

let garageA: string
let garageB: string
let jean: string      // garage A, avec historique
let paul: string      // garage A, sans historique
let mecanoB: string   // garage B

/** PNG minimal valide de 256×256. */
function png(largeur = 256, hauteur = 256): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(25)
  ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'ascii')
  ihdr.writeUInt32BE(largeur, 8); ihdr.writeUInt32BE(hauteur, 12)
  ihdr[16] = 8; ihdr[17] = 6
  return Buffer.concat([sig, ihdr, Buffer.alloc(32)])
}
const dataUrl = (b: Buffer, mime = 'image/png') => `data:${mime};base64,${b.toString('base64')}`

const envoyerPhoto = (id: string, image: unknown) =>
  avatarPUT(
    new Request(`http://x/api/mechanics/${id}/avatar`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image }),
    }),
    { params: { id } },
  )

const supprimerPhoto = (id: string) =>
  avatarDELETE(new Request(`http://x/api/mechanics/${id}/avatar`, { method: 'DELETE' }), { params: { id } })

const patcher = (id: string, corps: unknown) =>
  mechanicPATCH(
    new Request(`http://x/api/mechanics/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps),
    }),
    { params: { id } },
  )

const sessionDe = (garageId: string, role = 'OWNER') => ({ user: { id: 'u', name: 'A', role, garageId } })

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ PUT: avatarPUT, DELETE: avatarDELETE } = (await import('@/app/api/mechanics/[id]/avatar/route')) as any)
  ;({ PATCH: mechanicPATCH, DELETE: mechanicDELETE } = (await import('@/app/api/mechanics/[id]/route')) as any)
  ;({ GET: mechanicsGET } = (await import('@/app/api/mechanics/route')) as any)
  ;({ GET: photosGET } = (await import('@/app/api/photos/[...path]/route')) as any)

  garageA = (await prisma.garage.create({ data: { name: 'A', slug: 'a' } })).id
  garageB = (await prisma.garage.create({ data: { name: 'B', slug: 'b' } })).id

  const mk = async (garageId: string, name: string) =>
    (await prisma.mechanic.create({ data: { garageId, name, avatar: 'XX', color: '#123456' } })).id

  jean = await mk(garageA, 'Jean Dupont')
  paul = await mk(garageA, 'Paul Martin')
  mecanoB = await mk(garageB, 'Bruno Blanc')

  // Jean a une HISTOIRE : une intervention terminée il y a longtemps.
  await prisma.job.create({
    data: {
      garageId: garageA, mechanicId: jean, customerName: 'Client', vehicleModel: 'Clio',
      repairType: 'vidange', date: '2024-01-15', startTime: '09:00', estimatedDuration: 60, status: 'completed',
    },
  })
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  fs.rmSync(PHOTOS_DIR, { recursive: true, force: true })
})

beforeEach(() => { h.session = sessionDe(garageA) })

describe('téléversement de la photo', () => {
  it('enregistre l\'image, écrit le fichier et rend une URL servable', async () => {
    const res = await envoyerPhoto(paul, dataUrl(png()))
    expect(res.status).toBe(200)
    const corps = await res.json()
    expect(corps.avatarUrl).toMatch(/^\/api\/photos\/mechanics\//)

    const enBase = await prisma.mechanic.findUnique({ where: { id: paul } })
    expect(enBase.avatarPath).toBeTruthy()
    expect(enBase.avatarMime).toBe('image/png')
    expect(enBase.avatarHash).toHaveLength(64)
    expect(enBase.avatarUpdatedAt).toBeTruthy()
    // Le fichier existe RÉELLEMENT sur le disque.
    expect(fs.existsSync(path.join(PHOTOS_DIR, enBase.avatarPath))).toBe(true)
  })

  it('la photo est réellement servie par la route authentifiée', async () => {
    const m = await prisma.mechanic.findUnique({ where: { id: paul } })
    const res = await photosGET(new Request('http://x'), { params: { path: m.avatarPath.split('/') } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0)
  })

  it('refuse un contenu qui n\'est pas une image, sans rien écrire', async () => {
    const avant = await prisma.mechanic.findUnique({ where: { id: jean } })
    const res = await envoyerPhoto(jean, dataUrl(Buffer.from('<svg><script>alert(1)</script></svg>'), 'image/png'))
    expect(res.status).toBe(400)
    const apres = await prisma.mechanic.findUnique({ where: { id: jean } })
    expect(apres.avatarPath).toBe(avant.avatarPath)
  })

  it('remplacer une photo change l\'URL et retire l\'ancien fichier', async () => {
    const premier = await prisma.mechanic.findUnique({ where: { id: paul } })
    const cheminPremier = premier.avatarPath

    await envoyerPhoto(paul, dataUrl(png(300, 300)))
    const second = await prisma.mechanic.findUnique({ where: { id: paul } })

    // URL NEUVE : ni le navigateur ni le service worker ne peuvent servir l'ancienne.
    expect(second.avatarPath).not.toBe(cheminPremier)
    expect(fs.existsSync(path.join(PHOTOS_DIR, second.avatarPath))).toBe(true)
    // Pas de fichier orphelin.
    expect(fs.existsSync(path.join(PHOTOS_DIR, cheminPremier))).toBe(false)
  })

  it('supprimer la photo revient au repli et nettoie le disque', async () => {
    const avant = await prisma.mechanic.findUnique({ where: { id: paul } })
    const res = await supprimerPhoto(paul)
    expect(res.status).toBe(200)
    expect((await res.json()).avatarUrl).toBeNull()

    const apres = await prisma.mechanic.findUnique({ where: { id: paul } })
    expect(apres.avatarPath).toBeNull()
    expect(apres.avatarMime).toBeNull()
    expect(fs.existsSync(path.join(PHOTOS_DIR, avant.avatarPath))).toBe(false)
  })

  it('supprimer une photo absente est sans effet, pas une erreur', async () => {
    expect((await supprimerPhoto(paul)).status).toBe(200)
  })
})

describe('isolation entre garages', () => {
  it('le garage A ne peut pas poser de photo sur un mécanicien du garage B', async () => {
    h.session = sessionDe(garageA)
    const res = await envoyerPhoto(mecanoB, dataUrl(png()))
    // 404 et non 403 : ne pas confirmer l'existence de la ressource.
    expect(res.status).toBe(404)
    expect((await prisma.mechanic.findUnique({ where: { id: mecanoB } })).avatarPath).toBeNull()
  })

  it('le garage A ne peut pas supprimer la photo d\'un mécanicien du garage B', async () => {
    h.session = sessionDe(garageB)
    await envoyerPhoto(mecanoB, dataUrl(png()))
    const pose = await prisma.mechanic.findUnique({ where: { id: mecanoB } })
    expect(pose.avatarPath).toBeTruthy()

    h.session = sessionDe(garageA)
    expect((await supprimerPhoto(mecanoB)).status).toBe(404)
    expect((await prisma.mechanic.findUnique({ where: { id: mecanoB } })).avatarPath).toBe(pose.avatarPath)
  })

  it('le garage A ne peut pas LIRE la photo d\'un mécanicien du garage B', async () => {
    // Le chemin est pourtant connu : l'isolation ne repose pas sur son secret.
    const b = await prisma.mechanic.findUnique({ where: { id: mecanoB } })
    h.session = sessionDe(garageA)
    const res = await photosGET(new Request('http://x'), { params: { path: b.avatarPath.split('/') } })
    expect(res.status).toBe(404)

    // …alors que son propre garage y accède.
    h.session = sessionDe(garageB)
    expect((await photosGET(new Request('http://x'), { params: { path: b.avatarPath.split('/') } })).status).toBe(200)
  })

  it('le garage A ne voit pas le mécanicien du garage B dans sa liste', async () => {
    h.session = sessionDe(garageA)
    const liste = await (await mechanicsGET(new Request('http://x/api/mechanics'))).json()
    expect(liste.map((m: { id: string }) => m.id)).not.toContain(mecanoB)
  })

  it('la traversée de chemin est refusée', async () => {
    h.session = sessionDe(garageA)
    for (const chemin of [['..', '..', 'etc', 'passwd'], ['..%2F..%2Fsecret'], ['mechanics', '..', '..', 'x']]) {
      const res = await photosGET(new Request('http://x'), { params: { path: chemin } })
      expect([403, 404]).toContain(res.status)
    }
  })
})

describe('permissions', () => {
  it('un rôle sans gestion ne peut pas modifier une photo', async () => {
    h.session = sessionDe(garageA, 'MECHANIC')
    expect((await envoyerPhoto(paul, dataUrl(png()))).status).toBe(403)
    h.session = sessionDe(garageA, 'RECEPTIONIST')
    expect((await supprimerPhoto(paul)).status).toBe(403)
  })
})

describe('archivage — l\'historique survit', () => {
  it('la suppression d\'un mécanicien AYANT un historique est refusée, avec la marche à suivre', async () => {
    h.session = sessionDe(garageA)
    const res = await mechanicDELETE(
      new Request(`http://x/api/mechanics/${jean}`, { method: 'DELETE' }),
      { params: { id: jean } },
    )
    expect(res.status).toBe(409)
    const corps = await res.json()
    expect(corps.code).toBe('MECHANIC_HAS_HISTORY')
    expect(corps.counts.interventions).toBe(1)
    // Le mécanicien est toujours là, et son intervention aussi.
    expect(await prisma.mechanic.count({ where: { id: jean } })).toBe(1)
    expect(await prisma.job.count({ where: { mechanicId: jean } })).toBe(1)
  })

  it('archiver le retire du planning SANS toucher à son historique', async () => {
    const res = await patcher(jean, { archived: true })
    expect(res.status).toBe(200)

    const enBase = await prisma.mechanic.findUnique({ where: { id: jean } })
    expect(enBase.archivedAt).toBeTruthy()
    // L'intervention passée est intacte et toujours reliée à lui.
    const intervention = await prisma.job.findFirst({ where: { mechanicId: jean } })
    expect(intervention).toBeTruthy()
    expect(intervention.status).toBe('completed')

    // Il disparaît de l'effectif actif…
    h.session = sessionDe(garageA)
    const actifs = await (await mechanicsGET(new Request('http://x/api/mechanics'))).json()
    expect(actifs.map((m: { id: string }) => m.id)).not.toContain(jean)

    // …mais reste nommable pour la lecture de l'historique.
    const tous = await (await mechanicsGET(new Request('http://x/api/mechanics?includeArchived=1'))).json()
    expect(tous.map((m: { id: string }) => m.id)).toContain(jean)
  })

  it('réactiver le fait réapparaître, sans le marquer absent', async () => {
    await prisma.mechanic.update({ where: { id: jean }, data: { isAbsent: true } })
    const res = await patcher(jean, { archived: false })
    expect(res.status).toBe(200)

    const enBase = await prisma.mechanic.findUnique({ where: { id: jean } })
    expect(enBase.archivedAt).toBeNull()
    // Sinon il revenait barré et marqué ABSENT le jour de son retour.
    expect(enBase.isAbsent).toBe(false)

    const actifs = await (await mechanicsGET(new Request('http://x/api/mechanics'))).json()
    expect(actifs.map((m: { id: string }) => m.id)).toContain(jean)
  })

  it('un mécanicien SANS historique peut être réellement supprimé', async () => {
    h.session = sessionDe(garageA)
    const jetable = (await prisma.mechanic.create({
      data: { garageId: garageA, name: 'Créé par erreur', avatar: 'CE', color: '#000000' },
    })).id
    const res = await mechanicDELETE(
      new Request(`http://x/api/mechanics/${jetable}`, { method: 'DELETE' }),
      { params: { id: jetable } },
    )
    expect(res.status).toBe(200)
    expect(await prisma.mechanic.count({ where: { id: jetable } })).toBe(0)
  })

  it('un rôle sans gestion ne peut pas archiver', async () => {
    h.session = sessionDe(garageA, 'MECHANIC')
    expect((await patcher(jean, { archived: true })).status).toBe(403)
  })

  it('`archived` doit être un booléen — pas une date choisie par le client', async () => {
    h.session = sessionDe(garageA)
    for (const v of ['true', 1, '2020-01-01', {}]) {
      expect((await patcher(jean, { archived: v })).status).toBe(400)
    }
  })

  it('le garage A ne peut pas archiver un mécanicien du garage B', async () => {
    h.session = sessionDe(garageA)
    expect((await patcher(mecanoB, { archived: true })).status).toBe(404)
    expect((await prisma.mechanic.findUnique({ where: { id: mecanoB } })).archivedAt).toBeNull()
  })
})
