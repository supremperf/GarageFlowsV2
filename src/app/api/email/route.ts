export const dynamic = 'force-dynamic'

/**
 * GET  /api/email  — returns current SMTP config (no password)
 * PATCH /api/email — update SMTP config
 * POST  /api/email/test (handled below) — send a test email
 */

import { NextResponse } from 'next/server'
import { BRAND } from '@/config/brand'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { encryptSmtpPass, decryptSmtpPass, reencryptIfLegacy } from '@/lib/email/smtp-crypto'
import { logger } from '@/lib/logger'
import nodemailer from 'nodemailer'

export const GET = withAuth(async () => {
  const session = await requireSession()
  const garage = await prisma.garage.findUnique({
    where: { id: session.user.garageId },
    select: { smtpHost: true, smtpPort: true, smtpUser: true, smtpFrom: true, smtpSecure: true },
  })
  return NextResponse.json(garage ?? {})
})

export const PATCH = withAuth(async (req) => {
  const session = await requireSession()
  if (session.user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Réservé au propriétaire' }, { status: 403 })
  }

  const body = await req.json()
  const data: Record<string, unknown> = {}
  if (body.smtpHost  !== undefined) data.smtpHost  = body.smtpHost  || null
  if (body.smtpPort  !== undefined) data.smtpPort  = body.smtpPort  ? Number(body.smtpPort) : null
  if (body.smtpUser  !== undefined) data.smtpUser  = body.smtpUser  || null
  if (body.smtpFrom  !== undefined) data.smtpFrom  = body.smtpFrom  || null
  if (body.smtpSecure!== undefined) data.smtpSecure= Boolean(body.smtpSecure)
  // Le mot de passe est CHIFFRÉ au repos (AES-256-GCM) avant stockage ; jamais
  // conservé en clair, jamais renvoyé par l'API.
  if (body.smtpPass) data.smtpPass = encryptSmtpPass(String(body.smtpPass))

  await prisma.garage.update({ where: { id: session.user.garageId }, data })
  return NextResponse.json({ ok: true })
})

export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const body = await req.json()

  if (body.action !== 'test') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  const garage = await prisma.garage.findUnique({
    where: { id: session.user.garageId },
    select: { smtpHost: true, smtpPort: true, smtpUser: true, smtpPass: true, smtpFrom: true, smtpSecure: true },
  })

  if (!garage?.smtpHost || !garage?.smtpUser || !garage?.smtpPass) {
    return NextResponse.json({ error: 'Configuration SMTP incomplète' }, { status: 422 })
  }

  const pass = decryptSmtpPass(garage.smtpPass)
  if (!pass) {
    return NextResponse.json(
      { error: 'Mot de passe SMTP illisible (clé de chiffrement absente ?). Réenregistrez la configuration.' },
      { status: 422 },
    )
  }

  try {
    const transporter = nodemailer.createTransport({
      host: garage.smtpHost,
      port: garage.smtpPort ?? 587,
      secure: garage.smtpSecure ?? true,
      auth: { user: garage.smtpUser, pass },
    })

    await transporter.sendMail({
      from: garage.smtpFrom ?? garage.smtpUser,
      to: garage.smtpUser,
      subject: `${BRAND.productName} — Test de configuration email`,
      text: `La configuration email de ${BRAND.productName} fonctionne correctement.`,
    })

    // Migration paresseuse : si le mot de passe stocké était en clair (héritage),
    // on le ré-écrit chiffré maintenant qu'on a confirmé qu'il fonctionne.
    const upgraded = reencryptIfLegacy(garage.smtpPass)
    if (upgraded) {
      await prisma.garage.update({ where: { id: session.user.garageId }, data: { smtpPass: upgraded } })
        .catch(err => logger.error('[email] échec migration chiffrement SMTP', {}, err))
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    // Test SMTP admin : on renvoie un message court (utile au diagnostic) sans
    // stack ni détail interne. Borné pour éviter toute fuite d'information.
    const msg = (err instanceof Error ? err.message : 'Échec de l’envoi').split('\n')[0].slice(0, 160)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
})
