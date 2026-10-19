/**
 * Période de grâce hors ligne — cœur TESTABLE de la décision.
 *
 * ─── Le défaut corrigé ──────────────────────────────────────────────────────
 * La durée hors ligne se calculait ainsi :
 *
 *     const lastOnlineTs = rec?.ts ?? 0
 *     const offlineMs    = Date.now() - lastOnlineTs
 *
 * Quand aucun état « dernière connexion » n'existe — le cas d'une installation
 * NEUVE qui n'a jamais réussi à joindre l'autorité de licence —, l'origine
 * valait 0, c'est-à-dire le 1er janvier 1970. `offlineMs` dépassait donc
 * cinquante ans, très au-delà du seuil de verrouillage.
 *
 * Conséquence : un garage qui installe GarageFlows pendant une panne ADSL voit
 * le logiciel se verrouiller **trente secondes après le premier lancement**, sur
 * le message « hors ligne depuis plus de 72 heures » — alors qu'il vient de
 * l'installer. Rien ne permet de comprendre ni de corriger.
 *
 * ─── Pourquoi ce n'était pas une simple étourderie ──────────────────────────
 * Le `?? 0` est fail-closed À DESSEIN : si l'absence d'état valait « remise à
 * zéro de la grâce », il suffirait d'effacer `last_online.json` pour rester hors
 * ligne indéfiniment. Corriger en écrivant l'état au premier lancement
 * rouvrirait exactement ce contournement.
 *
 * ─── L'ancrage retenu ───────────────────────────────────────────────────────
 * En l'absence d'état signé, l'origine devient la **date de création du fichier
 * de base de données**. C'est un repère que le garage ne peut pas remettre à
 * zéro sans perdre l'intégralité de ses données — donc bien plus solide qu'un
 * fichier d'état supprimable :
 *
 *   · installation neuve hors ligne → base créée à l'instant → grâce accordée ;
 *   · `last_online.json` effacé après des mois d'usage → la base, elle, est
 *     ancienne → verrouillage maintenu.
 *
 * Limite honnête, du même ordre que celle déjà écrite pour `license_block.json` :
 * qui recrée la base repart à zéro — mais y perd tout son travail. Le scellement
 * inattaquable exigerait une autorité distante, ce que la période de grâce a
 * précisément pour objet de remplacer.
 */

/**
 * @param {object} e
 * @param {{ ts?: number } | null} e.enregistrement  état signé relu, ou null
 * @param {number | null} e.naissanceBase            création du fichier de base (ms), ou null
 * @param {number} e.maintenant
 * @param {boolean} e.horlogeIncoherente             recul d'horloge détecté
 * @param {number} e.seuilAvertissementMs
 * @param {number} e.seuilVerrouMs
 * @returns {{ decision: 'ok'|'avertissement'|'verrou', motif: string|null,
 *             offlineMs: number, origine: number, premierLancement: boolean }}
 */
function evaluerGraceHorsLigne(e) {
  const premierLancement = !e.enregistrement || typeof e.enregistrement.ts !== 'number'

  // Origine : l'état signé s'il existe ; sinon la naissance de la base ; sinon
  // l'instant présent (la base n'est pas encore créée — c'est le tout premier
  // démarrage, avant même les migrations).
  const origine = premierLancement
    ? (typeof e.naissanceBase === 'number' && e.naissanceBase > 0 ? e.naissanceBase : e.maintenant)
    : e.enregistrement.ts

  const offlineMs = e.maintenant - origine

  // Une durée négative signale une horloge reculée : on ne gagne pas de temps
  // en changeant la date de Windows.
  if (e.horlogeIncoherente || offlineMs < 0) {
    return { decision: 'verrou', motif: 'horloge', offlineMs, origine, premierLancement }
  }
  if (offlineMs > e.seuilVerrouMs) {
    return { decision: 'verrou', motif: 'hors-ligne', offlineMs, origine, premierLancement }
  }
  if (offlineMs > e.seuilAvertissementMs) {
    return { decision: 'avertissement', motif: 'hors-ligne', offlineMs, origine, premierLancement }
  }
  return { decision: 'ok', motif: null, offlineMs, origine, premierLancement }
}

module.exports = { evaluerGraceHorsLigne }
