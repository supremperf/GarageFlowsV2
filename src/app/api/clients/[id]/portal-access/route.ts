export const dynamic = 'force-dynamic'

/**
 * Gestion par le GARAGE de l'accès portail d'un client.
 *
 *   GET    → état de l'accès (existe ? actif ? mot de passe encore temporaire ?)
 *   POST   → ouvrir l'accès : identifiant + mot de passe temporaire
 *   PUT    → réinitialiser : nouveau mot de passe temporaire, sessions coupées
 *   PATCH  → activer / désactiver l'accès, sans toucher au client métier
 *
 * ─── Ce qui n'existait pas (GF-PORT-004) ────────────────────────────────────
 * Aucune route ne permettait au garage de gérer l'accès portail de ses clients :
 * l'unique chemin d'entrée était l'auto-inscription du client. Le garage ne
 * pouvait ni ouvrir un accès, ni en remettre un, ni le couper.
 *
 * ─── Le mot de passe temporaire n'est montré qu'UNE FOIS ────────────────────
 * Il est rendu en clair dans la réponse de POST et de PUT, et nulle part
 * ailleurs : seul son haché est conservé. Le garage doit donc le communiquer
 * immédiatement. Le stocker pour pouvoir le réafficher reviendrait à garder un
 * mot de passe en clair en base, ce que la remise d'un nouveau rend inutile.
 */

import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { genererMotDePasseTemporaire, identifiantDepuisClient, messageAccesPortail } from '@/lib/portal/acces'
import { sendGarageMail } from '@/lib/mail/send-garage-mail'
import { publicUrlFor } from '@/lib/public-url'
import { cheminPortail } from '@/lib/portal/routes'
import { publierAccesPortail } from '@/lib/portal/publier-acces'

/**
 * Envoie ses identifiants au client — best-effort, JAMAIS journalisé.
 *
 * Le mot de passe ne traverse que ce chemin : il n'apparaît ni dans le journal
 * d'audit (qui ne reçoit que l'identifiant du client), ni dans les traces
 * applicatives, ni dans le message d'erreur en cas d'échec SMTP. `sendGarageMail`
 * ne journalise que l'hôte et le garage, jamais le corps.
 *
 * Un échec d'envoi n'annule pas l'ouverture de l'accès : le mot de passe est de
 * toute façon affiché une fois au garage, qui peut le communiquer autrement.
 * Mais l'issue est RENDUE, pour que l'écran dise « accès créé · e-mail non
 * envoyé » plutôt que de laisser croire que le client a été prévenu.
 */
async function envoyerIdentifiants(params: {
  garageId: string
  nomGarage: string
  slugGarage: string | null
  nomClient: string | null
  identifiant: string
  motDePasse: string
}): Promise<boolean> {
  // `?garage=<slug>` est INDISPENSABLE : la route de connexion exige un
  // `garageSlug` et refuse « Garage introuvable ou ambigu » sans lui. Le lien
  // était envoyé nu, si bien que le client ne pouvait pas se connecter même
  // avec les bons identifiants. Les helpers `lienPortail`/`avecGarageSlug` sont
  // côté navigateur (ils lisent `window`) : ici, le slug vient de la fiche
  // garage, seule source disponible côté serveur.
  const base = publicUrlFor(cheminPortail('login'))
  const urlConnexion = params.slugGarage
    ? `${base}${base.includes('?') ? '&' : '?'}garage=${encodeURIComponent(params.slugGarage)}`
    : base

  const message = messageAccesPortail({
    nomGarage: params.nomGarage,
    nomClient: params.nomClient,
    identifiant: params.identifiant,
    motDePasseTemporaire: params.motDePasse,
    urlConnexion,
  })
  const envoi = await sendGarageMail({
    garageId: params.garageId,
    to: params.identifiant,
    subject: message.subject,
    text: message.text,
  })
  if (!envoi.ok) {
    // `envoi.reason` est un code (SMTP absent, refus serveur…) — jamais le corps.
    logger.info('[portal/access] identifiants non envoyés par e-mail', { motif: envoi.reason })
  }
  return envoi.ok
}

/** Rôles autorisés à ouvrir ou couper un accès client. */
const ROLES_GESTION = new Set(['OWNER', 'MANAGER'])

/** Client du garage de la SESSION, ou `null`. Jamais `findUnique` par id seul. */
async function clientDuGarage(id: string, garageId: string) {
  return prisma.client.findFirst({ where: { id, garageId }, select: { id: true, name: true, email: true } })
}

