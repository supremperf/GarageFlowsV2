/**
 * GF-030 — la voie de retour CLOUD → POSTE se bloquait définitivement.
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * Un curseur UNIQUE commandait les trois flux du retour (exécution,
 * commentaires, photos), calé sur le flux le plus en retard. Un garage dont la
 * dernière photo de mécanicien datait de trois mois redemandait donc, à chaque
 * passage, tout ce qui s'était écrit depuis trois mois — et le serveur n'en
 * renvoyait que les 200 plus ANCIENS. Passé ce volume, la réponse ne contenait
 * plus que des commentaires DÉJÀ appliqués : les nouveaux ne redescendaient
 * jamais. Le garage ne lisait plus un mot de son mécanicien, sans le moindre
 * message d'erreur.
 *
 * Le curseur photo, lui, se bloquait sur toute photo impossible à rapatrier —
 * et il y en avait une catégorie entière : celles écrites sur DISQUE par
 * `POST /api/mechanic/jobs/[id]/photos` (`base64: ''`), auxquelles la
 * passerelle répondait « NO_INLINE_DATA ». Redemandées toutes les 10 secondes,
 * jamais obtenues (§7).
 *
 * Chaque flux porte désormais son propre curseur, le serveur annonce qu'il a
 * tronqué, et une photo sur disque est relue depuis le fichier.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const DB_PATH = path.resolve(__dirname, '../../.tmp-voie-retour.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

/** Dossier photos du « cloud » simulé — activé AVANT l'import du magasin. */
const PHOTOS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-photos-'))
process.env.GF_PHOTOS_DIR = PHOTOS_DIR

const cloud = vi.hoisted(() => ({
  corps: [] as Record<string, unknown>[],
  reponses: [] as Record<string, unknown>[],
  photoReponse: null as Record<string, unknown> | null,
}))
vi.mock('@/lib/sync/cloud-client', () => ({
  isDesktopInstance: () => true,
  // Preuve d'identité du poste : sans elle la remontée s'arrête avant tout
  // appel réseau. Simulée ici — sa recherche en base a ses propres tests.
  garageLicenseToken: async () => 'GF2.jeton-licence-test',
  cloudPost: async (chemin: string, corps: Record<string, unknown>) => {
    cloud.corps.push({ chemin, ...corps })
    if (chemin === '/api/sync/job-photo') {
      return cloud.photoReponse ?? { ok: false, code: 'NOT_FOUND' }
    }
    return cloud.reponses.shift() ?? { ok: true, data: { deletedApplied: [], changes: null } }
  },
}))
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))
/**
 * La vérification de licence GF2 n'est pas l'objet de ce test — elle est
 * couverte ailleurs, et la reproduire ici demanderait de signer un jeton réel.
 * On ne remplace donc QUE la porte d'entrée ; tout ce qui suit dans la route
 * (lecture en base, relecture du fichier, forme de la réponse) est le vrai code.
 */
vi.mock('@/lib/sync/garage-auth', async (orig) => {
  const reel = await (orig as () => Promise<Record<string, unknown>>)()
  return {
    ...reel,
    authenticateGarageLicense: async (_t: unknown, claimed: string) => ({ ok: true, garageId: claimed }),
  }
})

let prisma: any
let syncGarageJobs: (garageId: string, now?: Date) => Promise<Record<string, unknown>>
let collectMechanicChanges: any
let parseReturnCursors: any
let RETURN_MAX_NOTES = 200
let readPhotoAsDataUrl: (r: string | null | undefined) => string | null
let savePhoto: (b64: string, sub: string) => string | null
let garageId = ''
let mecanicienId = ''
let jobId = ''

/** 1×1 GIF transparent — vraie image, deux cents octets suffisent. */
const GIF =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

const dernierEnvoi = () => cloud.corps.filter((c) => c.chemin === '/api/sync/jobs').slice(-1)[0]

