/**
 * Export FEC — anti-injection (V15 P1, base SQLite réelle).
 *
 * Le FEC est un fichier délimité par « | » (importé en routine dans un tableur).
 * Un nom de client contrôlé par l'utilisateur ne doit JAMAIS pouvoir :
 *  1. injecter des colonnes / écritures fantômes via « | » ou un retour ligne
 *     (corruption du registre comptable légal) ;
 *  2. déclencher une formule tableur (= + - @ en tête) à l'ouverture du .txt.
 *
 * Les montants / dates / n° de compte, générés par le programme, restent bruts.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-fec-injection-v15.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)()
  return { ...actual, withAuth: (fn: unknown) => fn, requireSession: async () => h.session }
})

let prisma: any
let GET: (req: Request) => Promise<Response>
const HEADER_COLS = 18 // JournalCode … Idevise

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ GET } = (await import('@/app/api/export/fec/route')) as any)

  const g = await prisma.garage.create({ data: { name: 'FEC', slug: 'fec-inj-v15', siret: '12345678900011' } })
  // Nom malveillant : formule tableur en tête + séparateur FEC + retour ligne.
  await prisma.invoice.create({
    data: {
      number: 'FAC-1', garageId: g.id, clientName: '=2+3|EVIL\nROW', status: 'paid',
      issueDate: '2026-03-01', taxRate: 20,
      lines: { create: [{ description: 'L', quantityTenThousandths: 10000, unitPriceTenThousandths: 1000000, sortOrder: 0 }] },
    },
  })
  h.session = { user: { id: 'u', role: 'OWNER', garageId: g.id } }
}, 120_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

describe('Export FEC — injection neutralisée (V15 P1)', () => {
  it('aucune ligne ne dépasse 18 colonnes (le « | » du nom client n’injecte pas de champ)', async () => {
    const res = await GET(new Request('http://localhost/api/export/fec?year=2026'))
    expect(res.status).toBe(200)
    const body = await res.text()
    const lines = body.split('\r\n')
    // Chaque ligne (en-tête + écritures) a EXACTEMENT le bon nombre de colonnes.
    for (const line of lines) {
      expect(line.split('|').length).toBe(HEADER_COLS)
    }
    // Le retour ligne du nom n'a pas créé de ligne supplémentaire injectée :
    // écritures = 706 (HT) + 44571 (TVA) + 411 (client) + 512 (banque) + 411 (banque) = 5.
    expect(lines.length).toBe(1 + 5)
  })

  it('le libellé démarrant par « = » est neutralisé (préfixe apostrophe, pas de formule)', async () => {
    const res = await GET(new Request('http://localhost/api/export/fec?year=2026'))
    const body = await res.text()
    const dataRows = body.split('\r\n').slice(1)
    // La ligne 411 « Clients » porte le nom client en CompAuxLib (index 7) et EcritureLib (index 10).
    const clientRow = dataRows.find(r => r.split('|')[4] === '411000')!
    const cols = clientRow.split('|')
    expect(cols[7].startsWith("'=")).toBe(true)   // formule désamorcée
    expect(cols[7]).not.toContain('|')            // séparateur retiré
    expect(cols[7]).not.toContain('\n')           // retour ligne retiré
    // Aucun champ ne commence par un caractère déclencheur de formule nu.
    for (const c of cols) expect(/^[=+@]/.test(c)).toBe(false)
  })
})

/**
 * NON-RÉGRESSION GF31-AUD-014.
 *
 * `Invoice.status` vaut draft | sent | paid | overdue | cancelled. Le filtre de
 * l'export était `status: { not: 'draft' }` : les factures ANNULÉES produisaient
 * donc des écritures de vente (706) et de TVA collectée (445710) dans le fichier
 * remis à l'administration fiscale — chiffre d'affaires et TVA surdéclarés.
 *
 * Base SQLite réelle : c'est bien la requête Prisma qui filtre, pas un simulacre.
 */
describe('GF31-AUD-014 — les factures annulées ne sont pas du chiffre d’affaires', () => {
  it('une facture ANNULÉE ne produit aucune écriture, une facture envoyée si', async () => {
    const g = await prisma.garage.create({
      data: { name: 'FEC annul', slug: 'fec-aud-014', siret: '99988877700011' },
    })
    const ligne = {
      create: [{ description: 'L', quantityTenThousandths: 10000, unitPriceTenThousandths: 1000000, sortOrder: 0 }],
    }
    // 100,00 € HT chacune, TVA 20 %.
    await prisma.invoice.create({
      data: { number: 'FAC-OK', garageId: g.id, clientName: 'Client Actif', status: 'sent', issueDate: '2026-04-01', taxRate: 20, lines: ligne },
    })
    await prisma.invoice.create({
      data: { number: 'FAC-ANNULEE', garageId: g.id, clientName: 'Client Annule', status: 'cancelled', issueDate: '2026-04-02', taxRate: 20, lines: ligne },
    })
    await prisma.invoice.create({
      data: { number: 'FAC-BROUILLON', garageId: g.id, clientName: 'Client Brouillon', status: 'draft', issueDate: '2026-04-03', taxRate: 20, lines: ligne },
    })

    const precedent = h.session
    h.session = { user: { id: 'u', role: 'OWNER', garageId: g.id } }
    try {
      const body = await (await GET(new Request('http://localhost/api/export/fec?year=2026'))).text()

      expect(body).toContain('FAC-OK')
      expect(body).not.toContain('FAC-ANNULEE')
      expect(body).not.toContain('FAC-BROUILLON')

      // Et surtout : les MONTANTS. Une seule facture retenue → 100,00 HT et
      // 20,00 de TVA collectée, pas le double.
      const lignes = body.split('\r\n').slice(1).filter(Boolean)
      const credit = (compte: string) =>
        lignes
          .filter((l) => l.split('|')[4] === compte)
          .reduce((s, l) => s + Number(l.split('|')[12].replace(',', '.')), 0)

      expect(credit('706000')).toBeCloseTo(100, 2)   // produits
      expect(credit('445710')).toBeCloseTo(20, 2)    // TVA collectée
    } finally {
      h.session = precedent
    }
  })
})
