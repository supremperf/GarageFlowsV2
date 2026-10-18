/**
 * Deux garanties du copilote qui étaient AFFIRMÉES sans être éprouvées.
 *
 * 1. LA PORTE FINANCIÈRE. `FINANCIAL_RESOLVERS` (route.ts) réserve quatre
 *    résolveurs à `financial:read`. Un seul — `margin` — était testé : retirer
 *    `revenue_today`, `top_clients` ou `forecast` de la liste n'aurait rougi
 *    aucun test, et le chiffre d'affaires serait parti à un réceptionniste.
 *
 * 2. L'ISOLATION ENTRE GARAGES. Elle n'était croisée que sur 2 résolveurs sur
 *    11. Les moins testés étaient les plus sensibles : `top_clients` et
 *    `margin` agrègent l'argent de tout le garage. Sur une installation cloud
 *    multi-garages, un `garageId` oublié dans un `where` ferait fuiter le CA
 *    d'un garage vers un autre sans qu'aucun test ne rougisse.
 *
 * Chaque cas croise donc une donnée d'un SECOND garage, et vérifie qu'elle
 * n'apparaît pas — un test qui n'interroge qu'un seul garage ne prouve rien.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { toScaled } from '@/lib/money'
import { format, subDays } from 'date-fns'
import path from 'node:path'
import fs from 'node:fs'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-copilot-portee.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', () => ({ withAuth: (fn: unknown) => fn, requireSession: async () => h.session }))

let POST: (req: Request) => Promise<Response>
let prisma: any
let gA: string
let gB: string
const today = format(new Date(), 'yyyy-MM-dd')

const commeRole = (role: string, garageId?: string) => {
  h.session = { user: { id: 'u1', name: 'U', role, garageId: garageId ?? gA } }
}
const demander = async (query: string) => {
  const r = await POST(new Request('http://localhost/api/copilot', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }),
  }))
  return { status: r.status, json: await r.json() }
}

async function factureP(garageId: string, number: string, issueDate: string, ht: number, clientName: string) {
  await prisma.invoice.create({
    data: {
      number, garageId, clientName, status: 'paid', issueDate, taxRate: 20,
      lines: { create: [{ description: 'x', quantityTenThousandths: 10000, unitPriceTenThousandths: toScaled(ht), unitCostTenThousandths: toScaled(ht / 2), isLabor: false, sortOrder: 0 }] },
    },
  })
}

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST } = await import('@/app/api/copilot/route') as any)

  gA = (await prisma.garage.create({ data: { name: 'A', slug: 'portee-a' } })).id
  gB = (await prisma.garage.create({ data: { name: 'B', slug: 'portee-b' } })).id

  // Chiffres volontairement reconnaissables : 111 chez A, 999 chez B.
  await factureP(gA, 'F-A-1', today, 111, 'Client Alpha')
  await factureP(gB, 'F-B-1', today, 999, 'Client Bravo')
  await factureP(gA, 'F-A-2', format(subDays(new Date(), 20), 'yyyy-MM-dd'), 111, 'Client Alpha')
  await factureP(gB, 'F-B-2', format(subDays(new Date(), 20), 'yyyy-MM-dd'), 999, 'Client Bravo')

  await prisma.quote.create({ data: { number: 'DEV-A-1', garageId: gA, clientName: 'Client Alpha', issueDate: today, status: 'sent' } })
  await prisma.quote.create({ data: { number: 'DEV-B-1', garageId: gB, clientName: 'Client Bravo', issueDate: today, status: 'sent' } })

  const mA = await prisma.mechanic.create({ data: { name: 'MecaAlpha', avatar: 'a', color: '#111', garageId: gA, isAbsent: false } })
  const mB = await prisma.mechanic.create({ data: { name: 'MecaBravo', avatar: 'b', color: '#222', garageId: gB, isAbsent: false } })

  const job = (garageId: string, mechanicId: string, customerName: string) => ({
    customerName, vehicleModel: 'Clio', repairType: 'revision', estimatedDuration: 60,
    startTime: '09:00', date: today, mechanicId, garageId, status: 'in_progress', delayMinutes: 30,
  })
  await prisma.job.create({ data: job(gA, mA.id, 'Retard Alpha') })
  await prisma.job.create({ data: job(gB, mB.id, 'Retard Bravo') })
}, 60_000)

afterAll(async () => { await prisma?.$disconnect(); if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH) })

// Les quatre résolveurs que `FINANCIAL_RESOLVERS` doit protéger, avec une
// question qui les atteint réellement (cf. le catalogue d'intentions).
const QUESTIONS_FINANCIERES: Array<[string, string]> = [
  ['revenue_today', "Quel est le chiffre d'affaires du jour ?"],
  ['margin', 'Quelle est la marge du mois ?'],
  ['top_clients', 'Quels sont mes meilleurs clients ?'],
  ['forecast', 'Quelle est la prevision du chiffre ?'],
]

describe('la porte financière tient sur les QUATRE résolveurs, pas seulement sur la marge', () => {
  it.each(QUESTIONS_FINANCIERES)('« %s » est refusé à un RECEPTIONIST', async (_resolveur, question) => {
    commeRole('RECEPTIONIST')
    const { status, json } = await demander(question)
    expect(status, 'un rôle sans financial:read ne doit pas obtenir ces chiffres').toBe(403)
    expect(JSON.stringify(json), 'aucun chiffre ne doit fuir dans le refus').not.toMatch(/111|999/)
  })

  it.each(QUESTIONS_FINANCIERES)('« %s » est refusé à un MECHANIC', async (_resolveur, question) => {
    commeRole('MECHANIC')
    expect((await demander(question)).status).toBe(403)
  })

  it.each(QUESTIONS_FINANCIERES)('« %s » répond VRAIMENT à un OWNER', async (_resolveur, question) => {
    // Le test d'autorisation existant ne lisait que le code HTTP : il restait
    // vert même si le résolveur était entièrement cassé, la route rendant 200
    // avec « Erreur lors de la récupération des données. ».
    commeRole('OWNER')
    const { status, json } = await demander(question)
    expect(status).toBe(200)
    expect(json.message, 'un 200 portant une erreur n’est pas une réponse').not.toMatch(/Erreur lors de la récupération/)
    expect(json.data, 'l’autorisation accordée doit livrer des données').not.toBeNull()
  })
})

describe('aucun résolveur ne laisse passer les données d’un autre garage', () => {
  it('les devis en attente sont ceux du garage de la session', async () => {
    commeRole('OWNER')
    const { json } = await demander('Quels devis attendent une réponse ?')
    const brut = JSON.stringify(json.data)
    expect(brut).toMatch(/DEV-A-1/)
    expect(brut, 'le devis du garage B n’a rien à faire ici').not.toMatch(/DEV-B-1/)
  })

  it('les meilleurs clients n’agrègent pas ceux d’un autre garage', async () => {
    commeRole('OWNER')
    const { json } = await demander('Quels sont mes meilleurs clients ?')
    const brut = JSON.stringify(json.data)
    expect(brut).toMatch(/Alpha/)
    expect(brut, 'agréger le CA d’un autre garage serait la pire des fuites').not.toMatch(/Bravo/)
  })

  it('la marge ne mélange pas deux garages', async () => {
    commeRole('OWNER')
    const { json } = await demander('Quelle est la marge du mois ?')
    // 999 n'appartient qu'au garage B : il ne doit apparaître ni dans les
    // totaux, ni dans le message.
    expect(`${json.message} ${JSON.stringify(json.data)}`).not.toMatch(/999/)
  })

  it('les mécaniciens disponibles sont ceux du garage', async () => {
    commeRole('OWNER')
    const { json } = await demander('Quels sont les mecaniciens disponibles ?')
    expect(json.message).toMatch(/MecaAlpha/)
    expect(json.message).not.toMatch(/MecaBravo/)
  })

  it('les véhicules en retard sont ceux du garage', async () => {
    commeRole('OWNER')
    const { json } = await demander('Quels vehicules sont en retard ?')
    const brut = JSON.stringify(json.data)
    expect(brut).toMatch(/Retard Alpha/)
    expect(brut).not.toMatch(/Retard Bravo/)
  })

  it('vu depuis le garage B, ce sont les données de B — et elles seules', async () => {
    // Le contrôle symétrique : sans lui, un `where` codé en dur sur le garage A
    // passerait tous les tests ci-dessus.
    commeRole('OWNER', gB)
    const { json } = await demander('Quels devis attendent une réponse ?')
    const brut = JSON.stringify(json.data)
    expect(brut).toMatch(/DEV-B-1/)
    expect(brut).not.toMatch(/DEV-A-1/)
  })
})
