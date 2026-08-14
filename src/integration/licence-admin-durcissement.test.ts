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

describe('revoke-by-key : `revoked` reste TERMINAL (GF-DUR-048)', () => {
  it('révoquer fonctionne, et laisse une trace', async () => {
    await poser('lic-a', 'active')
    const r = await revokeByKey(post('/api/admin/licenses/revoke-by-key', { licenseId: 'lic-a', status: 'revoked' }, CLE))
    expect(r.status).toBe(200)

    const e = await etat('lic-a')
    expect(e.status).toBe('revoked')
    expect(e.revokedAt, 'la date de révocation doit être posée').not.toBeNull()

    const t = await traces('lic-a')
    expect(t, 'une révocation sans trace est intraçable').toHaveLength(1)
    expect(t[0].action).toBe('revoked')
    expect(t[0].detail, 'aucun jeton ni clé dans la trace').not.toMatch(/GF2\.|BEGIN .*PRIVATE/)
  })

  it('RÉACTIVER une licence révoquée par un PATCH ordinaire est REFUSÉ', async () => {
    // Le défaut : c'était une écriture de champ ordinaire, qui effaçait même
    // `revokedAt`.
    //
    // La machine à états distingue deux refus, et c'est plus fin que ce que ce
    // test attendait d'abord : un `{status:'active'}` nu ne se voit pas opposer
    // « révoqué est terminal » mais « la réactivation exige un geste dédié ».
    // La propriété qui compte est la même — la licence ne repasse pas active.
    await poser('lic-b', 'revoked')
    const r = await revokeByKey(post('/api/admin/licenses/revoke-by-key', { licenseId: 'lic-b', status: 'active' }, CLE))
    expect(r.status).toBe(400)
    expect((await r.json()).code).toBe('REACTIVATION_REQUIRES_CONFIRMATION')

    const e = await etat('lic-b')
    expect(e.status, 'la licence ne doit PAS être repassée active').toBe('revoked')
    expect(e.revokedAt, 'la date de révocation ne doit pas être effacée').not.toBeNull()
    expect(await traces('lic-b'), 'un refus n’écrit aucune transition').toHaveLength(0)
  })

  it('réactiver SANS motif reste refusé, même avec confirmation', async () => {
    await poser('lic-c', 'revoked')
    const r = await revokeByKey(post('/api/admin/licenses/revoke-by-key',
      { licenseId: 'lic-c', status: 'active', confirmReactivation: true }, CLE))
    expect(r.status).toBe(400)
    expect((await etat('lic-c')).status).toBe('revoked')
  })

  it('réactiver AVEC confirmation ET motif est possible — la voie légitime existe', async () => {
    // Contrôle positif : sans lui, les tests ci-dessus passeraient aussi si la
    // route refusait tout.
    await poser('lic-d', 'revoked')
    const r = await revokeByKey(post('/api/admin/licenses/revoke-by-key', {
      licenseId: 'lic-d', status: 'active',
      confirmReactivation: true, reason: 'Erreur de saisie du support, licence rétablie',
    }, CLE))
    expect(r.status).toBe(200)

    const e = await etat('lic-d')
    expect(e.status).toBe('active')
    expect(e.revokedAt, 'une réactivation légitime efface la date de révocation').toBeNull()

    const t = await traces('lic-d')
    expect(t).toHaveLength(1)
    expect(t[0].action).toBe('reactivated')
    expect(JSON.parse(t[0].detail).reason, 'le motif doit être conservé').toContain('Erreur de saisie')
  })

  it('suspendre puis réactiver reste libre — ce n’est pas un état terminal', async () => {
    await poser('lic-e', 'active')
    expect((await revokeByKey(post('/api/admin/licenses/revoke-by-key', { licenseId: 'lic-e', status: 'suspended' }, CLE))).status).toBe(200)
    expect((await etat('lic-e')).status).toBe('suspended')

    expect((await revokeByKey(post('/api/admin/licenses/revoke-by-key', { licenseId: 'lic-e', status: 'active' }, CLE))).status).toBe(200)
    expect((await etat('lic-e')).status).toBe('active')
  })

  it('une clé API fausse ne change RIEN', async () => {
    await poser('lic-f', 'active')
    const r = await revokeByKey(post('/api/admin/licenses/revoke-by-key',
      { licenseId: 'lic-f', status: 'revoked' }, { 'x-gf-key': 'mauvaise-cle-0123456789abcdef' }))
    expect(r.status).toBe(403)
    expect((await etat('lic-f')).status).toBe('active')
    expect(await traces('lic-f')).toHaveLength(0)
  })

  it('un statut hors énumération est refusé', async () => {
    await poser('lic-g', 'active')
    for (const mauvais of ['Revoked', 'revoked ', 'REVOKED', 'deleted', '']) {
      const r = await revokeByKey(post('/api/admin/licenses/revoke-by-key', { licenseId: 'lic-g', status: mauvais }, CLE))
      expect(r.status, `statut « ${mauvais} » accepté`).toBe(400)
    }
    expect((await etat('lic-g')).status).toBe('active')
  })
})
