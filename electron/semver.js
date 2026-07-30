'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  Comparaison SemVer — port CommonJS de garagesite3/src/lib/releases/semver.ts.
//  Évite toute comparaison lexicographique (« 1.9.0 » > « 1.10.0 » serait FAUX).
//  Accepte "1.2.3", "v1.2.3", "1.2.3-beta.1". Une pré-version est antérieure à
//  la version stable correspondante (1.2.3-beta < 1.2.3).
// ─────────────────────────────────────────────────────────────────────────────

function parseVersion(input) {
  if (typeof input !== 'string') return null
  const cleaned = input.trim().replace(/^v/i, '')
  if (!cleaned) return null
  const [core, pre] = cleaned.split('-')
  const nums = core.split('.').map((n) => parseInt(n, 10))
  if (nums.length === 0 || nums.some((n) => Number.isNaN(n))) return null
  return {
    major: nums[0] || 0,
    minor: nums[1] || 0,
    patch: nums[2] || 0,
    prerelease: pre ? pre.split('.') : [],
  }
}

function isValidVersion(input) {
  return parseVersion(input) !== null
}

function comparePrerelease(a, b) {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const ai = a[i]
    const bi = b[i]
    if (ai === undefined) return -1
    if (bi === undefined) return 1
    const an = /^\d+$/.test(ai)
    const bn = /^\d+$/.test(bi)
    if (an && bn) {
      const d = parseInt(ai, 10) - parseInt(bi, 10)
      if (d !== 0) return d < 0 ? -1 : 1
    } else if (an !== bn) {
      return an ? -1 : 1
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1
    }
  }
  return 0
}

function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa && !pb) return 0
  if (!pa) return -1
  if (!pb) return 1
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1
  return comparePrerelease(pa.prerelease, pb.prerelease)
}

function isNewer(candidate, current) {
  return compareVersions(candidate, current) > 0
}

function satisfiesMinimum(version, minimum) {
  if (!minimum) return true
  return compareVersions(version, minimum) >= 0
}

module.exports = { parseVersion, isValidVersion, compareVersions, isNewer, satisfiesMinimum }
