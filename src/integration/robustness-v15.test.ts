/**
 * Robustesse V15 (P2 — base SQLite réelle) — trois corrections :
 *  1. labor-operations/bulk-import : tableau borné (anti-DoS) ;
 *  2. appointments/[id] : transition de statut ATOMIQUE (anti-TOCTOU) — deux
 *     actions concurrentes ne peuvent pas s'écraser ;
 *  3. mechanics : dé-doublonnage RÉEL au niveau applicatif (le handler P2002
 *     ne se déclenchait jamais faute de contrainte d'unicité en base).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { prepareTestDb } from '../test-utils/prepare-test-db'

const DB_PATH = path.resolve(__dirname, '../../.tmp-robustness-v15.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)()
  return { ...actual, withAuth: (fn: unknown) => fn, requireSession: async () => h.session }
})

let prisma: any
let bulkImport: (req: Request) => Promise<Response>
let apptAction: (req: Request, ctx: { params: { id: string } }) => Promise<Response>
let mechPost: (req: Request) => Promise<Response>
const ctx = { garageId: '' }

const jreq = (method: string, body?: unknown) =>
  new Request('http://localhost/x', { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

beforeAll(async () => {
  prepareTestDb(DB_PATH)
  ;({ prisma } = await import('@/lib/db'))
  ;({ POST: bulkImport } = (await import('@/app/api/labor-operations/bulk-import/route')) as any)
  ;({ POST: apptAction } = (await import('@/app/api/appointments/[id]/route')) as any)
  ;({ POST: mechPost } = (await import('@/app/api/mechanics/route')) as any)

  const g = await prisma.garage.create({ data: { name: 'RB', slug: 'robustness-v15' } })
  ctx.garageId = g.id
  h.session = { user: { id: 'u', role: 'OWNER', garageId: g.id, name: 'O', email: 'o@o' } }
}, 120_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
})

describe('labor bulk-import — borne anti-DoS (V15 P2)', () => {
  it('> 500 opérations → 400, rien inséré', async () => {
    const operations = Array.from({ length: 501 }, (_, i) => ({ name: `Op ${i}`, durationMin: 30, unitPrice: 10 }))
    const res = await bulkImport(jreq('POST', { operations }))
    expect(res.status).toBe(400)
    const count = await prisma.laborOperation.count({ where: { garageId: ctx.garageId } })
    expect(count).toBe(0)
  })
  it('lot raisonnable → 201', async () => {
    const operations = [{ name: 'Vidange', durationMin: 30, unitPrice: 40 }, { name: 'Freins', durationMin: 60, unitPrice: 90 }]
    const res = await bulkImport(jreq('POST', { operations }))
    expect(res.status).toBe(201)
    const count = await prisma.laborOperation.count({ where: { garageId: ctx.garageId } })
    expect(count).toBe(2)
  })
})

describe('appointment — transition atomique (V15 P2)', () => {
  /**
   * Ce que le handler garantit VRAIMENT : aucune mise à jour perdue. Il relit le
   * statut dans le `where` de l'update (compare-and-swap) ; une écriture fondée
   * sur un statut périmé ne matche aucune ligne et repart en 409.
   *
   * Il ne garantit PAS « exactement un gagnant ». Deux entrelacements sont
   * possibles et tous deux CORRECTS :
   *
   *   a) lecture, lecture, écriture, écriture  → le second update ne matche plus
   *      → [200, 409]  (~85 % des exécutions mesurées)
   *   b) lecture, écriture, lecture, écriture  → le second relit « confirmed »,
   *      et `cancel` EST autorisé depuis « confirmed » (canModifyAppointment)
   *      → [200, 200], état final « cancelled »  (~15 % des exécutions)
   *
   * L'ancienne assertion `toEqual([200, 409])` traitait (b) comme un échec : le
   * test tombait environ une fois sur sept, sans qu'aucun défaut n'existe.
   * Mesuré sur 180 courses : l'état final a TOUJOURS été un terminal valide,
   * cohérent avec les actions ayant réussi — jamais un mélange, jamais une perte.
   *
   * On répète donc la course : chaque itération vérifie l'invariant réel, et
   * l'ensemble prouve que le compare-and-swap rejette bien les écritures
   * périmées (au moins un 409 sur 20 courses ; la probabilité d'en manquer un
   * est de 0,15^20, soit ~3·10⁻¹⁷).
   */
  it('confirm + cancel concurrents : aucune mise à jour perdue, état final cohérent', async () => {
    const RACES = 20
    let sawConflict = false

    for (let i = 0; i < RACES; i++) {
      const appt = await prisma.appointment.create({
        data: { garageId: ctx.garageId, clientName: 'C', reason: 'R', date: '2026-08-10', startTime: '09:00', status: 'requested' },
      })
      const [a, b] = await Promise.all([
        apptAction(jreq('POST', { action: 'confirm' }), { params: { id: appt.id } }),
        apptAction(jreq('POST', { action: 'cancel' }), { params: { id: appt.id } }),
      ])
      const statuses = [a.status, b.status].sort()
      const fresh = await prisma.appointment.findUnique({ where: { id: appt.id } })

      // Jamais de 500 ni d'autre code : soit l'action s'applique, soit elle est
      // refusée parce que l'état a bougé.
      expect(statuses.every((s) => s === 200 || s === 409)).toBe(true)
      // Au moins une action aboutit : le rendez-vous ne reste jamais bloqué.
      expect(statuses).toContain(200)

      if (statuses[1] === 409) {
        sawConflict = true
        // Un seul gagnant → l'état final est SON état terminal.
        expect(['confirmed', 'cancelled']).toContain(fresh.status)
      } else {
        // Les deux ont abouti : seule la séquence confirm PUIS cancel est
        // légale (cancel accepte « confirmed », confirm n'accepte que
        // « requested »). L'état final ne peut donc être que « cancelled ».
        expect(fresh.status).toBe('cancelled')
      }
    }

    // Le compare-and-swap a effectivement rejeté au moins une écriture périmée.
    expect(sawConflict).toBe(true)
  }, 60_000)
})

describe('mechanics — dé-doublonnage réel (V15 P2)', () => {
  it('même nom (casse différente) → 409 ; nom distinct → 201', async () => {
    const first = await mechPost(jreq('POST', { name: 'Jean', color: '#3b82f6', specialty: [] }))
    expect(first.status).toBe(201)
    const dup = await mechPost(jreq('POST', { name: '  jean ', color: '#ef4444', specialty: [] }))
    expect(dup.status).toBe(409)
    const other = await mechPost(jreq('POST', { name: 'Marie', color: '#10b981', specialty: [] }))
    expect(other.status).toBe(201)
    const count = await prisma.mechanic.count({ where: { garageId: ctx.garageId } })
    expect(count).toBe(2) // Jean + Marie, pas de doublon
  })
})
