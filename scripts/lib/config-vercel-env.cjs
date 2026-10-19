'use strict'
// Metadata describes protection, not readability. Only trust values returned by
// an authenticated pull/decryption endpoint, never ciphertext from env ls.
function readable(value) {
  return typeof value === 'string' && value.trim() !== '' &&
    !/^(?:\*{3,}|\[(?:redacted|sensitive|encrypted|hidden)\]|<(?:redacted|sensitive|encrypted|hidden)>|(?:redacted|sensitive|encrypted|hidden))$/i.test(value.trim())
}
function fromPull(records, pulled) {
  const values = Object.fromEntries(Object.entries(pulled || {}).filter(([, value]) => readable(value)))
  const hidden = new Set(), present = new Set(), stamps = {}
  for (const r of records) {
    present.add(r.key)
    stamps[r.key] = JSON.stringify([r.id, r.updatedAt, r.createdAt, r.type, r.visibility, r.configurationId])
    if (!readable(values[r.key])) { hidden.add(r.key); delete values[r.key] }
  }
  return { values, hidden, present, stamps, records }
}
function production(record) {
  const targets = Array.isArray(record.target) ? record.target : [record.target]
  return !record.gitBranch && targets.includes('production')
}
// Attach recovered credentials without inventing project metadata or changing
// the original stamps used by the concurrent-change guard.
function attach(remote, values) {
  const result = { ...remote, values: { ...remote.values }, hidden: new Set(remote.hidden) }
  for (const [key, value] of Object.entries(values)) {
    if (!readable(value)) continue
    result.values[key] = value
    result.hidden.delete(key)
  }
  return result
}
module.exports = { readable, fromPull, production, attach }
