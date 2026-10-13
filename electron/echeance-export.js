/**
 * Décide s'il est l'heure d'écrire l'export quotidien sur le Bureau.
 *
 * L'échéance était posée par un `setTimeout` de plusieurs heures, réarmé après
 * coup. Deux façons de ne jamais exporter :
 *
 *  · le poste dort. Un garage ferme à 19 h ; l'ordinateur passe en veille, et
 *    le compte à rebours de 20 h ne s'écoule pas comme l'horloge murale. Le
 *    minuteur se déclenchait plus tard, parfois beaucoup plus tard — et le
 *    réarmement décalait encore le lendemain ;
 *  · le poste est éteint. Là, aucun minuteur ne survit : l'échéance de 20 h
 *    était simplement perdue, sans rattrapage au rallumage. Un garage qui
 *    éteint son PC en partant n'a JAMAIS eu d'export quotidien.
 *
 * On ne fait donc plus confiance à un compte à rebours : on compare l'horloge
 * murale à la DERNIÈRE exportation réussie, mémorisée sur disque, et on
 * regarde souvent. La règle tient en une phrase — « au plus un export par
 * jour, à 20 h, ou dès que possible après ».
 */

/** Heure locale de l'export quotidien. */
const HEURE_EXPORT = 20

/**
 * Dernier passage de l'heure d'export ATTEINT à cette date.
 * Avant 20 h, c'est celui de la veille : c'est lui qu'on a pu manquer.
 */
function derniereEcheance(maintenant, heure = HEURE_EXPORT) {
  const cible = new Date(maintenant)
  cible.setHours(heure, 0, 0, 0)
  if (cible.getTime() > maintenant.getTime()) cible.setDate(cible.getDate() - 1)
  return cible.getTime()
}

/**
 * @param {object} p
 * @param {number} p.maintenant          Date.now()
 * @param {number|null} p.dernierExport  horodatage du dernier export réussi
 * @param {number} [p.heure]
 * @returns {{ doitExporter: boolean, motif: 'heure'|'rattrapage'|'horloge'|null, echeance: number }}
 */
function evaluerEcheanceExport({ maintenant, dernierExport, heure = HEURE_EXPORT }) {
  const echeance = derniereEcheance(new Date(maintenant), heure)

  if (dernierExport === null || dernierExport === undefined || !Number.isFinite(dernierExport)) {
    return { doitExporter: true, motif: 'rattrapage', echeance }
  }

  // Horodatage dans le futur : l'horloge a reculé, ou le fichier a été bricolé.
  // On refuse de s'en servir pour se taire — mieux vaut un export de trop qu'un
  // export perdu parce qu'une date était fausse.
  if (dernierExport > maintenant) {
    return { doitExporter: true, motif: 'horloge', echeance }
  }

  if (dernierExport >= echeance) {
    return { doitExporter: false, motif: null, echeance }
  }

  // L'échéance est dépassée et l'export n'a pas eu lieu. « heure » quand on est
  // le soir même, « rattrapage » quand on rallume le lendemain matin.
  const soirMeme = maintenant - echeance < 60 * 60 * 1_000
  return { doitExporter: true, motif: soirMeme ? 'heure' : 'rattrapage', echeance }
}

module.exports = { evaluerEcheanceExport, derniereEcheance, HEURE_EXPORT }
