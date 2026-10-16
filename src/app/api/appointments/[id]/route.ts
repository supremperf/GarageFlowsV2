export const dynamic = 'force-dynamic'

/**
 * POST /api/appointments/[id]   — décision du garage sur un rendez-vous.
 *   Body: { action: 'confirm' | 'cancel' | 'complete' }
 * PATCH /api/appointments/[id]  — MODIFIER le rendez-vous (GF-DUR-054).
 *   Body: champs de `UpdateAppointmentSchema` (date, heure, durée, motif, notes,
 *         nom du client, véhicule, rattachement aux fiches).
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { pushAppointmentDecision } from '@/lib/sync/appointment-sync'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { logAudit } from '@/lib/audit'
import { UpdateAppointmentSchema } from '@/lib/schemas'
import { nextAppointmentStatus, validateSlot, type AppointmentStatus, type AppointmentAction } from '@/lib/portal/appointments'

const ACTIONS: readonly AppointmentAction[] = ['confirm', 'cancel', 'complete']

export const POST = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  // CONSULTER le planning de l'atelier concerne tout le monde ; s'ENGAGER
  // auprès d'un client — confirmer un créneau, l'annuler — relève de la
  // gestion des interventions. La route ne contrôlait rien : un mécanicien
  // pouvait annuler le rendez-vous d'un client sans que personne au comptoir
  // ne l'apprenne.
  if (!can(session.user.role, 'job:manage')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const action = body.action as AppointmentAction
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: `action invalide (${ACTIONS.join(', ')})` }, { status: 400 })
  }

  const appointment = await prisma.appointment.findFirst({ where: { id: params.id, garageId: session.user.garageId } })
  if (!appointment) return NextResponse.json({ error: 'Rendez-vous introuvable' }, { status: 404 })

  const status = nextAppointmentStatus(appointment.status as AppointmentStatus, action)
  if (!status) return NextResponse.json({ error: `Transition « ${action} » impossible depuis « ${appointment.status} »` }, { status: 409 })

  // ── CONFIRMER, c'est s'engager : on regarde d'abord la charge (GF-040) ─────
  // Rendez-vous et interventions vivent dans deux tables indépendantes, sans
  // aucun lien : le portail proposait un créneau que rien ne vérifiait, et le
  // comptoir confirmait au client une journée déjà pleine. Personne ne s'en
  // apercevait avant le matin même.
  //
  // Le contrôle reste volontairement grossier — une confirmation ne CRÉE pas
  // l'intervention (`Job.mechanicId` est obligatoire : il faudrait choisir un
  // mécanicien, ce qui est un autre chantier). Il refuse simplement de promettre
  // une journée où il n'y a déjà plus un mécanicien de libre.
  if (status === 'confirmed') {
    const [actifs, occupes] = await Promise.all([
      prisma.mechanic.count({ where: { garageId: session.user.garageId, archivedAt: null, isAbsent: false } }),
      prisma.job.count({
        where: { garageId: session.user.garageId, date: appointment.date, status: { not: 'cancelled' } },
      }),
    ])
    // Un garage SANS mécanicien enregistré n'a pas de capacité modélisée : il
    // n'utilise pas le planning, et lui refuser toute confirmation casserait
    // une fonction qui marchait. On ne bloque que sur une saturation MESURÉE.
    if (actifs > 0 && occupes >= actifs) {
      return NextResponse.json(
        {
          error: `L'atelier est complet le ${appointment.date} `
               + `(${occupes} intervention(s) pour ${actifs} mécanicien(s) disponible(s)). `
               + 'Proposez une autre date au client.',
          code: 'WORKSHOP_FULL',
        },
        { status: 409 },
      )
    }
  }

  // Transition ATOMIQUE (anti-TOCTOU) : l'update n'aboutit que si le statut n'a
  // pas changé depuis la lecture. Deux actions concurrentes (ex. confirm/cancel)
  // ne peuvent donc pas s'écraser l'une l'autre — la seconde reçoit un 409.
  const moved = await prisma.appointment.updateMany({
    where: { id: appointment.id, garageId: session.user.garageId, status: appointment.status },
    data: { status },
  })
  if (moved.count === 0) {
    return NextResponse.json({ error: 'Le rendez-vous a été modifié entre-temps. Réessayez.' }, { status: 409 })
  }

  // La demande vient de l'espace client, servi par le service en ligne : sans
  // cette remontée, le garage confirmerait un rendez-vous que son client verrait
  // encore « en attente ». Un décalage où les deux parties croient savoir est
  // pire que l'absence de la fonctionnalité. L'ISSUE est rendue — l'écran ne
  // doit pas laisser croire que le client a été prévenu.
  const remontee = await pushAppointmentDecision(session.user.garageId, appointment.id, action)

  return NextResponse.json({ ok: true, status, clientPrevenu: remontee.remonte })
})

/**
 * PATCH — modifier un rendez-vous.
 *
 * ─── Ce que le garage peut changer, et ce qu'il ne peut pas ──────────────────
 *
 * Tous les champs descriptifs : date, heure, durée, motif, notes, nom du client,
 * véhicule — et le rattachement à une FICHE client/véhicule. Le STATUT reste
 * hors de portée : il n'évolue que par les transitions de `POST`, qui portent
 * seules les règles (créneau futur, atelier non saturé, remontée au client).
 *
 * ─── Un créneau reste un créneau ─────────────────────────────────────────────
 *
 * Déplacer un rendez-vous hors des horaires d'ouverture, ou vers une heure
 * passée, produirait un rendez-vous que le client ne pourrait pas honorer. Les
 * mêmes règles que la prise de rendez-vous de l'espace client sont donc
 * appliquées (`validateSlot`) dès que la date, l'heure ou la durée changent.
 *
 * ─── Vie privée de la fiche liée ─────────────────────────────────────────────
 *
 * Un `clientId`/`vehicleId` fourni doit appartenir AU GARAGE. Sans ce contrôle,
 * un identifiant deviné suffirait à faire pointer un rendez-vous vers la fiche
 * d'un autre garage — et le tableau de bord afficherait le nom de ce client.
 *
 * ─── Le client est-il prévenu ? ──────────────────────────────────────────────
 *
 * Le protocole de synchronisation vers l'espace client ne transporte que des
 * DÉCISIONS (`confirm`, `cancel`, `complete`) : il n'existe pas de message
 * « créneau déplacé ». La réponse le dit donc franchement (`clientPrevenu`),
 * et l'écran affiche un avertissement au comptoir. Annoncer une modification
 * comme notifiée alors qu'elle ne l'est pas serait pire que de ne pas la faire.
 */
