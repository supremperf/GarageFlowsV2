'use strict'
const fs = require('node:fs')
const path = require('node:path')
const core = require('./config-core.cjs')

// Every canonical manifest entry has an explicit disposition; autoManage=false is
// not permission to activate a feature or rotate a key. The full wizard respects this.
const TEMPLATE = new Set(core.templateNames(fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8')))
const EXTRA_APP = new Set(['GF_APP_URL', 'GF_TOTP_ENC_KEY', 'GF_TOTP_ENC_KEY_OLD',
  'GF_MAX_MECHANIC_KEYS', 'GF_MECHANIC_TIMER_AUTOCOMPLETE', 'GF_BACKUP_DIR', 'GF_PHOTOS_DIR'])
function disposition(v, platform) {
  if (v.status === 'absent-consumer') return { action: 'unused', destination: 'aucune', reason: 'Consommateur absent/non implémenté ; ne pas inventer un réglage.' }
  if (platform.has(v.name) || v.scope === 'runtime-system') return { action: 'platform', destination: 'OS / Electron / Next / Vercel / tests', reason: 'Injectée par la plateforme, jamais provisionnée comme secret applicatif.' }
  if (v.name === 'GF_UPDATE_SIGNING_KEY' || v.name === 'GF_UPDATE_SIGNING_KEY_FILE') return { action: 'publisher', destination: 'coffre hors dépôt + GarageFlow-configuration/publisher.json (chemin/keyId seulement)', reason: 'Clé privée Ed25519 jamais dans le client ni le Vercel PWA.' }
  if (v.name === 'GF_KEYGEN_MAX_MECHANIC') return { action: 'keygen', destination: 'keys/server_config.json + lanceur keygen', reason: 'Plafond du générateur Python.' }
  if (v.name === 'GF_INTERNAL_EXPORT_KEY' || v.scope === 'desktop-runtime') return { action: 'runtime', destination: 'Electron userData / mémoire', reason: 'Secret éphémère/local généré par Electron ; ne pas le déployer en PWA.' }
  if (EXTRA_APP.has(v.name) || TEMPLATE.has(v.name) || v.name === 'UPSTASH_REDIS_TIMEOUT_MS') {
    return { action: 'application', destination: v.scope === 'desktop' ? '.env / défaut compilé Electron' : '.env.server.local / Vercel (selon profil)', reason: v.notes || 'Configuration applicative validée, valeurs existantes conservées.' }
  }
  return { action: 'manual', destination: 'outil/opération concernée seulement', reason: 'Développement, maintenance, tests ou choix métier : jamais activé automatiquement.' }
}
function loadPolicy(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/garageflow-env-manifest.json'), 'utf8'))
  const platform = new Set(manifest.platformProvided)
  const entries = manifest.variables.map(v => ({ ...v, ...disposition(v, platform) }))
  const names = entries.filter(v => v.action === 'application').map(v => v.name)
  // Internal export is documented in the template but is a runtime-only secret.
  return { manifest, entries, names }
}
function assertNoAliases(env, policy) {
  const bad = Object.keys(env).filter(n => env[n] && policy.manifest.forbiddenAliases[n])
  if (bad.length) throw new Error(`Alias obsolètes détectés : ${bad.join(', ')}. Importer les valeurs sous leurs noms canoniques avant de poursuivre.`)
}
function assertSafeServerOverrides(remote) {
  if (remote.present?.has('ELECTRON')) throw new Error('Vercel : override ELECTRON détecté. Cette variable appartient au runtime desktop ; la retirer du projet PWA avant configuration, sans toucher aux variables système Vercel.')
  if (remote.values.NODE_ENV && remote.values.NODE_ENV !== 'production') throw new Error('Vercel : NODE_ENV non production détecté. Corriger cet override avant de déployer une PWA.')
  const exposed = [...(remote.present || new Set(Object.keys(remote.values)))].filter(n => /^NEXT_PUBLIC_.*(?:SECRET|PRIVATE_KEY|PEPPER|TOKEN|API_KEY)/.test(n))
  if (exposed.length) throw new Error(`Vercel : noms de secrets publics interdits (${exposed.join(', ')}). Corriger et vérifier/roter les secrets exposés explicitement avant déploiement.`)
}
module.exports = { EXTRA_APP, disposition, loadPolicy, assertNoAliases, assertSafeServerOverrides }
