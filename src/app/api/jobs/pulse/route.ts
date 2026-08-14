export const dynamic = 'force-dynamic'

/**
 * GET /api/jobs/pulse?date=YYYY-MM-DD — empreinte de l'état du planning.
 *
 * ─── Le problème qu'elle résout (GF-DUR-041) ────────────────────────────────
 * La synchronisation n'allait que dans un sens. Le poste garage → PWA mécanicien
 * fonctionne (sondage à 3 s, mesuré 438–2989 ms). L'inverse, RIEN : le planning
 * du poste ne sonde pas, il ne recharge qu'au retour de focus et au plus une
 * fois par 30 s. Un mécanicien qui démarre son travail, le termine, ajoute une
 * photo ou un commentaire restait invisible sur l'écran du comptoir jusqu'à ce
 * que quelqu'un appuie sur F5.
 *
 * ─── Pourquoi PAS un sondage classique ──────────────────────────────────────
 * La solution évidente — rebrancher la politique `lib/live-sync` sur le poste —
 * a été mesurée puis écartée. La limite de débit `api` vaut 120 req/min et elle
 * est indexée sur l'ADRESSE IP : dans un garage, tous les appareils sortent
 * derrière la même. Relevé :
 *
 *     PWA mécanicien au premier plan ............... 42 req/min
 *     poste avec un sondage à 3 s (jobs + mécaniciens) ~40 req/min
 *
 * Un poste et deux mécaniciens auraient dépassé le quota — le remède aurait
 * fabriqué les 429 que GF-DUR-035 venait d'éliminer.
 *
 * Changer l'indexation du quota a été envisagé et écarté aussi : la limite
 * s'applique AVANT `requireSession()`, précisément pour protéger le chemin
 * d'authentification. L'indexer sur le garage exigerait d'authentifier d'abord,
 * c'est-à-dire de ne plus protéger ce qu'elle protège.
 *
 * ─── Ce que fait cette route ────────────────────────────────────────────────
 * Elle ne renvoie AUCUNE donnée métier : deux agrégats (combien d'interventions,
 * quelle est la plus récemment modifiée) réduits à une courte empreinte. Le
 * poste l'interroge toutes les 10 s — 6 req/min — et ne recharge le planning
 * QUE lorsque l'empreinte change.
 *
 * Coût en régime stable : 6 req/min au lieu de ~40. Un poste et deux mécaniciens
 * tiennent à ~90 req/min, sous le quota, avec de la marge.
 *
 * Latence : jusqu'à 10 s pour voir l'action d'un mécanicien. C'est assumé — le
 * garage ne guette pas un clic de mécanicien comme un mécanicien attend son
 * affectation. Aucune de ces valeurs ne s'appelle « temps réel ».
 */

import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'

export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const garageId = session.user.garageId

  const url = new URL(req.url)
  const dateBrute = url.searchParams.get('date')
  const date = dateBrute && /^\d{4}-\d{2}-\d{2}$/.test(dateBrute) ? dateBrute : undefined

  // Portée STRICTEMENT bornée au garage de la session — comme partout ailleurs,
  // le paramètre client ne peut que restreindre, jamais élargir.
  const ouJobs = { garageId, ...(date ? { date } : {}) }

  // Deux agrégats seulement. `_max.updatedAt` bouge à toute modification, et le
  // compte capte créations et suppressions : ensemble ils détectent tout ce que
  // le planning affiche, sans lire une seule ligne.
  const [jobs, mecas] = await Promise.all([
    prisma.job.aggregate({ where: ouJobs, _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.mechanic.aggregate({ where: { garageId }, _count: { _all: true }, _max: { updatedAt: true } }),
  ])

  const brut = [
    jobs._count._all,
    jobs._max.updatedAt?.toISOString() ?? '-',
    mecas._count._all,
    mecas._max.updatedAt?.toISOString() ?? '-',
  ].join('|')

  // Empreinte courte : ni horodatage ni volumétrie ne transitent en clair. Sans
  // cela, la réponse renseignerait sur l'activité du garage à qui l'observe.
  const v = createHash('sha256').update(brut).digest('hex').slice(0, 16)

  return NextResponse.json({ v }, { headers: { 'Cache-Control': 'no-store' } })
})
