// Read-only dependency analysis; no installs, alerts dismissal or package mutations.
// node docs/audit/security-151/build-inventory.cjs MAIN_LOCK MAIN_AUDIT CANDIDATE_LOCK
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const semver = require('semver')
const OUT = __dirname
const [mainLockFile, auditFile, candidateLockFile] = process.argv.slice(2)
if (!mainLockFile || !auditFile || !candidateLockFile) throw new Error('Three input paths required')
const main = JSON.parse(fs.readFileSync(mainLockFile)), candidate = JSON.parse(fs.readFileSync(candidateLockFile))
const audit = JSON.parse(fs.readFileSync(auditFile))
const details = new Map(JSON.parse(fs.readFileSync(path.join(OUT, 'public-advisories.json'))).map(a => [a.ghsa_id, a]))
const root = '/audit-virtual-project'
function locationName(loc, data) {
  return data.name || loc.split('node_modules/').at(-1)
}
function versionAt(lock, loc) {
  const entry = lock.packages[loc]
  if (!entry) return null
  return entry.link ? lock.packages[entry.resolved]?.version ?? null : entry.version ?? null
}
function locations(lock, name) {
  return Object.entries(lock.packages).filter(([loc]) => loc.endsWith('node_modules/' + name))
    .map(([loc, item]) => ({ location: loc, version: versionAt(lock, loc), link: !!item.link, resolved: item.link ? item.resolved : undefined }))
}
// Node's actual node_modules search semantics, represented by lockfile locations.
function resolve(lock, parent, name) {
  for (const dir of Module._nodeModulePaths(path.join(root, parent))) {
    const loc = path.relative(root, path.join(dir, name)).split(path.sep).join('/')
    if (lock.packages[loc]) return loc
  }
  return null
}
const deps = Object.fromEntries(Object.entries(main.packages).map(([loc, data]) => [loc,
  Object.keys({ ...data.dependencies, ...data.optionalDependencies, ...data.peerDependencies, ...(loc === '' ? data.devDependencies : {}) })
    .map(name => ({ name, location: resolve(main, loc, name) })).filter(d => d.location)]))
const paths = new Map()
for (const direct of deps['']) {
  const queue = [{ loc: direct.location, chain: ['garageflow@' + main.version, direct.name + '@' + versionAt(main, direct.location)] }]
  const visited = new Set()
  for (let i = 0; i < queue.length; i++) {
    const { loc, chain } = queue[i]
    if (visited.has(loc)) continue
    visited.add(loc)
    if (!paths.has(loc)) paths.set(loc, [])
    paths.get(loc).push(chain)
    for (const child of deps[loc] || []) queue.push({ loc: child.location, chain: [...chain, child.name + '@' + versionAt(main, child.location)] })
  }
}
const packages = [], advisories = []
for (const [name, entry] of Object.entries(audit.vulnerabilities)) {
  const targets = locations(candidate, name)
  packages.push({ name, severity: entry.severity, direct: entry.isDirect, mainLocations: entry.nodes.map(location => ({
    location, lockedVersion: versionAt(main, location), introducingPaths: paths.get(location) || [],
  })), candidateLocations: targets, via: entry.via, fixAvailable: entry.fixAvailable,
    remediation: name === 'braces' ? 'Locally maintained bounded source fork; registry identity differs, not a machine-certified fix. Source review and upstream advisory monitoring mandatory.'
      : targets.length ? 'Candidate graph was changed before this mission: fixed package versions or resolved children/overrides, possibly an unchanged parent version. Integration into main and runtime validation still outstanding.'
        : 'No instance at this package name in candidate lock; verify parent upgrades/removal through dependency paths, not alert dismissal.' })
  for (const issue of entry.via.filter(v => typeof v === 'object')) {
    const id = issue.url.split('/').at(-1), publicRecord = details.get(id)
    advisories.push({ package: name, ghsa: id, cve: publicRecord?.cve_id ?? null,
      severity: issue.severity, summary: issue.title, sourceUrl: issue.url, npmAffectedRange: issue.range,
      firstPatchedVersions: (publicRecord?.vulnerabilities || []).filter(v => v.package.name === name).map(v => ({ range: v.vulnerable_version_range, version: v.first_patched_version })),
      mainInstances: entry.nodes.map(location => ({ location, version: versionAt(main, location), introducingPaths: paths.get(location) || [] })),
      candidateInstances: targets.map(target => ({ ...target,
        affectedByNpmRange: target.link ? null : semver.satisfies(target.version, issue.range, { includePrerelease: true }),
        evaluation: target.link ? 'RENAMED_LOCAL_FORK_REQUIRES_SOURCE_REVIEW_NOT_VERSION_COMPARISON' : 'locked-version-range-comparison-only' })),
      status: targets.some(v => v.link) ? 'LOCAL_FORK_MANUAL_REVIEW_REQUIRED' : targets.length ? 'VERSION_UPDATED_PENDING_MAIN_INTEGRATION_AND_RUNTIME_VALIDATION' : 'PARENT_GRAPH_CHANGED_VERIFY_FUNCTIONAL_COMPATIBILITY',
    })
  }
}
const write = (name, value) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2) + '\n')
write('package-inventory.json', { scope: 'All npm vulnerable package aggregates from exact default branch lock; not an export of the 151 GitHub alerts.', pathCoverage: 'One shortest Node-resolution path per direct root dependency and physical target; cycles deduplicated, not all combinatorial walks.', packages })
write('advisory-inventory.json', advisories)
const rows = ['package\tseverity\tGHSA\tCVE\tmain-versions\tcandidate-versions\tfirst-patched-versions\tstatus\tadvisory-url']
for (const a of advisories) rows.push([a.package, a.severity, a.ghsa, a.cve || 'not-assigned', [...new Set(a.mainInstances.map(i => i.version))].join(','), [...new Set(a.candidateInstances.map(i => i.version))].join(',') || 'absent', [...new Set(a.firstPatchedVersions.map(i => i.version || 'no-upstream-fix'))].join(','), a.status, a.sourceUrl].join('\t'))
fs.writeFileSync(path.join(OUT, 'advisory-inventory.tsv'), rows.join('\n') + '\n')
const summary = { observedUtc: new Date().toISOString(), npmPackageAggregates: audit.metadata.vulnerabilities,
  advisoryPackageRelations: advisories.length, uniqueGhsas: new Set(advisories.map(a => a.ghsa)).size,
  criticalRelations: advisories.filter(a => a.severity === 'critical').length,
  candidateInstancesStillMatchingKnownRanges: advisories.flatMap(a => a.candidateInstances.filter(i => i.affectedByNpmRange).map(i => ({ package: a.package, ghsa: a.ghsa, ...i }))),
  missingIntroductionPaths: packages.flatMap(p => p.mainLocations.filter(i => !i.introducingPaths.length).map(i => ({ package: p.name, ...i }))),
  gitHub151Reconciliation: 'BLOCKED: REST 403; npm aggregates/advisories cannot be substituted for GitHub alert IDs.',
}
write('inventory-summary.json', summary)
console.log(JSON.stringify(summary, null, 2))