beforeAll(async () => {
  const { prepareTestDb } = await import('../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ syncGarageJobs } = (await import('@/lib/sync/job-sync')) as any)
  ;({ collectMechanicChanges, parseReturnCursors, RETURN_MAX_NOTES } =
    (await import('@/lib/sync/return-path')) as any)
  ;({ readPhotoAsDataUrl, savePhoto } = (await import('@/lib/photo-store')) as any)

  const garage = await prisma.garage.create({ data: { name: 'Retour', slug: 'voie-retour' } })
  garageId = garage.id
  mecanicienId = (await prisma.mechanic.create({
    data: { garageId, name: 'Jean', avatar: 'J', color: '#123456' },
  })).id
  await prisma.licenseKey.create({
    data: {
      licenseId: 'lic-voie-retour', token: 'GF2.aaa.bbb.ccc', customerId: 'client-test',
      licenseType: 'premium', expiryAt: new Date('2030-01-01'), status: 'active', garageId,
    },
  })
  jobId = (await prisma.job.create({
    data: {
      garageId, mechanicId: mecanicienId, customerName: 'C', vehicleModel: 'V',
      repairType: 'oil_change', estimatedDuration: 60, startTime: '09:00', date: '2026-08-14',
    },
  })).id
}, 180_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
  fs.rmSync(PHOTOS_DIR, { recursive: true, force: true })
})

beforeEach(async () => {
  cloud.corps = []
  cloud.reponses = []
  cloud.photoReponse = null
  await prisma.jobMechanicNote.deleteMany({})
  await prisma.jobPhoto.deleteMany({})
})

describe('curseurs indépendants (GF-030)', () => {
  it('une photo ANCIENNE ne retient plus le curseur des commentaires', async () => {
    // Le cas réel : commentaires quotidiens, photos rares.
    await prisma.jobPhoto.create({
      data: {
        jobId, garageId, mechanicId: mecanicienId, phase: 'during', base64: GIF,
        createdAt: new Date('2026-05-16T10:00:00Z'),
      },
    })
    await prisma.jobMechanicNote.create({
      data: {
        jobId, garageId, mechanicId: mecanicienId, type: 'comment', body: 'Récent',
        createdAt: new Date('2026-08-13T10:00:00Z'),
      },
    })

    await syncGarageJobs(garageId, new Date('2026-08-14T12:00:00Z'))
    const envoi = dernierEnvoi()

    expect(
      new Date(envoi.sinceNotes as string).getTime(),
      'le curseur des commentaires suivait la photo vieille de trois mois',
    ).toBeGreaterThan(new Date('2026-08-13T09:00:00Z').getTime())
    expect(new Date(envoi.sincePhotos as string).getTime())
      .toBeLessThan(new Date('2026-05-17T00:00:00Z').getTime())
  })

  it('un commentaire RÉCENT ne fait pas sauter des photos', async () => {
    // Le défaut symétrique, corrigé jadis en calant tout sur le flux le plus
    // lent : il ne doit pas revenir.
    await prisma.jobPhoto.create({
      data: {
        jobId, garageId, mechanicId: mecanicienId, phase: 'during', base64: GIF,
        createdAt: new Date('2026-05-16T10:00:00Z'),
      },
    })
    await prisma.jobMechanicNote.create({
      data: {
        jobId, garageId, mechanicId: mecanicienId, type: 'comment', body: 'Récent',
        createdAt: new Date('2026-08-13T10:00:00Z'),
      },
    })

    await syncGarageJobs(garageId, new Date('2026-08-14T12:00:00Z'))
    const envoi = dernierEnvoi()
    expect(
      new Date(envoi.sincePhotos as string).getTime(),
      'le curseur photo ne doit pas dépasser la dernière photo connue',
    ).toBeLessThan(new Date('2026-05-16T10:00:00Z').getTime() + 1)
  })

  it('un garage neuf ne demande AUCUN curseur (tout depuis l’origine)', async () => {
    await syncGarageJobs(garageId, new Date('2026-08-14T12:00:00Z'))
    const envoi = dernierEnvoi()
    expect(envoi.sinceNotes).toBeNull()
    expect(envoi.sincePhotos).toBeNull()
    expect(envoi.since).toBeNull()
  })

  it('`since` reste envoyé pour un serveur pas encore à jour', async () => {
    await prisma.jobMechanicNote.create({
      data: {
        jobId, garageId, mechanicId: mecanicienId, type: 'comment', body: 'x',
        createdAt: new Date('2026-08-13T10:00:00Z'),
      },
    })
    await prisma.jobPhoto.create({
      data: {
        jobId, garageId, mechanicId: mecanicienId, phase: 'during', base64: GIF,
        createdAt: new Date('2026-05-16T10:00:00Z'),
      },
    })
    await syncGarageJobs(garageId, new Date('2026-08-14T12:00:00Z'))
    const envoi = dernierEnvoi()
    // Le repli vaut exactement ce que l'ancien serveur recevait : le plus
    // ancien des deux. Il ne régresse donc pas.
    expect(new Date(envoi.since as string).getTime())
      .toBe(new Date(envoi.sincePhotos as string).getTime())
  })
})

