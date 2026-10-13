'use strict'
/**
 * QUAND retenter l'enregistrement de cet appareil après un refus.
 *
 * POURQUOI CE MODULE EXISTE
 * `activation-report.js` a réglé ce qu'il faut DIRE lors d'un refus. Restait ce
 * qu'il faut FAIRE : rien ne l'empêchait de retenter à chaque battement, pour
 * toujours. Observé le 2026-08-08 sur le poste de l'opérateur, clé mécanicien
 * non attribuée — les deux autorités refusant la même chose :
 *
 *   22:09:38 [license/activate] server refused — remote — Cette clé n'est pas…
 *   22:09:38 [license/activate] server refused — local  — Cette clé n'est pas…
 *   22:10:06 [license/activate] server refused — local  — Cette clé n'est pas…
 *   22:10:07 [license/activate] server refused — local  — Cette clé n'est pas…
 *
 * Le correctif précédent n'empêchait le repli local QUE derrière un refus
 * distant. Ici les DEUX autorités refusent : plus rien ne borne les tentatives,
 * et le cycle repart à chaque battement — sur les deux serveurs à la fois.
 *
 * Or un refus explicite n'est pas une panne passagère : c'est une décision qui
 * ne changera pas tant qu'un humain n'aura pas agi (attribuer la clé, libérer
 * un appareil, contacter le revendeur). Marteler les serveurs entre-temps
 * n'apporte rien et masque les vrais incidents dans le journal.
 *
 * On espace donc les tentatives, sans jamais les abandonner : la situation PEUT
 * se débloquer côté serveur sans que l'application le sache, et l'utilisateur
 * doit alors repartir tout seul. Le premier réessai reste rapproché pour ne pas
 * pénaliser une correction immédiate ; l'écart croît ensuite.
 *
 * Ce module est PUR (aucune horloge, aucun état caché) : `now` est fourni par
 * l'appelant, ce qui le rend intégralement testable — contrairement à la
 * logique qu'il remplace, enfouie dans `main.js` qui charge `electron`.
 */

/**
 * Écart avant le n-ième réessai suivant un refus explicite.
 * 1 min, 5 min, 15 min, puis 1 h — plafonné.
 */
const BACKOFF_STEPS_MS = [60_000, 300_000, 900_000, 3_600_000]

/**
 * @param {number} refusalStreak  Refus explicites CONSÉCUTIFS (1 pour le premier).
 * @returns {number} délai en millisecondes avant la prochaine tentative.
 */
function backoffDelayMs(refusalStreak) {
  const rank = Math.min(Math.max(Math.trunc(refusalStreak), 1), BACKOFF_STEPS_MS.length)
  return BACKOFF_STEPS_MS[rank - 1]
}

/**
 * Faut-il tenter un enregistrement maintenant ?
 *
 * @param {object}  state
 * @param {boolean} state.refused  Un refus explicite est-il en cours ?
 * @param {?number} state.retryAt  Horodatage du prochain réessai autorisé, ou null.
 * @param {number}  state.now      Horodatage courant (injecté — module pur).
 * @returns {boolean}
 */
function shouldAttemptActivation({ refused, retryAt, now }) {
  // Aucun refus en cours → le comportement normal s'applique, sans délai :
  // une autorité injoignable doit continuer d'être sondée à chaque battement.
  if (!refused) return true
  if (retryAt === null || retryAt === undefined) return true
  return now >= retryAt
}

/**
 * État suivant après un refus explicite.
 *
 * @param {object} state
 * @param {number} state.refusalStreak  Compteur AVANT ce refus.
 * @param {number} state.now
 * @returns {{ refusalStreak: number, retryAt: number, delayMs: number }}
 */
function afterRefusal({ refusalStreak, now }) {
  const streak = Math.max(Math.trunc(refusalStreak), 0) + 1
  const delayMs = backoffDelayMs(streak)
  return { refusalStreak: streak, retryAt: now + delayMs, delayMs }
}

/** État remis à neuf : plus aucun refus en cours. */
function cleared() {
  return { refusalStreak: 0, retryAt: null }
}

/** Formatage lisible d'un délai, pour le journal. */
function humanDelay(ms) {
  return ms >= 3_600_000 ? `${Math.round(ms / 3_600_000)} h` : `${Math.round(ms / 60_000)} min`
}

module.exports = {
  BACKOFF_STEPS_MS,
  backoffDelayMs,
  shouldAttemptActivation,
  afterRefusal,
  cleared,
  humanDelay,
}
