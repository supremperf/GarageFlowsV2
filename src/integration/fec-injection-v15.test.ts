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
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

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
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '../..'), env: { ...process.env }, stdio: 'ignore',
  })
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