describe('le serveur dit qu’il a tronqué (GF-030)', () => {
  const cible = { garageId, jobIds: [] as string[] }

  beforeEach(() => { cible.garageId = garageId; cible.jobIds = [jobId] })

  it('en dessous du plafond, rien n’est annoncé tronqué', async () => {
    for (let i = 0; i < 3; i++) {
      await prisma.jobMechanicNote.create({
        data: {
          jobId, garageId, mechanicId: mecanicienId, type: 'comment', body: `n${i}`,
          createdAt: new Date(Date.UTC(2026, 7, 1, 0, i)),
        },
      })
    }
    const r = await collectMechanicChanges(prisma, garageId, [jobId], { jobs: null, notes: null, photos: null })
    expect(r.notes).toHaveLength(3)
    expect(r.truncated.notes).toBe(false)
  })

  it('au plafond, le serveur l’ANNONCE — sinon le poste croit avoir tout reçu', async () => {
    // Le plafond est une pagination : sans l'annonce, le poste attendait le
    // prochain déclencheur pour la tranche suivante.
    const lignes = Array.from({ length: RETURN_MAX_NOTES + 5 }, (_, i) => ({
      jobId, garageId, mechanicId: mecanicienId, type: 'comment', body: `n${i}`,
      createdAt: new Date(Date.UTC(2026, 7, 1, 0, 0, i)),
    }))
    for (const l of lignes) await prisma.jobMechanicNote.create({ data: l })

    const p1 = await collectMechanicChanges(prisma, garageId, [jobId], { jobs: null, notes: null, photos: null })
    expect(p1.notes).toHaveLength(RETURN_MAX_NOTES)
    expect(p1.truncated.notes, 'le reste doit être annoncé').toBe(true)

    // Deuxième tranche : le curseur avancé rend le RESTE, pas la même tranche.
    const curseur = new Date(p1.notes[p1.notes.length - 1].createdAt as Date)
    const p2 = await collectMechanicChanges(prisma, garageId, [jobId], { jobs: null, notes: curseur, photos: null })
    expect(p2.notes).toHaveLength(5)
    expect(p2.truncated.notes).toBe(false)
    expect(
      p2.notes.map((n: any) => n.id).some((id: string) => p1.notes.some((n: any) => n.id === id)),
      'aucun recouvrement : la file s’écoule vraiment',
    ).toBe(false)
  })

  it('aucune intervention dans la fenêtre : forme stable, jamais d’exception', async () => {
    const r = await collectMechanicChanges(prisma, garageId, [], { jobs: null, notes: null, photos: null })
    expect(r).toEqual({ jobs: [], notes: [], photos: [], truncated: { notes: false, photos: false } })
  })
})

