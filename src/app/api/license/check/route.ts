export const dynamic = 'force-dynamic'

/**
 * POST /api/license/check
 * Periodic revocation check — called after initial activation to detect revocations.
 *
 * Body:    { licenseId: string }
 * Returns: { allowed: boolean; status?: string; reason?: string }
 *
 * Fail-open: if the DB is unavailable, we return allowed=true so Electron
 * can work fully offline without losing functionality.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyRecordMac } from '@/lib/license/record-mac'

export async function POST(req: NextRequest) {
  let licenseId: string
  try {
    const body = await req.json()
    licenseId  = String(body.licenseId ?? '').trim()
  } catch {
    return NextResponse.json({ allowed: false, reason: 'Requête invalide' }, { status: 400 })
  }

  if (!licenseId) {
    return NextResponse.json({ allowed: false, reason: 'licenseId manquant' }, { status: 400 })
  }

  try {
    const record = await prisma.licenseKey.findUnique({ where: { licenseId } })

    if (!record) {
      // Not in DB yet — allowed (will be registered on next full activation)
      return NextResponse.json({ allowed: true, status: 'unknown' })
    }

    // DB integrity check — detect SQLite tampering
    const mac = verifyRecordMac(record)
    if (mac.tampered) {
      console.error('[license/check] DB integrity FAILED for lid:', record.licenseId)
      return NextResponse.json({
        allowed: false,
        status:  'tampered',
        reason:  'Intégrité de la base de données compromise.',
      })
    }
    if (mac.missing) {
      console.warn('[license/check] No MAC for lid:', record.licenseId, '(legacy record)')
    }

    if (record.status === 'revoked') {
      return NextResponse.json({
        allowed: false,
        status:  'revoked',
        reason:  'Cette licence a été révoquée.',
      })
    }
    if (record.status === 'suspended') {
      return NextResponse.json({
        allowed: false,
        status:  'suspended',
        reason:  'Cette licence est temporairement suspendue.',
      })
    }

    // Still active — bump lastSeenAt
    await prisma.licenseKey.update({
      where: { id: record.id },
      data:  { lastSeenAt: new Date() },
    })

    return NextResponse.json({ allowed: true, status: 'active' })
  } catch (err) {
    console.error('[license/check] DB error (fail-open):', err)
    return NextResponse.json({ allowed: true, status: 'unknown' })
  }
}
