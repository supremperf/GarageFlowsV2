/**
 * L'écusson « Chiffres ancrés sur les données · vérifié » doit dire la vérité.
 *
 * Le panneau l'affichait dès que le champ `phrasing` existait — or il existe
 * TOUJOURS sur ce chemin. L'écusson apparaissait donc sous « Erreur lors de la
 * récupération des données. », sous une demande de VIN et sous une demande de
 * précision de diagnostic : le seul signal de confiance de l'interface ne
 * distinguait rien.
 *
 * Ce qui est vérifié ici, c'est le contrat que le serveur expose désormais
 * (`ancrage.verifie`), parce que c'est lui qui sait si un résolveur a réellement
 * lu les données du garage. Le panneau ne fait que le lire.
 *
 * Piège à ne pas retomber dedans : `phrased.grounded` vaut `false` exactement
 * quand le garde-fou a REJETÉ une reformulation inventée et rendu le texte
 * déterministe — c'est-à-dire au moment où la réponse est la plus sûre. Un test
 * qui s'alignerait dessus inverserait le signal ; le dernier cas ci-dessous le
 * verrouille.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { toScaled } from '@/lib/money'
import { format } from 'date-fns'
import path from 'node:path'
import fs from 'node:fs'
import { __setLlmProvider } from '@/lib/copilot-llm/provider'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-copilot-ecusson.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', () => ({ withAuth: (fn: unknown) => fn, requireSession: async () => h.session }))

let POST: (req: Request) => Promise<Response>
let prisma: any
let garageA: string
const today = format(new Date(), 'yyyy-MM-dd')

async function ask(query: string): Promise<any> {
  const res = await POST(new Request('http://localhost/api/copilot', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }),
  }))
  return res.json()
}

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST } = await import('@/app/api/copilot/route') as any)

  garageA = (await prisma.garage.create({ data: { name: 'A', slug: 'ecusson-a' } })).id
  await prisma.invoice.create({
    data: {
      number: 'FAC-E-1', garageId: garageA, clientName: 'C', status: 'paid', issueDate: today, taxRate: 20,
      lines: { create: [{ description: 'x', quantityTenThousandths: 10000, unitPriceTenThousandths: toScaled(250), unitCostTenThousandths: 0, isLabor: false, sortOrder: 0 }] },
    },
  })
  h.session = { user: { id: 'ua', name: 'A', role: 'OWNER', garageId: garageA } }
})

afterAll(async () => { await prisma?.$disconnect(); if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH) })
afterEach(() => { __setLlmProvider(null); vi.restoreAllMocks() })

describe('l’écusson s’affiche quand la réponse porte vraiment des données', () => {
  it('une réponse chiffrée tirée de la base est marquée vérifiée', async () => {
    const json = await ask('Quel est le CA du jour ?')
    expect(json.data.revenueHT).toBe(250)
    expect(json.ancrage.verifie, 'une vraie réponse chiffrée doit porter l’écusson').toBe(true)
  })

  it('la provenance du texte cesse d’être indevinable', async () => {
    const json = await ask('Quel est le CA du jour ?')
    // Sans fournisseur : le texte EST le calcul déterministe.
    expect(json.ancrage.source).toBe('fallback')
  })
})

describe('l’écusson disparaît quand il n’y a aucune donnée à ancrer', () => {
  it('une panne de lecture n’est pas une réponse vérifiée', async () => {
    // C'était le cas le plus grave : un écusson vert sous une erreur de base.
    vi.spyOn(prisma.invoice, 'findMany').mockRejectedValueOnce(new Error('base indisponible'))
    const json = await ask('Quel est le CA du jour ?')
    expect(json.message).toMatch(/Erreur lors de la récupération/)
    expect(json.ancrage.verifie, 'un écusson « vérifié » sous une erreur est un mensonge').toBe(false)
    // On verrouille aussi le fait OBSERVABLE, et pas seulement le verdict : une
    // réponse en échec ne rapporte aucune donnée. Trois clauses concourent au
    // verdict côté serveur ; c'est celle-ci qui doit rester vraie quelle que
    // soit la façon dont il sera écrit demain.
    expect(json.data, 'une lecture en échec ne rapporte rien').toBeUndefined()
  })

  it('une demande de VIN n’est pas une réponse vérifiée', async () => {
    const json = await ask('Décode ce VIN')
    expect(json.type).toBe('clarify')
    expect(json.ancrage.verifie).toBe(false)
    expect(json.data, 'rien n’a été décodé : il n’y a pas de donnée').toBeUndefined()
  })

  it('une demande de précision de diagnostic n’est pas une réponse vérifiée', async () => {
    const json = await ask('Fais un diagnostic')
    expect(json.message).toMatch(/Précisez/)
    expect(json.ancrage.verifie, 'aucun symptôme fourni : rien n’a été lu ni calculé').toBe(false)
  })
})

describe('le rejet d’une invention ne doit pas éteindre l’écusson', () => {
  it('une reformulation inventée est rejetée, et la réponse reste vérifiée', async () => {
    __setLlmProvider({ id: 'x', name: 'X', phrase: async () => 'Vous avez encaissé 9999 € aujourd’hui !' })
    const json = await ask('Quel est le CA du jour ?')

    expect(json.phrasing, 'le chiffre inventé ne doit jamais apparaître').not.toMatch(/9999/)
    expect(json.phrasing).toBe(json.message)
    // Le texte affiché est le calcul déterministe : il EST ancré. Éteindre
    // l'écusson ici punirait le garde-fou d'avoir fait son travail.
    expect(json.ancrage.verifie).toBe(true)
    // …mais l'événement cesse d'être invisible : la provenance le dit.
    expect(json.ancrage.source).toBe('fallback_ungrounded')
  })

  it('une reformulation ancrée est acceptée et signalée comme telle', async () => {
    __setLlmProvider({ id: 'x', name: 'X', phrase: async () => 'Aujourd’hui : 250 € encaissés sur 1 facture.' })
    const json = await ask('Quel est le CA du jour ?')
    expect(json.phrasing).toMatch(/250/)
    expect(json.ancrage).toEqual({ verifie: true, source: 'llm' })
  })
})

describe('le panneau lit le verdict du serveur, il ne le recalcule pas', () => {
  // Les tests ci-dessus verrouillent le CONTRAT du serveur. Sans cette garde,
  // rétablir la déduction côté client les laisserait tous verts alors que
  // l'écusson mentirait de nouveau. Le dépôt n'a pas d'outillage de rendu React
  // (environnement `node`, pas de testing-library) : on éprouve donc la source,
  // comme le font déjà les gardes de corpus du projet.
  const panneau = fs.readFileSync(
    path.resolve(__dirname, '../components/CopilotPanel.tsx'), 'utf8',
  )

  it('l’écusson ne se déduit plus de la simple présence de `phrasing`', () => {
    expect(panneau, 'c’était exactement le défaut : un champ toujours présent')
      .not.toMatch(/const\s+grounded\s*=\s*!!\s*m\.res\?\.phrasing/)
  })

  it('l’écusson vient du verdict serveur `ancrage.verifie`', () => {
    expect(panneau).toMatch(/const\s+grounded\s*=\s*m\.res\?\.ancrage\?\.verifie\s*===\s*true/)
  })
})
