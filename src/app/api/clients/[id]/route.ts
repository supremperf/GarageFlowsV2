export const dynamic = 'force-dynamic'

/**
 * Fiche client tenue par le GARAGE.
 *
 *   GET   → la fiche, avec l'état de son accès portail
 *   PATCH → modifier la fiche, et propager l'adresse au compte portail
 *
 * ─── Ce qui manquait (GF-PORT-007, §18 à §26) ───────────────────────────────
 * Le sens portail → garage existait : quand le client confirmait sa nouvelle
 * adresse, la fiche du garage suivait. Le sens inverse n'existait pas — et pas
 * par oubli de propagation : AUCUNE route ne permettait au garage de modifier
 * la fiche d'un de ses clients. `UpdateClientSchema` était écrit, validé,
 * exporté, et appelé nulle part.
 *
 * Conséquence : le garage corrigeait une adresse mal saisie… nulle part. Il
 * continuait d'écrire à l'ancienne, et le client se connectait avec elle.
 *
 * ─── La source de vérité, et pourquoi il en faut une (§19) ──────────────────
 * Deux adresses cohabitent : celle de la FICHE (le carnet d'adresses du garage)
 * et celle du COMPTE PORTAIL (l'identifiant de connexion du client). Les laisser
 * évoluer séparément, c'est se retrouver avec un garage qui écrit à l'une
 * pendant que le client se connecte avec l'autre, sans que rien ne le signale.
 *
 * Règle retenue : elles restent égales, et chacun des deux côtés peut la
 * changer — mais pas au même prix.
 *
 *   · Le CLIENT doit PROUVER l'adresse avant qu'elle devienne son identifiant
 *     (`pendingEmail` + lien de confirmation). Sans cela, un cookie volé
 *     suffirait à s'approprier le compte.
 *   · Le GARAGE, lui, l'applique tout de suite. Il est l'émetteur de cet accès
 *     et le teneur du carnet d'adresses ; lui imposer d'attendre le clic d'un
 *     client qui ne relève PLUS son ancienne boîte laisserait la fiche fausse
 *     indéfiniment. Cela ne lui donne aucun pouvoir nouveau : il consulte déjà
 *     l'intégralité du dossier de ce client depuis son propre logiciel.
 *
 * L'asymétrie est donc dans la PREUVE exigée, jamais dans le résultat : les deux
 * adresses finissent toujours égales.
 *
 * ─── Ce que la propagation entraîne, et pourquoi (§21, §23, §25) ────────────
 *   · `emailVerified` retombe à FAUX. L'ancienne preuve portait sur l'ancienne
 *     adresse ; la transporter sur la nouvelle serait affirmer une vérification
 *     qui n'a pas eu lieu (§23). Un lien de confirmation part sur la nouvelle.
 *   · Les sessions ouvertes sont COUPÉES. L'identifiant de connexion vient de
 *     changer ; laisser vivre un cookie émis pour l'ancien laisserait le compte
 *     accessible sous une identité qui n'existe plus.
 *   · Une demande de changement encore EN ATTENTE côté client est annulée. Elle
 *     avait été émise contre un état qui n'existe plus ; la laisser courir
 *     permettrait au client de confirmer, plus tard, une adresse décidée avant
 *     la correction du garage — c'est exactement la divergence silencieuse que
 *     §25 interdit.
 */

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { UpdateClientSchema } from '@/lib/schemas'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { sendGarageMail } from '@/lib/mail/send-garage-mail'
import { publicUrlFor } from '@/lib/public-url'
import { cheminPortail } from '@/lib/portal/routes'

/** Rôles autorisés à modifier une fiche client. */
const ROLES_GESTION = new Set(['OWNER', 'MANAGER'])

export const GET = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  // Portée garage : la fiche d'un autre garage est INTROUVABLE, pas refusée.
  const client = await prisma.client.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    include: { vehicles: { select: { id: true, licensePlate: true, make: true, model: true, year: true } } },
  })
  if (!client) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  return NextResponse.json(client)
})

