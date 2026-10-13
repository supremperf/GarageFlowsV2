'use strict'
/**
 * Que DIRE quand l'enregistrement de cet appareil n'aboutit pas.
 *
 * POURQUOI CE MODULE EXISTE
 * La décision vivait au milieu du battement périodique de `main.js`, non
 * testable (le fichier charge `electron`), et elle mentait dans les trois cas
 * observés le 2026-08-08 dans le journal du poste de l'opérateur — les deux
 * premiers avec une clé mécanicien pas encore attribuée :
 *
 *   [license/activate] server refused — Cette clé n'est pas encore attribuée…
 *   [license/check]    5 tentatives d'enregistrement sans succès — autorité injoignable ?
 *
 *   1. « autorité injoignable ? » était journalisé alors que l'autorité venait
 *      de répondre, clairement et volontairement. Le garde anti-répétition du
 *      motif faisait tomber le contrôle dans la branche « injoignable » dès le
 *      deuxième battement : le diagnostic affirmait le contraire des faits.
 *   2. le refus était présenté à l'écran sous le statut `device_limit`, absent
 *      de la table de l'overlay, donc rendu par le repli `revoked` :
 *      « Compte révoqué — votre licence a été révoquée ». Une clé simplement
 *      pas encore attribuée annonçait une révocation.
 *
 *   3. plus tôt (19:39), le repli local délivrait un jeton à chaque battement
 *      pendant que l'autorité distante RÉPONDAIT et continuait d'exiger un
 *      enregistrement — et le message concluait, là encore, « injoignable ? ».
 *      Une autorité qui répond n'est pas injoignable.
 *
 * Un refus est ici une DÉCISION de l'autorité, jamais une panne. Ces situations
 * se disent différemment parce qu'elles appellent des gestes différents :
 * appeler le responsable du garage, ou attendre le retour du réseau. Elles sont
 * donc distinguées par ce qui les distingue vraiment : qui a répondu, et quoi.
 */

/** Statut d'overlay pour un refus d'activation. Distinct de `revoked`. */
const ACTIVATION_REFUSED = 'activation_refused'

/**
 * @param {object}  state
 * @param {?string} state.refusal        Motif du dernier refus EXPLICITE, ou null.
 * @param {number}  state.streak         Battements consécutifs sans enregistrement.
 * @param {?string} state.loggedRefusal  Motif déjà journalisé (anti-répétition).
 * @param {number}  state.warnAt         Seuil d'alerte.
 * @param {?string} state.authority      Autorité ayant délivré le jeton courant :
 *                                       'local' (repli), ou null si aucune n'a
 *                                       abouti. ('remote' ne parvient pas ici :
 *                                       le battement repart aussitôt.)
 * @returns {{ log: ?string, overlay: ?{status: string, reason: string}, loggedRefusal: ?string }}
 */
function activationReport({ refusal, streak, loggedRefusal, warnAt, authority = null }) {
  if (refusal) {
    // L'overlay est renvoyé à CHAQUE battement tant que le refus tient : c'est
    // idempotent côté rendu, et c'est la seule façon qu'il survive à un
    // rechargement de page — même raison que pour une licence bloquée. Le
    // JOURNAL, lui, ne répète pas le même motif.
    return {
      log: refusal === loggedRefusal ? null : `[license/check] activation refusée par l'autorité — ${refusal}`,
      overlay: { status: ACTIVATION_REFUSED, reason: refusal },
      loggedRefusal: refusal,
    }
  }

  // Aucun refus explicite. Après N battements d'affilée sans enregistrement
  // reconnu, on le signale UNE fois, sans bloquer l'utilisation — en nommant ce
  // qui s'est réellement produit plutôt qu'en supposant une panne réseau.
  if (streak === warnAt) {
    const cause = authority === 'local'
      ? 'le repli local délivre un jeton que l\'autorité distante ne reconnaît pas'
      : 'aucune autorité n\'a répondu — injoignable ?'
    return {
      log: `[license/check] ${streak} tentatives d'enregistrement sans succès — ${cause}`,
      overlay: null,
      loggedRefusal: null,
    }
  }

  return { log: null, overlay: null, loggedRefusal: loggedRefusal ?? null }
}

module.exports = { activationReport, ACTIVATION_REFUSED }
