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
import { resolveSmtpTestConfig, smtpErrorMessage } from '@/lib/email/smtp-config'
import nodemailer from 'nodemailer'

export const GET = withAuth(async () => {
  const session = await requireSession()
  const garage = await prisma.garage.findUnique({
    where: { id: session.user.garageId },
    select: { smtpHost: true, smtpPort: true, smtpUser: true, smtpFrom: true, smtpSecure: true, smtpPass: true },
  })
  if (!garage) return NextResponse.json({})

  // Le mot de passe n'est JAMAIS renvoyé — seulement le fait qu'il existe.
  // L'interface le déduisait de la présence de `smtpUser`, ce qui affichait
  // « déjà enregistré » pour un garage sans mot de passe et menait tout droit
  // au refus « Configuration SMTP incomplète » au moment du test.
  const { smtpPass, ...rest } = garage
  return NextResponse.json({ ...rest, smtpPassConfigured: Boolean(smtpPass) })
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

  // Le test utilise les identifiants du garage : même exigence que PATCH.
  if (session.user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Réservé au propriétaire' }, { status: 403 })
  }

  const garage = await prisma.garage.findUnique({
    where: { id: session.user.garageId },
    select: { smtpHost: true, smtpPort: true, smtpUser: true, smtpPass: true, smtpFrom: true, smtpSecure: true },
  })

  // On teste CE QUI EST À L'ÉCRAN : les valeurs courantes du formulaire priment
  // sur celles enregistrées. Tester silencieusement d'anciennes données faisait
  // répondre « configuration incomplète » à un formulaire pourtant rempli.
  // Le mot de passe stocké reste utilisable sans être ressaisi, mais seulement
  // avec son propre hôte/compte (cf. lib/email/smtp-config.ts).
  const resolved = resolveSmtpTestConfig(garage, body)
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }

  let smtpPass = resolved.password
  if (resolved.useStoredSecret) {
    try {
      smtpPass = decryptSecret(garage!.smtpPass as string)
    } catch {
      return NextResponse.json(
        { error: 'Impossible de déchiffrer le mot de passe SMTP enregistré (clé GF_SMTP_CIPHER_KEY manquante ou modifiée). Ressaisissez le mot de passe puis enregistrez.' },
        { status: 503 },
      )
    }
  }

  try {
    const transporter = nodemailer.createTransport({
      host: resolved.host,
      port: resolved.port,
      secure: resolved.secure,
      auth: { user: resolved.user, pass: smtpPass ?? undefined },
    })

    await transporter.sendMail({
      from: resolved.from,
      to: resolved.user,
      subject: 'GarageFlows — Test de configuration email',
      text: 'La configuration email de GarageFlows fonctionne correctement.',
    })

    // Succès annoncé UNIQUEMENT si le serveur SMTP a accepté l'envoi.
    return NextResponse.json({ ok: true })
  } catch (err) {
    // Message actionnable (auth refusée, TLS, timeout…) sans stack, sans secret.
    return NextResponse.json({ error: smtpErrorMessage(err, resolved.host) }, { status: 500 })
  }
})
