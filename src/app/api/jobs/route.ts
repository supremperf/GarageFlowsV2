export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { CreateJobSchema } from '@/lib/schemas'
import { logAudit } from '@/lib/audit'
import { scheduleJobSync, pollJobSync } from '@/lib/sync/job-sync'
import { rattacherClientEtVehicule } from '@/lib/clients/rattachement'
import { logger } from '@/lib/logger'

/** Plafond dur d'une page. Une journée d'atelier reste très en deçà. */
const LIMITE_MAX = 500
/** Défaut d'une liste PAGINÉE (sans date) — inchangé. */
const LIMITE_DEFAUT = 20
/**
 * Défaut d'une JOURNÉE. Une requête `?date=` n'est pas une liste que l'on
 * feuillette : c'est le contenu d'un écran, et le planning comme le tableau de
 * réception affichent tout ce qu'ils reçoivent.
 *
 * Ils appelaient `/api/jobs?date=…` sans `limit` et recevaient donc 20
 * interventions au plus, triées par heure croissante : au-delà, les rendez-vous
 * de fin de journée n'existaient POUR AUCUN écran du poste — sans message, sans
 * indication de troncature. Le mécanicien concerné, lui, les voyait dans sa PWA
 * (limite 200) : deux surfaces du même produit ne montraient pas la même
 * journée. L'empreinte `/api/jobs/pulse`, elle, compte TOUTES les interventions
 * — l'écran se rechargeait donc, et retronquait.
 */
const LIMITE_JOURNEE = 500

// GET /api/jobs?date=YYYY-MM-DD&page=1&limit=20
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')

  const page  = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limiteDemandee = searchParams.get('limit')
  const limit = Math.min(
    LIMITE_MAX,
    Math.max(1, parseInt(limiteDemandee ?? String(date ? LIMITE_JOURNEE : LIMITE_DEFAUT))),
  )
  const skip  = (page - 1) * limit

  const where: Record<string, unknown> = { garageId: session.user.garageId }
  if (date) where.date = date

  const [jobs, total] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      skip,
      take: limit,
    }),
    prisma.job.count({ where }),
  ])

  // Rattrapage opportuniste (fortement limité en cadence) : c'est ce qui fait
  // redescendre sur le poste le chrono, les commentaires et les photos du
  // mécanicien même quand le garage ne modifie rien. Non bloquant.
  pollJobSync(session.user.garageId)

  return NextResponse.json({ data: jobs, total, page, totalPages: Math.ceil(total / limit), limit })
})

// POST /api/jobs
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const body = await req.json()

  const parsed = CreateJobSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }

  const {
    customerName,
    vehicleModel,
    licensePlate,
    repairType,
    estimatedDuration,
    startTime,
    date,
    mechanicId,
    vehicleId,
    status = 'scheduled',
    notes,
    isUrgent = false,
  } = parsed.data

  if (!customerName || !vehicleModel || !repairType || !estimatedDuration || !startTime || !date || !mechanicId) {
    return NextResponse.json({ error: 'Champs obligatoires manquants' }, { status: 400 })
  }

  // Verify mechanic belongs to this garage
  const mechanic = await prisma.mechanic.findFirst({
    where: { id: mechanicId, garageId: session.user.garageId },
  })
  if (!mechanic) {
    return NextResponse.json({ error: 'Mécanicien introuvable' }, { status: 404 })
  }

  // Le schéma accepte vehicleId mais l'ancien handler ne le persistait jamais :
  // le rattachement intervention↔véhicule (historique du véhicule) était perdu
  // en silence. Persisté désormais, après contrôle d'appartenance au garage.
  if (vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: vehicleId, garageId: session.user.garageId },
    })
    if (!vehicle) {
      return NextResponse.json({ error: 'Véhicule introuvable' }, { status: 404 })
    }
  }

  // ── Le client et le véhicule deviennent RÉELS (GF-015) ─────────────────────
  // Sans cela, planifier deux cents interventions laissait l'annuaire Clients
  // vide et la table Vehicle avec zéro ligne : la fiche véhicule ne trouvait
  // rien, les alertes de contrôle technique ne remontaient jamais, aucun accès
  // portail ne pouvait être ouvert et toutes les factures partaient sans client.
  // C'est ici que ça se joue — l'unique point par lequel passent TOUTES les
  // créations d'intervention. Best-effort : le rattachement ne doit pas faire
  // échouer la planification du garage.
  let rattachement: { clientId: string | null; vehicleId: string | null } = { clientId: null, vehicleId: null }
  if (!vehicleId) {
    try {
      rattachement = await rattacherClientEtVehicule(prisma, session.user.garageId, {
        customerName, vehicleModel, licensePlate,
      })
    } catch (err) {
      logger.warn('[jobs] rattachement client/véhicule impossible', {
        motif: err instanceof Error ? err.message : 'inconnu',
      })
    }
  }

  const job = await prisma.job.create({
    data: {
      customerName,
      vehicleModel,
      licensePlate: licensePlate || null,
      repairType,
      estimatedDuration: Number(estimatedDuration),
      startTime,
      date,
      status,
      notes: notes || null,
      isUrgent: Boolean(isUrgent),
      mechanicId,
      vehicleId: vehicleId || rattachement.vehicleId || null,
      garageId: session.user.garageId,
    },
  })

  await logAudit({ action: 'create', entityType: 'Job', entityId: job.id, session, req })

  // Miroir vers le cloud : sans cette remontée, la PWA du mécanicien affecté ne
  // verrait JAMAIS la tâche (bases distinctes, cf. lib/sync/job-sync).
  // Déclenchement non bloquant — la réponse ne dépend pas du réseau.
  scheduleJobSync(session.user.garageId)

  return NextResponse.json(job, { status: 201 })
})
