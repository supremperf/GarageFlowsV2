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
import { pollJobSync, etatSyncCloud } from '@/lib/sync/job-sync'

export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const garageId = session.user.garageId

  const url = new URL(req.url)
  const dateBrute = url.searchParams.get('date')
  const date = dateBrute && /^\d{4}-\d{2}-\d{2}$/.test(dateBrute) ? dateBrute : undefined

  // ── La boucle était fermée sur elle-même (GF-012) ───────────────────────────
  // L'empreinte ci-dessous est calculée sur la base LOCALE du poste. L'action du
  // mécanicien, elle, vit dans la base du CLOUD : elle ne peut donc pas la faire
  // bouger. Or la voie de retour cloud → poste n'était déclenchée que par
  // `pollJobSync`, appelée uniquement depuis `GET /api/jobs` — que le poste
  // n'appelle QUE lorsque cette empreinte a changé.
  //
  //   empreinte inchangée → pas de GET /api/jobs → pas de pollJobSync
  //   → pas de synchronisation → base locale inchangée → empreinte inchangée
  //
  // Dépendance circulaire : le mécanicien terminait son intervention et l'écran
  // du comptoir affichait « Prévu » indéfiniment, tant qu'un humain ne touchait
  // pas au poste. La route qui prétendait résoudre ce défaut (GF-DUR-041) en
  // était donc structurellement incapable.
  //
  // Le battement DÉCLENCHE désormais la voie de retour. `pollJobSync` est
  // lui-même limité à une remontée toutes les 10 s et ne bloque jamais : le coût
  // réseau ne change pas d'ordre de grandeur, et la réponse reste immédiate.
  // Latence résultante : une remontée (≤ 10 s) puis le battement suivant
  // (≤ 10 s) — soit ~10 à 20 s, contre « jamais » auparavant.
  pollJobSync(garageId)

  // Portée STRICTEMENT bornée au garage de la session — comme partout ailleurs,
  // le paramètre client ne peut que restreindre, jamais élargir.
  const ouJobs = { garageId, ...(date ? { date } : {}) }

  // Agrégats seulement. `_max.updatedAt` bouge à toute modification, et le
  // compte capte créations et suppressions : ensemble ils détectent tout ce que
  // le planning affiche, sans lire une seule ligne.
  //
  // Les COMMENTAIRES et les PHOTOS du mécanicien vivent dans leurs propres
  // tables : rapatriés par la voie de retour, ils ne touchent pas `Job.updatedAt`
  // et n'auraient donc rien déclenché. Ils entrent dans l'empreinte.
  const [jobs, mecas, notes, photos] = await Promise.all([
    prisma.job.aggregate({ where: ouJobs, _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.mechanic.aggregate({ where: { garageId }, _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.jobMechanicNote.aggregate({ where: { garageId }, _count: { _all: true }, _max: { createdAt: true } }),
    prisma.jobPhoto.aggregate({ where: { garageId }, _count: { _all: true }, _max: { createdAt: true } }),
  ])

  const brut = [
    jobs._count._all,
    jobs._max.updatedAt?.toISOString() ?? '-',
    mecas._count._all,
    mecas._max.updatedAt?.toISOString() ?? '-',
    notes._count._all,
    notes._max.createdAt?.toISOString() ?? '-',
    photos._count._all,
    photos._max.createdAt?.toISOString() ?? '-',
  ].join('|')

  // Empreinte courte : ni horodatage ni volumétrie ne transitent en clair. Sans
  // cela, la réponse renseignerait sur l'activité du garage à qui l'observe.
  const v = createHash('sha256').update(brut).digest('hex').slice(0, 16)

  // ── L'état de la remontée cloud est REMONTÉ à l'écran (GF-039) ─────────────
  // Une remontée non confirmée n'était que journalisée : le comptoir ne
  // distinguait pas « le mécanicien a reçu l'affectation » de « le cloud ne
  // répond plus depuis dix minutes ». Le rattrapage existe — la fenêtre entière
  // repart au passage suivant — mais tant qu'il n'a pas eu lieu, personne ne le
  // sait. Aucune donnée sensible : deux valeurs, `ok` ou `attente`.
  const cloud = etatSyncCloud(garageId)

  return NextResponse.json(
    cloud ? { v, cloud } : { v },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
