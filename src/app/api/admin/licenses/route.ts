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
import { verifyLicenseToken } from '@/lib/license/verify'
import { computeRecordMac } from '@/lib/license/record-mac'

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

  if (!body.token) {
    return NextResponse.json({ error: 'token manquant' }, { status: 400 })
  }

  // ── LE PAYLOAD SIGNÉ FAIT FOI (GF31-AUD-054) ──────────────────────────────
  //
  // Cette route insérait la ligne à partir du CORPS DE LA REQUÊTE, sans jamais
  // vérifier la signature du jeton et sans calculer de `recordMac`. Deux
  // conséquences : on pouvait enregistrer une licence dont le contenu ne
  // correspondait à aucun jeton valide (nombre de sièges, type, expiration
  // choisis librement), et l'enregistrement échappait DÉFINITIVEMENT au
  // contrôle d'intégrité de la base — `verifyRecordMac` ne peut rien vérifier
  // sur une ligne qui n'a jamais eu de MAC.
  //
  // La route sœur `/api/admin/licenses/create` faisait déjà les deux. On
  // s'aligne sur elle : le jeton est vérifié, et TOUS les champs de sécurité
  // sont dérivés du payload signé — jamais du corps.
  const result = verifyLicenseToken(body.token)
  if (!result.valid || !result.payload) {
    return NextResponse.json({ error: result.reason ?? 'Licence invalide' }, { status: 400 })
  }
  const p = result.payload

  try {
    const existing = await prisma.licenseKey.findUnique({ where: { licenseId: p.lid } })
    if (existing) {
      return NextResponse.json({ error: 'Cette licence est déjà enregistrée' }, { status: 409 })
    }

    const expiryAt = new Date(p.exp * 1000)
    const hwid = p.hwid ?? null
    const seats = typeof p.seats === 'number' && p.seats > 0 ? p.seats : 1
    const recordMac = computeRecordMac({
      licenseId: p.lid,
      token: body.token,
      status: 'active',
      expiryAt,
      hwid,
      parentLicenseId: null,
      mechanicId: null,
    })

    const record = await prisma.licenseKey.create({
      data: {
        licenseId:   p.lid,
        token:       body.token,
        customerId:  p.cid,
        licenseType: p.typ,
        expiryAt,
        // Seuls les champs DESCRIPTIFS viennent encore du corps : ils n'entrent
        // dans aucune décision de sécurité.
        label:       body.label  ?? null,
        notes:       body.notes  ?? null,
        isAdmin:     p.typ === 'admin',
        seats,
        hwid,
        status:      'active',
        recordMac,
      },
    })
    return NextResponse.json(record, { status: 201 })
  } catch (err: any) {
    return dbError(err)
  }
}
