export const dynamic = 'force-dynamic'

/**
 * GET /api/appointments — liste des rendez-vous du garage, filtrable.
 *
 * ─── Ce que fait cette route, et ce qu'elle ne fait pas ──────────────────────
 *
 * Elle lit la table `Appointment` du garage. Aucune copie, aucune seconde
 * source : le tableau de bord et le tiroir « Rendez-vous » affichent les mêmes
 * lignes, et un rendez-vous confirmé au comptoir est visible dans les deux.
 *
 * ─── Filtres ajoutés pour la vue GLOBALE du tableau de bord (GF-DUR-054) ─────
 *
 * Le panneau d'origine ne savait demander qu'un statut et UNE date. Le tableau
 * de bord doit répondre à « tous les rendez-vous, toutes dates confondues »,
 * puis à « ceux de ce client », « ceux de ce véhicule », « ceux de cette
 * période ». Les filtres sont donc appliqués PAR LE SERVEUR : filtrer les 200
 * lignes déjà chargées donnerait une liste fausse dès que le garage dépasse la
 * limite, en laissant croire qu'il ne reste rien.
 *
 *   ?status=  (une valeur, ou plusieurs séparées par des virgules)
 *   ?date=    (jour exact, YYYY-MM-DD) — historique conservé
 *   ?from= & ?to=  (période inclusive, YYYY-MM-DD)
 *   ?clientId= & ?vehicleId=  (fiches liées)
 *   ?plate=   (contient, sur la plaque)
 *   ?q=       (contient, sur le nom du client, le véhicule, la plaque ou le motif)
 *   ?order=desc  (défaut : asc — chronologique)
 *   ?limit= & ?offset=  (défaut 200, maximum 500)
 *
 * La réponse gagne `total`, `limit` et `offset`; les rendez-vous gagnent
 * `clientFiche` et `vehiculeFiche`. Rien n'est retiré : les appelants existants
 * (`AppointmentsPanel`) continuent de lire les mêmes champs.
 *
 * ─── Pourquoi les fiches sont résolues ici, et non par une relation Prisma ───
 *
 * `Appointment.clientId` / `vehicleId` sont des colonnes, sans relation
 * déclarée : les rendez-vous rapatriés du cloud les laissent volontairement
 * nulles (le service en ligne ne publie pas les fiches). Ajouter la relation
 * ferait exiger à Prisma une contrainte de clé étrangère — sur les bases
 * existantes, cela peut échouer sur des identifiants devenus orphelins. On
 * résout donc les fiches par une lecture complémentaire, bornée aux
 * identifiants réellement présents, et on retombe sur les champs dénormalisés
 * (nom, modèle, plaque) quand il n'y a pas de fiche.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'

/** Jour au format `YYYY-MM-DD` — le format stocké dans `Appointment.date`. */
const JOUR = /^\d{4}-\d{2}-\d{2}$/

const LIMITE_DEFAUT = 200
const LIMITE_MAX    = 500

export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)

  const lireJour = (cle: string): string | undefined => {
    const v = searchParams.get(cle)?.trim()
    return v && JOUR.test(v) ? v : undefined
  }

  const statuts = (searchParams.get('status') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const date     = lireJour('date')
  const from     = lireJour('from')
  const to       = lireJour('to')
  const clientId = searchParams.get('clientId')?.trim() || undefined
  const vehicleId = searchParams.get('vehicleId')?.trim() || undefined
  const plate    = searchParams.get('plate')?.trim() || undefined
  const q        = searchParams.get('q')?.trim() || undefined
  const desc     = searchParams.get('order') === 'desc'

  const limit  = Math.min(LIMITE_MAX, Math.max(1, Number.parseInt(searchParams.get('limit') ?? '', 10) || LIMITE_DEFAUT))
  const offset = Math.max(0, Number.parseInt(searchParams.get('offset') ?? '', 10) || 0)

  // Un jour exact l'emporte sur la période : c'est la demande la plus précise.
  const bornesDate = date
    ? { date }
    : {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      }

  const where = {
    garageId: session.user.garageId,
    ...(statuts.length ? { status: statuts.length === 1 ? statuts[0] : { in: statuts } } : {}),
    ...(date || from || to ? { date: bornesDate } : {}),
    ...(clientId ? { clientId } : {}),
    ...(vehicleId ? { vehicleId } : {}),
    ...(plate ? { licensePlate: { contains: plate } } : {}),
    ...(q
      ? {
          OR: [
            { clientName:   { contains: q } },
            { licensePlate: { contains: q } },
            { vehicleModel: { contains: q } },
            { reason:       { contains: q } },
          ],
        }
      : {}),
  }

  const [appointments, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      orderBy: [{ date: desc ? 'desc' : 'asc' }, { startTime: desc ? 'desc' : 'asc' }],
      skip: offset,
      take: limit,
    }),
    prisma.appointment.count({ where }),
  ])

  // ── Fiches liées : une seule requête par table, bornée aux identifiants vus ─
  interface LienRdv { clientId: string | null; vehicleId: string | null }
  const liens = appointments as unknown as LienRdv[]
  const idsClients  = Array.from(new Set(liens.map((a) => a.clientId).filter((v): v is string => !!v)))
  const idsVehicules = Array.from(new Set(liens.map((a) => a.vehicleId).filter((v): v is string => !!v)))

  const [clients, vehicules] = await Promise.all([
    idsClients.length
      ? prisma.client.findMany({
          where: { id: { in: idsClients }, garageId: session.user.garageId },
          select: { id: true, name: true, phone: true, email: true },
        })
      : Promise.resolve([]),
    idsVehicules.length
      ? prisma.vehicle.findMany({
          where: { id: { in: idsVehicules }, garageId: session.user.garageId },
          select: { id: true, make: true, model: true, licensePlate: true, year: true },
        })
      : Promise.resolve([]),
  ])

  const parClient   = new Map((clients as Array<{ id: string }>).map((c) => [c.id, c]))
  const parVehicule = new Map((vehicules as Array<{ id: string }>).map((v) => [v.id, v]))

  return NextResponse.json({
    appointments: (appointments as Array<Record<string, unknown> & LienRdv>).map((a) => ({
      ...a,
      clientFiche:   a.clientId  ? parClient.get(a.clientId)     ?? null : null,
      vehiculeFiche: a.vehicleId ? parVehicule.get(a.vehicleId) ?? null : null,
    })),
    total,
    limit,
    offset,
  })
})
