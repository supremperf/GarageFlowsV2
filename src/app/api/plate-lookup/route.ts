export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'

// GET /api/plate-lookup?plate=AB-123-CD
export const GET = withAuth(async (req) => {
  // SECURITY: authenticate — this route calls an external API and can spend the
  // ANTHROPIC_API_KEY, so it must never be reachable anonymously.
  const session = await requireSession()
  const rl = await enforceRateLimit('api', `plate-lookup:${session.user.garageId}`, { max: 20, windowSec: 60 })
  if (!rl.ok) return rateLimitResponse(rl)

  const { searchParams } = new URL(req.url)
  const plate = searchParams.get('plate')?.toUpperCase().replace(/\s/g, '-')

  if (!plate) return NextResponse.json({ error: 'plate param required' }, { status: 400 })

  // Validation de format AVANT tout appel sortant/payant : rejette les entrées
  // parasites et toute injection dans l'invite IA de repli (la plaque est déjà
  // normalisée en MAJUSCULES, séparateur « - »).
  const PLATE_RE = /^[A-Z0-9-]{4,12}$/
  if (!PLATE_RE.test(plate)) {
    return NextResponse.json({ error: 'Format de plaque invalide' }, { status: 400 })
  }

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

  // ── Aucune donnée : on le DIT, on n'en invente pas ──────────────────────────
  //
  // Il existait ici un « repli IA » qui demandait à un modèle de langue :
  //   « French license plate: "AB-123-CD". Based on the plate format and any
  //     encoding, provide the most likely vehicle info… »
  // et renvoyait sa réponse sous `source: 'ai'`. `JobModal.handlePlateLookup`
  // la traitait comme n'importe quel autre résultat : remplissage du champ
  // `vehicleModel` et message « Véhicule détecté ». La marque, le modèle et
  // l'année ainsi obtenus partaient ensuite dans l'intervention, l'ordre de
  // réparation, le devis et la facture.
  //
  // Or, depuis 2009, une plaque du SIV est attribuée SÉQUENTIELLEMENT au niveau
  // national : elle n'encode ni la marque, ni le modèle, ni l'année, ni le
  // département. Aucun modèle ne peut donc l'en déduire — la consigne
  // « most likely vehicle info » ne pouvait produire qu'une invention
  // plausible, présentée à l'utilisateur comme une consultation officielle.
  //
  // Le repli est supprimé. Une information indisponible est annoncée comme
  // telle ; c'est au garagiste de saisir le véhicule, ce qu'il fait déjà.
  return NextResponse.json({
    plate,
    make:   null,
    model:  null,
    year:   null,
    fuel:   null,
    color:  null,
    source: 'unavailable',
  })
})
