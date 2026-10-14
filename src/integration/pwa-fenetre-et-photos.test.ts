/**
 * GF-038 — la PWA du mécanicien : fenêtre tenue à jour, et photos réduites.
 *
 * ─── Le miroir n'est rafraîchi que dans une fenêtre ─────────────────────────
 * Le poste ne remonte que [J−7, J+30] (`syncWindow`), et le cloud ne purge que
 * dans cette même fenêtre. En dehors, le miroir reste FIGÉ : une intervention
 * datée d'il y a plus de sept jours, puis réaffectée ou modifiée sur le poste,
 * gardait éternellement son ancien état — et la PWA laissait pourtant y
 * naviguer, flèche par flèche, sans rien signaler. Le mécanicien lisait alors
 * une affectation qui n'existe plus, et pouvait y pointer son chrono.
 *
 * ─── La photo partait telle quelle ──────────────────────────────────────────
 * Trois écrans réduisaient la photo avant l'envoi, chacun avec sa copie du même
 * passage canvas. Le quatrième — celui qui prend le plus de photos — envoyait
 * le fichier brut de l'appareil.
 */
type OriginalModule1 = typeof import('@/lib/mechanic-api')

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../.tmp-pwa-fenetre.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ ctx: null as any }))
vi.mock('@/lib/mechanic-api', async (importOriginal) => {
  const reel = await importOriginal<OriginalModule1>()
  return { ...reel, withMechanic: (fn: any) => fn, requireMechanic: async () => h.ctx }
})

let prisma: any
let scheduleGET: (req: Request) => Promise<Response>
let findAssignedJob: (ctx: any, id: string) => Promise<any>
let syncWindow: (d: Date) => { from: string; to: string }
const ids = { garage: '', mecano: '' }

/** Date ISO décalée de `n` jours (négatif = passé). */
const jour = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const creerJob = (date: string) => prisma.job.create({
  data: {
    garageId: ids.garage, mechanicId: ids.mecano, customerName: 'Client',
    vehicleModel: 'Clio', repairType: 'oil_change', estimatedDuration: 60,
    startTime: '09:00', date,
  },
})

const lirePlanning = async (date?: string) => {
  const url = date ? `http://localhost/api/mechanic/schedule?date=${date}` : 'http://localhost/api/mechanic/schedule'
  const res = await scheduleGET(new Request(url))
  const texte = await res.text()
  expect(res.status, texte).toBe(200)
  return JSON.parse(texte)
}

