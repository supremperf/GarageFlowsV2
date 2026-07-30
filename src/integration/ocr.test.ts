/**
 * API-route integration test for POST /api/ocr.
 *
 * This route touches NO database — only the auth layer is mocked. Verifies
 * structured extraction through the real handler, the VIN cross-decode, the two
 * independent size guards (413 pre-parse, 400 post-parse), and the OCR-quality
 * warning. Rate-limit state is reset per test (the handler limits 30/min/garage).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'

const h = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/api-helpers', () => ({ withAuth: (fn: unknown) => fn, requireSession: async () => h.session }))

let POST: (req: Request) => Promise<Response>
let resetRateLimit: (...args: any[]) => Promise<void>
const GARAGE = 'garage-ocr'

const CARTE_GRISE = "CERTIFICAT D'IMMATRICULATION\nA  AB-123-CD\nB  15/03/2018\nD.1 PEUGEOT\nD.3 308\nE  VF3LBHYBWFS123456\nP.3 GO"

async function post(body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: any }> {
  const res = await POST(new Request('http://localhost/api/ocr', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }))
  return { status: res.status, json: await res.json() }
}
const field = (json: any, key: string) => json.fields.find((f: any) => f.key === key)

beforeAll(async () => {
  ;({ POST } = await import('@/app/api/ocr/route') as any)
  ;({ resetRateLimit } = await import('@/lib/security/rate-limit'))
  h.session = { user: { id: 'u', name: 'A', garageId: GARAGE } }
})

afterEach(() => resetRateLimit('api', `ocr:${GARAGE}`))

describe('POST /api/ocr', () => {
  it('classifies a carte grise and extracts its fields', async () => {
    const { status, json } = await post({ text: CARTE_GRISE, ocrConfidence: 0.9 })
    expect(status).toBe(200)
    expect(json.type).toBe('carte_grise')
    expect(field(json, 'plate').value).toBe('AB-123-CD')
    expect(field(json, 'vin').value).toBe('VF3LBHYBWFS123456')
    expect(field(json, 'make').value).toBe('PEUGEOT')
    expect(field(json, 'model').value).toBe('308')
    expect(field(json, 'firstRegistration').value).toBe('2018-03-15')
    expect(field(json, 'energy').value).toBe('Diesel')
  })

  it('cross-decodes a detected VIN', async () => {
    const { json } = await post({ text: CARTE_GRISE, ocrConfidence: 0.9 })
    expect(json.vinDecoded).not.toBeNull()
    expect(json.vinDecoded.vin).toBe('VF3LBHYBWFS123456')
    expect(json.vinDecoded.wmi).toBe('VF3')
    expect(json.vinDecoded.manufacturer).toBe('Peugeot') // cache-stable field
  })

  it('returns vinDecoded null when the document has no VIN', async () => {
    const { json } = await post({ text: 'AB-123-CD', type: 'plate' })
    expect(json.vinDecoded).toBeNull()
  })

  it('rejects an oversized body (413) before parsing, boundary-exact', async () => {
    expect((await post({ text: 'x' }, { 'content-length': '200001' })).status).toBe(413)
    // At the cap it passes the size gate (then extracts normally).
    expect((await post({ text: CARTE_GRISE }, { 'content-length': '200000' })).status).toBe(200)
    // Proves ORDERING: a body that would fail Zod (empty text → 400) still yields
    // 413 when oversized — so the size guard short-circuits BEFORE parsing. A
    // post-parse guard would surface 400 here instead.
    expect((await post({ text: '' }, { 'content-length': '200001' })).status).toBe(413)
    expect((await post('not json', { 'content-length': '200001' })).status).toBe(413)
  })

  it('rejects empty/blank/missing/invalid-json text with 400', async () => {
    for (const body of [{ text: '' }, { text: '   ' }, {}, 'not json']) {
      const { status, json } = await post(body)
      expect(status).toBe(400)
      expect(json.error).toMatch(/text requis/)
    }
  })

  it('emits a low-quality warning only when ocrConfidence is below the threshold', async () => {
    const low = await post({ text: CARTE_GRISE, ocrConfidence: 0.3 })
    expect(low.json.warnings.some((w: string) => /Confiance OCR faible/.test(w))).toBe(true)

    const high = await post({ text: CARTE_GRISE, ocrConfidence: 0.9 })
    expect(high.json.warnings.some((w: string) => /Confiance OCR faible/.test(w))).toBe(false)

    const override = await post({ text: CARTE_GRISE, ocrConfidence: 0.6, minOcrConfidence: 0.7 })
    expect(override.json.warnings.some((w: string) => /Confiance OCR faible/.test(w))).toBe(true)
  })

  it('applies the route rate limit (429 after the window is exhausted)', async () => {
    for (let i = 0; i < 30; i++) await post({ text: 'AB-123-CD', type: 'plate' })
    const { status, json } = await post({ text: 'AB-123-CD', type: 'plate' })
    expect(status).toBe(429)
    expect(json.error).toMatch(/Trop de requêtes/)
  })
})
