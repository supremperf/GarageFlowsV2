'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  GarageFlow — Résolution de l'AUTORITÉ DE LICENCE (pure, testable)
//
//  Même principe que UPDATE_SERVER : l'URL officielle est COMPILÉE dans le
//  binaire. Sans ce défaut, une app packagée (qui n'embarque pas de .env)
//  n'interrogeait plus l'autorité distante → révocation/suspension inopérantes
//  et seul le SQLite local (que l'éditeur ne peut jamais modifier) faisait foi :
//  la licence était SILENCIEUSEMENT désactivée par simple absence de config.
//
//  Surcharge : GF_LICENSE_SERVER permet dev/staging/self-hosted. En build
//  PACKAGÉ (production), une surcharge NON https est refusée (anti-downgrade) et
//  l'URL officielle est utilisée à la place.
// ─────────────────────────────────────────────────────────────────────────────

const OFFICIAL_LICENSE_SERVER = 'https://app.garageflows.fr'

/**
 * Résout la base de l'autorité de licence.
 * @param {{ envUrl?: string, isPackaged?: boolean }} opts
 * @returns {string} base sans slash final (jamais vide)
 */
function resolveLicenseServer({ envUrl, isPackaged } = {}) {
  const raw = String(envUrl || '').trim().replace(/\/+$/, '')
  if (!raw) return OFFICIAL_LICENSE_SERVER
  // En production packagée : une surcharge doit être https (anti-downgrade).
  if (isPackaged && !/^https:\/\//i.test(raw)) return OFFICIAL_LICENSE_SERVER
  return raw
}

module.exports = { OFFICIAL_LICENSE_SERVER, resolveLicenseServer }
