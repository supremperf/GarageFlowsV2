'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  GarageFlow — Garde de navigation (pure, testable)
//
//  Autorise UNIQUEMENT la navigation vers l'origine locale exacte de l'app
//  (http://127.0.0.1:PORT). La comparaison se fait sur URL(...).origin, jamais
//  sur un préfixe de chaîne — un test startsWith serait contournable via le
//  userinfo (« http://127.0.0.1:PORT@evil.com/ ») ou via un port dont le préfixe
//  correspond (« http://127.0.0.1:PORT8/ »).
// ─────────────────────────────────────────────────────────────────────────────

/** Vrai uniquement si `url` a EXACTEMENT l'origine locale attendue. */
function isLocalAppUrl(url, localOrigin) {
  try {
    return new URL(url).origin === localOrigin
  } catch {
    return false
  }
}

module.exports = { isLocalAppUrl }
