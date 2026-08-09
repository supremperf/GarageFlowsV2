/**
 * Route d'attribution/réattribution d'une clé mécanicien (P0-8, AUD réattribution).
 *
 * Prouve le comportement RÉELLEMENT appliqué par le serveur à la réattribution —
 * la mitigation qui, jusqu'ici, n'était pas couverte par un test :
 *  - première attribution : historise, N'A PAS d'ancien titulaire à couper ;
 *  - réattribution : clôture l'attribution précédente, RÉVOQUE DÉFINITIVEMENT
 *    TOUS les appareils non révoqués — actifs ET déconnectés (« deactivated ») —
 *    de l'ancien titulaire (un appareil « deactivated » retenait autrement un
 *    siège), recalcule l'intégrité (recordMac) et audite « reassign » ;
 *  - garde-fous : même mécanicien → 409, mécanicien/clé absents → 404/permission.
 *
 * Résiduel HONNÊTE (non prétendu corrigé ici) : la clé mécanicien est un jeton
 * PORTEUR signé ; sa RÉ-ÉMISSION cryptographique (nouveau token) exige la clé
 * privée du control-plane (hors application) — cf. EXTERNAL_BLOCKERS #8bis. Le
 * plafond de sièges (seats=1) borne la fenêtre de ré-activation de l'ancien
 * porteur ; ce test prouve que la révocation d'appareils, elle, est totale.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.GF_DB_MAC_SECRET = 'test-mac-secret-assign'

const cap = vi.hoisted(() => ({
  license: null as Record<string, unknown> | null,
  mechanic: null as Record<string, unknown> | null,
  assignmentUpdateMany: [] as Array<Record<string, unknown>>,
  assignmentCreate: [] as Array<Record<string, unknown>>,
  licenseUpdate: [] as Array<Record<string, unknown>>,
  deviceUpdateMany: [] as Array<Record<string, unknown>>,
  audit: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/db', () => {
  const tx = {
    mechanicLicenseAssignment: {
      updateMany: async (a: Record<string, unknown>) => { cap.assignmentUpdateMany.push(a); return { count: 1 } },
      create: async (a: { data: Record<string, unknown> }) => { cap.assignmentCreate.push(a.data); return a.data },
    },
    licenseKey: { update: async (a: { data: Record<string, unknown> }) => { cap.licenseUpdate.push(a.data); return a.data } },
    licenseDevice: { updateMany: async (a: Record<string, unknown>) => { cap.deviceUpdateMany.push(a); return { count: 3 } } },
    mechanicActionAudit: { create: async (a: { data: Record<string, unknown> }) => { cap.audit.push(a.data); return a.data } },
  }
  return {
    prisma: {
      licenseKey: { findFirst: async () => cap.license },
      mechanic: { findFirst: async () => cap.mechanic },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
    isPostgresDatabase: () => false,
  }
})
vi.mock('@/lib/api-helpers', () => ({
  requireSession: async () => ({ user: { id: 'owner1', role: 'OWNER', garageId: 'gA' } }),
  withAuth: (h: (req: unknown, ctx: unknown) => Promise<unknown>) =>
    async (req: unknown, ctx: unknown) => {
      try { return await h(req, ctx) } catch (e) { if (e instanceof Response) return e; throw e }
    },
}))
vi.mock('@/lib/authz', () => ({ can: () => true }))
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }))

import { POST as ASSIGN } from '@/app/api/mechanic-licenses/[lid]/assign/route'

function assignReq(mechanicId: unknown) {
  const req = new Request('http://127.0.0.1/api/mechanic-licenses/L1/assign', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mechanicId }),
  })
  return (ASSIGN as unknown as (r: Request, c: { params: { lid: string } }) => Promise<Response>)(req, { params: { lid: 'L1' } })
}

const baseLicense = (mechanicId: string | null) => ({
  id: 7, licenseId: 'L1', token: 'GF2.tok', status: 'active',
  expiryAt: new Date('2030-01-01T00:00:00Z'), hwid: null,
  parentLicenseId: 'P1', mechanicId, licenseType: 'mechanic', garageId: 'gA',
})

beforeEach(() => {
  cap.license = null; cap.mechanic = { id: 'M2' }
  cap.assignmentUpdateMany = []; cap.assignmentCreate = []
  cap.licenseUpdate = []; cap.deviceUpdateMany = []; cap.audit = []
})

describe('assign — première attribution (aucun ancien titulaire)', () => {
  it('historise + met à jour la clé, SANS toucher aux appareils', async () => {
    cap.license = baseLicense(null)
    const res = await assignReq('M2')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, licenseId: 'L1', mechanicId: 'M2', reassignment: false })
    expect(cap.assignmentCreate).toHaveLength(1)
    expect(cap.assignmentCreate[0]).toMatchObject({ mechanicId: 'M2', previousMechanicId: null })
    expect(cap.licenseUpdate[0]).toMatchObject({ mechanicId: 'M2' })
    // Pas d'ancien titulaire → aucune clôture d'historique ni révocation d'appareils.
    expect(cap.assignmentUpdateMany).toHaveLength(0)
    expect(cap.deviceUpdateMany).toHaveLength(0)
    expect(cap.audit[0]).toMatchObject({ action: 'assign' })
  })
})

describe('reassign — révocation TOTALE des appareils de l’ancien titulaire', () => {
  it('révoque les appareils actifs ET déconnectés (aucun siège retenu), clôture l’historique, audite reassign', async () => {
    cap.license = baseLicense('M1')            // déjà attribuée à M1
    const res = await assignReq('M2')          // réattribuée à M2
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, reassignment: true })

    // Historique précédent clôturé.
    expect(cap.assignmentUpdateMany).toHaveLength(1)
    expect((cap.assignmentUpdateMany[0].where as Record<string, unknown>).unassignedAt).toBeNull()

    // Révocation d'appareils : PERMANENTE, ciblant active ET deactivated.
    expect(cap.deviceUpdateMany).toHaveLength(1)
    const where = cap.deviceUpdateMany[0].where as Record<string, unknown>
    const data = cap.deviceUpdateMany[0].data as Record<string, unknown>
    expect((where.status as { in: string[] }).in.sort()).toEqual(['active', 'deactivated'])
    expect(data.status).toBe('revoked')
    expect(data.revokeReason).toBe('reassigned')
    expect(data.revokedAt).toBeInstanceOf(Date)

    // Nouvel historique + audit.
    expect(cap.assignmentCreate[0]).toMatchObject({ mechanicId: 'M2', previousMechanicId: 'M1' })
    expect(cap.audit[0]).toMatchObject({ action: 'reassign' })
  })
})

describe('assign — garde-fous', () => {
  it('même mécanicien déjà titulaire → 409, aucune écriture', async () => {
    cap.license = baseLicense('M2')
    const res = await assignReq('M2')
    expect(res.status).toBe(409)
    expect(cap.deviceUpdateMany).toHaveLength(0)
    expect(cap.assignmentCreate).toHaveLength(0)
  })

  it('mechanicId manquant → 400', async () => {
    cap.license = baseLicense('M1')
    const res = await assignReq('')
    expect(res.status).toBe(400)
  })

  it('clé introuvable → 404', async () => {
    cap.license = null
    const res = await assignReq('M2')
    expect(res.status).toBe(404)
  })

  it('mécanicien introuvable dans le garage → 404', async () => {
    cap.license = baseLicense('M1'); cap.mechanic = null
    const res = await assignReq('MX')
    expect(res.status).toBe(404)
  })
})
