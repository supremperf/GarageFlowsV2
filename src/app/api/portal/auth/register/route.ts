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
import { sendGarageMail } from '@/lib/mail/send-garage-mail'
import { publicUrlFor } from '@/lib/public-url'
import { logger } from '@/lib/logger'

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
  // Le nom est repris dans le corps du courriel de vérification. Il est donc
  // borné et débarrassé de ses sauts de ligne : la route étant ouverte (aucune
  // session requise), elle ne doit pas devenir un moyen de faire porter un
  // texte arbitraire par le serveur SMTP du garage. Le débit est déjà borné
  // ci-dessus (5 tentatives / 15 min / IP, fail-closed en production).
  const name = body.name ? String(body.name).replace(/\s+/g, ' ').trim().slice(0, 100) : null

  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Email invalide' }, { status: 400 })
  if (password.length < 8) return NextResponse.json({ error: 'Mot de passe trop court (min 8 caractères)' }, { status: 400 })

  const garageId = await resolveGarageId(typeof body.garageSlug === 'string' ? body.garageSlug : null)
  if (!garageId) return NextResponse.json({ error: 'Garage introuvable ou ambigu (garageSlug requis)' }, { status: 400 })

  // ── ANTI-ÉNUMÉRATION (§72) ────────────────────────────────────────────────
  // Répondre « Un compte existe déjà pour cet email » confirmait qu'une adresse
  // donnée est cliente de CE garage — la protection soigneusement posée sur la
  // connexion (réponse indifférenciée) était annulée par l'inscription, où il
  // suffisait d'essayer (GF31-AUD-060).
  //
  // On rend donc la MÊME réponse que pour une inscription réussie, sans créer
  // ni modifier quoi que ce soit, et l'on prévient le titulaire légitime par
  // courriel : c'est lui, et lui seul, qui apprend la tentative.
  const existing = await prisma.portalUser.findUnique({ where: { garageId_email: { garageId, email } } })
  if (existing) {
    logger.info('[portal/register] tentative sur une adresse déjà inscrite', { garageId })
    await sendGarageMail({
      garageId,
      to: email,
      subject: 'Tentative de création de compte',
      text: [
        'Bonjour,',
        '',
        'Quelqu’un vient de tenter de créer un compte client avec votre adresse',
        'e-mail. Vous en possédez déjà un : aucune modification n’a été faite.',
        '',
        'Si c’était vous, connectez-vous simplement avec votre mot de passe',
        'habituel. Sinon, vous pouvez ignorer ce message.',
        '',
      ].join(String.fromCharCode(10)),
    }).catch(() => undefined)

    return NextResponse.json(
      {
        ok: true,
        user: null,
        requiresEmailVerification: true,
        // Indifférenciable d'une vraie inscription : le client légitime reçoit
        // un courriel dans les deux cas.
        verificationEmailSent: true,
      },
      { status: 201 },
    )
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const emailVerifyToken = crypto.randomBytes(32).toString('hex')

  // clientId reste NULL à l'inscription : aucun rattachement à un Client existant
  // tant que l'email n'est pas vérifié (cf. verify-email). Empêche la prise de
  // contrôle du dossier d'un client par simple ré-utilisation de son email.
  const user = await prisma.portalUser.create({
    data: { garageId, email, passwordHash, name, clientId: null, emailVerifyToken },
    select: { id: true, email: true, name: true, emailVerified: true, clientId: true },
  })

  // ── ENVOI RÉEL du lien de vérification ─────────────────────────────────────
  //
  // Le jeton était généré et stocké « pour envoi ultérieur » — envoi qui
  // n'existait nulle part. Le client ne recevait donc jamais rien, ne pouvait
  // jamais vérifier son adresse, et `clientId` restait NULL indéfiniment : le
  // compte n'était JAMAIS rattaché au dossier client, si bien que le portail
  // n'affichait aucun document (GF31-AUD-018).
  //
  // L'envoi ne conditionne PAS la création du compte : un garage sans SMTP
  // configuré doit pouvoir inscrire ses clients, quitte à leur transmettre le
  // lien autrement. Mais on ne prétend jamais l'avoir envoyé (§3) : la réponse
  // dit exactement ce qui s'est passé.
  const lien = publicUrlFor(`/api/portal/auth/verify-email?token=${encodeURIComponent(emailVerifyToken)}`)
  const envoi = await sendGarageMail({
    garageId,
    to: email,
    subject: 'Vérifiez votre adresse e-mail',
    text:
      `Bonjour${name ? ` ${name}` : ''},\n\n` +
      'Confirmez votre adresse e-mail pour accéder à vos devis, factures et rendez-vous :\n\n' +
      `${lien}\n\n` +
      "Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message.\n",
  })

  if (!envoi.ok) {
    logger.warn('[portal/register] lien de vérification non envoyé', {
      garageId, reason: envoi.reason,
    })
  }

  return NextResponse.json(
    {
      ok: true,
      user,
      requiresEmailVerification: true,
      // Le client sait s'il doit attendre un courriel ou réclamer le lien.
      verificationEmailSent: envoi.ok,
      ...(envoi.ok ? {} : { verificationEmailError: envoi.message }),
    },
    { status: 201 },
  )
}
