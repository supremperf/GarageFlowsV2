/**
 * §7 — Durcissement des photos mécanicien : type réel (octets magiques, pas le
 * MIME déclaré), taille, empreinte sha256, et plafond par intervention.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateMechanicPhoto, MECHANIC_PHOTO_MAX_PER_JOB } from '@/lib/mechanic-photo'

function url(bytes: number[], mime = 'image/jpeg'): string {
  // padding à >= 12 octets (le sniff exige au moins 12 octets)
  const padded = bytes.concat(Array(Math.max(0, 16 - bytes.length)).fill(0))
  return `data:${mime};base64,${Buffer.from(padded).toString('base64')}`
}
const JPEG = [0xff, 0xd8, 0xff, 0xe0]
const PNG  = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50] // RIFF....WEBP
const GIF  = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] // GIF89a
const PDF  = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31] // %PDF-1
const EXE  = [0x4d, 0x5a, 0x90, 0x00] // MZ (PE)
const ZIP  = [0x50, 0x4b, 0x03, 0x04] // PK..

describe('§7 — validateMechanicPhoto : types autorisés', () => {
  it('JPEG / PNG / WebP acceptés, type RÉEL renvoyé + empreinte sha256', () => {
    const j = validateMechanicPhoto(url(JPEG))
    expect(j.ok && j.mime).toBe('image/jpeg')
    expect(j.ok && /^[0-9a-f]{64}$/.test(j.hash)).toBe(true)
    const p = validateMechanicPhoto(url(PNG))
    expect(p.ok && p.mime).toBe('image/png')
    const w = validateMechanicPhoto(url(WEBP))
    expect(w.ok && w.mime).toBe('image/webp')
  })
  it('le MIME déclaré ne fait PAS foi : PNG déclaré image/jpeg → sniffé image/png', () => {
    const r = validateMechanicPhoto(url(PNG, 'image/jpeg'))
    expect(r.ok && r.mime).toBe('image/png')
  })
})

describe('§7 — validateMechanicPhoto : refus', () => {
  it('GIF / PDF / exe renommé / zip renommé → refusés (octets magiques)', () => {
    for (const b of [GIF, PDF, EXE, ZIP]) {
      expect(validateMechanicPhoto(url(b)).ok).toBe(false)
    }
  })
  it('payload vide, base64 invalide, non-data-url → refusés', () => {
    expect(validateMechanicPhoto('data:image/jpeg;base64,').ok).toBe(false)
    expect(validateMechanicPhoto('pas-une-data-url').ok).toBe(false)
    expect(validateMechanicPhoto('').ok).toBe(false)
    expect(validateMechanicPhoto(null).ok).toBe(false)
    expect(validateMechanicPhoto(123).ok).toBe(false)
  })
  it('trop volumineux (au-delà du plafond) → refusé', () => {
    const huge = 'A'.repeat(8 * 1024 * 1024 * 2)
    expect(validateMechanicPhoto(`data:image/jpeg;base64,${huge}`).ok).toBe(false)
  })
  it('empreinte déterministe : même contenu → même hash, contenu différent → hash différent', () => {
    const a = validateMechanicPhoto(url(JPEG))
    const b = validateMechanicPhoto(url(JPEG))
    const c = validateMechanicPhoto(url(PNG))
    expect(a.ok && b.ok && a.hash === b.hash).toBe(true)
    expect(a.ok && c.ok && a.hash !== c.hash).toBe(true)
  })
})

// ── Plafond par intervention (route) ─────────────────────────────────────────
const state = vi.hoisted(() => ({ photoCount: 0 }))
vi.mock('@/lib/db', () => ({
  prisma: {
    jobPhoto: {
      count: async () => state.photoCount,
      create: async (a: { data: unknown; select: unknown }) => ({ id: 'PH1', phase: 'during', caption: null, photoPath: 'p', mechanicId: 'M1', createdAt: new Date() }),
    },
  },
}))
vi.mock('@/lib/mechanic-api', () => ({
  requireMechanic: async () => ({ garageId: 'gA', mechanicId: 'M1', licenseId: 'L1', deviceId: null }),
  withMechanic: (h: (req: unknown, ctx: unknown) => Promise<unknown>) =>
    async (req: unknown, ctx: unknown) => { try { return await h(req, ctx) } catch (e) { if (e instanceof Response) return e; throw e } },
  findAssignedJob: async () => ({ id: 'J1' }),
  logMechanicAction: async () => {},
}))
vi.mock('@/lib/photo-store', () => ({ savePhoto: () => 'jobs/J1/x.jpg' }))

import { POST } from '@/app/api/mechanic/jobs/[id]/photos/route'

function post(base64: string) {
  const req = new Request('http://127.0.0.1/p', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ base64 }) })
  return (POST as unknown as (r: Request, c: { params: { id: string } }) => Promise<Response>)(req, { params: { id: 'J1' } })
}

describe('§7 — plafond de photos par intervention', () => {
  beforeEach(() => { state.photoCount = 0 })
  it('sous le plafond → 201', async () => {
    state.photoCount = MECHANIC_PHOTO_MAX_PER_JOB - 1
    expect((await post(url(JPEG))).status).toBe(201)
  })
  it('au plafond → 403', async () => {
    state.photoCount = MECHANIC_PHOTO_MAX_PER_JOB
    expect((await post(url(JPEG))).status).toBe(403)
  })
  it('contenu invalide → 400 (avant tout comptage/écriture)', async () => {
    expect((await post(url(EXE))).status).toBe(400)
  })
})
