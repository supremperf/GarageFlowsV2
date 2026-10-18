/**
 * Audit log helper — records every write operation to the AuditLog table.
 *
 * Usage in API routes:
 *   await logAudit({ action: 'create', entityType: 'Job', entityId: job.id, req, session })
 *
 * Fail-silent: a logging failure must never break the actual API response.
 */

import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { headers } from 'next/headers'
import type { Session } from 'next-auth'

export type AuditAction = 'create' | 'update' | 'delete' | 'login' | 'logout'
export type AuditEntityType =
  | 'Job' | 'Client' | 'Vehicle' | 'Invoice' | 'Quote'
  | 'User' | 'Mechanic' | 'Part' | 'Inspection' | 'Reminder' | 'Garage'
  | 'PurchaseOrder' | 'License'
  // Rendez-vous : modifier un créneau engage le garage vis-à-vis d'un client.
  // L'écriture doit laisser une trace, comme une facture émise.
  | 'Appointment'
  // Accès portail d'un client : ouverture, réinitialisation, désactivation.
  // Ce sont des décisions du garage sur qui peut voir les données d'un client —
  // elles doivent laisser une trace au même titre qu'une facture émise.
  | 'PortalUser'

interface LogAuditOptions {
  action:     AuditAction
  entityType: AuditEntityType
  entityId?:  string
  session:    Session
  req?:       Request
  details?:   Record<string, unknown>
}

async function getIp(req?: Request): Promise<string | undefined> {
  try {
    if (req) {
      const forwarded = req.headers.get('x-forwarded-for')
      if (forwarded) return forwarded.split(',')[0].trim()
      const real = req.headers.get('x-real-ip')
      if (real) return real
    }
    // Fallback: read from Next.js headers() in server context
    const h = await headers()
    return h.get('x-forwarded-for')?.split(',')[0].trim() ?? h.get('x-real-ip') ?? undefined
  } catch {
    return undefined
  }
}

export async function logAudit(opts: LogAuditOptions): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action:     opts.action,
        entityType: opts.entityType,
        entityId:   opts.entityId ?? null,
        userId:     opts.session.user.id,
        userName:   opts.session.user.name ?? opts.session.user.email ?? 'unknown',
        garageId:   opts.session.user.garageId,
        details:    opts.details ? JSON.stringify(opts.details) : null,
        ipAddress:  (await getIp(opts.req)) ?? null,
      },
    })
  } catch (err) {
    logger.warn('[audit] Failed to write audit log:', err)
  }
}
