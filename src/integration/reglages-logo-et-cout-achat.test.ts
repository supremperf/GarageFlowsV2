/**
 * Deux défauts P0 découverts pendant l'audit transversal du 2026-08-14.
 *
 * ─── GF-006 — le logo du garage était DÉTRUIT à chaque enregistrement ───────
 * Dès que le logo est stocké en FICHIER (cas normal sous Electron,
 * `GF_PHOTOS_DIR` défini), `GET /api/garages` renvoie `logoBase64: null` et
 * `logoPath: 'logos/…'`. L'écran des réglages charge cela dans son état
 * (`logoBase64: data.logoBase64 ?? ''`) puis renvoie TOUT son état à chaque
 * enregistrement. Le serveur recevait donc `logoBase64: ''` et le lisait comme
 * « supprime le logo » : corriger un numéro de téléphone effaçait le logo de
 * toutes les factures, de tous les devis et du portail client. Le fichier
 * restait sur le disque, orphelin, irrécupérable depuis l'application.
 *
 * ─── GF-007 — le coût d'achat servi à des rôles qui n'y ont pas droit ──────
 * `GET /api/jobs/:id/parts` renvoyait `unitCost` (la marge du garage) à tout
 * utilisateur authentifié. Les mêmes chiffres sont refusés à un RECEPTIONIST
 * par `/api/finance`, `/api/profitability` et `/api/export/fec` : le contrôle
 * posé sur une porte se contournait par celle d'à côté — exactement ce que
 * `redactLineCosts` avait été écrit pour empêcher (GF31-AUD-009).
 */
type OriginalModule1 = typeof import('@/lib/api-helpers')
type OriginalModule2 = typeof import('@/lib/security/rate-limit')

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../.tmp-reglages-logo.db')
const PHOTOS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-photos-'))
process.env.DATABASE_URL = `file:${DB_PATH}`
// Lu à l'import du module de stockage : doit être posé AVANT tout import.
process.env.GF_PHOTOS_DIR = PHOTOS_DIR

/** PNG 1×1 valide — le stockage refuse tout type hors liste blanche. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const h = vi.hoisted(() => ({ session: null as any }))
vi.mock('@/lib/api-helpers', async (importOriginal) => {
  const reel = await importOriginal<OriginalModule1>()
  return {
    ...reel,
    withAuth: (fn: (req: unknown, ctx: unknown) => Promise<Response>) =>
      async (req: unknown, ctx: unknown) => {
        try { return await fn(req, ctx) } catch (e) {
          if (e instanceof Response) return e
          return new Response(JSON.stringify({ error: 'internal' }), { status: 500, headers: { 'content-type': 'application/json' } })
        }
      },
    requireSession: async () => h.session,
  }
})
// Le limiteur de débit n'est pas le sujet ; il reste réel ailleurs.
vi.mock('@/lib/security/rate-limit', async (importOriginal) => {
  const reel = await importOriginal<OriginalModule2>()
  return { ...reel, enforceRateLimit: async () => ({ ok: true as const }) }
})

let prisma: any
let garagePATCH: (req: Request) => Promise<Response>
let garageGET: (req: Request) => Promise<Response>
let partsGET: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
const ids = { garage: '', job: '', part: '' }

/** Corps ENTIER envoyé par l'écran des réglages, comme en production. */
function reglages(sur: Record<string, unknown> = {}) {
  return {
    name: 'Garage Recette', address: '1 rue du Test', phone: '0102030405',
    email: 'contact@garage.test', website: '', siret: '', vatNumber: '',
    taxRate: 20, iban: '', bic: '', bankName: '', currency: 'EUR',
    paymentTerms: '30 jours net', invoicePrefix: 'FAC', quotePrefix: 'DEV',
    invoiceFooter: '', hourlyRate: 60, workshopStartHour: 8, workshopEndHour: 18,
    smsPhone: '', ...sur,
  }
}

const patch = (corps: Record<string, unknown>) =>
  garagePATCH(new Request('http://localhost/api/garages', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps),
  }))

const lireGarage = async () => (await garageGET(new Request('http://localhost/api/garages'))).json()

