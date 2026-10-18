export const dynamic = 'force-dynamic'

/**
 * GET /api/adresse/recherche?q=… — propositions d'adresses françaises (GF-022).
 *
 * L'appel part du SERVEUR, jamais du navigateur du garage :
 *  · le service public ne voit qu'une instance, pas chaque poste ;
 *  · une politique de sécurité de contenu stricte n'a pas à ouvrir un domaine
 *    tiers au renderer Electron ;
 *  · le débit est borné ICI, une fois, pour tout le produit.
 *
 * Route AUTHENTIFIÉE : elle ne renvoie aucune donnée du garage, mais un relais
 * ouvert serait un service de recherche gratuit offert à qui trouve l'URL.
 */
import { NextResponse } from 'next/server'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { rechercherAdresse, MIN_CARACTERES } from '@/lib/adresse/ban'

export const GET = withAuth(async (req: Request) => {
  await requireSession()

  // Catégorie `api` : 120 requêtes/minute par IP. Une frappe débattue à 300 ms
  // en consomme au plus une poignée ; un script en consommerait beaucoup plus.
  const rl = await enforceRateLimit('api', clientIpFrom(req))
  if (!rl.ok) return rateLimitResponse(rl)

  const q = new URL(req.url).searchParams.get('q') ?? ''
  if (q.trim().length < MIN_CARACTERES) {
    // Ni erreur ni requête sortante : une saisie trop courte n'a pas de sens
    // pour le service, et l'écran ne doit pas afficher d'échec pour autant.
    return NextResponse.json({ ok: true, adresses: [] })
  }

  const resultat = await rechercherAdresse(q)
  return NextResponse.json(resultat, {
    headers: {
      // Les adresses ne changent pas d'une minute à l'autre : une courte mise en
      // cache évite de réinterroger le service pour la même frappe.
      'Cache-Control': 'private, max-age=60',
    },
  })
})
