export const dynamic = 'force-dynamic'

/**
 * GET  /api/email  — returns current SMTP config (no password)
 * PATCH /api/email — update SMTP config
 * POST  /api/email/test (handled below) — send a test email
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { encryptSecret, decryptSecret } from '@/lib/security/secret-cipher'
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
  // Chiffrement au repos (AES-256-GCM). On ne stocke JAMAIS le mot de passe en
  // clair. Si la clé GF_SMTP_CIPHER_KEY manque, on refuse plutôt que de dégrader.
  if (body.smtpPass) {
    try {
      data.smtpPass = encryptSecret(String(body.smtpPass))
    } catch {
      return NextResponse.json(
        { error: 'Chiffrement SMTP indisponible : configurez GF_SMTP_CIPHER_KEY (« openssl rand -base64 32 »).' },
        { status: 503 },
      )
    }
  }

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

  let smtpPass: string | null
  try {
    smtpPass = decryptSecret(garage.smtpPass)
  } catch {
    return NextResponse.json(
      { error: 'Impossible de déchiffrer le mot de passe SMTP (clé GF_SMTP_CIPHER_KEY manquante ou incorrecte).' },
      { status: 503 },
    )
  }

  try {
    // `secure` par défaut = (port === 465), COHÉRENT avec reminders/send et
    // notifications/dispatch. L'ancien `?? true` faisait échouer le test sur un
    // port 587 (STARTTLS) → le diagnostic signalait à tort une config invalide.
    const smtpPort = garage.smtpPort ?? 587
    const transporter = nodemailer.createTransport({
      host: garage.smtpHost,
      port: smtpPort,
      secure: garage.smtpSecure ?? smtpPort === 465,
      auth: { user: garage.smtpUser, pass: smtpPass ?? undefined },
    })

    await transporter.sendMail({
      from: garage.smtpFrom ?? garage.smtpUser,
      to: garage.smtpUser,
      subject: 'GarageFlow — Test de configuration email',
      text: 'La configuration email de GarageFlow fonctionne correctement.',
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    // Test SMTP admin : on renvoie un message court (utile au diagnostic) sans
    // stack ni détail interne. Borné pour éviter toute fuite d'information.
    const msg = (err instanceof Error ? err.message : 'Échec de l’envoi').split('\n')[0].slice(0, 160)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
})
