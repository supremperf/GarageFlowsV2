export const dynamic = 'force-dynamic'

/**
 * GET /api/internal/export
 * Export complet de toutes les données pour la sauvegarde bureau quotidienne.
 * Accessible uniquement depuis Electron via le header X-Internal-Key.
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'

/** Constant-time comparison — avoids leaking the key via response timing. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

function authorized(req: NextRequest): boolean {
  const expected = process.env.GF_INTERNAL_EXPORT_KEY
  if (!expected) return false // fail closed when unconfigured
  const key = req.headers.get('x-internal-key')
  return !!key && safeEqual(key, expected)
}

export async function GET(req: NextRequest) {
  // Throttle to blunt brute-forcing of the shared secret.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local'
  const rl = rateLimit(`internal-export:${ip}`, 30, 60)
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Trop de requêtes' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

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
    return NextResponse.json({ error: err.message ?? 'Erreur DB' }, { status: 500 })
  }
}
