/**
 * Portail publié par un POSTE : /api/sync/portal (publication) puis
 * /api/portal/[token] (lecture par le client).
 *
 * TEST F — un portail créé depuis le poste est réellement résolu côté cloud.
 * TEST G — jeton falsifié / expiré / croisé → refus.
 *
 * La signature JWT est RÉELLE (jose + secret de test) : seule la couche base
 * est simulée. Ce sont donc les vraies vérifications cryptographiques qui sont
 * exercées, pas une imitation.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

process.env.GF_PORTAL_SECRET = 'secret-de-test-portail-suffisamment-long-1234567890'
process.env.NEXTAUTH_SECRET  = 'secret-de-test-portail-suffisamment-long-1234567890'

const GARAGE_LID = 'garage-lid-1'
const GARAGE_ID  = 'gA'
const JOB_ID     = 'job-1'

const cap = vi.hoisted(() => ({
  licenses: new Map<string, Record<string, unknown>>(),
  snapshots: new Map<string, Record<string, unknown>>(),
  jobs: [] as Array<Record<string, unknown>>,
  tokens: new Map<string, Record<string, unknown>>(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    licenseKey: {
      findUnique: async (a: { where: { licenseId: string } }) => cap.licenses.get(a.where.licenseId) ?? null,
      // Réservation d'un garage par une AUTRE licence garage (GF31-AUD-003).
      findFirst: async (a: {
        where: { garageId: string; licenseType: { not: string }; NOT: { licenseId: string } }
      }) => {
        const hit = Array.from(cap.licenses.values()).find(
          (row) =>
            row.garageId === a.where.garageId &&
            row.licenseType !== a.where.licenseType.not &&
            row.licenseId !== a.where.NOT.licenseId,
        )
        return hit ? { licenseId: String(hit.licenseId) } : null
      },
      updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = cap.licenses.get(String(a.where.licenseId))
        if (!row || row.garageId != null) return { count: 0 }
        Object.assign(row, a.data); return { count: 1 }
      },
    },
    // Le rattachement se fait désormais dans une transaction : le simulacre la
    // rejoue simplement sur le même client (aucune isolation à imiter ici).
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const { prisma } = await import('@/lib/db')
      return fn(prisma)
    },
    portalSnapshot: {
      upsert: async (a: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const cur = cap.snapshots.get(a.where.id)
        const row = cur ? { ...cur, ...a.update } : a.create
        cap.snapshots.set(a.where.id, row); return row
      },
      findUnique: async (a: { where: { id: string } }) => cap.snapshots.get(a.where.id) ?? null,
      deleteMany: async () => ({ count: 0 }),
    },
    job: { findFirst: async () => cap.jobs[0] ?? null },
  },
  isPostgresDatabase: () => true,
}))
vi.mock('@/lib/security/rate-limit', () => ({
  clientIpFrom: () => '127.0.0.1',
  enforceRateLimit: async () => ({ ok: true }),
  rateLimitResponse: () => new Response('rate', { status: 429 }),
}))
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }))
vi.mock('@/lib/license/verify', () => ({
  verifyLicenseToken: (token: string) => cap.tokens.get(token) ?? { valid: false, reason: 'inconnu' },
}))

let SYNC: (req: Request) => Promise<Response>
let READ: (req: Request, ctx: { params: { token: string } }) => Promise<Response>
beforeAll(async () => {
  SYNC = (await import('../portal/route')).POST as never
  READ = (await import('../../portal/[token]/route')).GET as never
})

const PAYLOAD = {
  customerName: 'Jean Client', vehicleModel: 'Clio', licensePlate: 'AA-123-BB',
  status: 'scheduled', date: '2026-08-10', startTime: '09:00', repairType: 'oil_change',
  notes: null, mechanic: { name: 'Alice', avatar: 'AL', color: '#3b82f6' },
  photos: [], quote: null, garage: { name: 'Garage Test', phone: null, email: null, logoBase64: null, logoPath: null },
}

function publish(over: Record<string, unknown> = {}) {
  return new Request('http://x/api/sync/portal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ garageLicense: 'GF2.garage', garageId: GARAGE_ID, jobId: JOB_ID, payload: PAYLOAD, ...over }),
  })
}
const read = (token: string) =>
  READ(new Request('http://x'), { params: { token } })

beforeEach(() => {
  cap.licenses.clear(); cap.snapshots.clear(); cap.jobs = []; cap.tokens.clear()
  cap.tokens.set('GF2.garage', {
    valid: true, isMechanic: false,
    payload: { lid: GARAGE_LID, typ: 'premium', exp: Math.floor(Date.now() / 1000) + 86_400 },
  })
  cap.licenses.set(GARAGE_LID, {
    licenseId: GARAGE_LID, licenseType: 'premium', status: 'active', garageId: null,
    expiryAt: new Date(Date.now() + 86_400_000), revokedAt: null,
  })
})

describe('TEST F — un portail créé depuis le poste se résout côté cloud', () => {
  it('publie puis sert réellement le contenu', async () => {
    const pub = await SYNC(publish())
    expect(pub.status).toBe(200)
    const { ok, token, url } = await pub.json()
    expect(ok).toBe(true)
    expect(url).toBe(`https://app.garageflows.fr/portal/${token}`)
    expect(cap.snapshots.size).toBe(1)

    // Aucun Job en base cloud (garage installé en local) : le repli instantané
    // doit néanmoins servir la page.
    const res = await read(token)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.customerName).toBe('Jean Client')
    expect(data.garage.name).toBe('Garage Test')
    // Le coût d'achat n'est jamais publié.
    expect(JSON.stringify(data)).not.toContain('unitCost')
  })

  it('republier la même intervention reste exploitable (nouveau jeton)', async () => {
    const a = await (await SYNC(publish())).json()
    const b = await (await SYNC(publish())).json()
    expect(a.token).not.toBe(b.token)
    expect((await read(a.token)).status).toBe(200)
    expect((await read(b.token)).status).toBe(200)
  })

  it('expiration 7 jours', async () => {
    const { expiresAt } = await (await SYNC(publish())).json()
    const days = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(6.99)
    expect(days).toBeLessThan(7.01)
  })

  it('refuse une publication sans licence garage valide', async () => {
    cap.licenses.get(GARAGE_LID)!.status = 'revoked'
    const res = await SYNC(publish())
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('LICENSE_REVOKED')
    expect(cap.snapshots.size).toBe(0)
  })
})

describe('TEST G — jetons falsifiés ou croisés', () => {
  it('signature altérée → 403', async () => {
    const { token } = await (await SYNC(publish())).json()
    const [h, p, s] = token.split('.')
    // On altère un caractère au MILIEU : le DERNIER caractère base64url d'un
    // HMAC-SHA256 (32 octets → 43 caractères) ne porte que 2 bits utiles, si
    // bien que le modifier peut redonner exactement les mêmes octets — le test
    // était alors non déterministe alors que le produit, lui, refuse bien.
    const i = Math.floor(s.length / 2)
    const alt = s[i] === 'A' ? 'B' : 'A'
    const res = await read(`${h}.${p}.${s.slice(0, i)}${alt}${s.slice(i + 1)}`)
    expect(res.status).toBe(403)
  })

  it('charge utile modifiée (jti d’un autre instantané) → 403', async () => {
    const { token } = await (await SYNC(publish())).json()
    const [h, p, s] = token.split('.')
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString())
    claims.jti = 'jti-inconnu'
    const forged = `${h}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${s}`
    expect((await read(forged)).status).toBe(403)
  })

  it('instantané d’un AUTRE garage non servi (jti volé)', async () => {
    const { token } = await (await SYNC(publish())).json()
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    // Le jti existe mais l'instantané appartient à un autre garage.
    cap.snapshots.get(claims.jti)!.garageId = 'gB'
    const res = await read(token)
    // Aucun repli : pas de Job non plus → introuvable, jamais le contenu d'autrui.
    expect([403, 404]).toContain(res.status)
    expect(await res.text()).not.toContain('Jean Client')
  })

  it('instantané expiré → 403', async () => {
    const { token } = await (await SYNC(publish())).json()
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    cap.snapshots.get(claims.jti)!.expiresAt = new Date(Date.now() - 1000)
    expect((await read(token)).status).toBe(403)
  })

  it('jeton absent / vide → 403', async () => {
    expect((await read('')).status).toBe(403)
    expect((await read('pas-un-jeton')).status).toBe(403)
  })
})
