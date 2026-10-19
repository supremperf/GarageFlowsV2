/**
 * CONTRAT DES LIGNES FINANCIÈRES DU PORTAIL CLIENT.
 *
 * Bug reproduit (écran « Une erreur est survenue », réf. GF-ERR-…) : la base
 * stocke les montants en ENTIERS de dix-millièmes (`*TenThousandths`), et
 * `GET /api/portal/[token]` comme `buildPortalSnapshot` renvoyaient CES SEULS
 * entiers. La page portail, elle, affiche `line.unitPrice.toFixed(2)` :
 * `undefined.toFixed` lève une TypeError PENDANT LE RENDU — donc hors du
 * `try/catch` du fetch — et toute la page tombe sur l'error boundary
 * (src/app/error.tsx). `/api/portal/quote/[token]` faisait DÉJÀ la dérivation :
 * c'est cette duplication qui a laissé deux producteurs sur trois en arrière.
 *
 * Ces tests verrouillent le contrat : tout producteur portail émet LES DEUX
 * représentations, et jamais le coût d'achat du garage.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { SignJWT } from 'jose'
import { readLineAmounts, salesLinesToEuros } from '@/lib/money-db'
import { lineCents, fromCents } from '@/lib/money'

const SECRET = 'secret-de-test-portail-suffisamment-long-1234567890'
process.env.GF_PORTAL_SECRET = SECRET
process.env.NEXTAUTH_SECRET = SECRET

const GARAGE_ID = 'gA'
const JOB_ID = 'job-1'

/** Lignes réalistes : quantité entière, prix à 4 décimales, zéro, quantité fractionnaire. */
const RAW_LINES = [
  { id: 'l1', description: 'Filtre à huile', quantityTenThousandths: 20_000, unitPriceTenThousandths: 123_456, isLabor: false, sortOrder: 0 },
  { id: 'l2', description: 'Main-d’œuvre', quantityTenThousandths: 15_000, unitPriceTenThousandths: 600_000, isLabor: true, sortOrder: 1 },
  { id: 'l3', description: 'Geste commercial', quantityTenThousandths: 10_000, unitPriceTenThousandths: 0, isLabor: false, sortOrder: 2 },
]

const JOB = {
  id: JOB_ID,
  garageId: GARAGE_ID,
  customerName: 'Pauline',
  vehicleModel: 'Renault Twingo',
  licensePlate: 'FZ-319-BZ',
  status: 'in_progress',
  date: '2026-08-10',
  startTime: '09:00',
  repairType: 'oil_change',
  notes: null,
  mechanic: null,
  photos: [],
  quotes: [{ id: 'q1', number: 'D-001', status: 'sent', issueDate: '2026-08-10', validUntil: null, taxRate: 20, createdAt: new Date(), lines: RAW_LINES }],
  garage: { name: 'Garage Test', phone: null, email: null, logoBase64: null, logoPath: null },
}

vi.mock('@/lib/db', () => ({
  prisma: {
    job: { findFirst: async () => JOB },
    portalSnapshot: { findUnique: async () => null },
  },
  isPostgresDatabase: () => true,
}))
vi.mock('@/lib/photo-store', () => ({ readPhotoAsDataUrl: () => null }))

let READ: (req: Request, ctx: { params: { token: string } }) => Promise<Response>
let buildPortalSnapshot: (jobId: string, garageId: string) => Promise<{ payload: Record<string, unknown> } | null>

beforeAll(async () => {
  READ = (await import('@/app/api/portal/[token]/route')).GET as never
  buildPortalSnapshot = (await import('@/lib/portal/snapshot')).buildPortalSnapshot as never
})

async function portalToken() {
  return new SignJWT({ typ: 'portal', jobId: JOB_ID, garageId: GARAGE_ID })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(SECRET))
}

/** Ce que la page portail calcule réellement pour la colonne « Total HT ». */
function renderLine(line: unknown) {
  const { quantity, unitPrice } = readLineAmounts(line as never)
  return {
    quantity,
    unitPrice: unitPrice.toFixed(2),
    total: fromCents(lineCents(unitPrice, quantity)).toFixed(2),
  }
}

