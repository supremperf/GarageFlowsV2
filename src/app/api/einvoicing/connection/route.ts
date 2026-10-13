export const dynamic = 'force-dynamic'

/**
 * Connexion du garage à sa plateforme agréée.
 *
 *   GET    — état de la connexion (JAMAIS les secrets)
 *   PUT    — enregistre / met à jour la configuration et les identifiants
 *   DELETE — déconnecte
 *
 * Sécurité :
 *  - réservé à OWNER/MANAGER (`settings:manage`) — un mécanicien ou un
 *    réceptionniste ne configure pas la facturation réglementaire (§20) ;
 *  - le `garageId` vient de la session, jamais du corps : une connexion n'est
 *    lisible et modifiable que par SON garage (§17) ;
 *  - les identifiants sont chiffrés au repos et ne ressortent jamais (§87) ;
 *  - l'environnement est verrouillé sur « sandbox » tant que `sandboxOnly` est
 *    vrai — aucune transmission réelle par mégarde (§99).
 */

import { NextResponse } from 'next/server'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { can } from '@/lib/authz'
import { getEInvoicingFlags } from '@/lib/einvoicing/flags'
import {
  dechiffrer, enregistrerConnexion, lireConnexion, projeter, supprimerConnexion,
  type EInvoiceEnvironment,
} from '@/lib/einvoicing/connection'
import { GENERIC_PA_ADAPTER_ID } from '@/lib/einvoicing/registry'
import type { GenericPaCredentials } from '@/lib/einvoicing/adapters/generic-pa'
import { serverPrisma, isPostgresDatabase } from '@/lib/db'
import { relayerVersCloud } from '@/lib/einvoicing/desktop-bridge'
import { logger } from '@/lib/logger'

/** Environnement effectif : la configuration ne peut pas forcer la production. */
function environnement(): EInvoiceEnvironment {
  return getEInvoicingFlags().defaultEnvironment
}


/**
 * La facturation électronique vit UNIQUEMENT côté serveur : ses quatre modèles
 * n'existent que dans le schéma PostgreSQL (dérogation documentée). Sur une
 * installation poste (SQLite), `serverPrisma()` lève.
 *
 * Cette route répondait donc 501 SERVER_ONLY — motif exact, conséquence
 * inacceptable : la fonctionnalité était annoncée et inaccessible à qui
 * travaille sur un poste, c'est-à-dire à tous les garages.
 *
 * La garde `isPostgresDatabase()` est CONSERVÉE (la retirer remplacerait une
 * erreur claire par un 500 opaque) ; ce qu'elle déclenche a changé : le poste
 * délègue au service en ligne par le canal licence, au lieu de refuser.
 */

function refusRole() {
  return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
}

/** La gestion des connexions doit être explicitement activée. */
function refusDrapeau() {
  return NextResponse.json(
    { error: 'La gestion des connexions de facturation électronique est désactivée.', code: 'FEATURE_DISABLED' },
    { status: 409 },
  )
}

export const GET = withAuth(async () => {
  const session = await requireSession()
  if (!can(session.user.role, 'settings:manage')) return refusRole()
  // Poste : les modèles n'existent qu'en PostgreSQL — on délègue au service en
  // ligne au lieu de répondre 501 (cf. src/lib/einvoicing/desktop-bridge.ts).
  if (!isPostgresDatabase()) return relayerVersCloud(session.user.garageId, 'connection.get')

  const env = environnement()
  const ligne = await lireConnexion(session.user.garageId, env)
  if (!ligne) return NextResponse.json({ connection: null, environment: env })
  return NextResponse.json({
    connection: projeter(ligne, dechiffrer(ligne.credentials)),
    environment: env,
  })
})

