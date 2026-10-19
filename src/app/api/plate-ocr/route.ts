export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { normaliserPlaque } from '@/lib/plate-format'
import { logger } from '@/lib/logger'
import Anthropic from '@anthropic-ai/sdk'

// POST /api/plate-ocr  body: { imageBase64: "data:image/...;base64,..." }
export const POST = withAuth(async (req: Request) => {
  const session = await requireSession()
  const rl = await enforceRateLimit('api', `plate-ocr:${session.user.garageId}`, { max: 10, windowSec: 60 })
  if (!rl.ok) return rateLimitResponse(rl)

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
    // Dégradation propre plutôt qu'un 500 portant l'erreur brute du fournisseur.
    // `logger` et non `console` : lui seul applique la rédaction centralisée, et
    // une erreur de SDK peut transporter des en-têtes de requête (§15).
    logger.error('[plate-ocr] appel au fournisseur en échec', e)
    return NextResponse.json({ error: 'OCR temporairement indisponible' }, { status: 503 })
  }

  if (!text) {
    return NextResponse.json({ error: 'Plaque non détectée' }, { status: 422 })
  }

  // Le modèle rend du TEXTE LIBRE : il peut très bien répondre « je ne distingue
  // pas la plaque ». Sans contrôle de forme, cette phrase devenait la plaque —
  // `PlateSearchField` la recopie dans le champ ET déclenche la recherche
  // véhicule, donc elle partait dans l'intervention, le devis et la facture.
  // C'est exactement le défaut GF-FINAL-020, par une autre porte : une sortie de
  // modèle présentée comme une LECTURE alors qu'elle n'en est pas une.
  //
  // On refuse donc tout ce qui n'est pas une immatriculation française :
  //   · SIV (depuis 2009) — AB-123-CD ;
  //   · FNI (véhicules antérieurs, toujours en circulation) — 1234-AB-75.
  // Mieux vaut « non détectée », qui invite à ressaisir, qu'une valeur inventée
  // que personne ne relira.
  const plaque = normaliserPlaque(text)
  if (!plaque) {
    logger.info('[plate-ocr] sortie du modèle non conforme, refusée')
    return NextResponse.json({ error: 'Plaque non détectée' }, { status: 422 })
  }
  return NextResponse.json({ plate: plaque })
})
