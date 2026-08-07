export const dynamic = 'force-dynamic'

/**
 * POST /api/portal/auth/register — create a client-portal account.
 * Body: { email, password, name?, garageSlug? }
 *
 * SÉCURITÉ (anti-prise de contrôle de compte) : le nouveau compte n'est JAMAIS
 * lié à un Client existant sur simple correspondance d'email. Sans preuve de
 * possession de l'email, un attaquant s'inscrivant avec l'email d'une victime
 * hériterait de son dossier Client (dashboard : véhicules, factures, devis,
 * garanties). Le rattachement au Client est donc DIFFÉRÉ jusqu'à la vérification
 * de l'email (verify-email), seul moment où la possession de l'adresse est prouvée.
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { resolveGarageId, clientIp } from '@/lib/portal/auth-helpers'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export async function POST(req: NextRequest) {
  const ip = clientIp(req) ?? 'local'
  const rl = await enforceRateLimit('login', `portal-register:${ip}`, { max: 5, windowSec: 15 * 60 })
  if (!rl.ok) {
    return NextResponse.json({ error: `Trop de tentatives. Réessayez dans ${rl.retryAfterSec}s.` }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })
  }

  let body: Record<string, unknown>
  try { body = (await req.json()) as Record<string, unknown> } catch { return NextResponse.json({ error: 'Corps invalide' }, { status: 400 }) }

  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  const name = body.name ? String(body.name).trim() : null

  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Email invalide' }, { status: 400 })
  if (password.length < 8) return NextResponse.json({ error: 'Mot de passe trop court (min 8 caractères)' }, { status: 400 })

  const garageId = await resolveGarageId(typeof body.garageSlug === 'string' ? body.garageSlug : null)
  if (!garageId) return NextResponse.json({ error: 'Garage introuvable ou ambigu (garageSlug requis)' }, { status: 400 })

  const existing = await prisma.portalUser.findUnique({ where: { garageId_email: { garageId, email } } })
  if (existing) return NextResponse.json({ error: 'Un compte existe déjà pour cet email' }, { status: 409 })

  const passwordHash = await bcrypt.hash(password, 10)
  const emailVerifyToken = crypto.randomBytes(32).toString('hex')

  // clientId reste NULL à l'inscription : aucun rattachement à un Client existant
  // tant que l'email n'est pas vérifié (cf. verify-email). Empêche la prise de
  // contrôle du dossier d'un client par simple ré-utilisation de son email.
  const user = await prisma.portalUser.create({
    data: { garageId, email, passwordHash, name, clientId: null, emailVerifyToken },
    select: { id: true, email: true, name: true, emailVerified: true, clientId: true },
  })

  // The verification token is stored (never returned) for later dispatch via the
  // garage's mail pipeline. The account is usable immediately; emailVerified is a flag.
  return NextResponse.json({ ok: true, user, requiresEmailVerification: true }, { status: 201 })
}
