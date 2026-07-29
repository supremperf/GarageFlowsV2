export const dynamic = 'force-dynamic'

/**
 * GET  /api/email  — returns current SMTP config (no password)
 * PATCH /api/email — update SMTP config
 * POST  /api/email/test (handled below) — send a test email
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
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
  if (body.smtpPass) data.smtpPass = body.smtpPass

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

  try {
    const transporter = nodemailer.createTransport({
      host: garage.smtpHost,
      port: garage.smtpPort ?? 587,
      secure: garage.smtpSecure ?? true,
      auth: { user: garage.smtpUser, pass: garage.smtpPass },
    })

    await transporter.sendMail({
      from: garage.smtpFrom ?? garage.smtpUser,
      to: garage.smtpUser,
      subject: 'GarageFlow — Test de configuration email',
      text: 'La configuration email de GarageFlow fonctionne correctement.',
    })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    // Log full SMTP error server-side; return a generic message so host/port/TLS
    // and auth-failure details are not exposed to the caller.
    console.error('[email/test] SMTP error:', err)
    return NextResponse.json({ error: "Échec de l'envoi de l'email de test." }, { status: 500 })
  }
})
