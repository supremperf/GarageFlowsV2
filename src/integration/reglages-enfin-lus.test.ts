/**
 * GF-039 — des réglages validés, persistés… et sans aucun lecteur.
 *
 * `warrantyMonthsDefault` était accepté par le schéma, écrit en base, affiché
 * dans l'écran des réglages sous la mention « Appliquée automatiquement à
 * chaque nouvelle garantie » — et JAMAIS lu : toute garantie partait à 12 mois.
 * Le mensonge était explicite, pas implicite. Même chose pour `loanerEnabled`,
 * dont l'entrée de menu s'affichait quoi qu'ait décidé le garage.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve(__dirname, '../../.tmp-reglages-lus.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as any }))
vi.mock('@/lib/api-helpers', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@/lib/api-helpers')>()
  return { ...reel, withAuth: (fn: any) => fn, requireSession: async () => h.session }
})
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))

let prisma: any
let warrantyPOST: (req: Request) => Promise<Response>
let garageId = ''

const creerGarantie = async (corps: Record<string, unknown>) => {
  const res = await warrantyPOST(new Request('http://localhost/api/warranties', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ partName: 'Alternateur', clientName: 'Client', ...corps }),
  }))
  const texte = await res.text()
  expect(res.status, texte).toBe(201)
  return JSON.parse(texte)
}

/** Écart en mois entre deux dates ISO, arrondi. */
const moisEntre = (debut: string, fin: string) => {
  const a = new Date(debut), b = new Date(fin)
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
}

beforeAll(async () => {
  const { prepareTestDb } = await import('../test-utils/prepare-test-db')
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST: warrantyPOST } = (await import('@/app/api/warranties/route')) as any)

  garageId = (await prisma.garage.create({ data: { name: 'Réglages', slug: 'reglages-lus' } })).id
  h.session = { user: { id: 'u1', garageId, role: 'OWNER' } }
}, 120_000)

afterAll(async () => {
  await prisma?.$disconnect()
  for (const s of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${DB_PATH}${s}`, { force: true })
})

beforeEach(async () => { await prisma.warranty.deleteMany({}) })

describe('GF-039 — la durée de garantie du garage est appliquée', () => {
  it('une garantie SANS durée suit le réglage du garage', async () => {
    await prisma.garage.update({ where: { id: garageId }, data: { warrantyMonthsDefault: 24 } })

    const g = await creerGarantie({ installedAt: '2026-01-15' })
    expect(g.durationMonths, 'le réglage était ignoré : toute garantie partait à 12 mois').toBe(24)
    expect(moisEntre(g.installedAt, g.expiresAt)).toBe(24)
  })

  it('une durée EXPLICITE reste prioritaire sur le réglage', async () => {
    await prisma.garage.update({ where: { id: garageId }, data: { warrantyMonthsDefault: 24 } })
    const g = await creerGarantie({ installedAt: '2026-01-15', durationMonths: 6 })
    expect(g.durationMonths).toBe(6)
  })

  it('un garage qui n’a rien réglé garde 12 mois', async () => {
    // La colonne porte `@default(12)` : un garage jamais configuré retrouve
    // exactement le comportement d'avant. La correction n'impose rien.
    await prisma.garage.update({ where: { id: garageId }, data: { warrantyMonthsDefault: 12 } })
    const g = await creerGarantie({ installedAt: '2026-01-15' })
    expect(g.durationMonths).toBe(12)
  })

  it('le réglage ne franchit pas la frontière du garage', async () => {
    await prisma.garage.update({ where: { id: garageId }, data: { warrantyMonthsDefault: 24 } })
    const autre = await prisma.garage.create({
      data: { name: 'Voisin', slug: 'reglages-voisin', warrantyMonthsDefault: 36 },
    })
    const g = await creerGarantie({ installedAt: '2026-01-15' })
    expect(g.durationMonths, 'le réglage du voisin ne doit pas s’appliquer').toBe(24)
    await prisma.garage.delete({ where: { id: autre.id } })
  })
})

describe('GF-039 — les écrans lisent bien ces réglages', () => {
  const RACINE = path.resolve(__dirname, '..')
  const lire = (f: string) => fs.readFileSync(path.join(RACINE, f), 'utf8')

  it('le formulaire de garantie s’ouvre sur la durée réglée', () => {
    const src = lire('components/WarrantyPanel.tsx')
    expect(src, 'il s’ouvrait toujours sur 12 mois').toContain('dureeParDefaut')
    expect(src).toContain("fetch('/api/garages')")
  })

  it('l’entrée « véhicules de prêt » suit `loanerEnabled`', () => {
    const store = lire('store/schedule-store.ts')
    expect(store, 'le réglage n’avait aucun lecteur').toContain('loanerActif')
    expect(store).toContain('g.loanerEnabled !== false')

    const page = lire('app/page.tsx')
    expect(page).toContain('loanerActif ? () => setIsLoanerPanelOpen(true) : undefined')
  })

  it('le panneau lui-même n’est PAS démonté', () => {
    // Une réservation en cours resterait sinon inaccessible du jour où le
    // garage décoche la case.
    const page = lire('app/page.tsx')
    expect(page).toContain('<LoanerPanel')
    expect(page).not.toMatch(/loanerActif && <LoanerPanel/)
  })

  it('le repli est l’activation — un réglage indisponible ne fait rien disparaître', () => {
    const store = lire('store/schedule-store.ts')
    expect(store).toContain('loanerActif:    true')
  })
})
