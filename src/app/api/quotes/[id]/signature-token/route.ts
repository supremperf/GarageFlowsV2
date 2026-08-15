export const dynamic = "force-dynamic"

/**
 * POST /api/quotes/[id]/signature-token — produit le lien de signature d'un
 * devis, et l'envoie au client.
 *
 * ─── La chaîne était coupée en son milieu (GF-DUR-020) ──────────────────────
 * La page de signature du client existe et est complète : elle affiche le devis,
 * recueille une signature, accepte ou refuse. Mais AUCUN écran du garage
 * n'appelait cette route — la seule qui fabrique le jeton. Personne ne pouvait
 * donc faire signer un devis : la moitié cliente attendait un lien que la moitié
 * garage ne savait pas produire.
 */

import { NextResponse } from 'next/server'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { prisma } from '@/lib/db'
import { SignJWT } from 'jose'
import { portalSecret } from '@/lib/portal-secret'
import { publicUrlFor } from '@/lib/public-url'
import { cheminPortail } from '@/lib/portal/routes'
import { sendGarageMail } from '@/lib/mail/send-garage-mail'
import { isDesktopInstance } from '@/lib/sync/cloud-client'
import { logger } from '@/lib/logger'

// POST /api/quotes/[id]/signature-token
export const POST = withAuth(async (req: Request, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  // Émettre un devis engage le garage : même permission que sa gestion.
  if (!can(session.user.role, 'quote:manage')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  // ── Un poste installé ne peut pas encore faire signer à distance (GF-003) ───
  // Le jeton est signé avec le secret D'INSTALLATION du poste (per-install,
  // cf. electron/secret.js) et l'URL remise au client pointe sur la PWA
  // officielle, qui ne connaît ni ce secret ni ce devis : le devis n'est pas
  // répliqué (la passerelle /api/sync/* ne porte que les interventions, les
  // photos, les mécaniciens et l'instantané portail).
  //
  // Ce qui se passait : le lien partait quand même par e-mail, le devis
  // basculait en « envoyé », et l'écran affichait « Devis envoyé à … ». Le
  // client, lui, ouvrait « Token invalide ou expiré ». Trois mensonges pour un
  // seul défaut. On refuse donc explicitement, sans rien modifier ni envoyer.
  //
  // Lever la limite demande une vraie voie de retour poste ⇄ cloud pour la
  // signature (publication du devis + remontée de l'accord) : c'est une
  // fonctionnalité à part entière, pas un correctif — elle est signalée comme
  // telle plutôt que simulée.
  if (isDesktopInstance()) {
    logger.info('[quotes/signature] refus — instance poste, devis non publiable', { quote: params.id })
    return NextResponse.json({
      error: 'La signature à distance n’est pas disponible depuis un poste installé : '
        + 'le lien serait illisible pour votre client. Faites signer le devis sur place, '
        + 'ou utilisez l’espace en ligne de GarageFlows.',
      code: 'SIGNATURE_DISTANTE_INDISPONIBLE',
    }, { status: 409 })
  }

  const quote = await prisma.quote.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    select: { id: true, number: true, status: true, clientName: true, clientEmail: true },
  })
  if (!quote) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 })
  if (!['draft', 'sent'].includes(quote.status)) {
    return NextResponse.json({ error: 'Ce devis ne peut plus être signé' }, { status: 409 })
  }

  const token = await new SignJWT({ quoteId: params.id, typ: 'quote-sign', garageId: session.user.garageId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(portalSecret())

  // URL PUBLIQUE (envoyée au client pour signer) : jamais l'origine de la
  // requête — sous Electron elle vaut `http://localhost:4028`.
  const url = publicUrlFor(cheminPortail(`quote/${token}`))

  // Mark quote as sent if it was draft
  if (quote.status === 'draft') {
    await prisma.quote.update({ where: { id: params.id, garageId: session.user.garageId }, data: { status: 'sent' } })
  }

  // ── Envoi au client ────────────────────────────────────────────────────────
  // Le lien est aussi RENDU à l'écran : un garage sans SMTP configuré, ou dont
  // le client n'a pas d'adresse, doit pouvoir le communiquer autrement — par
  // SMS, de vive voix, en le recopiant. Faire dépendre toute la signature d'un
  // envoi de courriel rendrait la fonction inutilisable là où elle sert.
  let emailEnvoye: boolean | null = null
  if (quote.clientEmail) {
    const garage = await prisma.garage.findUnique({
      where: { id: session.user.garageId }, select: { name: true },
    })
    const envoi = await sendGarageMail({
      garageId: session.user.garageId,
      to: quote.clientEmail,
      subject: `${garage?.name ?? 'Votre garage'} — devis ${quote.number} à signer`,
      text: [
        `Bonjour${quote.clientName ? ` ${quote.clientName}` : ''},`,
        '',
        `Votre devis ${quote.number} est prêt. Vous pouvez le consulter, l’accepter ou le refuser ici :`,
        '',
        url,
        '',
        'Ce lien est personnel et valable sept jours.',
      ].join('\n'),
    })
    emailEnvoye = envoi.ok
    if (!envoi.ok) logger.info('[quotes/signature] lien non envoyé', { motif: envoi.reason })
  }

  return NextResponse.json({ token, url, emailEnvoye, destinataire: quote.clientEmail ?? null })
})
