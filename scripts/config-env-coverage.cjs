'use strict'
// Read-only names/destinations inventory. Never return environment values.
const fs = require('node:fs')
const path = require('node:path')
const core = require('./config-core.cjs')
const { loadPolicy } = require('./config-policy.cjs')

const ENV_FILES = ['.env', '.env.server.local', '.env.local',
  '.env.development', '.env.development.local', '.env.production', '.env.production.local',
  '.env.test', '.env.test.local']
function coverage(root) {
  const policy = loadPolicy(root)
  const template = core.templateNames(fs.readFileSync(path.join(root, '.env.example'), 'utf8'))
  const desktop = new Set(core.namesForProfile(policy.names, 'desktop'))
  const server = new Set(core.namesForProfile(policy.names, 'licences'))
  const entries = new Map(policy.entries.map(e => [e.name, {
    name: e.name, action: e.action, destination: e.destination,
    template: template.includes(e.name),
    profiles: [...(desktop.has(e.name) ? ['desktop'] : []), ...(server.has(e.name) ? ['pwa', 'licences'] : [])],
    observedIn: [],
  }]))
  for (const name of template) {
    if (!entries.has(name)) entries.set(name, { name, action: 'unclassified', destination: 'contrat à compléter',
      template: true, profiles: [], observedIn: [] })
  }
  const files = []
  for (const name of ENV_FILES) {
    const file = path.join(root, name)
    if (!fs.existsSync(file)) continue
    const env = core.readEnv(file)
    const managed = ['.env', '.env.server.local'].includes(name)
    files.push({ path: name, names: Object.keys(env).length, managed })
    for (const key of Object.keys(env)) {
      if (!entries.has(key)) {
        const alias = Object.hasOwn(policy.manifest.forbiddenAliases, key)
        const platform = policy.manifest.platformProvided.includes(key)
        entries.set(key, { name: key, action: alias ? 'obsolete-alias' : platform ? 'platform' : 'local-custom',
          destination: alias ? 'migration explicite vers le nom canonique' : platform ? 'plateforme, pas un secret applicatif' : 'réglages avancés locaux ; jamais synchronisée automatiquement vers Vercel',
          template: false, profiles: [], localOnly: !alias && !platform, observedIn: [] })
      }
      entries.get(key).observedIn.push(name)
    }
  }
  return { templateCount: template.length, applicationCount: policy.names.length,
    files, entries: [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)),
    unclassified: [...entries.values()].filter(e => e.action === 'unclassified').map(e => e.name),
    limits: 'Noms et destinations uniquement. Présence dans un fichier ≠ valeur valide, connexion réelle ou configuration du compte. Les overrides .env.local/.env.production ne sont pas modifiés par config et peuvent primer sur .env.' }
}
function render(result) {
  const lines = ['Couverture de config — aucune valeur affichée',
    `${result.templateCount} variables du template ; ${result.applicationCount} paramètres applicatifs canoniques.`,
    ...result.files.map(f => `${f.path} : ${f.names} noms (${f.managed ? 'destination gérée' : 'override Next.js non modifié par config'}).`),
    ...(result.files.length ? [] : ['Aucun fichier .env privé présent : seul le contrat du template peut être vérifié.']), '',
    'Variable | Prise en charge | Profil(s) | Destination']
  for (const e of result.entries) lines.push(`${e.name} | ${e.action} | ${e.profiles.join(', ') || (e.localOnly ? 'local seulement' : 'runtime/outil dédié')} | ${e.destination}`)
  lines.push('', result.limits)
  return lines.join('\n')
}
module.exports = { coverage, render }