beforeAll(async () => {
  const { prepareTestDb } = await import('../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  const garages = (await import('@/app/api/garages/route')) as any
  garagePATCH = garages.PATCH
  garageGET = garages.GET
  ;({ GET: partsGET } = (await import('@/app/api/jobs/[id]/parts/route')) as any)

  const garage = await prisma.garage.create({ data: { name: 'Garage Recette', slug: 'garage-recette' } })
  const mecano = await prisma.mechanic.create({ data: { name: 'Alice', avatar: 'AL', color: '#000', garageId: garage.id } })
  const job = await prisma.job.create({
    data: {
      customerName: 'Jean', vehicleModel: 'Clio', repairType: 'oil_change',
      estimatedDuration: 60, startTime: '09:00', date: '2026-08-14',
      garageId: garage.id, mechanicId: mecano.id,
    },
  })
  const piece = await prisma.part.create({
    data: {
      name: 'Filtre à huile', quantity: 10, garageId: garage.id,
      unitCostTenThousandths: 41_2000, unitPriceTenThousandths: 90_0000,
    },
  })
  await prisma.jobPart.create({
    data: {
      jobId: job.id, partId: piece.id, quantity: 2,
      unitPriceTenThousandths: 90_0000, unitCostTenThousandths: 41_2000,
    },
  })
  ids.garage = garage.id; ids.job = job.id; ids.part = piece.id
  h.session = { user: { id: 'u1', garageId: garage.id, role: 'OWNER' } }
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
  fs.rmSync(PHOTOS_DIR, { recursive: true, force: true })
})

const fichiersLogo = () => {
  const d = path.join(PHOTOS_DIR, 'logos')
  return fs.existsSync(d) ? fs.readdirSync(d) : []
}

describe('réglages du garage — un garage sans site web peut enregistrer (GF-010)', () => {
  beforeEach(() => { h.session = { user: { id: 'u1', garageId: ids.garage, role: 'OWNER' } } })

  it('`website: ""` n’est pas une adresse invalide, c’est l’absence d’adresse', async () => {
    // L'écran renvoie TOUT son état à chaque enregistrement, et `website` vaut
    // '' tant que le garage n'en a pas. `z.string().url()` refusait la chaîne
    // vide : le garage ne pouvait enregistrer AUCUN réglage.
    const res = await patch(reglages({ website: '', phone: '0101010101' }))
    const corps = await res.text()
    expect(res.status, corps).toBe(200)
    expect(JSON.parse(corps).website).toBeNull()
  })

  it('une adresse web réellement saisie reste vérifiée', async () => {
    expect((await patch(reglages({ website: 'pas-une-url' }))).status).toBe(400)
    const bonne = await patch(reglages({ website: 'https://garage.test' }))
    expect(bonne.status).toBe(200)
    expect((await bonne.json()).website).toBe('https://garage.test')
  })
})

describe('horaires d’atelier — la demi-heure est enregistrable (GF-021)', () => {
  beforeEach(() => { h.session = { user: { id: 'u1', garageId: ids.garage, role: 'OWNER' } } })

  it('8 h 30 → 18 h 30 est accepté et persisté', async () => {
    const res = await patch(reglages({
      workshopStartHour: 8, workshopStartMinute: 30,
      workshopEndHour: 18, workshopEndMinute: 30,
    }))
    const corps = await res.text()
    expect(res.status, corps).toBe(200)
    const g = JSON.parse(corps)
    expect(g.workshopStartMinute).toBe(30)
    expect(g.workshopEndMinute).toBe(30)
  })

  it('une minute hors demi-heure est refusée', async () => {
    const res = await patch(reglages({
      workshopStartHour: 8, workshopStartMinute: 15,
      workshopEndHour: 18, workshopEndMinute: 0,
    }))
    expect(res.status).toBe(400)
  })

  it('une fermeture AVANT l’ouverture est refusée, minutes comprises', async () => {
    // « 8 h 30 → 8 h 00 » passait : la comparaison ne portait que sur les heures.
    const res = await patch(reglages({
      workshopStartHour: 8, workshopStartMinute: 30,
      workshopEndHour: 8, workshopEndMinute: 0,
    }))
    expect(res.status).toBe(400)
  })

  it('une amplitude de moins d’une heure est refusée', async () => {
    const res = await patch(reglages({
      workshopStartHour: 8, workshopStartMinute: 0,
      workshopEndHour: 8, workshopEndMinute: 30,
    }))
    expect(res.status).toBe(400)
  })

  it('un atelier ouvert 24 h/24 reste possible', async () => {
    const res = await patch(reglages({
      workshopStartHour: 0, workshopStartMinute: 0,
      workshopEndHour: 24, workshopEndMinute: 0,
    }))
    expect(res.status).toBe(200)
  })
})

describe('réglages du garage — le logo survit à un enregistrement (GF-006)', () => {
  beforeEach(() => { h.session = { user: { id: 'u1', garageId: ids.garage, role: 'OWNER' } } })

  it('importer un logo le range dans un FICHIER', async () => {
    const res = await patch(reglages({ logoBase64: PNG }))
    expect(res.status).toBe(200)
    const g = await res.json()
    expect(g.logoPath, 'le logo doit être stocké sur disque').toMatch(/^logos\/photo_[0-9a-f]+\.png$/)
    expect(g.logoBase64, 'et pas dupliqué en base').toBeNull()
    expect(fs.existsSync(path.join(PHOTOS_DIR, g.logoPath))).toBe(true)
  })

  it('un enregistrement ORDINAIRE ne touche pas au logo', async () => {
    // Reproduction fidèle : l'écran recharge, met `logoBase64: data.logoBase64
    // ?? ''` dans son état, puis renvoie TOUT son état pour changer le
    // téléphone. C'est ce corps-là qui effaçait le logo.
    const avant = await lireGarage()
    expect(avant.logoPath).toBeTruthy()

    const res = await patch(reglages({
      phone: '0999999999',
      logoBase64: avant.logoBase64 ?? '',
      logoPath: avant.logoPath ?? '',
    }))
    expect(res.status).toBe(200)

    const apres = await lireGarage()
    expect(apres.phone).toBe('0999999999')
    expect(apres.logoPath, 'le logo ne doit pas disparaître').toBe(avant.logoPath)
    expect(fs.existsSync(path.join(PHOTOS_DIR, apres.logoPath)), 'ni le fichier').toBe(true)
  })

  it('remplacer le logo retire l’ancien fichier', async () => {
    const avant = await lireGarage()
    const ancienFichier = path.join(PHOTOS_DIR, avant.logoPath)

    const g = await (await patch(reglages({ logoBase64: PNG, logoPath: avant.logoPath }))).json()
    expect(g.logoPath).not.toBe(avant.logoPath)
    expect(fs.existsSync(ancienFichier), 'l’ancien fichier ne doit pas rester orphelin').toBe(false)
    expect(fs.existsSync(path.join(PHOTOS_DIR, g.logoPath))).toBe(true)
  })

  it('la suppression EXPLICITE (les deux champs vides) efface bien tout', async () => {
    // C'est ce que fait la croix de CompanyTab : set('logoBase64','') ET
    // set('logoPath',''). L'intention est alors sans ambiguïté.
    const avant = await lireGarage()
    const fichier = path.join(PHOTOS_DIR, avant.logoPath)

    const g = await (await patch(reglages({ logoBase64: '', logoPath: '' }))).json()
    expect(g.logoPath).toBeNull()
    expect(g.logoBase64).toBeNull()
    expect(fs.existsSync(fichier), 'le fichier doit être retiré du disque').toBe(false)
    expect(fichiersLogo().length, 'aucun logo orphelin ne subsiste').toBe(0)
  })
})

describe('coût d’achat des pièces d’une intervention (GF-007)', () => {
  const lirePieces = () =>
    partsGET(new Request('http://localhost/api/jobs/x/parts'), { params: { id: ids.job } })

  it('OWNER (financial:read) voit le coût d’achat', async () => {
    h.session = { user: { id: 'u1', garageId: ids.garage, role: 'OWNER' } }
    const lignes = await (await lirePieces()).json()
    expect(lignes).toHaveLength(1)
    expect(lignes[0].unitCost).toBe(41.2)
    expect(lignes[0].part.unitCost).toBe(41.2)
  })

  it('RECEPTIONIST ne le voit NI sur la ligne NI sur la pièce imbriquée', async () => {
    h.session = { user: { id: 'u2', garageId: ids.garage, role: 'RECEPTIONIST' } }
    const res = await lirePieces()
    expect(res.status).toBe(200)
    const brut = await res.text()

    expect(brut, 'aucun coût d’achat ne doit sortir, à aucun niveau').not.toContain('unitCost')
    const lignes = JSON.parse(brut)
    expect(lignes[0].unitCost).toBeUndefined()
    expect(lignes[0].unitCostTenThousandths).toBeUndefined()
    expect(lignes[0].part.unitCost, 'la pièce imbriquée était la porte de service').toBeUndefined()
    expect(lignes[0].part.unitCostTenThousandths).toBeUndefined()
    // Ce dont le réceptionniste a réellement besoin reste servi.
    expect(lignes[0].unitPrice).toBe(90)
    expect(lignes[0].part.name).toBe('Filtre à huile')
  })

  it('MANAGER (financial:read) le voit', async () => {
    h.session = { user: { id: 'u3', garageId: ids.garage, role: 'MANAGER' } }
    const lignes = await (await lirePieces()).json()
    expect(lignes[0].unitCost).toBe(41.2)
  })
})
