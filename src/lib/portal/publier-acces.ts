/**
 * Publication POSTE → CLOUD d'un accès client au portail.
 *
 * Le portail client est servi par le SERVICE EN LIGNE : c'est sa base que
 * `/api/portal/auth/login` interroge. Un accès créé sur un poste et gardé sur le
 * poste n'existe donc pour personne — le serveur local n'écoute que sur
 * 127.0.0.1, et aucun client ne peut l'atteindre.
 *
 * Ce module ne décide de rien : il transporte l'état local vers le cloud et
 * REND l'issue. C'est l'appelant qui doit en tirer les conséquences — et
 * surtout ne pas annoncer « accès prêt, communiquez le mot de passe » quand la
 * publication a échoué.
 *
 * Le mot de passe en clair ne passe JAMAIS par ici : seul le haché bcrypt, que
 * le cloud doit de toute façon stocker.
 */
import { prisma } from '@/lib/db'
import { cloudPost, garageLicenseToken, isDesktopInstance } from '@/lib/sync/cloud-client'
import { logger } from '@/lib/logger'

export interface IssuePublication {
  /** L'accès est-il utilisable par le client, en ligne, maintenant ? */
  publie: boolean
  /**
   * Pourquoi il ne l'est pas — destiné à l'écran du garage, pas au client :
   *   SANS_OBJET          le service est lui-même le cloud (rien à publier)
   *   LICENCE_ABSENTE     aucune licence garage active sur ce poste
   *   HORS_LIGNE          service en ligne injoignable
   *   EMAIL_TAKEN_CLOUD   cette adresse a déjà un accès en ligne
   *   REFUS               refus métier du service
   */
  motif?: 'SANS_OBJET' | 'LICENCE_ABSENTE' | 'HORS_LIGNE' | 'EMAIL_TAKEN_CLOUD' | 'REFUS'
}

/**
 * Publie l'état ACTUEL d'un accès, relu en base — jamais une valeur reconstruite
 * de mémoire, qui pourrait diverger de ce qui a réellement été écrit.
 *
 * `revoquerAppareils` : à poser sur une réinitialisation de mot de passe et sur
 * une désactivation. Couper l'accès sans couper les sessions ouvertes ne
 * couperait rien tant qu'un cookie reste valide.
 */
export async function publierAccesPortail(
  portalUserId: string,
  options: { revoquerAppareils?: boolean } = {},
): Promise<IssuePublication> {
  // Sur le déploiement cloud, l'écriture locale EST l'écriture de référence.
  if (!isDesktopInstance()) return { publie: true, motif: 'SANS_OBJET' }

  const compte = await prisma.portalUser.findUnique({
    where: { id: portalUserId },
    select: {
      id: true, garageId: true, email: true, passwordHash: true, name: true,
      emailVerified: true, mustChangePassword: true, disabledAt: true, passwordChangedAt: true,
    },
  })
  if (!compte) return { publie: false, motif: 'REFUS' }

  const licence = await garageLicenseToken(compte.garageId)
  if (!licence) {
    logger.info('[portal/publication] aucune licence garage : accès non publié')
    return { publie: false, motif: 'LICENCE_ABSENTE' }
  }

  const sortie = await cloudPost('/api/sync/portal-account', {
    garageLicense: licence,
    revoquerAppareils: options.revoquerAppareils === true,
    account: {
      id: compte.id,
      email: compte.email,
      // Haché bcrypt — le mot de passe en clair ne quitte pas la réponse rendue
      // une seule fois au garage.
      passwordHash: compte.passwordHash,
      name: compte.name,
      emailVerified: compte.emailVerified,
      mustChangePassword: compte.mustChangePassword,
      disabledAt: compte.disabledAt ? compte.disabledAt.toISOString() : null,
      passwordChangedAt: compte.passwordChangedAt ? compte.passwordChangedAt.toISOString() : null,
    },
  })

  if (sortie.ok) return { publie: true }

  if (sortie.code === 'NETWORK' || sortie.code === 'TIMEOUT') {
    logger.info('[portal/publication] service en ligne injoignable')
    return { publie: false, motif: 'HORS_LIGNE' }
  }
  const code = (sortie.data as { code?: unknown } | undefined)?.code
  if (code === 'EMAIL_TAKEN_CLOUD') return { publie: false, motif: 'EMAIL_TAKEN_CLOUD' }

  logger.warn('[portal/publication] refusée par le service', { statut: sortie.status ?? 0 })
  return { publie: false, motif: 'REFUS' }
}