describe('curseurs annoncés par le poste — lecture côté serveur', () => {
  it('les trois curseurs sont lus séparément', () => {
    const c = parseReturnCursors({
      since: '2026-01-01T00:00:00.000Z',
      sinceNotes: '2026-08-13T00:00:00.000Z',
      sincePhotos: '2026-05-16T00:00:00.000Z',
    })
    expect(c.notes?.toISOString()).toBe('2026-08-13T00:00:00.000Z')
    expect(c.photos?.toISOString()).toBe('2026-05-16T00:00:00.000Z')
    expect(c.jobs?.toISOString(), 'sans curseur propre, `since` fait office').toBe('2026-01-01T00:00:00.000Z')
  })

  it('un poste ANCIEN, qui n’envoie que `since`, fonctionne comme avant', () => {
    const c = parseReturnCursors({ since: '2026-01-01T00:00:00.000Z' })
    expect(c.notes?.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(c.photos?.toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('une valeur illisible n’est jamais prise pour un instant', () => {
    const c = parseReturnCursors({ since: 'hier', sinceNotes: '', sincePhotos: 42 })
    expect(c.notes).toBeNull()
    expect(c.photos).toBeNull()
    expect(c.jobs).toBeNull()
  })
})

describe('photo stockée sur DISQUE : elle redescend (GF-030)', () => {
  /** Appelle la VRAIE passerelle de récupération des octets. */
  const demanderOctets = async (photoId: string) => {
    const { POST } = (await import('@/app/api/sync/job-photo/route')) as any
    const res = await POST(new Request('http://localhost/api/sync/job-photo', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ garageLicense: 'GF2.a.b.c', garageId, photoId }),
    }))
    return { status: res.status, corps: await res.json() }
  }

  it('la passerelle SERT une photo stockée en fichier', async () => {
    // Le cas nominal d'une photo prise par le mécanicien quand le stockage
    // fichier est actif : `base64` vaut '' et seul `photoPath` est renseigné.
    const chemin = savePhoto(GIF, `jobs/${jobId}`)
    const photo = await prisma.jobPhoto.create({
      data: {
        jobId, garageId, mechanicId: mecanicienId, phase: 'during',
        base64: '', photoPath: chemin,
      },
    })

    const { status, corps } = await demanderOctets(photo.id)
    expect(status, 'la passerelle répondait 409 « NO_INLINE_DATA »').toBe(200)
    expect(corps.ok).toBe(true)
    expect(corps.photo.base64, 'les octets doivent être ceux du fichier').toBe(GIF)
    expect(corps.photo, 'le chemin serveur ne sort pas de la machine').not.toHaveProperty('photoPath')
  })

  it('une photo stockée en colonne continue de passer', async () => {
    const photo = await prisma.jobPhoto.create({
      data: { jobId, garageId, mechanicId: mecanicienId, phase: 'during', base64: GIF },
    })
    const { status, corps } = await demanderOctets(photo.id)
    expect(status).toBe(200)
    expect(corps.photo.base64).toBe(GIF)
  })

  it('ni colonne ni fichier : refus explicite, sans détail technique', async () => {
    const photo = await prisma.jobPhoto.create({
      data: {
        jobId, garageId, mechanicId: mecanicienId, phase: 'during',
        base64: '', photoPath: `jobs/${jobId}/photo_absente.png`,
      },
    })
    const { status, corps } = await demanderOctets(photo.id)
    expect(status).toBe(409)
    expect(corps.code).toBe('NO_INLINE_DATA')
    expect(JSON.stringify(corps), 'aucun chemin serveur exposé (§83)').not.toContain(PHOTOS_DIR)
  })

  it('la photo d’un AUTRE garage reste introuvable', async () => {
    const autre = await prisma.garage.create({ data: { name: 'B', slug: `voisin-${Date.now()}` } })
    const mecanoB = await prisma.mechanic.create({ data: { garageId: autre.id, name: 'B', avatar: 'B', color: '#fff' } })
    const jobB = await prisma.job.create({
      data: {
        garageId: autre.id, mechanicId: mecanoB.id, customerName: 'X', vehicleModel: 'Y',
        repairType: 'oil_change', estimatedDuration: 30, startTime: '10:00', date: '2026-08-14',
      },
    })
    const photoB = await prisma.jobPhoto.create({
      data: { jobId: jobB.id, garageId: autre.id, mechanicId: mecanoB.id, phase: 'during', base64: GIF },
    })

    const { status } = await demanderOctets(photoB.id)
    expect(status, 'le cloisonnement multi-garage ne bouge pas').toBe(404)

    await prisma.jobPhoto.deleteMany({ where: { garageId: autre.id } })
    await prisma.job.deleteMany({ where: { garageId: autre.id } })
    await prisma.mechanic.deleteMany({ where: { garageId: autre.id } })
    await prisma.garage.delete({ where: { id: autre.id } })
  })

  it('le magasin relit un fichier écrit', () => {
    const rel = savePhoto(GIF, 'jobs/test')
    expect(rel, 'le stockage fichier doit être actif dans ce test').toBeTruthy()
    const relu = readPhotoAsDataUrl(rel)
    expect(relu, 'sans relecture, la photo du mécanicien n’atteint jamais le garage').toBe(GIF)
  })

  it('refuse de sortir du dossier des photos', () => {
    expect(readPhotoAsDataUrl('../../../etc/passwd')).toBeNull()
    expect(readPhotoAsDataUrl('')).toBeNull()
    expect(readPhotoAsDataUrl(null)).toBeNull()
  })

  it('un fichier absent ne rend rien plutôt qu’une exception', () => {
    expect(readPhotoAsDataUrl('jobs/test/photo_inexistante.png')).toBeNull()
  })
})

describe('GF-031 — le décalage d’horloge compte AUSSI à la descente', () => {
  /** Réponse cloud portant une exécution de mécanicien datée `cloudAt`. */
  const reponseExecution = (cloudAt: string, syncedAt: string) => ({
    ok: true,
    data: {
      deletedApplied: [],
      syncedAt,
      changes: {
        notes: [], photos: [], truncated: { notes: false, photos: false },
        jobs: [{
          id: jobId, status: 'completed', actualDuration: 45,
          delayMinutes: null, timerStartedAt: null, timerAccumulatedSec: 2700,
          updatedAt: cloudAt,
        }],
      },
    },
  })

  beforeEach(async () => {
    const { __resetJobSyncScheduler } = (await import('@/lib/sync/job-sync')) as any
    __resetJobSyncScheduler()
    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'scheduled', actualDuration: null, timerAccumulatedSec: 0 },
    })
  })

  it('un poste EN AVANCE réapplique quand même le travail du mécanicien', async () => {
    // Horloge du poste avancée de 10 minutes. Le mécanicien a terminé à 12h00
    // heure SERVEUR, le poste croit qu'il est 12h10 : brut, le miroir paraissait
    // toujours plus vieux que le local et n'était JAMAIS réappliqué.
    const local = await prisma.job.findUnique({ where: { id: jobId }, select: { updatedAt: true } })
    const posteNow = new Date(local!.updatedAt.getTime() + 60_000)
    const serveurNow = new Date(posteNow.getTime() - 10 * 60_000)
    // Le mécanicien agit APRÈS la dernière écriture locale, dans l'horloge du serveur.
    const cloudAt = new Date(serveurNow.getTime() - 1_000)

    cloud.reponses = [reponseExecution(cloudAt.toISOString(), serveurNow.toISOString())]
    const res = await syncGarageJobs(garageId, posteNow)

    expect(res.appliedBack, 'le travail du mécanicien doit redescendre').toBe(1)
    const apres = await prisma.job.findUnique({ where: { id: jobId } })
    expect(apres.status).toBe('completed')
    expect(apres.actualDuration).toBe(45)
  })

  it('un poste EN RETARD n’écrase plus ses propres saisies avec un miroir périmé', async () => {
    // Horloge du poste en retard de 10 minutes : tout miroir paraissait plus
    // récent que le local, donc réappliqué à chaque passage.
    const local = await prisma.job.findUnique({ where: { id: jobId }, select: { updatedAt: true } })
    const posteNow = new Date(local!.updatedAt.getTime() + 60_000)
    const serveurNow = new Date(posteNow.getTime() + 10 * 60_000)
    // Le mécanicien a agi AVANT la dernière écriture locale (heure serveur).
    const cloudAt = new Date(local!.updatedAt.getTime() + 10 * 60_000 - 120_000)

    cloud.reponses = [reponseExecution(cloudAt.toISOString(), serveurNow.toISOString())]
    const res = await syncGarageJobs(garageId, posteNow)

    expect(res.appliedBack, 'la saisie du garage est plus récente : rien à réappliquer').toBe(0)
    const apres = await prisma.job.findUnique({ where: { id: jobId } })
    expect(apres.status).toBe('scheduled')
  })

  it('sans `syncedAt`, le comportement reste EXACTEMENT celui d’avant', async () => {
    // Un serveur pas encore à jour n'en fournit pas : aucune compensation, donc
    // aucune régression pour lui.
    const local = await prisma.job.findUnique({ where: { id: jobId }, select: { updatedAt: true } })
    const cloudAt = new Date(local!.updatedAt.getTime() + 60_000)
    cloud.reponses = [{
      ok: true,
      data: {
        deletedApplied: [],
        changes: {
          notes: [], photos: [], truncated: { notes: false, photos: false },
          jobs: [{
            id: jobId, status: 'completed', actualDuration: 45, delayMinutes: null,
            timerStartedAt: null, timerAccumulatedSec: 2700, updatedAt: cloudAt.toISOString(),
          }],
        },
      },
    }]
    const res = await syncGarageJobs(garageId, new Date(local!.updatedAt.getTime() + 30_000))
    expect(res.appliedBack).toBe(1)
  })
})

