export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { BRAND } from '@/config/brand'
import { z } from 'zod'
import nodemailer from 'nodemailer'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { decryptSmtpPass } from '@/lib/email/smtp-crypto'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import {
  NotificationEngine,
  InternalProvider,
  FunctionProvider,
  CHANNELS,
  type Channel,
  type DispatchResult,
  type RenderedMessage,
} from '@/lib/notifications'

const BodySchema = z.object({
  trigger: z.string().min(1).optional(),
  channel: z.enum(['email', 'sms', 'whatsapp', 'push', 'internal']).optional(),
  channels: z.array(z.enum(['email', 'sms', 'whatsapp', 'push', 'internal'])).optional(),
  templateKey: z.string().min(1).optional(),
  to: z.string().trim().min(1).max(200),
  context: z.record(z.string(), z.unknown()).optional(),
})

/** Build the email sender from the garage's SMTP config, or null if unconfigured. */
function buildEmailSender(garage: {
  smtpHost: string | null; smtpPort: number | null; smtpUser: string | null
  smtpPass: string | null; smtpFrom: string | null; smtpSecure: boolean; name: string | null; email: string | null
}) {
  if (!garage.smtpHost || !garage.smtpUser || !garage.smtpPass) return null
  // Le mot de passe est chiffré au repos → déchiffrement au moment de l'envoi.
  const pass = decryptSmtpPass(garage.smtpPass)
  if (!pass) return null
  const port = garage.smtpPort ?? 587
  const secure = garage.smtpSecure ?? port === 465
  const from = garage.smtpFrom || garage.email || garage.smtpUser
  return async (to: string, message: RenderedMessage) => {
    try {
      const transporter = nodemailer.createTransport({
        host: garage.smtpHost!, port, secure, auth: { user: garage.smtpUser!, pass },
      })
      const info = await transporter.sendMail({
        from: `${garage.name ?? BRAND.productName} <${from}>`,
        to,
        subject: message.subject ?? '(sans objet)',
        text: message.body,
      })
      return { ok: true, id: info.messageId }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
}

// POST /api/notifications/dispatch — render + send a notification, record the journal.
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const rl = await enforceRateLimit('api', `notify:${session.user.garageId}`, { max: 30, windowSec: 60 })
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Trop de requêtes. Réessayez dans ${rl.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    )
  }

  const parsed = BodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }
  const { trigger, channel, channels, templateKey, to, context = {} } = parsed.data
  if (!trigger && !channel) {
    return NextResponse.json({ error: 'trigger ou channel requis' }, { status: 400 })
  }

  const garage = await prisma.garage.findUnique({
    where: { id: session.user.garageId },
    select: {
      name: true, email: true,
      smtpHost: true, smtpPort: true, smtpUser: true, smtpPass: true, smtpFrom: true, smtpSecure: true,
    },
  })
  if (!garage) return NextResponse.json({ error: 'Garage introuvable' }, { status: 404 })

  const emailSend = buildEmailSender(garage)
  // SMS / WhatsApp / Push have no built-in gateway yet → not_configured (structured
  // so a real gateway can be added without touching the engine or the callers).
  const engine = new NotificationEngine({
    providers: [
      new InternalProvider(),
      new FunctionProvider('email', emailSend),
      new FunctionProvider('sms', null),
      new FunctionProvider('whatsapp', null),
      new FunctionProvider('push', null),
    ],
  })

  let results: DispatchResult[]
  if (trigger) {
    results = await engine.dispatchTrigger({
      trigger: trigger as never,
      to,
      context,
      channels: channels as Channel[] | undefined,
    })
  } else {
    results = [await engine.dispatch({ channel: channel!, to, context, templateKey, trigger: trigger as never })]
  }

  // Persist the journal (best-effort — never fail the response on a write error).
  try {
    await prisma.notificationLog.createMany({
      data: results.map((r) => ({
        garageId: session.user.garageId,
        trigger: trigger ?? null,
        channel: r.channel,
        recipient: to,
        subject: r.message?.subject ?? null,
        body: r.message?.body ?? '',
        status: r.status,
        providerId: r.providerId ?? null,
        error: r.error ?? null,
        attempts: r.attempts,
      })),
    })
  } catch (e) {
    console.error('[notifications] journal write failed', e)
  }

  return NextResponse.json({ results })
})

// GET /api/notifications/dispatch?status=&limit= — recent notification journal.
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? '50')))
  const channel = searchParams.get('channel')

  const where: { garageId: string; status?: string; channel?: string } = { garageId: session.user.garageId }
  if (status) where.status = status
  if (channel && CHANNELS.includes(channel as Channel)) where.channel = channel

  const logs = await prisma.notificationLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return NextResponse.json({ logs })
})
