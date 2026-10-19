export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'
import { normalizeSpecialty } from '@/lib/specialty'
import { deletePhoto } from '@/lib/photo-store'

// PATCH /api/mechanics/:id  (absence, informations, archivage/réactivation)
export const PATCH = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()

  const existing = await prisma.mechanic.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!existing) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  const body = await req.json()
  const allowed = ['name', 'color', 'isAbsent', 'specialty', 'order']
  const data: Record<string, unknown> = {}
  for (const f of allowed) {
    if (f in body) {
      data[f] = f === 'specialty' ? normalizeSpecialty(body[f]) : body[f]
    }
  }

  // ── Archivage / réactivation ───────────────────────────────────────────────
  // Exposé comme un booléen `archived` et non comme une date brute : la date est
  // décidée par le serveur, et un client ne doit pas pouvoir antidater une
  // sortie d'effectif.
  let transition: 'archive' | 'restore' | null = null
  if ('archived' in body) {
    if (typeof body.archived !== 'boolean') {
      return NextResponse.json({ error: '`archived` doit être un booléen.', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!['OWNER', 'MANAGER'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
    const dejaArchive = existing.archivedAt !== null
    if (body.archived !== dejaArchive) {
      transition = body.archived ? 'archive' : 'restore'
      data.archivedAt = body.archived ? new Date() : null
      // Un mécanicien archivé n'est pas « absent aujourd'hui » : il a quitté
      // l'effectif. Laisser `isAbsent` à true le ferait revenir barré et marqué
      // ABSENT le jour de sa réactivation.
      if (!body.archived) data.isAbsent = false
    }
  }

  const updated = await prisma.mechanic.update({
    where: { id: params.id, garageId: session.user.garageId },
    data,
  })

  await logAudit({
    action: 'update', entityType: 'Mechanic', entityId: updated.id, session, req,
    ...(transition ? { details: { extra: { transition } } } : {}),
  })

  return NextResponse.json(updated)
})

/**
 * DELETE /api/mechanics/:id — retrait du registre.
 *
 * ─── Le défaut corrigé (GF-PLAN-006) ────────────────────────────────────────
 * `Job.mechanicId` est NOT NULL et sa relation ne déclare aucun `onDelete` :
 * Prisma applique donc `Restrict`. `prisma.mechanic.delete()` échouait par
 * violation de clé étrangère dès que le mécanicien avait la MOINDRE
 * intervention — y compris terminée il y a deux ans. Aucun `try/catch` ne
 * couvrait l'appel : l'utilisateur recevait une erreur brute, sans explication
 * ni solution de rechange.
 *
 * Pire, l'ancienne route ANNULAIT d'abord les interventions planifiées
 * (`status: 'cancelled'`) avant de tenter la suppression. Sur un mécanicien
 * doté d'un historique, l'annulation était donc appliquée… puis la suppression
 * échouait. Le garage se retrouvait avec des interventions annulées, un
 * mécanicien toujours présent, et rien pour le lui dire.
 *
 * ─── La règle retenue ───────────────────────────────────────────────────────
 * Un mécanicien qui a une histoire s'ARCHIVE, il ne se supprime pas : ses
 * interventions, notes, photos, temps et audits doivent rester lisibles — le
 * suivi comptable et les rapports en dépendent. La suppression définitive reste
 * possible pour le seul cas où elle a du sens : une fiche créée par erreur, qui
 * n'a jamais servi.
 */
export const DELETE = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()

  if (!['OWNER', 'MANAGER'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const existing = await prisma.mechanic.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!existing) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  // Y a-t-il une histoire à préserver ? On interroge TOUT ce qui référence le
  // mécanicien, pas seulement les interventions : une clé attribuée ou une note
  // signée sont, elles aussi, des traces qu'une suppression ferait disparaître
  // ou détacherait silencieusement (`onDelete: SetNull`).
  const [interventions, notes, licences, audits] = await Promise.all([
    prisma.job.count({ where: { mechanicId: existing.id } }),
    prisma.jobMechanicNote.count({ where: { mechanicId: existing.id } }),
    prisma.licenseKey.count({ where: { mechanicId: existing.id } }),
    prisma.mechanicActionAudit.count({ where: { targetMechanicId: existing.id } }),
  ])
  const historique = interventions + notes + licences + audits

  if (historique > 0) {
    return NextResponse.json(
      {
        error: existing.archivedAt
          ? 'Ce mécanicien est déjà archivé et conserve son historique ; il ne peut pas être supprimé.'
          : `Ce mécanicien a un historique (${interventions} intervention(s)). Archivez-le : il sortira du planning en conservant ses données.`,
        code: 'MECHANIC_HAS_HISTORY',
        counts: { interventions, notes, licences, audits },
      },
      { status: 409 },
    )
  }

  // Aucune histoire : suppression réelle, et retrait de la photo pour ne pas
  // laisser un fichier orphelin sur le disque.
  if (existing.avatarPath) deletePhoto(existing.avatarPath)
  await prisma.mechanic.delete({ where: { id: params.id, garageId: session.user.garageId } })

  await logAudit({ action: 'delete', entityType: 'Mechanic', entityId: params.id, session, req })

  return NextResponse.json({ success: true })
})
