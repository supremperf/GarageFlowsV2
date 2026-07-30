export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import nodemailer from 'nodemailer'
import { logger } from '@/lib/logger'

// POST /api/reminders/send  body: { id }
// Sends a real email if SMTP is configured, otherwise returns the email content
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const { id } = await req.json()

  const reminder = await prisma.reminder.findFirst({
    where: { id, garageId: session.user.garageId },
  })
  if (!reminder) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  if (!reminder.email) return NextResponse.json({ error: 'Pas d\'email pour ce client' }, { status: 400 })

  // Fetch garage info for sender details
  const garage = await prisma.garage.findUnique({ where: { id: session.user.garageId } })

  const typeLabels: Record<string, string> = {
    vidange: 'Vidange', ct: 'Contrôle technique', distribution: 'Distribution',
    freins: 'Freins', pneus: 'Pneus', batterie: 'Batterie', autre: 'Entretien',
  }
  const typeLabel = typeLabels[reminder.type] ?? reminder.type
  const dateStr = new Date(reminder.scheduledDate + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  // Optional appointment time (HH:MM). Shown as "à 14:30" when present.
  const timeStr    = reminder.scheduledTime ? reminder.scheduledTime.trim() : ''
  const dateTimeFr = timeStr ? `${dateStr} à ${timeStr}` : dateStr

  const subject = `Rappel entretien - ${typeLabel} - ${garage?.name ?? 'Votre garage'}`
  const textBody = `Bonjour ${reminder.clientName},

Nous vous contactons pour vous rappeler que votre ${typeLabel.toLowerCase()} est prévu(e) pour le ${dateTimeFr}.

${reminder.vehicleModel ? `Véhicule : ${reminder.vehicleModel}${reminder.licensePlate ? ` (${reminder.licensePlate})` : ''}\n` : ''}${reminder.notes ? `Note : ${reminder.notes}\n` : ''}
N'hésitez pas à nous contacter en cas d'indisponibilité ou pour obtenir plus d'informations.

Cordialement,
${garage?.name ?? 'Votre garage'}${garage?.phone ? `\nTél : ${garage.phone}` : ''}${garage?.email ? `\nEmail : ${garage.email}` : ''}`

  const htmlBody = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1e293b">
<div style="background:#3b82f6;border-radius:12px 12px 0 0;padding:20px 24px">
  <h1 style="color:white;margin:0;font-size:20px">🔔 Rappel d'entretien</h1>
  <p style="color:#bfdbfe;margin:4px 0 0">${garage?.name ?? 'Votre garage de confiance'}</p>
</div>
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:0 0 12px 12px;padding:24px">
  <p style="font-size:16px">Bonjour <strong>${reminder.clientName}</strong>,</p>
  <p>Nous vous rappelons que votre entretien est prévu :</p>
  <div style="background:white;border:2px solid #3b82f6;border-radius:10px;padding:16px;margin:16px 0;text-align:center">
    <p style="font-size:22px;font-weight:700;color:#3b82f6;margin:0">${typeLabel}</p>
    <p style="font-size:16px;color:#475569;margin:8px 0 0">${dateStr}${timeStr ? ` · <strong>${timeStr}</strong>` : ''}</p>
    ${reminder.vehicleModel ? `<p style="font-size:13px;color:#94a3b8;margin:4px 0 0">${reminder.vehicleModel}${reminder.licensePlate ? ` · ${reminder.licensePlate}` : ''}</p>` : ''}
  </div>
  ${reminder.notes ? `<p style="color:#64748b;font-style:italic;font-size:13px">${reminder.notes}</p>` : ''}
  <p>En cas d'indisponibilité :</p>
  ${garage?.phone ? `<p><a href="tel:${garage.phone}" style="color:#3b82f6">📞 ${garage.phone}</a></p>` : ''}
  ${garage?.email ? `<p><a href="mailto:${garage.email}" style="color:#3b82f6">✉️ ${garage.email}</a></p>` : ''}
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0">
  <p style="color:#94a3b8;font-size:12px">Cordialement, l'équipe de ${garage?.name ?? 'votre garage'}</p>
</div>
</body></html>`

  // SMTP configuration is stored on the garage (Paramètres › Email), NOT in env vars.
  const smtpHost   = garage?.smtpHost
  const smtpUser   = garage?.smtpUser
  const smtpPass   = garage?.smtpPass
  const smtpPort   = garage?.smtpPort ?? 587
  const smtpSecure = garage?.smtpSecure ?? (smtpPort === 465)
  const smtpFrom   = garage?.smtpFrom || garage?.email || smtpUser

  if (!smtpHost || !smtpUser || !smtpPass) {
    // No SMTP configured — return the email content so the client can open mailto
    return NextResponse.json({
      sent: false,
      reason: 'no_smtp',
      to: reminder.email,
      subject,
      body: textBody,
    })
  }

  // Send via the garage's configured SMTP account
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: { user: smtpUser, pass: smtpPass },
  })

  try {
    await transporter.sendMail({
      from: `${garage?.name ?? 'GarageFlow'} <${smtpFrom}>`,
      to: reminder.email,
      subject,
      text: textBody,
      html: htmlBody,
    })
  } catch (err) {
    // Le détail SMTP (hôte, réponse serveur) reste dans les logs redactés.
    logger.error('[reminders/send] échec SMTP', err)
    return NextResponse.json(
      { sent: false, reason: 'smtp_error', error: 'Échec de l\'envoi de l\'e-mail. Vérifiez la configuration SMTP.' },
      { status: 502 },
    )
  }

  // Mark as sent
  await prisma.reminder.update({ where: { id, garageId: session.user.garageId }, data: { status: 'sent' } })

  return NextResponse.json({ sent: true, to: reminder.email })
})
