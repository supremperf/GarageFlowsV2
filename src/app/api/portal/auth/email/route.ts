export const dynamic = 'force-dynamic'

/**
 * PUT /api/portal/auth/email — le client demande à changer son adresse.
 *
 * ─── Pourquoi l'adresse ne change pas tout de suite (GF-PORT-006) ───────────
 * L'adresse est l'IDENTIFIANT de connexion. La remplacer sur simple demande
 * aurait deux conséquences inacceptables : une faute de frappe enfermerait le
 * client dehors sans recours, et n'importe qui pourrait revendiquer l'adresse
 * d'un tiers. La nouvelle adresse est donc mise EN ATTENTE, et un lien de
 * confirmation part sur ELLE. Tant que le client n'a pas cliqué, il continue de
 * se connecter avec son ancienne adresse.
 *
 * La propagation vers la fiche client du garage a lieu à la CONFIRMATION, dans
 * `verify-email` — pas ici : tant que l'adresse n'est pas prouvée, la propager
 * ferait écrire le garage dans le vide.
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { withPortalAuth, type PortalContext } from '@/lib/portal/auth-helpers'
import { sendGarageMail } from '@/lib/mail/send-garage-mail'
import { publicUrlFor } from '@/lib/public-url'
import { logger } from '@/lib/logger'

/** Même exigence que l'identifiant posé par le garage (voir lib/portal/acces). */
function adresseValide(v: unknown): v is string {
  return typeof v === 'string'
    && v.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim().toLowerCase())
}

export const PUT = withPortalAuth(async (req: NextRequest, portal: PortalContext) => {
  let corps: { email?: unknown; currentPassword?: unknown }
  try {
    corps = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
  }

  if (!adresseValide(corps.email)) {
    return NextResponse.json({ error: 'Adresse e-mail invalide.', code: 'INVALID_EMAIL' }, { status: 400 })
  }
  const nouvelle = (corps.email as string).trim().toLowerCase()

  // Le mot de passe est exigé : changer l'adresse de connexion depuis un cookie
  // volé reviendrait à s'approprier le compte définitivement.
  if (typeof corps.currentPassword !== 'string'
      || !(await bcrypt.compare(corps.currentPassword, portal.user.passwordHash))) {
    return NextResponse.json({ error: 'Mot de passe incorrect.' }, { status: 403 })
  }

  if (nouvelle === portal.user.email.toLowerCase()) {
    return NextResponse.json({ error: 'Cette adresse est déjà la vôtre.', code: 'EMAIL_UNCHANGED' }, { status: 400 })
  }

  // Collision DANS LE GARAGE (l'unicité y est bornée) : refusée tout de suite
  // plutôt qu'au moment de la confirmation, où le client aurait déjà changé de
  // boîte mail en pensant l'opération faite.
  const occupee = await prisma.portalUser.findFirst({
    where: { garageId: portal.user.garageId, email: nouvelle, NOT: { id: portal.user.id } },
    select: { id: true },
  })
  if (occupee) {
    return NextResponse.json(
      { error: 'Cette adresse est déjà utilisée dans ce garage.', code: 'EMAIL_TAKEN' },
      { status: 409 },
    )
  }

  const jeton = crypto.randomBytes(32).toString('base64url')
  await prisma.portalUser.update({
    where: { id: portal.user.id },
    data: { pendingEmail: nouvelle, emailVerifyToken: jeton },
  })

  const garage = await prisma.garage.findUnique({
    where: { id: portal.user.garageId },
    select: { name: true },
  })
  const lien = publicUrlFor(`/api/portal/auth/verify-email?token=${encodeURIComponent(jeton)}`)

  // Le message part sur la NOUVELLE adresse : c'est ce qui en prouve la
  // possession. L'ancienne reste l'identifiant jusqu'au clic.
  const envoi = await sendGarageMail({
    garageId: portal.user.garageId,
    to: nouvelle,
    subject: `${garage?.name ?? 'Votre garage'} — confirmez votre nouvelle adresse`,
    text: [
      'Bonjour,',
      '',
      'Vous avez demandé à utiliser cette adresse pour votre espace client.',
      'Confirmez-la en ouvrant ce lien :',
      '',
      lien,
      '',
      'Tant que vous n’aurez pas confirmé, votre ancienne adresse reste valable pour vous connecter.',
      'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.',
    ].join('\n'),
  })

  if (!envoi.ok) logger.info('[portal/email] confirmation non envoyée', { motif: envoi.reason })

  return NextResponse.json({
    ok: true,
    pendingEmail: nouvelle,
    emailEnvoye: envoi.ok,
    // L'interface doit dire la vérité : sans envoi, le client n'a aucun moyen de
    // confirmer, et son adresse actuelle reste la seule valable.
    message: envoi.ok
      ? 'Un lien de confirmation vient de vous être envoyé à cette adresse.'
      : 'Demande enregistrée, mais l’e-mail de confirmation n’a pas pu être envoyé. Contactez votre garage.',
  })
})