describe('GF-032 — la fenêtre entière n’est plus redemandée à chaque passage', () => {
  beforeEach(async () => {
    const { __resetJobSyncScheduler } = (await import('@/lib/sync/job-sync')) as any
    __resetJobSyncScheduler()
  })

  it('le premier passage demande tout, le suivant seulement le nouveau', async () => {
    const t1 = '2026-08-14T12:00:00.000Z'
    cloud.reponses = [
      { ok: true, data: { deletedApplied: [], syncedAt: t1, changes: null } },
      { ok: true, data: { deletedApplied: [], syncedAt: '2026-08-14T12:00:30.000Z', changes: null } },
    ]

    await syncGarageJobs(garageId, new Date('2026-08-14T12:00:00Z'))
    const premier = dernierEnvoi()
    expect(premier.sinceJobs, 'aucun repère encore : passage complet').toBeNull()

    await syncGarageJobs(garageId, new Date('2026-08-14T12:00:30Z'))
    const second = dernierEnvoi()
    expect(second.sinceJobs, 'le repère est l’heure que le SERVEUR a datée').toBeTruthy()
    expect(new Date(second.sinceJobs as string).getTime())
      .toBe(new Date(t1).getTime() - 60_000)
  })

  it('le curseur des interventions ne contamine pas le repli `since`', async () => {
    // Un serveur pas encore à jour n'utilise que `since` : y glisser le curseur
    // des interventions lui ferait sauter des commentaires et des photos.
    await prisma.jobMechanicNote.create({
      data: {
        jobId, garageId, mechanicId: mecanicienId, type: 'comment', body: 'x',
        createdAt: new Date('2026-05-01T10:00:00Z'),
      },
    })
    cloud.reponses = [
      { ok: true, data: { deletedApplied: [], syncedAt: '2026-08-14T12:00:00.000Z', changes: null } },
      { ok: true, data: { deletedApplied: [], syncedAt: '2026-08-14T12:00:30.000Z', changes: null } },
    ]
    await syncGarageJobs(garageId, new Date('2026-08-14T12:00:00Z'))
    await syncGarageJobs(garageId, new Date('2026-08-14T12:00:30Z'))

    const envoi = dernierEnvoi()
    expect(new Date(envoi.since as string).getTime())
      .toBe(new Date('2026-05-01T10:00:00Z').getTime() - 60_000)
  })
})

