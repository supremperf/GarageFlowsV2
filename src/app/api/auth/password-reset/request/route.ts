export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/password-reset/request  (public)
 * Body: { email }
 * Émet un jeton de réinitialisation (haché en base) et, si le garage a un SMTP
 * configuré, envoie le lien par e-mail. Réponse TOUJOURS générique (200) pour ne
 * jamais révéler l'existence d'un compte. Le jeton en clair n'est jamais renvoyé.
 */
import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { BRAND } from '@/config/brand'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { clientIp } from '@/lib/portal/auth-helpers'
import { issuePasswordReset } from '@/lib/users/service'
import { decryptSmtpPass } from '@/lib/email/smtp-crypto'
import { appBaseUrl } from '@/lib/app-url'
import { logger } from '@/lib/logger'

const GENERIC = { ok: true, message: 'Si un compte existe pour cette adresse, un e-mail de réinitialisation a été envoyé.' }
const Body = z.object({ email: z.string().email().max(200) })

export async function POST(req: NextRequest) {
  const ip = clientIp(req) ?? 'local'
  const rl = await enforceRateLimit('login', `pwreset-req:${ip}`, { max: 5, windowSec: 15 * 60 })
  if (!rl.ok) {
    return NextResponse.json({ error: `Trop de tentatives. Réessayez dans ${rl.retryAfterSec}s.` }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json(GENERIC) // ne pas révéler l'échec de validation

  const issued = await issuePasswordReset(parsed.data.email)
  if (issued) {
    // Livraison best-effort via le SMTP du garage. En cas d'absence de SMTP, le
    // jeton existe mais ne peut être remis (limite documentée).
    await deliverResetEmail(issued).catch(err => logger.error('[pwreset] envoi e-mail échoué', {}, err))
  }
  return NextResponse.json(GENERIC)
}

async function deliverResetEmail(issued: { garageId: string; email: string; name: string; token: string }) {
  const garage = await prisma.garage.findUnique({
    where: { id: issued.garageId },
    select: { name: true, smtpHost: true, smtpPort: true, smtpUser: true, smtpPass: true, smtpFrom: true, smtpSecure: true, email: true },
  })
  const pass = decryptSmtpPass(garage?.smtpPass)
  if (!garage?.smtpHost || !garage.smtpUser || !pass) return // pas de SMTP → non délivrable

  const link = `${appBaseUrl()}/reset-password?token=${encodeURIComponent(issued.token)}`
  const transporter = nodemailer.createTransport({
    host: garage.smtpHost, port: garage.smtpPort ?? 587, secure: garage.smtpSecure ?? true,
    auth: { user: garage.smtpUser, pass },
  })
  await transporter.sendMail({
    from: `${garage.name ?? BRAND.productName} <${garage.smtpFrom ?? garage.smtpUser}>`,
    to: issued.email,
    subject: `${BRAND.productName} — Réinitialisation de votre mot de passe`,
    text: `Bonjour ${issued.name},\n\nUne réinitialisation de mot de passe a été demandée. Ce lien est valable 1 heure et à usage unique :\n\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.`,
  })
}
