export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { rateLimit } from '@/lib/rate-limit'
import Anthropic from '@anthropic-ai/sdk'

// GET /api/plate-lookup?plate=AB-123-CD
export const GET = withAuth(async (req) => {
  // Require an authenticated session and a per-garage rate limit: this endpoint
  // triggers a billable LLM fallback, so it must not be reachable unauthenticated
  // or without a per-tenant cost cap (mirrors plate-ocr).
  const session = await requireSession()
  const rl = rateLimit(`plate-lookup:${session.user.garageId}`, 10, 60)
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Trop de requêtes. Réessayez dans ${rl.retryAfter}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  const { searchParams } = new URL(req.url)
  // Keep only plate-legal characters (defence for the prompt + upstream URL).
  const plate = searchParams.get('plate')?.toUpperCase().replace(/\s/g, '-').replace(/[^A-Z0-9-]/g, '')

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

  // Degraded response reused when the provider is unavailable or output is bad.
  const degraded = {
    plate, make: null, model: null, year: null, fuel: null, color: null,
    source: 'unknown' as const,
  }

  try {
    const client = new Anthropic({ apiKey, timeout: 8000, maxRetries: 1 })
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `French license plate: "${plate}". Based on the plate format and any encoding, provide the most likely vehicle info in JSON only (no explanation): {"make":"","model":"","year":null,"fuel":"","color":"","confidence":"low"}. If you cannot determine, use null values. Reply with only valid JSON.`,
      }],
    })

    const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '{}'
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {}

    // Whitelist output fields — never spread arbitrary model-produced keys.
    return NextResponse.json({
      plate,
      make:       typeof parsed.make === 'string' ? parsed.make : null,
      model:      typeof parsed.model === 'string' ? parsed.model : null,
      year:       typeof parsed.year === 'number' ? parsed.year : null,
      fuel:       typeof parsed.fuel === 'string' ? parsed.fuel : null,
      color:      typeof parsed.color === 'string' ? parsed.color : null,
      confidence: typeof parsed.confidence === 'string' ? parsed.confidence : 'low',
      source: 'ai',
    })
  } catch (e) {
    console.error('[plate-lookup] AI fallback failed', e)
    return NextResponse.json(degraded)
  }
})