describe('écoulement de l’arriéré (GF-030)', () => {
  it('une réponse tronquée demande un nouveau passage', async () => {
    await prisma.job.update({ where: { id: jobId }, data: { date: '2026-08-14' } })
    cloud.reponses = [{
      ok: true,
      data: {
        deletedApplied: [],
        changes: {
          jobs: [], photos: [],
          notes: [{
            id: 'note-arrieree', jobId, mechanicId: mecanicienId, type: 'comment',
            body: 'un mot du mécanicien', createdAt: '2026-08-14T08:00:00.000Z',
          }],
          truncated: { notes: true, photos: false },
        },
      },
    }]

    const res = await syncGarageJobs(garageId, new Date('2026-08-14T12:00:00Z'))
    expect(res.appliedBack, 'le commentaire doit être appliqué localement').toBe(1)
    expect(res.resteAPuiser, 'le poste doit savoir qu’il reste de l’arriéré').toBe(true)
    expect(await prisma.jobMechanicNote.count({ where: { id: 'note-arrieree' } })).toBe(1)
  })

  it('sans PROGRÈS, on ne repasse pas — pas de boucle sur un cloud bloqué', async () => {
    cloud.reponses = [{
      ok: true,
      data: {
        deletedApplied: [],
        // Le cloud annonce un reste mais ne rend rien d'applicable.
        changes: { jobs: [], notes: [], photos: [], truncated: { notes: true, photos: true } },
      },
    }]
    const res = await syncGarageJobs(garageId, new Date('2026-08-14T12:00:00Z'))
    expect(res.appliedBack).toBe(0)
    expect(res.resteAPuiser, 'sinon le poste tournerait sans fin').toBe(false)
  })
})
