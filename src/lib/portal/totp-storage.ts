/**
 * Stockage du secret TOTP du portail — chiffré au repos (GF-DUR-022).
 *
 * ─── Le constat ─────────────────────────────────────────────────────────────
 * `twoFactorSecret` et `twoFactorPending` étaient écrits EN CLAIR dans la base.
 * Un secret TOTP n'est pas un mot de passe : le serveur doit pouvoir le relire
 * pour vérifier les codes, un haché ne conviendrait donc pas. Mais « non
 * hachable » ne veut pas dire « à laisser en clair » : qui obtient un instantané
 * de la base — copie, sauvegarde, export, accès en lecture — obtient de quoi
 * générer indéfiniment les codes valides de tous les comptes protégés. Le second
 * facteur cesse alors d'en être un, sans que personne ne s'en aperçoive.
 *
 * La sauvegarde automatique du poste et l'export quotidien emportent la base :
 * ces fichiers-là contenaient donc aussi les secrets.
 *
 * ─── Pourquoi c'est corrigeable sans risque MAINTENANT ──────────────────────
 * Aucun écran n'a jamais permis d'activer la double authentification. Il n'y a
 * donc, à ce jour, aucun compte enrôlé à migrer — la fenêtre idéale pour changer
 * le format de stockage. La lecture reste néanmoins tolérante aux valeurs en
 * clair (`decryptSecret` les rend telles quelles), pour qu'une base ayant
 * échappé à ce raisonnement continue de fonctionner.
 *
 * ─── Fail-closed à l'écriture ───────────────────────────────────────────────
 * Sans clé de chiffrement configurée, l'enrôlement est REFUSÉ plutôt que rabattu
 * sur un stockage en clair. Un repli silencieux donnerait à l'utilisateur un
 * second facteur qu'il croit protéger son compte, et qui ne le protège pas.
 */

import {
  encryptSecret,
  decryptSecret,
  secretCipherConfigured,
  isEncryptedSecret,
} from '@/lib/security/secret-cipher'

/** Levée quand l'enrôlement est demandé sans clé de chiffrement disponible. */
export class SecretTotpNonProtegeable extends Error {
  constructor() {
    super(
      'La double authentification exige une clé de chiffrement des secrets au repos. '
      + 'Configurez GF_SMTP_CIPHER_KEY (« openssl rand -base64 32 ») avant de l’activer.',
    )
    this.name = 'SecretTotpNonProtegeable'
  }
}

/** Le déploiement peut-il protéger un secret TOTP au repos ? */
export function peutProtegerSecretTotp(): boolean {
  return secretCipherConfigured()
}

/**
 * Forme STOCKABLE d'un secret TOTP.
 * Lève {@link SecretTotpNonProtegeable} plutôt que d'écrire en clair.
 */
export function protegerSecretTotp(secretBase32: string): string {
  if (!secretCipherConfigured()) throw new SecretTotpNonProtegeable()
  return encryptSecret(secretBase32)
}

/**
 * Secret TOTP utilisable, à partir de la valeur stockée.
 *
 * Une valeur non marquée est un enregistrement ANTÉRIEUR au chiffrement : elle
 * est rendue telle quelle, sans quoi les comptes déjà enrôlés cesseraient de
 * pouvoir se connecter — un verrouillage bien pire que le défaut corrigé.
 */
export function lireSecretTotp(stocke: string | null | undefined): string | null {
  return decryptSecret(stocke)
}

/** Un secret stocké est-il déjà protégé ? (diagnostic, migration) */
export function secretTotpProtege(stocke: string | null | undefined): boolean {
  return isEncryptedSecret(stocke)
}
