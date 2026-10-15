'use strict'
/** Decode the quoted dotenv values produced by config, without interpolation/evaluation. */
function decodeDotenvValue(value) {
  const quote = value[0]
  if (!['"', "'", '`'].includes(quote)) return value
  if (value.at(-1) !== quote) throw new Error('Invalid quoted desktop environment value')
  let decoded = value.slice(1, -1)
  if (quote === '"') decoded = decoded.replace(/\\n/g, '\n').replace(/\\r/g, '\r')
  return decoded.replace(/\\\$/g, '$')
}
module.exports = { decodeDotenvValue }
