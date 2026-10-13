export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { UpdateJobSchema } from '@/lib/schemas'
import { logAudit } from '@/lib/audit'
import { scheduleJobSync } from '@/lib/sync/job-sync'
import { rattacherClientEtVehicule } from '@/lib/clients/rattachement'
import { logger } from '@/lib/logger'
import { MOVEMENT } from '@/lib/stock/invoice-stock'

// GET /api/jobs/:id
export const GET = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const job = await prisma.job.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
  })
  if (!job) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  return NextResponse.json(job)
})

// PUT /api/jobs/:id  (full update)
export const PUT = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const body = await req.json()

  const parsed = UpdateJobSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }

  // If mechanicId changes, verify the new mechanic belongs to the garage
  if (parsed.data.mechanicId) {
    const mech = await prisma.mechanic.findFirst({
      where: { id: parsed.data.mechanicId, garageId: session.user.garageId },
    })
    if (!mech) return NextResponse.json({ error: 'Mécanicien introuvable' }, { status: 404 })
  }

  const allowedFields = [
    'customerName', 'vehicleModel', 'licensePlate', 'repairType',
    'estimatedDuration', 'actualDuration', 'startTime', 'date',
    'status', 'notes', 'isUrgent', 'delayMinutes', 'mechanicId',
  ]
  const data: Record<string, unknown> = {}
  for (const field of allowedFields) {
    if (field in parsed.data) data[field] = (parsed.data as Record<string, unknown>)[field]
  }

  // ── Rattachement client/véhicule à la modification aussi (GF-015) ──────────
  // Une intervention créée sans plaque, complétée ensuite, doit elle aussi
  // matérialiser son client et son véhicule — sinon la moitié du parc échappe
  // au rattachement selon l'ordre dans lequel le garage a saisi les champs.
  // On ne touche à rien si l'intervention est DÉJÀ rattachée : le lien existant
  // fait foi.
  if ('licensePlate' in data || 'customerName' in data) {
    const actuel = await prisma.job.findFirst({
      where: { id: params.id, garageId: session.user.garageId },
      select: { vehicleId: true, customerName: true, vehicleModel: true, licensePlate: true },
    })
    if (actuel && !actuel.vehicleId) {
      try {
        const lien = await rattacherClientEtVehicule(prisma, session.user.garageId, {
          customerName: (data.customerName as string) ?? actuel.customerName,
          vehicleModel: (data.vehicleModel as string) ?? actuel.vehicleModel,
          licensePlate: (data.licensePlate as string) ?? actuel.licensePlate,
        })
        if (lien.vehicleId) data.vehicleId = lien.vehicleId
      } catch (err) {
        logger.warn('[jobs] rattachement client/véhicule impossible', {
          motif: err instanceof Error ? err.message : 'inconnu',
        })
      }
    }
  }

  // garageId in WHERE prevents cross-tenant writes
  const updated = await prisma.job.update({
    where: { id: params.id, garageId: session.user.garageId },
    data,
  })

  await logAudit({ action: 'update', entityType: 'Job', entityId: params.id, session, req })

  // Modification (horaire, statut, véhicule, AFFECTATION…) → miroir cloud, pour
  // que le mécanicien concerné la voie — et que l'ancien la perde.
  scheduleJobSync(session.user.garageId)

  return NextResponse.json(updated)
})

// PATCH /api/jobs/:id  (partial update — e.g. drag-and-drop move)
export const PATCH = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const body = await req.json()

  const parsed = UpdateJobSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }

  // Isolation multi-tenant : si mechanicId change, vérifier son appartenance au
  // garage (le PUT le fait déjà ; le PATCH l'omettait → assignation cross-garage
  // + lecture du mécanicien étranger via les include).
  if (parsed.data.mechanicId) {
    const mech = await prisma.mechanic.findFirst({
      where: { id: parsed.data.mechanicId, garageId: session.user.garageId },
    })
    if (!mech) return NextResponse.json({ error: 'Mécanicien introuvable' }, { status: 404 })
  }

  const safeFields = ['mechanicId', 'startTime', 'date', 'status', 'delayMinutes', 'actualDuration']
  const data: Record<string, unknown> = {}
  for (const f of safeFields) {
    if (f in parsed.data) data[f] = (parsed.data as Record<string, unknown>)[f]
  }

  const updated = await prisma.job.update({
    where: { id: params.id, garageId: session.user.garageId },
    data,
  })

  await logAudit({ action: 'update', entityType: 'Job', entityId: params.id, session, req })

  // Glisser-déposer, changement de statut, RÉAFFECTATION : même exigence.
  scheduleJobSync(session.user.garageId)

  return NextResponse.json(updated)
})