/** Projection publique : ni haché, ni jeton, ni secret 2FA. */
function etat(acces: {
  id: string; email: string; disabledAt: Date | null; mustChangePassword: boolean
  passwordChangedAt: Date | null; lastLoginAt: Date | null; emailVerified: boolean
} | null) {
  if (!acces) return { exists: false as const }
  return {
    exists: true as const,
    identifiant: acces.email,
    actif: acces.disabledAt === null,
    motDePasseTemporaire: acces.mustChangePassword,
    emailVerifie: acces.emailVerified,
    derniereConnexion: acces.lastLoginAt,
    motDePasseDefiniLe: acces.passwordChangedAt,
  }
}

const CHAMPS = {
  id: true, email: true, disabledAt: true, mustChangePassword: true,
  passwordChangedAt: true, lastLoginAt: true, emailVerified: true,
} as const

export const GET = withAuth(async (_req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  const client = await clientDuGarage(params.id, session.user.garageId)
  if (!client) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  const acces = await prisma.portalUser.findFirst({
    where: { clientId: client.id, garageId: session.user.garageId },
    select: CHAMPS,
  })
  return NextResponse.json(etat(acces))
})

export const POST = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  if (!ROLES_GESTION.has(session.user.role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const client = await clientDuGarage(params.id, session.user.garageId)
  if (!client) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  const identifiant = identifiantDepuisClient(client)
  if (!identifiant.ok) {
    return NextResponse.json({ error: identifiant.message, code: identifiant.code }, { status: 409 })
  }

  const dejaLie = await prisma.portalUser.findFirst({
    where: { clientId: client.id, garageId: session.user.garageId },
    select: { id: true },
  })
  if (dejaLie) {
    return NextResponse.json(
      { error: 'Ce client a déjà un accès portail. Utilisez « Réinitialiser » pour lui remettre un mot de passe.', code: 'ACCESS_EXISTS' },
      { status: 409 },
    )
  }

  const motDePasse = genererMotDePasseTemporaire()
  const hash = await bcrypt.hash(motDePasse, 12)

  let cree
  try {
    cree = await prisma.portalUser.create({
      data: {
        garageId: session.user.garageId,
        clientId: client.id,
        email: identifiant.email,
        passwordHash: hash,
        name: client.name,
        // L'adresse vient de la fiche client tenue par le garage : elle n'a pas
        // à être re-vérifiée par un message avant que l'accès fonctionne.
        emailVerified: true,
        mustChangePassword: true,
      },
      select: CHAMPS,
    })
  } catch (err) {
    // Contrainte @@unique([garageId, email]) : une adresse déjà utilisée par un
    // AUTRE compte du même garage (auto-inscription antérieure, homonyme…).
    if ((err as { code?: string })?.code === 'P2002') {
      return NextResponse.json(
        { error: 'Un accès portail existe déjà avec cette adresse dans ce garage.', code: 'EMAIL_TAKEN' },
        { status: 409 },
      )
    }
    throw err
  }

  await logAudit({
    action: 'create', entityType: 'PortalUser', entityId: cree.id, session, req,
    details: { extra: { clientId: client.id } },
  })
  logger.info('[portal/access] accès ouvert', { client: client.id })

  // Le portail client est servi par le SERVICE EN LIGNE : un accès resté sur le
  // poste n'existe pour personne. On publie AVANT d'annoncer quoi que ce soit —
  // et l'issue est rendue, pour que l'écran ne dise jamais « communiquez le mot
  // de passe » alors que le client ne pourra pas s'en servir.
  const publication = await publierAccesPortail(cree.id)

  const garage = await prisma.garage.findUnique({
    where: { id: session.user.garageId },
    select: { name: true, slug: true },
  })
  // L'e-mail porte le lien de connexion : l'envoyer alors que le compte n'est
  // pas en ligne enverrait le client sur un refus. On s'abstient.
  const emailEnvoye = publication.publie
    ? await envoyerIdentifiants({
      garageId: session.user.garageId,
      nomGarage: garage?.name ?? 'Votre garage',
      slugGarage: garage?.slug ?? null,
      nomClient: client.name,
      identifiant: identifiant.email,
      motDePasse,
    })
    : false

  // Mot de passe en clair rendu UNE SEULE FOIS.
  return NextResponse.json({
    ...etat(cree),
    motDePasseTemporaireEnClair: motDePasse,
    emailEnvoye,
    publieEnLigne: publication.publie,
    motifPublication: publication.motif ?? null,
  }, { status: 201 })
})