beforeAll(async () => {
  const { prepareTestDb } = await import('../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ GET: scheduleGET } = (await import('@/app/api/mechanic/schedule/route')) as any)
  ;({ findAssignedJob } = (await import('@/lib/mechanic-api')) as any)
  ;({ syncWindow } = (await import('@/lib/sync/job-fields')) as any)

  const garage = await prisma.garage.create({ data: { name: 'PWA', slug: 'pwa-fenetre' } })
  const mecano = await prisma.mechanic.create({
    data: { name: 'Jean', avatar: 'J', color: '#123456', garageId: garage.id },
  })
  ids.garage = garage.id; ids.mecano = mecano.id
  h.ctx = { garageId: garage.id, mechanicId: mecano.id, licenseId: 'lic-pwa' }
}, 120_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

beforeEach(async () => { await prisma.job.deleteMany({}) })

describe('GF-038 — la PWA ne montre que ce qui est tenu à jour', () => {
  it('une intervention DANS la fenêtre s’affiche', async () => {
    await creerJob(jour(1))
    const r = await lirePlanning()
    expect(r.data).toHaveLength(1)
  })

  it('une intervention trop ANCIENNE n’est plus servie', async () => {
    // J−30 : hors de [J−7, J+30]. Le miroir n'y est plus rafraîchi.
    await creerJob(jour(-30))
    const r = await lirePlanning()
    expect(r.data, 'son état est figé depuis des semaines').toHaveLength(0)
  })

  it('une intervention trop LOINTAINE n’est plus servie', async () => {
    await creerJob(jour(60))
    const r = await lirePlanning()
    expect(r.data, 'le poste ne l’a jamais remontée').toHaveLength(0)
  })

  it('les bornes de la fenêtre elles-mêmes passent', async () => {
    const fenetre = syncWindow(new Date())
    await creerJob(fenetre.from)
    await creerJob(fenetre.to)
    const r = await lirePlanning()
    expect(r.data, 'les bornes sont incluses').toHaveLength(2)
  })

  it('une DATE demandée hors fenêtre est refusée explicitement', async () => {
    await creerJob(jour(-30))
    const r = await lirePlanning(jour(-30))
    expect(r.data).toHaveLength(0)
    expect(r.outOfWindow, 'la PWA doit pouvoir le DIRE, pas afficher un vide muet').toBe(true)
    expect(r.window.from).toBeTruthy()
  })

  it('la réponse annonce toujours la fenêtre servie', async () => {
    const r = await lirePlanning()
    expect(r.window).toEqual(syncWindow(new Date()))
  })

  it('ouvrir une fiche hors fenêtre est refusé aussi', async () => {
    // Sinon le mécanicien pointait son chrono sur une affectation périmée.
    const ancienne = await creerJob(jour(-30))
    const recente = await creerJob(jour(1))
    expect(await findAssignedJob(h.ctx, ancienne.id)).toBeNull()
    expect(await findAssignedJob(h.ctx, recente.id)).toBeTruthy()
  })

  it('l’intervention d’un AUTRE mécanicien reste invisible', async () => {
    const autre = await prisma.mechanic.create({
      data: { name: 'Bob', avatar: 'B', color: '#fff', garageId: ids.garage },
    })
    const jobB = await prisma.job.create({
      data: {
        garageId: ids.garage, mechanicId: autre.id, customerName: 'X', vehicleModel: 'C3',
        repairType: 'oil_change', estimatedDuration: 60, startTime: '10:00', date: jour(1),
      },
    })
    const r = await lirePlanning()
    expect(r.data).toHaveLength(0)
    expect(await findAssignedJob(h.ctx, jobB.id)).toBeNull()
    await prisma.job.deleteMany({})
    await prisma.mechanic.delete({ where: { id: autre.id } })
  })
})

describe('GF-038 — plus aucun écran n’envoie la photo brute', () => {
  const RACINE = path.resolve(__dirname, '..')

  /**
   * L'ORDRE est imposé : commentaires de LIGNE d'abord, blocs ensuite. Dans
   * l'autre sens, un `/*` cité dans un `//` avale le code qui suit.
   */
  const sansCommentaires = (src: string) =>
    src.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ' ')

  /** Écrans qui déposent une PHOTO (le logo et l'OCR ont d'autres règles). */
  const ECRANS_PHOTO = [
    'components/JobPhotos.tsx',
    'components/InspectionModal.tsx',
    'app/mechanic/jobs/[id]/page.tsx',
  ]

  it.each(ECRANS_PHOTO)('%s passe par la réduction partagée', (fichier) => {
    const src = sansCommentaires(fs.readFileSync(path.join(RACINE, fichier), 'utf8'))
    expect(src, 'la réduction doit venir du module partagé').toContain('reduirePhoto(')
    expect(
      src,
      'envoyer le fichier brut de l’appareil : refus « trop volumineuse », puis instantané portail obèse',
    ).not.toContain('readAsDataURL')
  })

  it('le module partagé fixe des bornes explicites', async () => {
    const m = await import('@/lib/photo-client')
    expect(m.COTE_MAX_PAR_DEFAUT).toBeGreaterThan(0)
    expect(m.QUALITE_PAR_DEFAUT).toBeGreaterThan(0)
    expect(m.QUALITE_PAR_DEFAUT).toBeLessThanOrEqual(1)
  })

  it('le poids DÉCODÉ d’une data-URL est mesuré correctement', async () => {
    const { octetsDecodes } = await import('@/lib/photo-client')
    // 'AAAA' → 3 octets ; le préfixe et le remplissage ne comptent pas.
    expect(octetsDecodes('data:image/jpeg;base64,AAAA')).toBe(3)
    expect(octetsDecodes('data:image/jpeg;base64,AAA=')).toBe(2)
    expect(octetsDecodes('data:image/jpeg;base64,AA==')).toBe(1)
    expect(octetsDecodes('')).toBe(0)
  })
})