export const PATCH = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  if (!can(session.user.role, 'job:manage')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const parsed = UpdateAppointmentSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const corps = parsed.data

  const existant = await prisma.appointment.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!existant) return NextResponse.json({ error: 'Rendez-vous introuvable' }, { status: 404 })

  // ── Rattachements : la fiche doit être CELLE DE CE GARAGE ──────────────────
  if (corps.clientId) {
    const fiche = await prisma.client.findFirst({
      where: { id: corps.clientId, garageId: session.user.garageId },
      select: { id: true },
    })
    if (!fiche) return NextResponse.json({ error: 'Client introuvable' }, { status: 400 })
  }
  if (corps.vehicleId) {
    const fiche = await prisma.vehicle.findFirst({
      where: { id: corps.vehicleId, garageId: session.user.garageId },
      select: { id: true },
    })
    if (!fiche) return NextResponse.json({ error: 'Véhicule introuvable' }, { status: 400 })
  }

  // ── Créneau : mêmes règles que la prise de rendez-vous ─────────────────────
  const date      = corps.date      ?? existant.date
  const startTime = corps.startTime ?? existant.startTime
  const durationMin = corps.durationMin ?? existant.durationMin
  const creneauTouche =
    corps.date !== undefined || corps.startTime !== undefined || corps.durationMin !== undefined

  if (creneauTouche) {
    const garage = await prisma.garage.findUnique({
      where: { id: session.user.garageId },
      select: { workshopStartHour: true, workshopEndHour: true },
    })
    const validation = validateSlot({
      date, startTime, durationMin,
      workshopStartHour: garage?.workshopStartHour ?? 8,
      workshopEndHour: garage?.workshopEndHour ?? 18,
      // Un rendez-vous DÉJÀ passé reste modifiable (notes, motif) : la règle
      // « dans le futur » ne s'applique qu'au créneau qu'on déplace réellement.
      ...(date === existant.date && startTime === existant.startTime
        ? { now: new Date(0) }
        : {}),
    })
    if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  const maj = await prisma.appointment.update({
    where: { id: existant.id },
    data: {
      ...(corps.clientName   !== undefined ? { clientName: corps.clientName } : {}),
      ...(corps.vehicleModel !== undefined ? { vehicleModel: corps.vehicleModel } : {}),
      ...(corps.licensePlate !== undefined ? { licensePlate: corps.licensePlate } : {}),
      ...(corps.reason       !== undefined ? { reason: corps.reason } : {}),
      ...(corps.date         !== undefined ? { date } : {}),
      ...(corps.startTime    !== undefined ? { startTime } : {}),
      ...(corps.durationMin  !== undefined ? { durationMin } : {}),
      ...(corps.notes        !== undefined ? { notes: corps.notes } : {}),
      ...(corps.clientId     !== undefined ? { clientId: corps.clientId } : {}),
      ...(corps.vehicleId    !== undefined ? { vehicleId: corps.vehicleId } : {}),
    },
  })

  await logAudit({ action: 'update', entityType: 'Appointment', entityId: maj.id, session, req })

  // Le rendez-vous vient de l'espace client : le créneau déplacé n'y sera PAS
  // répercuté automatiquement. On le dit, avec le motif, pour que le comptoir
  // prévienne le client autrement.
  const venuDuPortail = !!existant.portalUserId
  return NextResponse.json({
    ok: true,
    appointment: maj,
    clientPrevenu: !venuDuPortail,
    ...(venuDuPortail
      ? {
          avertissement: creneauTouche
            ? "Ce rendez-vous vient de l’espace client : son nouveau créneau n’y est pas répercuté automatiquement. Prévenez le client."
            : "Ce rendez-vous vient de l’espace client : cette modification ne lui est pas transmise automatiquement.",
        }
      : {}),
  })
})