export const PATCH = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  if (!ROLES_GESTION.has(session.user.role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const parsed = UpdateClientSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const corps = parsed.data

  const client = await prisma.client.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    select: { id: true, name: true, email: true },
  })
  if (!client) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  const nouvelleAdresse = corps.email === undefined
    ? undefined
    : (corps.email?.trim().toLowerCase() || null)
  const adresseChange = nouvelleAdresse !== undefined
    && nouvelleAdresse !== (client.email?.toLowerCase() ?? null)

  const acces = await prisma.portalUser.findFirst({
    where: { clientId: client.id, garageId: session.user.garageId },
    select: { id: true, email: true, pendingEmail: true },
  })
  const propage = Boolean(adresseChange && nouvelleAdresse && acces)

  // ── Collision (§22) ────────────────────────────────────────────────────────
  // L'unicité des identifiants portail est bornée au garage. Deux garages
  // peuvent avoir un client à la même adresse ; deux comptes du MÊME garage,
  // non. Le conflit est refusé AVANT toute écriture, sinon la fiche partirait
  // et le compte resterait — les deux vérités divergeraient sur-le-champ.
  if (propage) {
    const occupee = await prisma.portalUser.findFirst({
      where: { garageId: session.user.garageId, email: nouvelleAdresse!, NOT: { id: acces!.id } },
      select: { id: true },
    })
    if (occupee) {
      return NextResponse.json(
        {
          error: 'Un autre accès portail de ce garage utilise déjà cette adresse.',
          code: 'EMAIL_TAKEN',
        },
        { status: 409 },
      )
    }
  }

  const jeton = propage ? crypto.randomBytes(32).toString('base64url') : null
  const ancienneAdresseCompte = acces?.email ?? null
  const demandeClientAnnulee = Boolean(propage && acces?.pendingEmail)

  // La fiche et le compte changent ENSEMBLE, ou ni l'un ni l'autre : une fiche
  // corrigée avec un compte resté en arrière serait précisément la
  // désynchronisation que cette route existe pour supprimer.
  const [maj] = await prisma.$transaction([
    prisma.client.update({
      where: { id: client.id },
      data: {
        ...(corps.name !== undefined && { name: corps.name.trim() }),
        ...(corps.phone !== undefined && { phone: corps.phone || null }),
        ...(corps.address !== undefined && { address: corps.address || null }),
        ...(nouvelleAdresse !== undefined && { email: nouvelleAdresse }),
      },
      include: { vehicles: { select: { id: true, licensePlate: true, make: true, model: true, year: true } } },
    }),
    ...(propage
      ? [
          prisma.portalUser.update({
            where: { id: acces!.id },
            data: {
              email: nouvelleAdresse!,
              // §23 — la preuve portait sur l'ancienne adresse. Elle ne suit pas.
              emailVerified: false,
              emailVerifyToken: jeton,
              // §25 — une demande du client émise avant cette correction n'a
              // plus d'objet ; la laisser courir autoriserait deux états.
              pendingEmail: null,
            },
          }),
          // L'identifiant a changé : les sessions ouvertes sous l'ancien tombent.
          prisma.portalDevice.updateMany({
            where: { portalUserId: acces!.id, revokedAt: null },
            data: { revokedAt: new Date() },
          }),
        ]
      : []),
  ])

  // ── Journalisation (§26) ───────────────────────────────────────────────────
  // Les adresses figurent au journal : sans elles, on saurait qu'un identifiant
  // a changé sans pouvoir dire de quoi vers quoi — c'est-à-dire rien d'utile le
  // jour où un client affirme ne plus recevoir ses factures.
  await logAudit({
    action: 'update', entityType: 'Client', entityId: client.id, session, req,
    details: {
      extra: {
        ...(adresseChange ? { emailAvant: client.email, emailApres: nouvelleAdresse } : {}),
        ...(propage
          ? {
              portalUserId: acces!.id,
              identifiantAvant: ancienneAdresseCompte,
              identifiantApres: nouvelleAdresse,
              emailVerifieRemisAZero: true,
              sessionsCoupees: true,
              ...(demandeClientAnnulee ? { demandeClientAnnulee: acces!.pendingEmail } : {}),
            }
          : {}),
      },
    },
  })

  let emailEnvoye: boolean | undefined
  if (propage) {
    logger.info('[clients] identifiant portail modifié par le garage', { client: client.id })

    const garage = await prisma.garage.findUnique({
      where: { id: session.user.garageId },
      select: { name: true },
    })
    const lien = publicUrlFor(`/api/portal/auth/verify-email?token=${encodeURIComponent(jeton!)}`)
    // Le message part sur la NOUVELLE adresse — la seule à laquelle le client
    // est désormais joignable — et dit la vérité sur ce qui vient de se passer :
    // il doit se reconnecter, et son identifiant a changé.
    const envoi = await sendGarageMail({
      garageId: session.user.garageId,
      to: nouvelleAdresse!,
      subject: `${garage?.name ?? 'Votre garage'} — votre adresse de connexion a changé`,
      text: [
        'Bonjour,',
        '',
        `${garage?.name ?? 'Votre garage'} a mis à jour l’adresse e-mail de votre dossier.`,
        `Vous vous connecterez désormais à votre espace client avec : ${nouvelleAdresse}`,
        '',
        'Votre mot de passe est inchangé. Confirmez cette adresse en ouvrant ce lien :',
        '',
        lien,
        '',
        'Vos sessions ouvertes ont été fermées : reconnectez-vous avec votre nouvelle adresse.',
        'Si ce changement vous surprend, contactez votre garage.',
      ].join('\n'),
    })
    emailEnvoye = envoi.ok
    if (!envoi.ok) logger.info('[clients] avis de changement non envoyé', { motif: envoi.reason })
  }

  return NextResponse.json({
    ...maj,
    // L'écran doit pouvoir DIRE ce qui s'est produit : taire la coupure des
    // sessions ferait passer pour une panne le fait que le client soit
    // déconnecté quelques minutes plus tard.
    portail: propage
      ? { identifiantModifie: true, emailEnvoye, sessionsCoupees: true, demandeClientAnnulee }
      : undefined,
  })
})
