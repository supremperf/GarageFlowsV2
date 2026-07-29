export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { rateLimit } from '@/lib/rate-limit'
import Anthropic from '@anthropic-ai/sdk'

// POST /api/plate-ocr  body: { imageBase64: "data:image/...;base64,..." }
export const POST = withAuth(async (req: Request) => {
  const session = await requireSession()
  const rl = rateLimit(`plate-ocr:${session.user.garageId}`, 10, 60)
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Trop de requêtes OCR. Réessayez dans ${rl.retryAfter}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  const { imageBase64 } = await req.json()
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return NextResponse.json({ error: 'imageBase64 required' }, { status: 400 })
  }
  // Cap the payload before forwarding to the provider (cost/DoS guard). ~6 MB of
  // base64 ≈ a ~4.5 MB image, ample for a plate photo.
  if (imageBase64.length > 6_000_000) {
    return NextResponse.json({ error: 'Image trop volumineuse' }, { status: 413 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'OCR non disponible (ANTHROPIC_API_KEY manquant)' }, { status: 503 })
  }

  // Strip data URL prefix and get media type
  const match = imageBase64.match(/^data:(image\/\w+);base64,(.+)$/)
  if (!match) {
    return NextResponse.json({ error: 'Format image invalide' }, { status: 400 })
  }
  const mediaType = match[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
  const base64Data = match[2]

  let text = ''
  try {
    const client = new Anthropic({ apiKey, timeout: 15000, maxRetries: 1 })
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 50,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Data },
          },
          {
            type: 'text',
            text: 'Read the vehicle license plate in this image. Reply with ONLY the plate number in standard French format (e.g. AB-123-CD) or the exact text visible. No explanation, just the plate text.',
          },
        ],
      }],
    })
    text = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
  } catch (e) {
    // Degrade gracefully instead of surfacing a 500 with the raw provider error.
    console.error('[plate-ocr] provider call failed', e)
    return NextResponse.json({ error: 'OCR temporairement indisponible' }, { status: 503 })
  }

  if (!text) {
    return NextResponse.json({ error: 'Plaque non détectée' }, { status: 422 })
  }

  // Normalize to French plate format
  const normalized = text.toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '')
  return NextResponse.json({ plate: normalized })
})
