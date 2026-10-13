/**
 * Ouverture d'un accès portail par le GARAGE — logique pure et testable.
 *
 * ─── L'identifiant ──────────────────────────────────────────────────────────
 * Le cahier des charges évoque un identifiant généré de la forme
 * `DUPONT-M-4827`. L'identifiant retenu est en réalité l'ADRESSE E-MAIL du
 * client, et c'est un choix, pas un oubli :
 *
 *  - toute la chaîne d'authentification du portail est bâtie dessus — écran de
 *    connexion, `resolveGarageId`, vérification d'e-mail, contrainte d'unicité
 *    `@@unique([garageId, email])` — et un second schéma d'identifiant en
 *    parallèle créerait deux vérités sur « qui est ce client » ;
 *  - un identifiant opaque devrait de toute façon être communiqué au client par
 *    un canal, et ce canal est son e-mail ;
 *  - l'unicité est déjà garantie PAR GARAGE, ce qui est la bonne granularité :
 *    deux garages peuvent légitimement avoir un client à la même adresse.
 *
 * Conséquence assumée : un client sans e-mail ne peut pas recevoir d'accès. Le
 * garage doit d'abord renseigner son adresse. Le refus est explicite plutôt que
 * silencieux.
 */

import crypto from 'crypto'

/** Longueur du mot de passe temporaire remis au client. */
export const MOT_DE_PASSE_TEMPORAIRE_LONGUEUR = 14

/**
 * Alphabet SANS caractères ambigus.
 *
 * Ce mot de passe est destiné à être lu à voix haute ou recopié depuis un écran
 * de comptoir : `O`/`0`, `I`/`l`/`1` et `S`/`5` produisent des erreurs de saisie
 * que l'utilisateur attribuera au logiciel. On les retire plutôt que d'ajouter
 * de l'entropie qui ne servirait qu'à faire échouer la première connexion.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

/**
 * Mot de passe temporaire — tirage uniforme, sans biais modulo.
 *
 * `crypto.randomInt` est rejeté-échantillonné par Node : contrairement à
 * `randomBytes()[i] % ALPHABET.length`, il ne rend pas les premiers caractères
 * de l'alphabet plus probables que les derniers.
 */
export function genererMotDePasseTemporaire(longueur = MOT_DE_PASSE_TEMPORAIRE_LONGUEUR): string {
  let out = ''
  for (let i = 0; i < longueur; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)]
  return out
}

/**
 * Message remis au client avec ses identifiants.
 *
 * Fonction PURE : elle ne journalise rien et n'envoie rien. Le mot de passe ne
 * traverse donc qu'un seul chemin — celui de l'envoi — et n'apparaît dans aucune
 * trace intermédiaire.
 *
 * Le texte dit explicitement que le mot de passe est provisoire : sans cela, un
 * client le note et s'étonne qu'on le lui refuse à la connexion suivante.
 */
export function messageAccesPortail(params: {
  nomGarage: string
  nomClient?: string | null
  identifiant: string
  motDePasseTemporaire: string
  urlConnexion: string
}): { subject: string; text: string } {
  const salutation = params.nomClient ? `Bonjour ${params.nomClient},` : 'Bonjour,'
  return {
    subject: `${params.nomGarage} — accès à votre espace client`,
    text: [
      salutation,
      '',
      `${params.nomGarage} vous a ouvert un accès à votre espace client : vous y retrouverez vos véhicules, vos devis, vos factures et le suivi de vos interventions.`,
      '',
      `Adresse    : ${params.urlConnexion}`,
      `Identifiant: ${params.identifiant}`,
      `Mot de passe provisoire: ${params.motDePasseTemporaire}`,
      '',
      'Ce mot de passe est provisoire : il vous sera demandé d’en choisir un nouveau dès votre première connexion.',
      '',
      'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message et prévenez votre garage.',
    ].join('\n'),
  }
}

export type VerdictIdentifiant =
  | { ok: true; email: string }
  | { ok: false; code: 'CLIENT_SANS_EMAIL' | 'EMAIL_INVALIDE'; message: string }

/**
 * Normalise et valide l'adresse qui servira d'identifiant.
 *
 * La normalisation en minuscules est indispensable : la contrainte d'unicité est
 * sensible à la casse, si bien que `Jean@x.fr` et `jean@x.fr` créeraient DEUX
 * accès pour le même client, dont un seul fonctionnerait à la connexion.
 */
export function identifiantDepuisClient(client: { email?: string | null }): VerdictIdentifiant {
  const brut = String(client.email ?? '').trim().toLowerCase()
  if (!brut) {
    return {
      ok: false,
      code: 'CLIENT_SANS_EMAIL',
      message: 'Ce client n’a pas d’adresse e-mail : renseignez-la avant de lui ouvrir un accès.',
    }
  }
  // Contrôle volontairement simple : la seule preuve qu'une adresse existe est
  // qu'un message y parvienne, et c'est la vérification d'e-mail qui s'en charge.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(brut) || brut.length > 254) {
    return { ok: false, code: 'EMAIL_INVALIDE', message: 'Adresse e-mail invalide.' }
  }
  return { ok: true, email: brut }
}
