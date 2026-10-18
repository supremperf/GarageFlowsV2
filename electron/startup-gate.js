'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  GarageFlow — Décision d'OUVERTURE au démarrage, pure et testable.
//
//  POURQUOI CE MODULE EXISTE (GF-DUR-019, P1)
//  Le blocage d'une licence (révoquée, suspendue, altérée) était bien persisté
//  et signé — mais relu APRÈS `createMainWindow()`. L'enchaînement réel était :
//
//      licence stockée → jeton ECDSA vérifié → serveur Next démarré →
//      fenêtre principale ouverte → tableau de bord chargé et AFFICHÉ →
//      … puis, au `did-finish-load`, un calque venait le recouvrir.
//
//  Une licence révoquée ouvrait donc réellement l'application, planning,
//  clients et factures compris, le temps d'un chargement de page. Le jeton, lui,
//  reste cryptographiquement valide : ce n'est pas lui qui porte la révocation.
//
//  Un calque n'est pas un contrôle d'accès. La décision doit être prise AVANT le
//  serveur et AVANT toute fenêtre — c'est ce que ce module rend explicite et
//  vérifiable, indépendamment d'Electron.
//
//  Ce module ne traite QUE le démarrage. Un blocage prononcé pendant que
//  l'application tourne relève du battement de cœur (`heartbeat-policy.js`), qui
//  pose légitimement un calque sur une application déjà ouverte.
// ─────────────────────────────────────────────────────────────────────────────

/** États de blocage TERMINAUX : aucun redémarrage ne les lève. */
const BLOCAGE_TERMINAL = Object.freeze(['revoked', 'suspended', 'tampered'])

/**
 * Le blocage persisté s'applique-t-il à CETTE licence ?
 *
 * Le blocage est lié au `lid` : activer une AUTRE clé, valide, n'hérite jamais
 * du blocage de la précédente. Un blocage sans `lid` — écrit avant que la
 * licence soit connue — s'applique par défaut : en cas de doute on refuse, on
 * n'ouvre pas.
 *
 * @param {?{status?: string, lid?: ?string, reason?: string}} blocage
 * @param {?string} lid
 * @returns {?object} le blocage applicable, ou `null`.
 */
function blocageApplicable(blocage, lid) {
  if (!blocage || !BLOCAGE_TERMINAL.includes(blocage.status)) return null
  if (blocage.lid && lid && blocage.lid !== lid) return null
  return blocage
}

/**
 * Que faire au démarrage ?
 *
 * @param {object}   etat
 * @param {?object}  etat.licence   Charge utile de la licence stockée, ou `null`
 *                                  si absente/invalide/HWID non concordant.
 * @param {?object}  etat.blocage   État de blocage persisté vérifié, ou `null`.
 * @returns {{action: 'ouvrir'|'activation', motif?: string, statut?: string}}
 *   - `activation` : montrer la fenêtre d'activation (licence absente OU bloquée) ;
 *   - `ouvrir`     : démarrer le serveur et la fenêtre principale.
 */
function decisionDemarrage({ licence, blocage }) {
  if (!licence) return { action: 'activation' }

  const bloc = blocageApplicable(blocage, licence.lid ?? null)
  if (bloc) {
    // Traitée exactement comme une licence absente : l'exploitant peut saisir
    // une autre clé, mais rien ne s'ouvre avec celle-ci.
    return { action: 'activation', statut: bloc.status, motif: bloc.reason || 'Licence bloquée.' }
  }

  return { action: 'ouvrir' }
}

/**
 * Une clé fraîchement activée peut-elle ouvrir l'application ?
 *
 * Appelée APRÈS la fenêtre d'activation. Sans ce second contrôle, recoller la
 * clé bloquée rouvrirait l'application — en particulier hors ligne, où
 * l'activation ne peut pas interroger l'autorité de licence.
 *
 * @returns {{action: 'ouvrir'|'refus', motif?: string, statut?: string}}
 */
function decisionApresActivation({ licence, blocage }) {
  if (!licence) return { action: 'refus', motif: 'Aucune licence activée.' }

  const bloc = blocageApplicable(blocage, licence.lid ?? null)
  if (bloc) {
    return { action: 'refus', statut: bloc.status, motif: bloc.reason || 'Licence bloquée.' }
  }
  return { action: 'ouvrir' }
}

/**
 * Le blocage persisté doit-il être purgé ?
 *
 * Uniquement quand il vise une AUTRE licence que celle qui vient d'ouvrir :
 * laissé en place, il finirait par bloquer une clé sans rapport le jour où son
 * `lid` viendrait à manquer.
 */
function purgerBlocage(blocage, lid) {
  return Boolean(blocage && blocage.lid && lid && blocage.lid !== lid)
}

module.exports = {
  BLOCAGE_TERMINAL,
  blocageApplicable,
  decisionDemarrage,
  decisionApresActivation,
  purgerBlocage,
}
