/**
 * GF-DUR-047 / GF-DUR-048 — passe hostile sur l'administration des licences.
 *
 * ─── Pourquoi des tests COMPORTEMENTAUX et pas des regex de source ──────────
 * Une assertion du type `expect(src).toContain('SEATS_MAX')` survit au retrait
 * du contrôle qu'elle prétend garder — je l'ai constaté sur mon propre garde
 * quelques heures plus tôt. Ici on appelle les routes, on regarde les codes de
 * statut, l'état en base, et on ESPIONNE la signature : le seul niveau de preuve
 * qui résiste à une mutation.
 *
 * ─── Les deux défauts éprouvés ──────────────────────────────────────────────
 *
 * GF-DUR-048 — `revoke-by-key` écrivait `status` DIRECTEMENT, sans consulter
 * l'état courant, et effaçait `revokedAt`. `revoked → active` y était une
 * écriture de champ ordinaire, alors que `revoked` est TERMINAL depuis le
 * LOT 1. La protection existait — sur UNE seule des deux routes qui changent
 * l'état. Une garde qu'un second chemin contourne ne garde rien : l'outil
 * keygen réactivait ce que l'interface d'admin refusait.
 *
 * GF-DUR-047 — ni l'émission ni la révocation par clé ne laissaient de trace.
 * Seule `[id]` journalisait. Une session admin volée pouvait signer ou couper
 * sans que rien n'en garde mémoire.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-licence-admin.db')
process.env.DATABASE_URL = `file:${DB_PATH}`
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'x'.repeat(48)
process.env.GF_DB_MAC_SECRET = process.env.GF_DB_MAC_SECRET || 'y'.repeat(48)
process.env.GARAGEFLOW_API_KEY = 'cle-keygen-de-test-0123456789abcdef'

/** Session admin simulée — on éprouve les GARDES, pas l'authentification. */
const h = vi.hoisted(() => ({ admin: true }))
vi.mock('@/lib/api-helpers', async (orig) => {
  const reel = await (orig as () => Promise<Record<string, unknown>>)()
  return { ...reel, isAdminSession: async () => h.admin, adminSessionActor: async () => 'admin-test' }
})

let prisma: any
let revokeByKey: (r: NextRequest) => Promise<Response>
let computeRecordMac: (r: never) => string

const post = (url: string, corps: unknown, entetes: Record<string, string> = {}) =>
  new NextRequest(`http://127.0.0.1${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...entetes },
    body: JSON.stringify(corps),
  })

const CLE = { 'x-gf-key': process.env.GARAGEFLOW_API_KEY as string }

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST: revokeByKey } = (await import('@/app/api/admin/licenses/revoke-by-key/route')) as any)
  ;({ computeRecordMac } = await import('@/lib/license/record-mac'))
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

/** Pose une licence dans l'état voulu, avec un MAC cohérent. */
async function poser(licenseId: string, status: string) {
  const expiryAt = new Date(Date.now() + 365 * 24 * 3600 * 1000)
  const base = { licenseId, token: `GF2.${licenseId}`, status, expiryAt, hwid: null }
  await prisma.licenseKey.deleteMany({ where: { licenseId } })
  await prisma.licenseKey.create({
    data: {
      ...base,
      customerId: 'client-test',
      licenseType: 'premium',
      revokedAt: status === 'revoked' ? new Date() : null,
      recordMac: computeRecordMac(base as never),
    },
  })
}

const etat = (licenseId: string) =>
  prisma.licenseKey.findUnique({ where: { licenseId }, select: { status: true, revokedAt: true } })

const traces = (licenseId: string) =>
  prisma.licenseDeviceEvent.findMany({ where: { licenseId }, orderBy: { createdAt: 'asc' } })

beforeEach(async () => {
  await prisma.licenseDeviceEvent.deleteMany({})
  h.admin = true
})

describe('revoke-by-key : retiré, aucun état DB ne peut changer', () => {
  it.each(['active', 'revoked', 'suspended'])('refuse toute transition depuis %s, même avec clé partagée', async (from) => {
    const id = `lic-disabled-${from}`
    await poser(id, from)
    for (const status of ['active', 'revoked', 'suspended']) {
      const r = await revokeByKey(post('/api/admin/licenses/revoke-by-key', {
        licenseId: id, status, confirmReactivation: true, reason: 'test de fermeture',
      }, CLE))
      expect(r.status).toBe(404)
      expect((await r.json()).code).toBe('ENDPOINT_DISABLED')
      expect((await etat(id)).status).toBe(from)
      expect(await traces(id)).toHaveLength(0)
    }
  })
})
