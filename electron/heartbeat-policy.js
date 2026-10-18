'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  GarageFlow — Décision du battement de licence, pure et testable.
//
//  POURQUOI CE MODULE EXISTE (GF-FINAL-001, P0)
//  La décision vivait au milieu de periodicLicenseCheck() dans main.js et
//  traitait un `status: 'active'` du REPLI LOCAL exactement comme celui de
//  l'AUTORITÉ DISTANTE. Conséquence observée : licence révoquée par l'admin →
//  overlay de blocage → serveur distant injoignable (panne, pare-feu, fichier
//  hosts) → le battement suivant retombe sur le contrôle local → la base SQLite
//  du poste, jamais informée de la révocation, répond « active » → le blocage
//  était LEVÉ et l'événement license:reactivated émis. Une licence révoquée ou
//  suspendue « finissait par se réactiver » toute seule.
//
//  RÈGLE : un blocage ne peut être levé QUE par un « active » explicite de
//  l'autorité DISTANTE — celle-là même par qui passent révocations,
//  suspensions et réactivations administratives. Le repli local n'existe que
//  pour la DISPONIBILITÉ d'une licence déjà active hors ligne, jamais comme
//  autorité de réactivation.
//
//  En revanche, un BLOCAGE est honoré quelle que soit l'autorité qui le
//  prononce (fail-secure) : le miroir local d'une révocation distante doit
//  pouvoir bloquer même quand le serveur distant est injoignable.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Décide de la suite à donner à un résultat de battement de licence.
 *
 * @param {object}  state
 * @param {?object} state.result     Réponse de /api/license/check (ou null si
 *                                   aucune autorité n'a répondu).
 * @param {?string} state.authority  Qui a produit `result` : 'remote' | 'local'.
 * @param {boolean} state.blocked    L'accès est-il actuellement bloqué ?
 * @returns {{ action: 'none'|'block'|'unblock'|'hold', status?: string, reason?: string }}
 *   - 'block'   : afficher/maintenir l'overlay, persister l'état bloqué ;
 *   - 'unblock' : lever le blocage (UNIQUEMENT sur « active » distant) ;
 *   - 'hold'    : rester bloqué — le « active » ne vient pas de l'autorité ;
 *   - 'none'    : conserver l'état courant (réponse indéterminée / déjà actif).
 */
function heartbeatDecision({ result, authority, blocked }) {
  if (!result || typeof result !== 'object') return { action: 'none' }

  // Refus explicite (revoked / suspended / expired / tampered / device_*) :
  // honoré quelle que soit l'autorité — fail-secure.
  if (result.allowed === false) {
    return {
      action: 'block',
      status: typeof result.status === 'string' && result.status ? result.status : 'unknown',
      reason: typeof result.reason === 'string' && result.reason ? result.reason : 'Vérification de licence non aboutie.',
    }
  }

  // « active » explicite. Jamais de réactivation sur 'unknown' (fail-open DB),
  // et JAMAIS de réactivation sur la foi du repli local : seule l'autorité
  // distante peut lever un blocage.
  if (result.status === 'active') {
    if (!blocked) return { action: 'none' }
    if (authority === 'remote') return { action: 'unblock' }
    return { action: 'hold' }
  }

  // 'unknown' (base pas encore enregistrée / fail-open) ou statut inattendu :
  // conserver l'état courant, ne JAMAIS lever un blocage là-dessus.
  return { action: 'none' }
}

module.exports = { heartbeatDecision }
