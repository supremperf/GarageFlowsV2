/**
 * Chemins du PORTAIL CLIENT — source de vérité unique.
 *
 * ─── L'écart corrigé (GF-FINAL-001) ─────────────────────────────────────────
 * L'URL officielle du portail client est `https://app.garageflows.fr/clients`.
 * Le code servait les pages sous `/portal/*`, et ce préfixe était réécrit en dur
 * dans onze endroits : les cinq pages du portail, la redirection de vérification
 * d'e-mail, les trois générateurs de liens tokenisés (dont celui des QR codes et
 * celui de la synchronisation poste → cloud), le middleware et le masquage des
 * journaux. Aucune réécriture n'existait dans `next.config.mjs` : tout lien
 * `…/clients/login` communiqué à un client tombait donc sur un 404.
 *
 * Le préfixe vit désormais ICI, et nulle part ailleurs. Les liens déjà diffusés
 * (QR codes imprimés, e-mails et SMS envoyés) restent valides grâce à une
 * redirection permanente `/portal/* → /clients/*` déclarée dans
 * `next.config.mjs` — c'est la raison d'être de `PORTAIL_BASE_HERITE`.
 */

/** Préfixe OFFICIEL du portail client. Ne pas écrire « /clients » ailleurs. */
export const PORTAIL_BASE = '/clients'

/**
 * Ancien préfixe, conservé UNIQUEMENT pour la redirection de compatibilité et
 * pour le masquage des journaux historiques. Aucun lien neuf ne doit l'employer.
 */
export const PORTAIL_BASE_HERITE = '/portal'

/**
 * Chemin d'une page du portail.
 *   cheminPortail()          → '/clients'
 *   cheminPortail('login')   → '/clients/login'
 *   cheminPortail('/login')  → '/clients/login'
 */
export function cheminPortail(sousChemin = ''): string {
  const s = sousChemin.replace(/^\/+/, '')
  return s ? `${PORTAIL_BASE}/${s}` : PORTAIL_BASE
}

/**
 * Chemin d'un lien tokenisé (celui que le garage communique à son client :
 * e-mail, SMS, QR code). Le jeton n'est jamais encodé deux fois : il est produit
 * en base64url, donc déjà sûr en URL.
 */
export function cheminPortailToken(token: string): string {
  return `${PORTAIL_BASE}/${token}`
}
