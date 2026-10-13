export const dynamic = 'force-dynamic'

/**
 * POST /api/appointments/[id] — staff action on an appointment (garage-scoped).
 * Body: { action: 'confirm' | 'cancel' | 'complete' }
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { pushAppointmentDecision } from '@/lib/sync/appointment-sync'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { nextAppointmentStatus, type AppointmentStatus, type AppointmentAction } from '@/lib/portal/appointments'

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
