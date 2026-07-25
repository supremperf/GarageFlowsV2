export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-helpers'
import Anthropic from '@anthropic-ai/sdk'

// GET /api/plate-lookup?plate=AB-123-CD
export const GET = withAuth(async (req) => {
  const { searchParams } = new URL(req.url)
  const plate = searchParams.get('plate')?.toUpperCase().replace(/\s/g, '-')

  if (!plate) return NextResponse.json({ error: 'plate param required' }, { status: 400 })

  // Try French SIV-like API first (free, no auth)
  try {
    const r = await fetch(
      `https://api-immat.com/vehicule/${encodeURIComponent(plate)}`,
      { signal: AbortSignal.timeout(4000) }
    )
    if (r.ok) {
      const d = await r.json()
      if (d?.marque) {
        return NextResponse.json({
          plate,
          make: d.marque ?? '',
          model: d.modele ?? '',
          year: d.annee ?? null,
          fuel: d.energie ?? null,
          color: d.couleur ?? null,
          source: 'siv',
        })
      }
    }
  } catch {
    // fall through to AI
  }

  // AI fallback — Claude parses the plate format and provides best-effort info
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({
      plate,
      make: null,
      model: null,
      year: null,
      fuel: null,
      color: null,
      source: 'unknown',
      error: 'no_api',
    })
  }

  const client = new Anthropic({ apiKey })
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `French license plate: "${plate}". Based on the plate format and any encoding, provide the most likely vehicle info in JSON only (no explanation): {"make":"","model":"","year":null,"fuel":"","color":"","confidence":"low"}. If you cannot determine, use null values. Reply with only valid JSON.`,
    }],
  })

  try {
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '{}'
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {}
    return NextResponse.json({ plate, ...parsed, source: 'ai' })
  } catch {
    return NextResponse.json({ plate, make: null, model: null, year: null, source: 'unknown' })
  }
})
