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
  chiffrerSecretTotp,
  dechiffrerSecretTotp,
  cleTotpConfiguree,
  estChiffreTotp,
} from './totp-crypto'

/** Levée quand l'enrôlement est demandé sans clé de chiffrement disponible. */
export class SecretTotpNonProtegeable extends Error {
  constructor() {
    super(
      'La double authentification exige une clé de chiffrement des secrets au repos. '
      + 'Configurez GF_TOTP_ENC_KEY (« openssl rand -base64 32 ») avant de l’activer. '
      + 'Elle est distincte de GF_SMTP_CIPHER_KEY à dessein.',
    )
    this.name = 'SecretTotpNonProtegeable'
  }
}

/** Le déploiement peut-il protéger un secret TOTP au repos ? */
export function peutProtegerSecretTotp(): boolean {
  return cleTotpConfiguree()
}

/**
 * Forme STOCKABLE d'un secret TOTP.
 * Lève {@link SecretTotpNonProtegeable} plutôt que d'écrire en clair.
 */
export function protegerSecretTotp(secretBase32: string): string {
  if (!cleTotpConfiguree()) throw new SecretTotpNonProtegeable()
  return chiffrerSecretTotp(secretBase32)
}

/**
 * Secret TOTP utilisable, à partir de la valeur stockée — ou `null`.
 *
 * ─── Pourquoi AUCUN repli sur le clair ──────────────────────────────────────
 * Première version : une valeur non marquée était rendue telle quelle, « pour ne
 * pas verrouiller un compte déjà enrôlé ». Ce raisonnement ne tient pas, et il
 * ouvrait une porte.
 *
 * Il ne tient pas, parce que l'enrôlement n'a jamais été offert par aucune
 * interface : ni `/2fa/setup` ni `/2fa/enable` n'ont jamais eu d'appelant, à
 * aucun moment de l'historique. Un secret en clair ne peut provenir que d'une
 * requête forgée à la main.
 *
 * Il ouvrait une porte, parce qu'accepter le clair rend le système PLUS
 * permissif sur un format non reconnu : qui obtient une écriture en base
 * remplace le chiffré par un secret en clair qu'il choisit, et passe le second
 * facteur avec ses propres codes. Le chiffrement ne protégeait alors plus que la
 * lecture.
 *
 * ─── Et ce refus n'enferme personne ─────────────────────────────────────────
 * Les CODES DE SECOURS sont hachés à part et restent valides : un compte dont le
 * secret devient illisible se connecte avec l'un d'eux, puis réactive sa double
 * authentification. La voie de récupération existe, et elle est éprouvée.
 */
export function lireSecretTotp(stocke: string | null | undefined): string | null {
  // `dechiffrerSecretTotp` rend déjà `null` — jamais une exception ni une valeur
  // devinée — pour : marqueur absent (clair, ou cryptogramme d'un AUTRE
  // domaine), structure invalide, clé absente, aucune clé ne convenant,
  // authentification GCM en échec.
  return dechiffrerSecretTotp(stocke)
}

/** Un secret stocké est-il déjà protégé ? (diagnostic, migration) */
export function secretTotpProtege(stocke: string | null | undefined): boolean {
  return estChiffreTotp(stocke)
}
