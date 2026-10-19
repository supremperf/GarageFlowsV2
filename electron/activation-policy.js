'use strict'

// Liste positive : tout résultat ambigu est technique, jamais un refus métier présumé.
const BUSINESS_CODES = new Set([
  'LICENSE_INVALID', 'LICENSE_TAMPERED', 'LICENSE_REVOKED', 'LICENSE_SUSPENDED', 'LICENSE_EXPIRED',
  'DEVICE_LIMIT_REACHED', 'DEVICE_REVOKED', 'MECHANIC_DEVICE_REVOKED', 'HWID_REQUIRED', 'HWID_MISMATCH',
  'MECHANIC_KEY_UNASSIGNED', 'PARENT_LICENSE_INVALID', 'MECHANIC_LICENSE_REVOKED',
  'MECHANIC_LICENSE_SUSPENDED', 'MECHANIC_LICENSE_EXPIRED', 'DEVICE_REQUIRED', 'VALIDATION_ERROR',
])

const BUSINESS_STATUS = {
  LICENSE_REVOKED: 'revoked', MECHANIC_LICENSE_REVOKED: 'revoked',
  LICENSE_SUSPENDED: 'suspended', MECHANIC_LICENSE_SUSPENDED: 'suspended',
  LICENSE_EXPIRED: 'expired', MECHANIC_LICENSE_EXPIRED: 'expired',
  LICENSE_TAMPERED: 'tampered', DEVICE_REVOKED: 'device_revoked', MECHANIC_DEVICE_REVOKED: 'device_revoked',
  HWID_MISMATCH: 'device_hwid_mismatch', HWID_REQUIRED: 'device_required', DEVICE_REQUIRED: 'device_required',
}

function activationDecision(response) {
  if (response?.ok === true && typeof response.deviceToken === 'string' && response.deviceToken &&
      typeof response.deviceId === 'string' && response.deviceId &&
      (!response.httpStatus || response.httpStatus === 200)) return { kind: 'success' }
  if (response?.ok === false && BUSINESS_CODES.has(response.code) &&
      (!response.httpStatus || response.httpStatus < 500)) {
    return { kind: 'business', status: BUSINESS_STATUS[response.code] || 'activation_refused', reason: response.reason || 'Activation refusée par le service de licence.' }
  }
  return {
    kind: 'infrastructure', status: 'infrastructure_error',
    reason: 'Le service de vérification est indisponible. Activation non effectuée ; réessayez plus tard.',
  }
}

/** Aucun repli local : panne réseau, corps ambigu, DB/config ou refus sont définitifs pour cette tentative. */
async function activateAtAuthority(post, url, body) {
  let response = null
  try { response = await post(url, body) } catch { /* classé indisponible, jamais licence invalide */ }
  return { response, decision: activationDecision(response) }
}
module.exports = { activationDecision, activateAtAuthority }
