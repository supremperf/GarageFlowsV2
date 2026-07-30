export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/licenses/generate
 *
 * Server-side license generation — signs a new token with the private key.
 * The private key is loaded from:
 *  1. GF_PRIVATE_KEY env var (base64-encoded PEM, for production/Docker)
 *  2. keys/private.pem file (for local development)
 *
 * Requires admin cookie.
 *
 * Body: { customerId, licenseType, years?, seats?, hwid?, label?, notes? }
 * Returns: { token, lid, customerId, licenseType, expiryAt, seats }
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { isAdminSession } from '@/lib/api-helpers'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { computeRecordMac } from '@/lib/license/record-mac'

// ── Base64url helpers ─────────────────────────────────────────────────────────
function b64uEnc(buf: Buffer): string {
  return buf.toString('base64url')
}

// ── Load private key (PEM) from env or file ───────────────────────────────────
function loadPrivateKeyPem(): string | null {
  // Env var takes priority (production deployments / Docker)
  if (process.env.GF_PRIVATE_KEY) {
    try {
      return Buffer.from(process.env.GF_PRIVATE_KEY, 'base64').toString('utf8')
    } catch {
      return null
    }
  }
  // Fallback: file (local dev)
  const keyPath = path.join(process.cwd(), 'keys', 'private.pem')
  if (fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath, 'utf8')
  }
  return null
}

// ── License token builder ──────────────────────────────────────────────────────
function buildToken(
  privKeyPem:  string,
  customerId:  string,
  licenseType: string,
  years:       number,
  seats:       number,
  hwid:        string | null,
  label:       string | null,
): { token: string; lid: string; expiryAt: Date } {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + years * 365 * 24 * 3600
  const lid = crypto.randomUUID()

  // Watermark
  const wm = b64uEnc(
    Buffer.from(JSON.stringify({ c: customerId, t: now, r: crypto.randomBytes(6).toString('hex'), l: label ?? '' }))
  )

  const payload: Record<string, unknown> = {
    lid, cid: customerId, typ: licenseType,
    iss: now, exp, seats,
    wm, ver: '2.0',
  }
  if (hwid) payload.hwid = hwid

  const header     = { alg: 'ES256', typ: 'GF-LIC', v: 2 }
  const headerB64  = b64uEnc(Buffer.from(JSON.stringify(header)))
  const payloadB64 = b64uEnc(Buffer.from(JSON.stringify(payload)))
  const sigInput   = `${headerB64}.${payloadB64}`

  const signer = crypto.createSign('SHA256')
  signer.update(sigInput)
  const sig     = signer.sign({ key: privKeyPem, format: 'pem' })
  const sigB64  = b64uEnc(sig)

  return {
    token:    `GF2.${headerB64}.${payloadB64}.${sigB64}`,
    lid,
    expiryAt: new Date(exp * 1000),
  }
}

// ── Admin guard ────────────────────────────────────────────────────────────────

const VALID_TYPES = new Set(['trial', 'premium', 'enterprise', 'admin'])

export async function POST(req: NextRequest) {
  if (!await isAdminSession()) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const privKeyPem = loadPrivateKeyPem()
  if (!privKeyPem) {
    return NextResponse.json(
      { error: 'Clé privée introuvable — lancez d\'abord: python scripts/keygen_gui.py (onglet Clés) puis copiez la clé publique dans verify.ts et main.js' },
      { status: 500 },
    )
  }

  let body: {
    customerId:  string
    licenseType: string
    years?:      number
    seats?:      number
    hwid?:       string | null
    label?:      string | null
    notes?:      string | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corps invalide' }, { status: 400 })
  }

  const { customerId, licenseType } = body
  if (!customerId || !licenseType) {
    return NextResponse.json({ error: 'customerId et licenseType sont requis' }, { status: 400 })
  }
  if (!VALID_TYPES.has(licenseType)) {
    return NextResponse.json({ error: `Type invalide: ${licenseType}` }, { status: 400 })
  }

  const years = Math.max(1, Math.min(10, body.years ?? 1))
  const seats = Math.max(1, body.seats ?? 1)
  const hwid  = body.hwid  ?? null
  const label = body.label ?? null

  let built: ReturnType<typeof buildToken>
  try {
    built = buildToken(privKeyPem, customerId, licenseType, years, seats, hwid, label)
  } catch (err: any) {
    logger.error('[admin/generate] signing error', err)
    const hint = err?.message?.includes('asn1')
      ? 'Format de clé invalide (attendu: PKCS8 PEM ECC P-256)'
      : 'Vérifiez que keys/private.pem est une clé ECC P-256 valide'
    return NextResponse.json({ error: `Erreur de signature — ${hint}` }, { status: 500 })
  }

  // Save to DB
  try {
    const recordMac = computeRecordMac({
      licenseId: built.lid,
      token:     built.token,
      status:    'active',
      expiryAt:  built.expiryAt,
      hwid,
    })
    const record = await prisma.licenseKey.create({
      data: {
        licenseId:   built.lid,
        token:       built.token,
        customerId,
        licenseType,
        expiryAt:    built.expiryAt,
        status:      'active',
        isAdmin:     licenseType === 'admin',
        seats,
        hwid,
        label,
        notes:       body.notes ?? null,
        recordMac,
      },
    })
    return NextResponse.json(record, { status: 201 })
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'Licence déjà enregistrée (LID en double)' }, { status: 409 })
    }
    logger.error('[admin/generate] DB error', err)
    return NextResponse.json({ error: 'Erreur base de données' }, { status: 500 })
  }
}