/** Intervention inexistante ou appartenant à un autre garage : 404, pas 500. */
class InterventionIntrouvable extends Error {}

// DELETE /api/jobs/:id
export const DELETE = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()

  // Suppression ET pierre tombale dans la MÊME transaction.
  //
  // Le cloud déduisait les suppressions de l'ABSENCE d'une intervention dans la
  // fenêtre remontée. Deux cas échappent à cette inférence : une suppression
  // faite hors ligne dont la date sort ensuite de la fenêtre, et une remontée
  // tronquée (où toute purge par inférence est suspendue, GF31-AUD-017). Dans
  // les deux cas l'intervention restait visible indéfiniment dans la PWA du
  // mécanicien, qui pouvait se déplacer sur une intervention annulée
  // (GF31-AUD-044). La trace explicite survit à la coupure réseau et à
  // l'extinction du poste : elle n'est effacée qu'une fois le cloud averti.
  try {
    await prisma.$transaction(async (tx) => {
      // ── Rendre les pièces AVANT la cascade, sinon elles disparaissent ──────
      // `JobPart` est en `onDelete: Cascade` sur `Job` : supprimer
      // l'intervention efface ses lignes de pièces sans repasser par la route
      // qui, elle, restitue le stock. Une intervention annulée emportait donc
      // définitivement les pièces réservées : l'inventaire les comptait
      // sorties, plus rien ne disait pour quoi, et le garage en recommandait.
      //
      // La restitution est ici l'exact miroir du DELETE de
      // `jobs/[id]/parts/route.ts` — même incrément, même mouvement journalisé.
      const lignes = await tx.jobPart.findMany({
        where:  { jobId: params.id, job: { garageId: session.user.garageId } },
        select: { partId: true, quantity: true },
      })
      for (const ligne of lignes) {
        const rendu = await tx.part.updateMany({
          where: { id: ligne.partId, garageId: session.user.garageId },
          data:  { quantity: { increment: ligne.quantity } },
        })
        // Pièce entre-temps supprimée du catalogue : rien à rendre, et la clé
        // étrangère refuserait le mouvement.
        if (rendu.count !== 1) continue
        await tx.stockMovement.create({
          data: {
            garageId: session.user.garageId,
            partId:   ligne.partId,
            type:     MOVEMENT.ADJUST,
            quantityDelta: ligne.quantity,
            reason:   `Intervention ${params.id} supprimée — pièces rendues au stock`,
          },
        })
      }

      // `delete` levait P2025 sur une intervention inconnue OU appartenant à un
      // autre garage : le client recevait un 500 « erreur interne » là où la
      // réponse honnête est « introuvable ». `deleteMany` rend le cas explicite.
      const supprimee = await tx.job.deleteMany({
        where: { id: params.id, garageId: session.user.garageId },
      })
      if (supprimee.count === 0) throw new InterventionIntrouvable()

      await tx.jobTombstone.upsert({
        where:  { jobId: params.id },
        create: { jobId: params.id, garageId: session.user.garageId },
        update: { deletedAt: new Date() },
      })
    })
  } catch (e) {
    if (e instanceof InterventionIntrouvable) {
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
    }
    throw e
  }

  await logAudit({ action: 'delete', entityType: 'Job', entityId: params.id, session, req })

  scheduleJobSync(session.user.garageId)

  return NextResponse.json({ success: true })
})
