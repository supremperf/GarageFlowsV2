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

  const client = new Anthropic({ apiKey })

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

  const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
  if (!text) {
    return NextResponse.json({ error: 'Plaque non détectée' }, { status: 422 })
  }

  // Normalize to French plate format
  const normalized = text.toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '')
  return NextResponse.json({ plate: normalized })
})
