'use strict'
/**
 * FOURNISSEUR SMTP.
 *
 * Particularité de GarageFlows : il n'existe AUCUNE variable `SMTP_HOST`,
 * `SMTP_USER` ou `SMTP_PASSWORD`. Les paramètres d'envoi sont saisis dans
 * l'application et stockés en base, et le mot de passe y est chiffré avec
 * `GF_SMTP_CIPHER_KEY` (`src/lib/security/secret-cipher.ts`).
 *
 * Il en découle deux conséquences pour le configurateur :
 *
 *   · il n'y a pas de mot de passe SMTP à deviner — l'interdiction du cahier
 *     des charges est donc respectée par construction ;
 *   · `GF_SMTP_CIPHER_KEY` est la seule chose à vérifier, et c'est une clé de
 *     DÉCHIFFREMENT : la remplacer ne « répare » pas une configuration SMTP,
 *     elle rend définitivement illisible le mot de passe déjà enregistré.
 *     Le moteur la classe donc parmi les clés de données, hors génération
 *     automatique.
 */

const secrets = require('../security/secrets.js')

/**
 * Vérifie l'état du chiffrement SMTP pour un jeu de variables.
 *
 * @returns {{ cle: 'absente'|'presente-conforme'|'presente-non-conforme',
 *             anciennesCles: number, anomalies: string[], consequence: string }}
 */
function verifier(valeurs) {
  const cle = valeurs.GF_SMTP_CIPHER_KEY
  const anciennes = String(valeurs.GF_SMTP_CIPHER_KEY_OLD || '')
    .split(',')
    .map((element) => element.trim())
    .filter(Boolean)

  const anomalies = []
  for (const ancienne of anciennes) {
    if (!secrets.aesValide(ancienne)) anomalies.push('GF_SMTP_CIPHER_KEY_OLD : une ancienne clé n est pas une clé AES-256 base64 valide ; le déchiffrement de repli échouerait.')
  }

  if (!cle) {
    return {
      cle: 'absente',
      anciennesCles: anciennes.length,
      anomalies,
      consequence: 'Aucun mot de passe SMTP ne peut être déchiffré ni enregistré : l envoi de courriels reste indisponible. '
        + 'La clé n est pas créée automatiquement — si des identifiants SMTP sont déjà stockés, seule la clé d origine permet de les relire.',
    }
  }
  const controle = secrets.conforme('GF_SMTP_CIPHER_KEY', cle)
  return {
    cle: controle.conforme ? 'presente-conforme' : 'presente-non-conforme',
    anciennesCles: anciennes.length,
    anomalies: anomalies.concat(controle.anomalies),
    consequence: controle.conforme
      ? 'Le chiffrement des identifiants SMTP est opérationnel. Les paramètres d envoi eux-mêmes sont saisis dans l application et stockés en base.'
      : 'Clé présente mais non conforme : le déchiffrement échouera. Ne pas la remplacer sans disposer de l originale — les mots de passe déjà chiffrés deviendraient illisibles.',
  }
}

/**
 * Le configurateur ne teste pas l'envoi d'un courriel : les paramètres
 * (hôte, port, compte) vivent en base et dépendent du locataire. Déclarer
 * `SUCCESS` sur une configuration qu'on n'a pas pu joindre serait un faux
 * succès ; on renvoie donc un constat explicite.
 */
function limites() {
  return [
    'Les paramètres SMTP (hôte, port, compte, expéditeur) sont stockés en base par l application, pas dans l environnement : '
    + 'le configurateur ne peut ni les lire ni tester une connexion SMTP sans ouvrir la base du locataire concerné.',
    'Aucun mot de passe SMTP n est généré ni deviné.',
  ]
}

module.exports = { verifier, limites }
