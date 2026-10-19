// ═══════════════════════════════════════════════════════════════════════════════
//  GarageFlows — Résolution du dossier de données utilisateur (pur, testable)
//
//  La marque visible est « GarageFlows », mais le dossier de données HISTORIQUE
//  est %APPDATA%/GarageFlow (base garageflow.db, licence, secret d'installation).
//  Electron dérive userData de productName : sans épinglage explicite, le rename
//  relocaliserait les données → perte BD/licence. Ce module calcule le chemin
//  épinglé et VALIDE le résultat effectif — tout échec est SIGNALÉ (structure
//  {ok, path, error}), jamais avalé : l'appelant décide (arrêt contrôlé).
// ═══════════════════════════════════════════════════════════════════════════════
'use strict'

const path = require('path')

/** Nom HISTORIQUE du dossier de données (compat installations existantes). */
const LEGACY_DATA_DIR_NAME = 'GarageFlow'

/** Chemin de données attendu : <appData>/GarageFlow. */
function legacyUserDataPath(appDataDir) {
  if (typeof appDataDir !== 'string' || appDataDir.length === 0) {
    return { ok: false, path: null, error: 'appData introuvable (getPath a renvoyé une valeur vide)' }
  }
  return { ok: true, path: path.join(appDataDir, LEGACY_DATA_DIR_NAME), error: null }
}

/**
 * Épingle userData sur le dossier historique et VÉRIFIE le résultat effectif.
 * `app` : l'objet Electron (injecté → testable sans Electron).
 * Renvoie { ok, path, error } — ne lance jamais, ne masque jamais.
 */
function pinUserDataToLegacyDir(app) {
  let resolved
  try {
    resolved = legacyUserDataPath(app.getPath('appData'))
    if (!resolved.ok) return resolved
    app.setPath('userData', resolved.path)
  } catch (err) {
    return { ok: false, path: resolved?.path ?? null, error: `setPath userData a échoué : ${err.message}` }
  }
  // Contrôle du chemin EFFECTIF : si l'épinglage n'a pas pris, les données
  // seraient créées dans un mauvais dossier (perte silencieuse) → on le signale.
  try {
    const effective = app.getPath('userData')
    if (effective !== resolved.path) {
      return { ok: false, path: effective, error: `userData effectif (${effective}) ≠ dossier historique attendu (${resolved.path})` }
    }
    return { ok: true, path: effective, error: null }
  } catch (err) {
    return { ok: false, path: resolved.path, error: `relecture de userData impossible : ${err.message}` }
  }
}

module.exports = { LEGACY_DATA_DIR_NAME, legacyUserDataPath, pinUserDataToLegacyDir }
