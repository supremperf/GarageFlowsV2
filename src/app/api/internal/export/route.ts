export const dynamic = 'force-dynamic'

/**
 * GET /api/internal/export
 * Export complet de toutes les données pour la sauvegarde bureau quotidienne.
 * Accessible uniquement depuis Electron via le header X-Internal-Key.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { internalRequestAuthorized } from '@/lib/internal-auth'
import { computeTotals } from '@/lib/money'
import { linesToEuros, partToEuros, jobPartToEuros } from '@/lib/money-db'

export async function GET(req: NextRequest) {
  if (!internalRequestAuthorized(req)) {
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

    // Vue euros + TOTAUX calculés ICI par la couche financière exacte (centimes) :
    // l'export Electron ne fait plus AUCUN recalcul flottant — il formate.
    const withDocTotals = <T extends { taxRate: number; lines: Parameters<typeof linesToEuros>[0] }>(doc: T) => {
      const lines = linesToEuros(doc.lines)
      const t = computeTotals(lines, doc.taxRate)
      return { ...doc, lines, totalHT: t.totalHT, totalTTC: t.totalTTC }
    }
    return NextResponse.json({
      clients,
      vehicles,
      jobs: jobs.map(j => ({ ...j, jobParts: j.jobParts.map(jobPartToEuros) })),
      invoices: invoices.map(withDocTotals),
      quotes: quotes.map(withDocTotals),
      parts: parts.map(partToEuros),
      mechanics,
      reminders,
    })
  } catch (err) {
    // Ne jamais renvoyer le détail interne au client (fuite d'infos).
    console.error('[internal/export] error:', (err as { code?: string })?.code ?? 'unknown')
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }
}