describe('readLineAmounts — normalisation d’affichage', () => {
  it('dérive les euros/unités des entiers exacts', () => {
    expect(readLineAmounts({ quantityTenThousandths: 20_000, unitPriceTenThousandths: 123_456 }))
      .toEqual({ quantity: 2, unitPrice: 12.3456 })
  })

  it('gère le zéro sans le confondre avec une valeur absente', () => {
    expect(readLineAmounts({ quantityTenThousandths: 0, unitPriceTenThousandths: 0 }))
      .toEqual({ quantity: 0, unitPrice: 0 })
    // Un prix nul FOURNI en euros doit rester 0 et ne pas retomber sur le scaled.
    expect(readLineAmounts({ unitPrice: 0, unitPriceTenThousandths: 999_999 }).unitPrice).toBe(0)
  })

  it('gère les quantités et prix décimaux', () => {
    expect(readLineAmounts({ quantityTenThousandths: 15_000, unitPriceTenThousandths: 600_000 }))
      .toEqual({ quantity: 1.5, unitPrice: 60 })
  })

  it('NE RECONVERTIT JAMAIS une valeur déjà en euros', () => {
    // Forme corrigée : les deux représentations cohabitent. La lecture doit
    // prendre l'euro tel quel — surtout PAS fromScaled(12.3456).
    const both = { quantity: 2, unitPrice: 12.3456, quantityTenThousandths: 20_000, unitPriceTenThousandths: 123_456 }
    expect(readLineAmounts(both)).toEqual({ quantity: 2, unitPrice: 12.3456 })
  })

  it('tolère null / undefined / non fini sans lever', () => {
    expect(readLineAmounts(null)).toEqual({ quantity: 0, unitPrice: 0 })
    expect(readLineAmounts(undefined)).toEqual({ quantity: 0, unitPrice: 0 })
    expect(readLineAmounts({})).toEqual({ quantity: 0, unitPrice: 0 })
    expect(readLineAmounts({ quantity: null, unitPrice: null })).toEqual({ quantity: 0, unitPrice: 0 })
    expect(readLineAmounts({ unitPrice: Number.NaN, unitPriceTenThousandths: 50_000 }).unitPrice).toBe(5)
  })

  it('rend une ligne LEGACY (instantané publié avant correction) sans planter', () => {
    // C'est exactement la charge utile encore stockée dans PortalSnapshot pour
    // les liens déjà remis à des clients (validité 7 jours).
    expect(renderLine(RAW_LINES[0])).toEqual({ quantity: 2, unitPrice: '12.35', total: '24.69' })
  })
})

describe('salesLinesToEuros — forme émise par les producteurs', () => {
  it('conserve les entiers exacts ET ajoute les dérivés euros', () => {
    const [l] = salesLinesToEuros([RAW_LINES[0]])
    expect(l.quantityTenThousandths).toBe(20_000)
    expect(l.unitPriceTenThousandths).toBe(123_456)
    expect(l.quantity).toBe(2)
    expect(l.unitPrice).toBe(12.3456)
  })

  it('n’invente aucun coût d’achat', () => {
    const [l] = salesLinesToEuros([RAW_LINES[0]]) as unknown as Array<Record<string, unknown>>
    expect(l).not.toHaveProperty('unitCost')
    expect(l).not.toHaveProperty('unitCostTenThousandths')
  })

  it('tolère une liste vide/nulle', () => {
    expect(salesLinesToEuros([])).toEqual([])
    expect(salesLinesToEuros(null as never)).toEqual([])
  })
})

describe('GET /api/portal/[token] — contrat de sortie', () => {
  it('émet des lignes que la page peut afficher sans lever', async () => {
    const res = await READ(new Request('http://localhost/api/portal/x'), { params: { token: await portalToken() } })
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(Array.isArray(body.quote?.lines)).toBe(true)
    for (const line of body.quote.lines) {
      // Le défaut historique : ces deux champs étaient absents.
      expect(typeof line.unitPrice).toBe('number')
      expect(typeof line.quantity).toBe('number')
      // …sans perdre la source de vérité exacte.
      expect(Number.isInteger(line.unitPriceTenThousandths)).toBe(true)
      expect(Number.isInteger(line.quantityTenThousandths)).toBe(true)
      // …ni exposer la marge du garage.
      expect(line).not.toHaveProperty('unitCost')
      expect(line).not.toHaveProperty('unitCostTenThousandths')
    }

    expect(renderLine(body.quote.lines[0])).toEqual({ quantity: 2, unitPrice: '12.35', total: '24.69' })
    expect(renderLine(body.quote.lines[1])).toEqual({ quantity: 1.5, unitPrice: '60.00', total: '90.00' })
    expect(renderLine(body.quote.lines[2])).toEqual({ quantity: 1, unitPrice: '0.00', total: '0.00' })
  })

  it('reste cohérent avec les totaux calculés côté serveur', async () => {
    const res = await READ(new Request('http://localhost/api/portal/x'), { params: { token: await portalToken() } })
    const body = await res.json()
    const sum = body.quote.lines.reduce((s: number, l: unknown) => {
      const { quantity, unitPrice } = readLineAmounts(l as never)
      return s + lineCents(unitPrice, quantity)
    }, 0)
    expect(fromCents(sum)).toBeCloseTo(body.quote.totalHT, 2)
  })
})

describe('buildPortalSnapshot — contrat de publication (poste → cloud)', () => {
  it('publie les lignes sous la même forme que l’API cloud', async () => {
    const snap = await buildPortalSnapshot(JOB_ID, GARAGE_ID)
    expect(snap).not.toBeNull()
    const quote = (snap!.payload as { quote: { lines: Array<Record<string, unknown>> } }).quote
    for (const line of quote.lines) {
      expect(typeof line.unitPrice).toBe('number')
      expect(typeof line.quantity).toBe('number')
      expect(line).not.toHaveProperty('unitCost')
    }
    // L'instantané est SERVI TEL QUEL au navigateur : il doit s'afficher.
    expect(renderLine(quote.lines[0])).toEqual({ quantity: 2, unitPrice: '12.35', total: '24.69' })
  })
})