export const PUT = withAuth(async (req) => {
  const session = await requireSession()
  if (!can(session.user.role, 'settings:manage')) return refusRole()

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Corps invalide' }, { status: 400 })
  }

  // Poste : la validation et le CHIFFREMENT des identifiants restent côté
  // cloud, exécutés une seule fois. Rien n'est stocké en clair sur le poste.
  //
  // Cette délégation précède le contrôle du drapeau, et ce n'est pas un oubli :
  // un poste n'a JAMAIS les variables `EINVOICING_*` (le reset ne les
  // provisionne pas — cf. flags.ts), donc `connectionsEnabled` y vaut toujours
  // faux. Tester le drapeau LOCAL avant de déléguer rendait le tunnel
  // inatteignable : aucun garage installé ne pouvait enregistrer sa plateforme,
  // alors que DELETE, lui, déléguait déjà avant le contrôle — on pouvait donc
  // détruire une connexion sans jamais pouvoir la ressaisir. C'est le SERVICE
  // qui décide, et il applique sa propre garde (`/api/sync/einvoicing`,
  // action `connection.put`).
  if (!isPostgresDatabase()) return relayerVersCloud(session.user.garageId, 'connection.put', body)

  if (!getEInvoicingFlags().connectionsEnabled) return refusDrapeau()

  const chaine = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined

  const credentials: Partial<GenericPaCredentials> = {
    authMode: body.authMode === 'api_key' ? 'api_key' : body.authMode === 'oauth2' ? 'oauth2' : undefined,
    apiBaseUrl: chaine(body.apiBaseUrl),
    submitPath: chaine(body.submitPath),
    statusPath: chaine(body.statusPath),
    tokenUrl: chaine(body.tokenUrl),
    clientId: chaine(body.clientId),
    clientSecret: chaine(body.clientSecret),
    scope: chaine(body.scope),
    apiKeyHeader: chaine(body.apiKeyHeader),
    apiKey: chaine(body.apiKey),
    extraHeaderName: chaine(body.extraHeaderName),
    extraHeaderValue: chaine(body.extraHeaderValue),
  }

  const env = environnement()
  try {
    const { id, clair } = await enregistrerConnexion({
      garageId: session.user.garageId,
      providerId: chaine(body.providerId) ?? GENERIC_PA_ADAPTER_ID,
      environment: env,
      credentials,
    })

    await serverPrisma().eInvoiceAuditEvent.create({
      data: {
        garageId: session.user.garageId, actorUserId: session.user.id, action: 'connect',
        targetType: 'GarageEInvoiceConnection', targetId: id,
        // Aucun secret : uniquement de quoi tracer l'acte.
        metadata: JSON.stringify({ environment: env, authMode: clair.authMode ?? null }),
      },
    })

    const ligne = await lireConnexion(session.user.garageId, env)
    return NextResponse.json({ ok: true, connection: ligne ? projeter(ligne, clair) : null })
  } catch (err) {
    // `encryptCredential` lève si GF_EINVOICE_CREDENTIALS_KEY manque : on refuse
    // plutôt que d'écrire un identifiant en clair (§87).
    logger.error('[einvoicing/connection] enregistrement impossible', err)
    return NextResponse.json(
      {
        error: 'Chiffrement des identifiants indisponible : configurez GF_EINVOICE_CREDENTIALS_KEY.',
        code: 'CIPHER_UNAVAILABLE',
      },
      { status: 503 },
    )
  }
})

export const DELETE = withAuth(async () => {
  const session = await requireSession()
  if (!can(session.user.role, 'settings:manage')) return refusRole()
  if (!isPostgresDatabase()) return relayerVersCloud(session.user.garageId, 'connection.delete')
  // Le drapeau ne gardait que l'écriture. Fonctionnalité coupée, on pouvait donc
  // encore DÉTRUIRE les identifiants d'une plateforme — sans pouvoir les
  // ressaisir ensuite, puisque le PUT, lui, était fermé. Un interrupteur qui
  // laisse passer la destruction n'est pas un interrupteur.
  if (!getEInvoicingFlags().connectionsEnabled) return refusDrapeau()

  const env = environnement()
  const supprimee = await supprimerConnexion(session.user.garageId, env)
  if (supprimee) {
    await serverPrisma().eInvoiceAuditEvent.create({
      data: {
        garageId: session.user.garageId, actorUserId: session.user.id, action: 'disconnect',
        targetType: 'GarageEInvoiceConnection', metadata: JSON.stringify({ environment: env }),
      },
    })
  }
  return NextResponse.json({ ok: true, disconnected: supprimee })
})
