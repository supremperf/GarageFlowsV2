/**
 * Décide QUAND dire au garagiste que ses sauvegardes ne se font plus.
 *
 * Le poste écrivait une sauvegarde toutes les heures et, quand elle échouait,
 * l'écrivait dans `garageflow.log` — un fichier que personne n'ouvre. Serveur
 * interne arrêté, disque plein, antivirus qui verrouille le dossier : la
 * sauvegarde pouvait ne plus passer pendant des semaines sans que rien ne
 * change à l'écran. Le jour où l'on en a besoin — disque mort, base corrompue,
 * erreur de manipulation — la dernière sauvegarde valide date d'un mois.
 *
 * Deux règles, et pas une de plus :
 *
 *  · on ne parle PAS au premier échec. Une sauvegarde ratée à 14 h alors que
 *    celle de 13 h est passée n'est pas un incident, c'est un contretemps ;
 *  · on parle quand aucune sauvegarde n'a réussi depuis SEUIL_MS, et jamais
 *    plus d'une fois par SILENCE_MS. Un avertissement qui revient toutes les
 *    heures devient un bruit qu'on apprend à fermer sans lire.
 *
 * Aucune dépendance à Electron : la décision est une fonction des dates, donc
 * vérifiable sans lancer une fenêtre.
 */

/** Au-delà, l'absence de sauvegarde cesse d'être un contretemps. */
const SEUIL_MS = 24 * 60 * 60 * 1_000
/** Entre deux avertissements, on se tait. */
const SILENCE_MS = 24 * 60 * 60 * 1_000

/**
 * @param {object} p
 * @param {Array<{ nom: string, mtimeMs: number }>} p.sauvegardes  sauvegardes horaires connues
 * @param {number} p.maintenant                                     Date.now()
 * @param {number} p.dernierAvertissement                           0 si jamais averti
 * @param {number} [p.premierDemarrage]  date de création de la base, pour ne pas
 *                                       crier « aucune sauvegarde » sur une
 *                                       installation qui a cinq minutes
 * @param {number} [p.seuilMs]
 * @param {number} [p.silenceMs]
 * @returns {{ alerter: boolean, motif: 'aucune'|'trop-ancienne'|null, ageMs: number|null }}
 */
function evaluerSauvegardes({
  sauvegardes,
  maintenant,
  dernierAvertissement = 0,
  premierDemarrage = null,
  seuilMs = SEUIL_MS,
  silenceMs = SILENCE_MS,
}) {
  const recentes = (sauvegardes || []).filter(s => Number.isFinite(s?.mtimeMs))
  const plusRecente = recentes.length
    ? recentes.reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a))
    : null

  // Une horloge qui recule (changement d'heure, correction NTP, date Windows
  // modifiée) rendrait un âge négatif : on le ramène à zéro plutôt que de
  // conclure que la sauvegarde est vieille de moins que rien.
  const age = plusRecente ? Math.max(0, maintenant - plusRecente.mtimeMs) : null

  let motif = null
  if (plusRecente === null) {
    // Pas encore de sauvegarde : normal juste après l'installation. On attend
    // que le poste ait vécu au moins un cycle avant de s'en inquiéter.
    const assezVieux =
      premierDemarrage === null || maintenant - premierDemarrage > seuilMs
    if (assezVieux) motif = 'aucune'
  } else if (age > seuilMs) {
    motif = 'trop-ancienne'
  }

  if (motif === null) return { alerter: false, motif: null, ageMs: age }

  const silenceEcoule =
    dernierAvertissement === 0 || maintenant - dernierAvertissement >= silenceMs
  return { alerter: silenceEcoule, motif, ageMs: age }
}

/** Rend l'âge sous une forme qu'un garagiste lit sans réfléchir. */
function formulerAge(ageMs) {
  if (ageMs === null || !Number.isFinite(ageMs)) return 'jamais'
  const heures = Math.floor(ageMs / (60 * 60 * 1_000))
  if (heures < 48) return `${heures} heure${heures > 1 ? 's' : ''}`
  return `${Math.floor(heures / 24)} jours`
}

module.exports = { evaluerSauvegardes, formulerAge, SEUIL_MS, SILENCE_MS }
