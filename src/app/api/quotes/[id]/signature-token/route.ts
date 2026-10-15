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
import { isDesktopInstance, cloudPost, garageLicenseToken } from '@/lib/sync/cloud-client'
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
  const quote = await prisma.quote.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    select: {
      id: true, number: true, status: true, issueDate: true, validUntil: true,
      notes: true, taxRate: true, jobId: true,
      clientName: true, clientEmail: true, clientPhone: true, clientAddress: true,
      vehicleModel: true, licensePlate: true,
    },
  })
  if (!quote) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 })
  if (!['draft', 'sent'].includes(quote.status)) {
    return NextResponse.json({ error: 'Ce devis ne peut plus être signé' }, { status: 409 })
  }

  let token: string | null = null
  let url: string

  if (isDesktopInstance()) {
    // ── Poste installé : le devis est PUBLIÉ au cloud, qui émet le lien ──────
    // Le poste ne peut pas forger le jeton lui-même : il le signerait avec son
    // secret d'installation, que le cloud ignore. Et lui confier GF_PORTAL_SECRET
    // poserait le secret du portail sur chaque machine de garage. C'est donc le
    // cloud — seul détenteur de son secret — qui signe, après avoir reçu le
    // devis par le canal licence déjà en place (cf. /api/sync/quote).
    //
    // Historique : cette branche renvoyait 409 SIGNATURE_DISTANTE_INDISPONIBLE,
    // parce que le devis n'était répliqué nulle part. Le refus valait mieux que
    // les trois mensonges d'avant (lien parti, devis « envoyé », écran de
    // confirmation, pendant que le client lisait « Token invalide »). La voie de
    // publication existant désormais, le refus n'a plus lieu d'être.
    const licence = await garageLicenseToken(session.user.garageId)
    if (!licence) {
      logger.info('[quotes/signature] poste sans licence garage active', { quote: params.id })
      return NextResponse.json({
        error: 'Aucune licence garage active sur ce poste : impossible de publier le devis '
          + 'pour signature à distance. Faites signer le devis sur place.',
        code: 'LICENCE_GARAGE_ABSENTE',
      }, { status: 409 })
    }

    const lignes = await prisma.quoteLine.findMany({
      where: { quoteId: params.id },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true, description: true, quantityTenThousandths: true,
        unitPriceTenThousandths: true, unitCostTenThousandths: true,
        isLabor: true, sortOrder: true,
      },
    })

    const publication = await cloudPost('/api/sync/quote', {
      garageLicense: licence,
      quote,
      lines: lignes,
    })
    if (!publication.ok || typeof publication.data?.url !== 'string') {
      // On ne marque RIEN comme envoyé et l'on n'expédie aucun courriel : un
      // lien qui n'existe pas ne doit pas être annoncé au patron.
      logger.info('[quotes/signature] publication cloud refusée', {
        quote: params.id, code: publication.code ?? 'REPONSE_INATTENDUE',
      })
      const injoignable = publication.code === 'NETWORK' || publication.code === 'TIMEOUT'
      return NextResponse.json({
        error: injoignable
          ? 'GarageFlows en ligne est injoignable : le devis n’a pas pu être publié pour '
            + 'signature à distance. Votre devis reste enregistré ; réessayez dans un instant.'
          : 'La publication du devis pour signature à distance a été refusée par GarageFlows '
            + 'en ligne. Faites signer le devis sur place.',
        code: publication.code ?? 'PUBLICATION_REFUSEE',
      }, { status: injoignable ? 503 : 409 })
    }
    url = publication.data.url as string
  } else {
    token = await new SignJWT({ quoteId: params.id, typ: 'quote-sign', garageId: session.user.garageId })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(portalSecret())

    // URL PUBLIQUE (envoyée au client pour signer) : jamais l'origine de la
    // requête — sous Electron elle vaut `http://localhost:4028`.
    url = publicUrlFor(cheminPortail(`quote/${token}`))
  }

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