export const PUT = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  if (!ROLES_GESTION.has(session.user.role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const client = await clientDuGarage(params.id, session.user.garageId)
  if (!client) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  const acces = await prisma.portalUser.findFirst({
    where: { clientId: client.id, garageId: session.user.garageId },
    select: { id: true },
  })
  if (!acces) return NextResponse.json({ error: 'Ce client n’a pas d’accès portail.', code: 'NO_ACCESS' }, { status: 404 })

  const motDePasse = genererMotDePasseTemporaire()
  const hash = await bcrypt.hash(motDePasse, 12)

  const [maj] = await prisma.$transaction([
    prisma.portalUser.update({
      where: { id: acces.id },
      data: {
        passwordHash: hash,
        mustChangePassword: true,
        passwordChangedAt: null,
        // Une réinitialisation est aussi le geste qui débloque un compte
        // verrouillé par des échecs de connexion.
        failedLoginCount: 0,
        lockedUntil: null,
      },
      select: CHAMPS,
    }),
    // TOUTES les sessions tombent, y compris celle de la personne qui détenait
    // l'ancien mot de passe — c'est précisément l'objet d'une réinitialisation.
    prisma.portalDevice.updateMany({
      where: { portalUserId: acces.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ])

  await logAudit({ action: 'update', entityType: 'PortalUser', entityId: acces.id, session, req, details: { extra: { reset: true } } })
  logger.info('[portal/access] accès réinitialisé', { client: client.id })

  // Republication : le nouveau haché doit atteindre le service, et les sessions
  // ouvertes en ligne tomber — sinon l'ancien mot de passe continue d'ouvrir le
  // portail alors que le garage croit l'avoir remplacé. C'est aussi le geste qui
  // rattrape une ouverture faite hors ligne.
  const publication = await publierAccesPortail(maj.id, { revoquerAppareils: true })

  const garage = await prisma.garage.findUnique({
    where: { id: session.user.garageId },
    select: { name: true, slug: true },
  })
  const emailEnvoye = publication.publie
    ? await envoyerIdentifiants({
      garageId: session.user.garageId,
      nomGarage: garage?.name ?? 'Votre garage',
      slugGarage: garage?.slug ?? null,
      nomClient: client.name,
      identifiant: maj.email,
      motDePasse,
    })
    : false

  return NextResponse.json({
    ...etat(maj),
    motDePasseTemporaireEnClair: motDePasse,
    emailEnvoye,
    publieEnLigne: publication.publie,
    motifPublication: publication.motif ?? null,
  })
})

export const PATCH = withAuth(async (req, { params }: { params: { id: string } }) => {
  const session = await requireSession()
  if (!ROLES_GESTION.has(session.user.role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  let corps: { actif?: unknown }
  try {
    corps = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
  }
  if (typeof corps.actif !== 'boolean') {
    return NextResponse.json({ error: '`actif` doit être un booléen.', code: 'VALIDATION_ERROR' }, { status: 400 })
  }

  const client = await clientDuGarage(params.id, session.user.garageId)
  if (!client) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  const acces = await prisma.portalUser.findFirst({
    where: { clientId: client.id, garageId: session.user.garageId },
    select: { id: true },
  })
  if (!acces) return NextResponse.json({ error: 'Ce client n’a pas d’accès portail.', code: 'NO_ACCESS' }, { status: 404 })

  const desactiver = corps.actif === false

  const [maj] = await prisma.$transaction([
    prisma.portalUser.update({
      where: { id: acces.id },
      data: { disabledAt: desactiver ? new Date() : null },
      select: CHAMPS,
    }),
    // Couper l'accès sans couper les sessions ouvertes ne couperait rien tant
    // qu'un cookie reste valide. La réactivation, elle, ne ressuscite aucune
    // session : le client se reconnecte.
    ...(desactiver
      ? [prisma.portalDevice.updateMany({
          where: { portalUserId: acces.id, revokedAt: null },
          data: { revokedAt: new Date() },
        })]
      : []),
  ])

  await logAudit({
    action: 'update', entityType: 'PortalUser', entityId: acces.id, session, req,
    details: { extra: { acces: desactiver ? 'desactive' : 'reactive' } },
  })
  logger.info('[portal/access] accès ' + (desactiver ? 'désactivé' : 'réactivé'), { client: client.id })

  // Une désactivation qui ne parvient pas au service ne coupe RIEN : c'est lui
  // qui sert le portail. On propage, et on coupe aussi les sessions en ligne.
  const publication = await publierAccesPortail(maj.id, { revoquerAppareils: desactiver })

  return NextResponse.json({
    ...etat(maj),
    publieEnLigne: publication.publie,
    motifPublication: publication.motif ?? null,
  })
})
