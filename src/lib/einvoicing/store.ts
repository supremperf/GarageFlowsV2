/**
 * Persistance des transmissions de facturation électronique (Prisma).
 *
 * Enregistre chaque dépôt (EInvoiceSubmission) + son cycle de vie (EInvoiceEvent),
 * scopé par garage. Idempotent par (garageId, idempotencyKey). Ne stocke jamais de
 * secret ; `detail` d'événement doit être une réponse fournisseur filtrée.
 */
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import type { EInvoiceFormat, LifecycleStatus } from './types'

/** SHA-256 hex d'une chaîne (empreinte du XML transmis — preuve d'intégrité). */
export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex')
}

export interface PersistSubmissionInput {
  invoiceId: string
  garageId: string
  provider?: string
  externalSubmissionId?: string | null
  idempotencyKey: string
  format: EInvoiceFormat
  xml: string
  status: LifecycleStatus
  rejectionCode?: string | null
  rejectionMessage?: string | null
}

/**
 * Persiste une transmission (idempotent). Si une soumission existe déjà pour
 * (garageId, idempotencyKey), elle est renvoyée telle quelle (pas de doublon).
 * Crée un premier événement « submit ».
 */
export async function persistSubmission(input: PersistSubmissionInput) {
  const existing = await prisma.eInvoiceSubmission.findUnique({
    where: { garageId_idempotencyKey: { garageId: input.garageId, idempotencyKey: input.idempotencyKey } },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  })
  if (existing) return { submission: existing, created: false }

  const submission = await prisma.eInvoiceSubmission.create({
    data: {
      invoiceId: input.invoiceId,
      garageId: input.garageId,
      provider: input.provider ?? 'sandbox',
      externalSubmissionId: input.externalSubmissionId ?? null,
      idempotencyKey: input.idempotencyKey,
      documentFormat: input.format,
      documentHash: sha256Hex(input.xml),
      status: input.status,
      rejectionCode: input.rejectionCode ?? null,
      rejectionMessage: input.rejectionMessage ?? null,
      events: {
        create: [{ type: 'submit', status: input.status, detail: `format=${input.format}` }],
      },
    },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  })
  return { submission, created: true }
}

/** Ajoute un événement de cycle de vie et met à jour le statut de la soumission. */
export async function recordStatusEvent(
  garageId: string,
  submissionId: string,
  status: LifecycleStatus,
  opts: { type?: 'status' | 'webhook'; detail?: string; rejectionCode?: string; rejectionMessage?: string } = {},
) {
  // Scoping tenant strict : on ne met à jour que si la soumission appartient au garage.
  const found = await prisma.eInvoiceSubmission.findFirst({ where: { id: submissionId, garageId }, select: { id: true } })
  if (!found) return null
  const now = new Date()
  return prisma.eInvoiceSubmission.update({
    where: { id: submissionId },
    data: {
      status,
      ...(status === 'ACCEPTED' ? { acceptedAt: now } : {}),
      ...(status === 'REJECTED' || status === 'REFUSED' ? { rejectedAt: now, rejectionCode: opts.rejectionCode ?? null, rejectionMessage: opts.rejectionMessage ?? null } : {}),
      events: { create: [{ type: opts.type ?? 'status', status, detail: opts.detail ?? null }] },
    },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  })
}

/** Liste les transmissions d'une facture (scopé garage). */
export async function listSubmissionsByInvoice(garageId: string, invoiceId: string) {
  return prisma.eInvoiceSubmission.findMany({
    where: { garageId, invoiceId },
    orderBy: { createdAt: 'desc' },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  })
}

/** Récupère une transmission par id (scopé garage). */
export async function getSubmission(garageId: string, id: string) {
  return prisma.eInvoiceSubmission.findFirst({
    where: { id, garageId },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  })
}
