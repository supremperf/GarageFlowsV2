/**
 * Connexion d'un GARAGE à sa plateforme agréée : lecture, écriture, effacement.
 *
 * Invariants tenus ici, une fois pour toutes, afin qu'aucune route n'ait à les
 * réimplémenter :
 *
 *  - les identifiants sont chiffrés AU REPOS (AES-256-GCM, `credentials-cipher`)
 *    et ne sont déchiffrés que côté serveur, à l'instant de l'appel ;
 *  - ils ne sont JAMAIS renvoyés au client, même tronqués : la projection
 *    publique ne contient que des champs de configuration (§87) ;
 *  - toute lecture est bornée au `garageId` de l'appelant — un identifiant de
 *    connexion n'est jamais une clé d'accès suffisante ;
 *  - un secret retiré cesse immédiatement d'être utilisable : le cache de jetons
 *    OAuth2 de l'adaptateur est purgé à la déconnexion comme à la mise à jour.
 */

import { serverPrisma } from '@/lib/db'
import { encryptCredential, decryptCredential, currentKeyVersion } from './credentials-cipher'
import {
  CHAMPS_PUBLICS,
  CHAMPS_SECRETS,
  oublierJetons,
  type GenericPaCredentials,
} from './adapters/generic-pa'

export type EInvoiceEnvironment = 'sandbox' | 'production'

export interface ConnexionPublique {
  id: string
  providerId: string
  environment: EInvoiceEnvironment
  status: string
  authMethod: string | null
  lastTestedAt: string | null
  lastTestOk: boolean
  /** Configuration NON secrète, réaffichée pour diagnostic. */
  settings: Record<string, string>
  /** Quels secrets sont renseignés — jamais leur valeur. */
  secretsPresents: string[]
}

/** Projection publique : ce qui peut sortir du serveur, et rien d'autre. */
export function projeter(
  ligne: {
    id: string; providerId: string; environment: string; status: string
    authMethod: string | null; lastTestedAt: Date | null; lastTestOk: boolean
    credentials: string | null
  },
  clair: GenericPaCredentials | null,
): ConnexionPublique {
  const settings: Record<string, string> = {}
  for (const champ of CHAMPS_PUBLICS) {
    const v = clair?.[champ]
    if (typeof v === 'string' && v) settings[champ] = v
  }
  return {
    id: ligne.id,
    providerId: ligne.providerId,
    environment: ligne.environment as EInvoiceEnvironment,
    status: ligne.status,
    authMethod: ligne.authMethod,
    lastTestedAt: ligne.lastTestedAt ? ligne.lastTestedAt.toISOString() : null,
    lastTestOk: ligne.lastTestOk,
    settings,
    secretsPresents: CHAMPS_SECRETS.filter((c) => typeof clair?.[c] === 'string' && clair[c]),
  }
}

/** Déchiffre l'enveloppe d'une connexion. `null` si absente ou illisible. */
export function dechiffrer(enveloppe: string | null): GenericPaCredentials | null {
  if (!enveloppe) return null
  try {
    return JSON.parse(decryptCredential(enveloppe)) as GenericPaCredentials
  } catch {
    // Clé absente ou modifiée : on ne devine pas, on signale l'absence.
    return null
  }
}

/** Connexion du garage pour un environnement donné, ou `null`. */
export async function lireConnexion(garageId: string, environment: EInvoiceEnvironment) {
  return serverPrisma().garageEInvoiceConnection.findFirst({ where: { garageId, environment } })
}

/**
 * Enregistre (ou met à jour) la connexion.
 *
 * Les secrets ABSENTS du corps reçu sont CONSERVÉS depuis l'enregistrement
 * existant : l'interface ne les réaffiche pas, donc ne peut pas les renvoyer.
 * Sans cette fusion, modifier une simple URL effacerait la clé API.
 */
export async function enregistrerConnexion(input: {
  garageId: string
  providerId: string
  environment: EInvoiceEnvironment
  credentials: Partial<GenericPaCredentials>
}): Promise<{ id: string; clair: GenericPaCredentials }> {
  const existante = await lireConnexion(input.garageId, input.environment)
  const precedent = dechiffrer(existante?.credentials ?? null)

  const fusion = { ...(precedent ?? {}), ...input.credentials } as GenericPaCredentials
  for (const champ of CHAMPS_SECRETS) {
    const fourni = input.credentials[champ]
    if (typeof fourni !== 'string' || fourni === '') {
      const ancien = precedent?.[champ]
      if (typeof ancien === 'string') (fusion as unknown as Record<string, unknown>)[champ] = ancien
      else delete (fusion as unknown as Record<string, unknown>)[champ]
    }
  }

  const enveloppe = encryptCredential(JSON.stringify(fusion))
  const donnees = {
    providerId: input.providerId,
    environment: input.environment,
    authMethod: fusion.authMode ?? null,
    credentials: enveloppe,
    credentialsKeyVersion: currentKeyVersion(),
    // Une configuration modifiée n'est PAS réputée testée : le drapeau retombe.
    status: 'pending',
    lastTestOk: false,
  }

  const ligne = existante
    ? await serverPrisma().garageEInvoiceConnection.update({ where: { id: existante.id }, data: donnees })
    : await serverPrisma().garageEInvoiceConnection.create({ data: { garageId: input.garageId, ...donnees } })

  // Un jeton obtenu avec les identifiants précédents ne doit plus servir.
  oublierJetons(`${input.garageId}:${input.providerId}:${input.environment}`)
  return { id: ligne.id, clair: fusion }
}

/** Supprime la connexion et invalide immédiatement tout jeton en cache. */
export async function supprimerConnexion(
  garageId: string,
  environment: EInvoiceEnvironment,
): Promise<boolean> {
  const existante = await lireConnexion(garageId, environment)
  if (!existante) return false
  await serverPrisma().garageEInvoiceConnection.delete({ where: { id: existante.id } })
  oublierJetons(`${garageId}:${existante.providerId}:${environment}`)
  return true
}
