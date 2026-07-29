export const dynamic = 'force-dynamic'

/**
 * GET /api/internal/export
 * Export complet de toutes les données pour la sauvegarde bureau quotidienne.
 * Accessible uniquement depuis Electron via le header X-Internal-Key.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

function authorized(req: NextRequest): boolean {
  const key = req.headers.get('x-internal-key')
  return !!key && key === process.env.GF_INTERNAL_EXPORT_KEY
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  try {
    const [clients, vehicles, jobs, invoices, quotes, parts, mechanics, reminders] =
      await Promise.all([
        prisma.client.findMany({ orderBy: { name: 'asc' } }),
        prisma.vehicle.findMany({
          include: { client: { select: { name: true } } },
          orderBy: { updatedAt: 'desc' },
        }),
        prisma.job.findMany({
          include: {
            mechanic:  { select: { name: true } },
            jobParts:  { include: { part: { select: { name: true } } } },
          },
          orderBy: { date: 'desc' },
        }),
        prisma.invoice.findMany({
          include: { lines: true },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.quote.findMany({
          include: { lines: true },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.part.findMany({ orderBy: { name: 'asc' } }),
        prisma.mechanic.findMany({ orderBy: { order: 'asc' } }),
        prisma.reminder.findMany({ orderBy: { scheduledDate: 'asc' } }),
      ])

    return NextResponse.json({ clients, vehicles, jobs, invoices, quotes, parts, mechanics, reminders })
  } catch (err: any) {
    console.error('[internal/export] error:', err)
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }
}
