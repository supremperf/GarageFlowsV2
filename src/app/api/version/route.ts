export const dynamic = 'force-dynamic'

/**
 * GET /api/version — contrat de compatibilité, lisible sans authentification.
 *
 * ─── Pourquoi ──────────────────────────────────────────────────────────────
 * Un poste en vX peut appeler une API en vY pendant que la PWA est encore en
 * vZ. Rien ne permettait à un client de le SAVOIR : la divergence n'apparaissait
 * qu'en production, sous forme de champs manquants ou d'écritures ignorées.
 * Cette réponse donne à chaque client de quoi décider AVANT d'écrire.
 *
 * ─── Ce qui est renvoyé (et rien d'autre) ──────────────────────────────────
 * Des numéros de version. Aucune information d'infrastructure, aucun secret,
 * aucun nom d'hôte, aucun état de base : cet endpoint est public par
 * construction, il ne doit donc jamais devenir un outil de reconnaissance.
 *
 * Un client PEUT passer sa propre version (`?client=pwa&version=1.1.0`) pour
 * obtenir directement le verdict, plutôt que de réimplémenter la comparaison.
 */
import { NextResponse } from 'next/server'
import { versionInfo, evaluateCompatibility } from '@/lib/version'
import type { ClientPlatform } from '@/lib/license/client-policy'

const NO_STORE = { 'Cache-Control': 'no-store' }

function platformOf(raw: string | null): ClientPlatform {
  if (raw === 'electron' || raw === 'desktop') return 'electron'
  if (raw === 'pwa') return 'pwa'
  return 'unknown'
}

export async function GET(req: Request) {
  const info = versionInfo()
  const { searchParams } = new URL(req.url)
  const platform = platformOf(searchParams.get('client'))
  const clientVersion = searchParams.get('version')

  // Sans plateforme reconnue, on se contente de publier le contrat : on ne rend
  // JAMAIS un verdict « ok » par défaut à un client qu'on n'a pas identifié.
  if (platform === 'unknown') {
    return NextResponse.json(info, { headers: NO_STORE })
  }

  const minimum = platform === 'electron' ? info.minimumDesktopVersion : info.minimumPwaVersion
  const compatibility = evaluateCompatibility(clientVersion, minimum)

  return NextResponse.json({ ...info, client: { platform, version: clientVersion, compatibility } }, { headers: NO_STORE })
}
