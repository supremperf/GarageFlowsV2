export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { extractDocument } from '@/lib/ocr'
import { vinEngine } from '@/lib/vin'

const DOC_TYPES = ['carte_grise', 'invoice', 'plate', 'vin_plate', 'odometer'] as const

const BodySchema = z.object({
  // OCR (image → text) is performed upstream; this endpoint structures the text.
  text: z.string().trim().min(1).max(20000),
  type: z.enum(DOC_TYPES).optional(),
  minOcrConfidence: z.number().min(0).max(1).optional(),
})

// POST /api/ocr — classify an automotive document and extract structured fields.
// Read-only: extraction only, no persistence, so no confirmation is required.
// Image input requires a configured OcrProvider (not bundled); pass recognised
// `text` from a client-side or server-side OCR engine.
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const garageId = session.user.garageId

  const rl = rateLimit(`ocr:${garageId}`, 30, 60)
  if (!rl.ok) {
    return NextResponse.json({ error: `Trop de requêtes. Réessayez dans ${rl.retryAfter}s.` }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'text requis (OCR effectué en amont)', details: parsed.error.flatten() }, { status: 400 })
  }

  const doc = extractDocument(
    { text: parsed.data.text, blocks: [] },
    { type: parsed.data.type, minOcrConfidence: parsed.data.minOcrConfidence },
  )

  // Enrich a detected VIN with the offline VIN decoder (read-only cross-check).
  const vinField = doc.fields.find((f) => f.key === 'vin')
  const vinDecoded = vinField ? await vinEngine.decode(vinField.value).catch(() => null) : null

  return NextResponse.json({ ...doc, vinDecoded })
})
