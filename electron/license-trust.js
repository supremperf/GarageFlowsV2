'use strict'
const crypto = require('node:crypto')

/** Une ancre illisible n'est pas une preuve contre la licence présentée. */
function assertLicenseTrust(pem) {
  try {
    const key = crypto.createPublicKey(pem)
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error()
    return key
  } catch {
    const error = new Error('Configuration du service de licence invalide. Contactez le support.')
    error.code = 'SERVER_MISCONFIGURED'
    throw error
  }
}
module.exports = { assertLicenseTrust }
