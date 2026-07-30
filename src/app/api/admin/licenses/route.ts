export const dynamic = 'force-dynamic'

/**
 * Admin License Management API
 * Requires cookie: gf_license_type=admin
 *
 * GET  /api/admin/licenses   — list all registered license keys
 * POST /api/admin/licenses   — manually import an existing token into the DB
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { isAdminSession } from '@/lib/api-helpers'

function dbError(err: any): NextResponse {
  logger.error('[admin/licenses] DB error', err)
  const msg = err?.code === 'P2021' || err?.code === 'P2022'
    ? 'Base de données non initialisée — lancez: npx prisma db push'
    : err?.message?.includes('no such table')
    ? 'Base de données non initialisée — relancez l\'application'
    : 'Erreur base de données — vérifiez que l\'application est bien démarrée'
  return NextResponse.json({ error: msg }, { status: 500 })
}

// ── GET — list all ─────────────────────────────────────────────────────────────
export async function GET() {
  if (!await isAdminSession()) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  try {
    const keys = await prisma.licenseKey.findMany({ orderBy: [{ createdAt: 'desc' }] })
    return NextResponse.json(keys)
  } catch (err: any) {
    return dbError(err)
  }
}

// ── POST — import an existing token ───────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!await isAdminSession()) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  let body: {
    licenseId:   string
    token:       string
    customerId:  string
    licenseType: string
    expiryAt:    string
    label?:      string
    notes?:      string
    isAdmin?:    boolean
    seats?:      number
    hwid?:       string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corps de la requête invalide' }, { status: 400 })
  }

  if (!body.licenseId || !body.token || !body.customerId || !body.licenseType || !body.expiryAt) {
    return NextResponse.json({ error: 'Champs obligatoires manquants' }, { status: 400 })
  }

  try {
    const existing = await prisma.licenseKey.findUnique({ where: { licenseId: body.licenseId } })
    if (existing) {
      return NextResponse.json({ error: 'Cette licence est déjà enregistrée' }, { status: 409 })
    }

    const record = await prisma.licenseKey.create({
      data: {
        licenseId:   body.licenseId,
        token:       body.token,
        customerId:  body.customerId,
        licenseType: body.licenseType,
        expiryAt:    new Date(body.expiryAt),
        label:       body.label  ?? null,
        notes:       body.notes  ?? null,
        isAdmin:     body.isAdmin ?? false,
        seats:       body.seats  ?? 1,
        hwid:        body.hwid   ?? null,
        status:      'active',
      },
    })
    return NextResponse.json(record, { status: 201 })
  } catch (err: any) {
    return dbError(err)
  }
}
