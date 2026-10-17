'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const core = require('./config-core.cjs')
const { audit } = require('./config-audit.cjs')
const { loadPolicy } = require('./config-policy.cjs')
const decoder = require('./lib/config-vercel-env.cjs')
const { normalizeStorage } = require('./config-rebuild.cjs')
const { TARGETS, stamp, targets, protectedRecord, cloud } = require('./lib/config-cloud.cjs')
const security = require('./lib/config-credentials.cjs')
function failure(message) { const error = new Error(message); error.configSafe = true; return error }
const VAULT = 'GarageFlow-configuration'
const FILES = Object.freeze({ development: ['.env.development.local', '.env.local'],
  preview: ['.env.preview.local'], production: ['.env.production.local', '.env.server.local'] })
const BASE_REQUIRED = ['DATABASE_URL', 'DIRECT_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'BLOB_READ_WRITE_TOKEN', 'NEXTAUTH_URL']
const SESSION_KEYS = ['NEXTAUTH_SECRET', 'DEVICE_TOKEN_PEPPER', 'GARAGEFLOW_API_KEY']
function json(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw failure('Configuration : état JSON local illisible ; contenu masqué.')
  }
}
const sameProject = (a, b) => !!a?.projectId && !!a?.orgId && a.projectId === b?.projectId && a.orgId === b?.orgId
const safeName = name => /^[A-Z][A-Z0-9_]*$/.test(name)
const safeMessage = (target, name) => `CONFIGURATION INCOMPLÈTE — ${target} — Variable : ${name}. Valeur absente, inaccessible, invalide ou exposée ; fournir une nouvelle valeur réelle (saisie locale dans le terminal).`
function recordMap(snapshot) { return new Map(snapshot.records.map(r => [r.key, r])) }
function signature(snapshot) {
  return JSON.stringify(snapshot.records.map(r => [r.key, stamp(r), snapshot.values[r.key] === undefined ? null : security.hash(snapshot.values[r.key])]).sort((a, b) => a[0].localeCompare(b[0])))
}
function acknowledged(receipts, target, record, value) {
  const receipt = receipts?.[target]?.[record.key]
  return decoder.readable(value) && receipt?.stamp === stamp(record) && receipt.sha256 === security.hash(value)
}
function planTarget(snapshot, values, policy, receipts, target, entries = []) {
  const names = new Set([...core.namesForProfile(policy.names, 'pwa'), 'BLOB_READ_WRITE_TOKEN'])
  const obsolete = new Set([...policy.entries.filter(e => e.action === 'unused').map(e => e.name), ...Object.keys(policy.manifest.forbiddenAliases)])
  const records = recordMap(snapshot), operations = [], preserved = [], blocked = [], unverified = []
  for (const [key, value] of Object.entries(values)) {
    if (!names.has(key) || !decoder.readable(value)) continue
    const record = records.get(key), oldValue = snapshot.values[key]
    if (record && (oldValue === value || acknowledged(receipts, target, record, value))) continue
    if (record && protectedRecord(record, policy.manifest.platformProvided)) {
      if (!decoder.readable(oldValue)) { unverified.push(key); preserved.push({ key, reason: 'integration_unreadable' }) }
      else blocked.push({ key, reason: 'integration_owned' })
      continue
    }
    if (record && targets(record).length !== 1) { blocked.push({ key, reason: 'shared_targets_need_split' }); continue }
    const restorable = !record || (decoder.readable(oldValue) && !security.compromised(oldValue, entries))
    operations.push({ kind: record ? 'update' : 'create', key, value, type: record?.type === 'sensitive' ? 'sensitive' : core.isSecret(key) || /POSTGRES|KV_|REDIS/.test(key) ? 'encrypted' : 'plain',
      record, oldValue, restorable, ...(!record ? { ownership: `GarageFlows config ${crypto.randomUUID()}` } : {}) })
  }
  for (const record of snapshot.records) {
    if (names.has(record.key)) continue
    if (obsolete.has(record.key) && !protectedRecord(record, policy.manifest.platformProvided) && targets(record).length === 1 && decoder.readable(snapshot.values[record.key]) && !security.compromised(snapshot.values[record.key], entries)) {
      // An alias is removable only after its canonical replacement has a value.
      const canonical = policy.manifest.forbiddenAliases[record.key]
      const replacement = typeof canonical === 'string' ? canonical : canonical?.canonical || canonical?.replacement
      if (canonical && (!replacement || !decoder.readable(values[replacement]))) { preserved.push({ key: record.key, reason: 'alias_not_migrated' }); continue }
      operations.push({ kind: 'remove', key: record.key, record, oldValue: snapshot.values[record.key], restorable: true })
    } else preserved.push({ key: record.key, reason: obsolete.has(record.key) ? 'not_safely_restorable' : 'unknown_platform_or_other_profile' })
  }
  return { target, names: [...names], values, operations, preserved, blocked, unverified, aliases: policy.manifest.forbiddenAliases }
}
function summary(plan) {
  return { target: plan.target, create: plan.operations.filter(o => o.kind === 'create').map(o => o.key),
    update: plan.operations.filter(o => o.kind === 'update').map(o => o.key), remove: plan.operations.filter(o => o.kind === 'remove').map(o => o.key),
    unrestorable: plan.operations.filter(o => !o.restorable).map(o => o.key), preserved: plan.preserved, blocked: plan.blocked, unverified: plan.unverified }
}
function verifyOperation(snapshot, operation, oldRecord) {
  const record = snapshot.records.find(r => r.key === operation.key)
  if (operation.kind === 'remove') return !record ? 'value' : false
  if (!record) return false
  if (decoder.readable(snapshot.values[operation.key])) return snapshot.values[operation.key] === operation.value ? 'value' : false
  // A changed stamp confirms presence/metadata, NOT plaintext equality.
  return (!oldRecord || stamp(record) !== stamp(oldRecord)) ? 'metadata_only' : false
}
function localText(root, target, file, plan, entries = []) {
  const old = core.readEnv(path.join(root, file)), values = { ...security.cleanCredentials(old, entries).safe }
  for (const name of plan.names) { if (plan.values[name]) values[name] = plan.values[name] }
  for (const op of plan.operations.filter(o => o.kind === 'remove')) delete values[op.key]
  for (const [alias, definition] of Object.entries(plan.aliases || {})) { const canonical = typeof definition === 'string' ? definition : definition.canonical; if (plan.values[canonical]) delete values[alias] }
  return core.serializeEnv(values, Object.keys(values).sort(), `vercel-${target}`).replace('Relancer node config --conserver-secrets pour compléter sans rotation.', 'Relancer node config pour synchroniser sans rotation implicite.')
}
async function rollback(driver, project, attempts) {
  const failures = []
  for (const attempted of [...attempts].reverse()) {
    const { target, operation } = attempted
    try {
      let current = await driver.read(project, target)
      const record = current.records.find(r => r.key === operation.key)
      if (operation.kind === 'create') {
        if (!record) continue
        if (!operation.ownership || record.comment !== operation.ownership || current.values[operation.key] !== operation.value) throw failure()
        await driver.write(project, target, { kind: 'remove', key: operation.key, record }, { authorized: true })
        current = await driver.read(project, target)
        if (current.records.some(r => r.key === operation.key)) throw failure()
      } else if (operation.kind === 'update') {
        if (record && stamp(record) === stamp(operation.record) && current.values[operation.key] === operation.oldValue) continue
        if (!operation.restorable || !record || current.values[operation.key] !== operation.value) throw failure()
        await driver.write(project, target, { kind: 'update', key: operation.key, value: operation.oldValue, type: operation.record.type, record }, { authorized: true })
        current = await driver.read(project, target)
        if (current.values[operation.key] !== operation.oldValue) throw failure()
      } else {
        if (record && current.values[operation.key] === operation.oldValue) continue
        if (record || !operation.restorable) throw failure()
        await driver.write(project, target, { kind: 'create', key: operation.key, value: operation.oldValue, type: operation.record.type, comment: operation.record.comment }, { authorized: true })
        current = await driver.read(project, target)
        if (current.values[operation.key] !== operation.oldValue) throw failure()
      }
    } catch { failures.push({ target, key: operation.key, reason: 'restoration_not_verified' }) }
  }
  return failures
}
function restoreFiles(root, state) {
  const failures = []
  for (const attempted of [...(state.localAttempts || [])].reverse()) {
    const file = attempted.file, text = state.originalFiles[file]
    try {
      const full = path.join(root, file), current = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null
      if (current === text) continue
      if (current === null || security.hash(current) !== attempted.sha256) throw failure('Modification locale concurrente.')
      if (text === null) fs.rmSync(full, { force: true }); else core.writePrivate(full, text)
      const restored = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null
      if (restored !== text) throw failure('Restauration locale non confirmée.')
    } catch { failures.push({ file, reason: 'local_restoration_not_verified' }) }
  }
  return failures
}
function render(report) {
  const lines = ['========================================', '       GARAGEFLOWS NODE CONFIG', '========================================',
    `MODE : ${report.dryRun ? 'SIMULATION — aucune mutation' : 'SYNCHRONISATION'}`, `VERCEL : ${report.connection}`]
  if (report.inventory) lines.push(report.dryRun ? `Variables détectées (références littérales) : ${report.inventory.references.map(r => r.name).join(', ') || 'aucune'}` : `Inventaire : ${report.inventory.files} fichiers, ${report.inventory.references.length} noms référencés littéralement.`)
  for (const target of TARGETS) {
    const e = report.environments[target]
    lines.push(`${target} : ${e?.status || 'NON VÉRIFIÉ'}`)
    if (e?.plan) for (const kind of ['create', 'update', 'remove']) lines.push(`  ${kind} : ${e.plan[kind].join(', ') || 'aucune'}`)
    if (e?.plan?.blocked.length) lines.push(`  bloquées : ${e.plan.blocked.map(b => `${b.key} (${b.reason})`).join(', ')}`)
    if (e?.plan?.unverified.length) lines.push(`  comparaison non vérifiable : ${e.plan.unverified.join(', ')}`)
    if (e?.generated?.length) lines.push(`  clés ${report.dryRun ? 'générables SI base vide et absence distante confirmées' : 'générées'} : ${e.generated.join(', ')}`)
    if (e?.missing?.length) lines.push(`  manquantes : ${e.missing.join(', ')}`)
    lines.push(`  Neon pool/direct : ${e?.checks?.database ? 'connexion testée' : 'NON VÉRIFIÉ'} ; Redis : ${e?.checks?.redis ? 'PING vérifié' : 'NON VÉRIFIÉ'}`)
    lines.push(`  Blob : ${e?.checks?.blob ? e.checks.blob.write === 'verified' ? 'association + PUT/HEAD/DELETE vérifiés' : 'association + liste vérifiées ; écriture NON TESTÉE' : 'NON VÉRIFIÉ'}`)
  }
  const environments = Object.values(report.environments)
  const completeInventory = environments.length === TARGETS.length && environments.every(e => Array.isArray(e.missing) && Array.isArray(e.issues))
  lines.push(`Variables requises manquantes : ${completeInventory ? environments.reduce((n, e) => n + e.missing.length, 0) : 'NON FINALISÉ'} ; incohérences de format : ${completeInventory ? environments.reduce((n, e) => n + e.issues.length, 0) : 'NON FINALISÉ'} ; erreurs : ${report.errors?.length || 0}`)
  lines.push(`Fichiers .env secrets suivis détectés : ${report.security?.trackedSecretFiles?.length ?? 'NON VÉRIFIÉ'} (ce contrôle ne remplace pas un scan de secrets complet).`)
  for (const error of report.errors || []) lines.push(`ERREUR : ${error}`)
  lines.push(`Fichiers prévus/modifiés : ${report.files.join(', ') || 'aucun'}`, `Protection Git : ${report.security?.ok ? 'contrôlée sur l’arbre courant ; historique non purgé' : 'BLOQUÉE / NON VÉRIFIÉE'}`,
    `STATUT : ${report.status}`, report.blobApplicationConsumer ? 'Blob : consommateur littéral trouvé ; aucun test des parcours applicatifs effectué.' : 'Blob : aucun consommateur applicatif trouvé ; aucune migration des uploads/sauvegardes effectuée.', 'Aucun déploiement ni migration SQL exécuté par ce gestionnaire.', '========================================')
  return lines.join('\n')
}
async function manage(api, { dryRun = false, offline = false, rotateSessions = false, blobWrite = false, driver = cloud(api), inventory = audit } = {}) {
  const root = api.root, folder = path.join(root, VAULT), stateFile = path.join(folder, 'manager-state.json'), receiptFile = path.join(folder, 'manager-receipts.json')
  const policy = loadPolicy(root), entries = json(path.join(root, 'scripts/compromised-secrets.json'), { entries: [] }).entries
  const destinations = [...Object.values(FILES).flat(), ...TARGETS.map(t => `.env.storage.${t}.local`), `${VAULT}/manager-state.json`, `${VAULT}/manager-report.json`, `${VAULT}/manager-receipts.json`]
  const report = { schema: 1, dryRun, connection: 'NON VÉRIFIÉE', status: 'EN PRÉPARATION', environments: {}, files: [], security: null, errors: [] }
  let state, project, locked = false, backup, receipts = {}, snapshots = {}, plans = [], writing = false
  const fileTexts = {}, originalTexts = {}
  const lock = path.join(folder, 'manager.lock')
  const save = () => { if (!dryRun) core.writePrivate(stateFile, JSON.stringify(state, null, 2) + '\n') }
  const checkpoint = (target, env) => { state.drafts[target] = env; save() }
  try {
    if (!dryRun && (process.env.DEBUG || process.env.NEXT_PUBLIC_DEBUG)) throw failure('Mode DEBUG actif : désactiver DEBUG/NEXT_PUBLIC_DEBUG avant la configuration pour empêcher les bibliothèques de tracer des credentials.')
    report.security = security.gitProtection(root, destinations)
    if (!report.security.ok) throw failure('Git : secrets suivis, exemples contenant des secrets, lien symbolique ou destination non ignorée ; corriger avant configuration.')
    const scan = inventory(root)
    report.blobApplicationConsumer = [...(scan.references.get('BLOB_READ_WRITE_TOKEN') || [])].some(file => file.startsWith('src/'))
    report.inventory = { files: scan.files, textFiles: scan.textFiles, binaries: scan.binaries,
      references: [...scan.references].filter(([name]) => safeName(name)).map(([name, files]) => ({ name, files: files.size })),
      limits: 'Références littérales uniquement ; les accès dynamiques ne prouvent pas l’absence de consommateur.' }
    if (offline && !dryRun) throw failure('--offline est réservé à la simulation.')
    if (!dryRun && await api.question('Saisir AUTORISER : préparation des trois environnements, sans suppression avant validation') !== 'AUTORISER') { report.status = 'ANNULÉ'; return report }
    if (!offline) { project = await driver.connect({ dryRun }); report.connection = 'COMPTE, PROJET ET ÉQUIPE VÉRIFIÉS' }
    else report.connection = 'NON VÉRIFIÉE — simulation locale hors ligne'
    if (!dryRun && !await api.yes(`Confirmer projet ${project.projectId}, équipe ${project.orgId}, environnements Development / Preview / Production`)) throw failure('Cible non confirmée.')
    if (!dryRun) {
      fs.mkdirSync(folder, { recursive: true, mode: 0o700 })
      if (process.platform !== 'win32' && (fs.statSync(folder).mode & 0o077)) fs.chmodSync(folder, 0o700)
      try { const fd = fs.openSync(lock, 'wx', 0o600); fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd); locked = true }
      catch { throw failure('Configuration déjà en cours/interrompue : vérifier le processus avant de retirer manager.lock.') }
    }
    state = json(stateFile, { schema: 1, project, drafts: {}, phase: 'preparing', attempts: [] })
    if (!state || state.schema !== 1 || !state.drafts || !Array.isArray(state.attempts) || Object.keys(state.originalFiles || {}).some(file => !destinations.includes(file) || (state.originalFiles[file] !== null && typeof state.originalFiles[file] !== 'string')) || (state.localAttempts && (!Array.isArray(state.localAttempts) || state.localAttempts.some(a => !a || !Object.hasOwn(state.originalFiles || {}, a.file) || !destinations.includes(a.file) || !/^[a-f0-9]{64}$/.test(a.sha256)))) || (!offline && !sameProject(state.project, project))) throw failure('Reprise liée à une autre cible ou journal invalide ; aucune mutation.')
    receipts = json(receiptFile, {})
    if (!sameProject(receipts.project, project)) receipts = { project, environments: {} }
    else if (!receipts.environments || typeof receipts.environments !== 'object' || Array.isArray(receipts.environments)) throw failure('Reçus locaux invalides ; aucune mutation.')
    if (!dryRun && ['applying', 'rollback-incomplete', 'rolling-back'].includes(state.phase)) {
      if (!await api.yes('Transaction interrompue : tenter la restauration vérifiée avant toute nouvelle synchronisation')) throw failure('Reprise non autorisée.')
      const failed = [...await rollback(driver, project, state.attempts), ...restoreFiles(root, state)]
      if (failed.length) { report.restoration = failed; throw failure('Restauration incomplète : valeurs masquées ou modifications concurrentes ; assistance nécessaire, journal conservé.') }
      state.phase = 'preparing'; state.attempts = []; state.localAttempts = []; save()
    }
    // Inventory ALL three targets before generating keys or contacting providers.
    for (const target of TARGETS) snapshots[target] = offline ? { records: [], values: {}, branchOverrides: 0 } : await driver.read(project, target)
    for (const target of TARGETS) {
      const snapshot = snapshots[target]
      state.sourceStamps ||= {}
      if (state.sourceStamps[target] && state.sourceStamps[target] !== signature(snapshot)) delete state.drafts[target]
      state.sourceStamps[target] = signature(snapshot)
      const existing = Object.assign({}, ...[...FILES[target]].reverse().map(file => core.readEnv(path.join(root, file))))
      const seed = core.readEnv(path.join(root, `.env.storage.${target}.local`))
      const legacySeed = target === 'production' ? core.readEnv(path.join(root, '.env.storage.local')) : {}
      const cleanedSources = [legacySeed, existing, seed, state.drafts[target] || {}, snapshot.values].map(source => security.cleanCredentials(normalizeStorage(source), entries))
      const cleaned = { safe: Object.assign({}, ...cleanedSources.map(s => s.safe)), rejected: [...new Set(cleanedSources.flatMap(s => s.rejected))] }
      let env = cleaned.safe
      report.environments[target] = { status: 'EN PRÉPARATION', rejectedExposed: cleaned.rejected, branchOverridesPreserved: snapshot.branchOverrides || 0, checks: {} }
      // Remove aliases whose URL embeds a compromised password before normalizing.
      env = normalizeStorage(env)
      for (const [alias, definition] of Object.entries(policy.manifest.forbiddenAliases)) {
        const canonical = typeof definition === 'string' ? definition : definition.canonical
        if (!env[canonical] && env[alias]) env[canonical] = env[alias]
      }
      const exposedNames = [...new Set([...Object.keys(env), ...snapshot.records.map(r => r.key)])].filter(n => /^NEXT_PUBLIC_/.test(n) && core.isSecret(n) && !/PUBLIC_KEY$/.test(n))
      if (exposedNames.length) throw failure(`${target} : noms de secrets publics interdits (${exposedNames.join(', ')}). Révoquer les valeurs exposées et retirer ces overrides avant synchronisation.`)
      if (snapshot.records.some(r => r.key === 'ELECTRON') || (target !== 'development' && env.NODE_ENV && env.NODE_ENV !== 'production')) throw failure(`${target} : override de runtime incompatible (ELECTRON ou NODE_ENV). Retirer cet override serveur avant synchronisation.`)
      if (!dryRun) {
        checkpoint(target, env)
        if (await api.yes(`${target} : tenter la récupération des accès manquants chez les fournisseurs`)) {
          await driver.recover(target, env)
          env = security.cleanCredentials(env, entries).safe
          checkpoint(target, env)
        }
        if (target === 'production' && (!env.DATABASE_URL || !env.DIRECT_URL) && await api.yes('Utiliser les hôtes Neon de référence us-east-2 avec votre NOUVEAU mot de passe')) {
          const field = {}
          await api.secretField(field, 'PGPASSWORD', 'Neon : NOUVEAU mot de passe réel (ancien exposé interdit)')
          if (!security.compromised(field.PGPASSWORD, entries)) Object.assign(env, security.neonVariables(field.PGPASSWORD))
          checkpoint(target, env)
        }
        for (const name of BASE_REQUIRED) {
          while (!decoder.readable(env[name]) || security.compromised(env[name], entries)) {
            delete env[name]
            console.log(safeMessage(target, name))
            await api.secretField(env, name, `${target} — ${name} (Entrée = interrompre et reprendre ultérieurement)`)
            Object.assign(env, normalizeStorage(env))
            if (!decoder.readable(env[name])) { checkpoint(target, env); throw failure(`Configuration suspendue : ${target} / ${name}. Relancer node config pour reprendre.`) }
            if (security.compromised(env[name], entries)) { delete env[name]; console.log('Valeur précédemment exposée refusée ; rotation fournisseur obligatoire.') }
            checkpoint(target, env)
          }
        }
      }
      if (env.NEXTAUTH_URL) env.GF_APP_URL ||= env.NEXTAUTH_URL
      if (env.DIRECT_URL) env.DATABASE_URL_UNPOOLED = env.DIRECT_URL
      const generated = [], needsOriginal = []
      for (const name of core.namesForProfile(policy.names, 'pwa')) if (!env[name] && core.DEFAULTS[name]) env[name] = core.DEFAULTS[name]
      const required = [...new Set([...BASE_REQUIRED, ...policy.entries.filter(e => e.requiredProduction && e.action === 'application').map(e => e.name)])]
      if (!dryRun) {
        const checks = report.environments[target].checks
        // All provider checks occur BEFORE generating or rotating application keys.
        const probe = async (label, fields, action) => {
          for (;;) {
            try {
              if (fields.some(n => security.compromised(env[n], entries))) throw failure('Valeur exposée interdite.')
              return await action()
            } catch (error) {
              if (error.configPhase === 'dependencies') throw failure(error.message)
              console.log(`${target} — ${label} : vérification non confirmée (format, droits, association ou connexion). Aucune mutation distante.`)
              if (!await api.yes(`${target} — corriger les accès ${label} maintenant (sinon suspendre avec reprise)`)) throw failure(`${target} : ${label} non vérifié ; saisies conservées pour reprise.`)
              for (const field of fields) {
                delete env[field]
                await api.secretField(env, field, `${target} — nouveau ${field}`)
                Object.assign(env, normalizeStorage(env))
                checkpoint(target, env)
                if (!decoder.readable(env[field])) throw failure(`Configuration suspendue : ${target} / ${field}.`)
              }
              if (env.DIRECT_URL) env.DATABASE_URL_UNPOOLED = env.DIRECT_URL
            }
          }
        }
        checks.database = await probe('Neon', ['DATABASE_URL', 'DIRECT_URL'], async () => {
          if (security.postgresIssues(env).length) throw failure('Format Neon/SSL invalide.')
          await driver.ensureClients(env)
          const result = await driver.probeDatabase(env)
          if (result?.pooled !== true || result?.direct !== true || typeof result.empty !== 'boolean') throw failure('Sondes SQL incomplètes.')
          return result
        })
        checks.redis = await probe('Redis', ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'], async () => {
          if (await driver.probeRedis(env) !== true) throw failure('PING non confirmé.')
          return true
        })
        checks.blob = await probe('Blob', ['BLOB_READ_WRITE_TOKEN'], async () => {
          const ids = await driver.blobStores(project, target, snapshot)
          const result = await driver.probeBlob(env, ids)
          if (result?.associated !== true || result?.list !== true) throw failure('Sonde Blob incomplète.')
          return result
        })
        if (blobWrite) {
          if (!await api.yes(`${target} : autoriser PUT/HEAD/DELETE d’un objet de sonde Blob sans secret (opérations potentiellement facturées)`)) throw failure(`${target} : sonde Blob mutante non autorisée.`)
          const choice = await api.select(`${target} : visibilité effective du store Blob (aucune modification du store)`, [{ id: 'private', name: 'Privé' }, { id: 'public', name: 'Public' }])
          try {
            const result = await driver.probeBlobWrite(env, await driver.blobStores(project, target, snapshot), { authorized: true, access: choice.id })
            if (result?.write !== true || result?.read !== true || result?.delete !== true) throw failure('Sonde Blob incomplète.')
            checks.blob.write = 'verified'; checks.blob.delete = 'verified'
          } catch (error) {
            if (error.probe?.cleanupVerified === false && /^garageflows-config-probe\/[a-f0-9-]+\.txt$/.test(error.probe.pathname)) report.environments[target].blobProbeCleanupPending = error.probe.pathname
            throw failure(`${target} : écriture/lecture/suppression Blob non confirmée ; vérifier la sonde signalée, aucune mutation des variables.`)
          }
        }
        const generable = { ...core.GENERATED, ...(env.EINVOICING_ENABLED === 'true' ? { GF_EINVOICE_CREDENTIALS_KEY: 'base64' } : {}) }
        for (const [name, format] of Object.entries(generable)) {
          if (!core.namesForProfile(policy.names, 'pwa').includes(name)) continue
          if (env[name] && !(rotateSessions && SESSION_KEYS.includes(name))) continue
          const existed = snapshot.records.some(r => r.key === name)
          if ((existed || !checks.database.empty) && !(rotateSessions && SESSION_KEYS.includes(name))) {
            if (!env[name]) { console.log(safeMessage(target, name)); await api.secretField(env, name, `${target} — clé ORIGINALE ${name} (aucun remplacement automatique)`); needsOriginal.push(name) }
          } else { env[name] = crypto.randomBytes(32).toString(format); generated.push(name) }
          checkpoint(target, env)
        }
        for (const r of snapshot.records.filter(r => core.namesForProfile(policy.names, 'pwa').includes(r.key) && !env[r.key])) {
          console.log(safeMessage(target, r.key)); await api.secretField(env, r.key, `${target} — original ${r.key}`); checkpoint(target, env)
          if (!decoder.readable(env[r.key])) throw failure(`Original indispensable non fourni : ${target} / ${r.key}.`)
        }
      } else {
        for (const name of Object.keys(core.GENERATED).filter(n => core.namesForProfile(policy.names, 'pwa').includes(n) && !env[n])) {
          if (snapshot.records.some(r => r.key === name)) needsOriginal.push(name)
          else generated.push(name)
        }
      }
      let missing = required.filter(n => !decoder.readable(env[n]) && !(dryRun && generated.includes(n)))
      let issues = dryRun ? security.postgresIssues(env) : [...security.postgresIssues(env), ...core.validate(env, 'pwa', { vercel: true, allowLocalHttp: target === 'development', publicPem: env.GF_PRIVATE_KEY ? core.embeddedLicenseKey(root) : undefined })]
      if (!dryRun && issues.length) {
        console.log(issues.join('\n'))
        const fixable = [...new Set(issues.map(issue => issue.match(/^([A-Z][A-Z0-9_]*) :/)?.[1]).filter(name => name && (!BASE_REQUIRED.includes(name) || name === 'NEXTAUTH_URL')))]
        if (fixable.length && await api.yes(`${target} : corriger les variables de format invalide avant toute mutation`)) {
          for (const name of fixable) { delete env[name]; await api.secretField(env, name, `${target} — ${name}`); checkpoint(target, env) }
          missing = required.filter(n => !decoder.readable(env[n]))
          issues = [...security.postgresIssues(env), ...core.validate(env, 'pwa', { vercel: true, allowLocalHttp: target === 'development', publicPem: env.GF_PRIVATE_KEY ? core.embeddedLicenseKey(root) : undefined })]
        }
      }
      const rejected = security.cleanCredentials(env, entries).rejected
      if (rejected.length) throw failure(`${target} : valeur exposée refusée (${rejected.join(', ')}).`)
      if (Object.keys(env).some(n => /^NEXT_PUBLIC_.*(?:SECRET|PRIVATE_KEY|PEPPER|TOKEN|PASSWORD|API_KEY)/.test(n))) throw failure(`${target} : secret public interdit.`)
      if (!dryRun && (missing.length || issues.length)) throw failure(`${target} : configuration invalide (${[...missing, ...issues].join(', ')}).`)
      const plan = planTarget(snapshot, env, policy, receipts.environments, target, entries)
      report.environments[target] = { ...report.environments[target], status: dryRun ? 'SIMULÉ — connexions non testées' : 'PRÉVALIDÉ', missing, issues, generated, needsOriginal, plan: summary(plan) }
      plans.push(plan)
      if (!dryRun) checkpoint(target, env)
    }
    for (const plan of plans) {
      for (const file of FILES[plan.target]) fileTexts[file] = localText(root, plan.target, file, plan, entries)
      const providerValues = Object.fromEntries(Object.entries(plan.values).filter(([key]) => /^(?:DATABASE_URL|DIRECT_URL|PG|POSTGRES_|KV_|REDIS_URL|UPSTASH_|BLOB_)/.test(key)))
      fileTexts[`.env.storage.${plan.target}.local`] = core.serializeEnv(providerValues, Object.keys(providerValues).sort(), `storage-${plan.target}`)
    }
    for (const [file, text] of Object.entries(fileTexts)) {
      originalTexts[file] = fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8') : null
      const needsPermissions = process.platform !== 'win32' && fs.existsSync(path.join(root, file)) && (fs.statSync(path.join(root, file)).mode & 0o077) !== 0
      if (originalTexts[file] !== text || needsPermissions) report.files.push(file)
    }
    if (dryRun) { report.status = offline ? 'SIMULATION LOCALE — VERCEL ET CONNEXIONS NON VÉRIFIÉS' : 'SIMULATION — AUCUNE MUTATION'; return report }
    if (plans.some(p => p.blocked.length)) throw failure('Plan bloqué : variable partagée entre cibles ou détenue par une intégration ; aucune mutation distante.')
    for (let i = 0; i < plans.length; i++) for (let j = i + 1; j < plans.length; j++) {
      if (plans[i].values.DIRECT_URL === plans[j].values.DIRECT_URL && !await api.yes(`ATTENTION : ${plans[i].target} et ${plans[j].target} partagent exactement la même base Neon. Autoriser explicitement ce partage`)) throw failure('Isolation des environnements non confirmée.')
    }
    console.log(render(report))
    const irreversible = plans.flatMap(p => p.operations.filter(o => !o.restorable).map(o => `${p.target}/${o.key}`))
    const destructive = plans.some(p => p.operations.some(o => o.kind !== 'create')) || rotateSessions
    if (destructive && !await api.yes(`Confirmer les remplacements/suppressions listés${irreversible.length ? ` ; restauration IMPOSSIBLE des anciennes valeurs : ${irreversible.join(', ')} ; remplacer une clé applicative peut invalider des jetons ou rendre des données illisibles` : ''}${rotateSessions ? ' ; rotation des sessions/API, invalidation des jetons' : ''}`)) throw failure('Opérations destructives non autorisées.')
    const needsApplication = report.files.length > 0 || plans.some(p => p.operations.length)
    if (needsApplication && !await api.yes('Appliquer ce plan validé et synchroniser les fichiers locaux listés')) { report.status = 'PLAN NON APPLIQUÉ'; return report }
    // Reread every target, including metadata for masked values, immediately before mutation.
    for (const target of TARGETS) if (signature(await driver.read(project, target)) !== signature(snapshots[target])) throw failure('Vercel a changé pendant la préparation ; aucun changement appliqué.')
    if (!sameProject(await driver.connect({ dryRun: true }), project)) throw failure('Cible modifiée avant mutation.')
    if (!needsApplication) {
      for (const plan of plans) {
        const snapshot = snapshots[plan.target]
        if (plan.names.some(name => plan.values[name] && !decoder.readable(snapshot.values[name]))) plan.unverified.push('masked_readback')
        report.environments[plan.target].status = plan.unverified.length ? 'INCHANGÉ — comparaison des secrets masqués NON VÉRIFIABLE' : 'INCHANGÉ — VALEURS ET CONNEXIONS VÉRIFIÉES'
      }
      state.phase = 'complete'; state.attempts = []; state.localAttempts = []; state.originalFiles = {}; save()
      report.status = plans.some(p => p.unverified.length) ? 'CONFIGURATION INCHANGÉE — VÉRIFICATION PARTIELLE' : blobWrite ? 'CONFIGURATION VALIDÉE (sondes fournisseurs incluses)' : 'CONFIGURATION VALIDÉE (Blob : lecture seulement)'
      return report
    }
    backup = fs.mkdtempSync(path.join(folder, 'manager-backup-')); fs.chmodSync(backup, 0o700)
    core.writePrivate(path.join(backup, 'remote.json'), JSON.stringify({ project, snapshots }, null, 2) + '\n')
    state.backup = path.basename(backup); state.originalFiles = {}
    for (const file of report.files) {
      const full = path.join(root, file), text = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null
      if (text !== originalTexts[file]) throw failure('Fichier local modifié pendant la préparation ; aucune mutation distante.')
      state.originalFiles[file] = text
      if (text !== null) core.writePrivate(path.join(backup, file), text)
    }
    state.phase = 'applying'; state.attempts = []; state.localAttempts = []; save(); writing = true
    for (const plan of plans) for (const operation of plan.operations) {
      // Persist BEFORE request: even a lost response after a successful write can be recovered.
      state.attempts.push({ target: plan.target, operation }); save()
      await driver.write(project, plan.target, operation, { authorized: true })
      const actual = await driver.read(project, plan.target)
      const proof = verifyOperation(actual, operation, operation.record)
      if (!proof) throw failure('Vercel : écriture non confirmée ; restauration engagée.')
      if (proof === 'metadata_only') plan.unverified.push(operation.key)
      state.attempts.at(-1).proof = proof; save()
    }
    for (const plan of plans) {
      const actual = await driver.read(project, plan.target), actualRecords = recordMap(actual)
      state.sourceStamps[plan.target] = signature(actual)
      const expectedKeys = new Set([...snapshots[plan.target].records.map(r => r.key), ...plan.operations.filter(o => o.kind === 'create').map(o => o.key)])
      for (const op of plan.operations.filter(o => o.kind === 'remove')) expectedKeys.delete(op.key)
      if (actualRecords.size !== expectedKeys.size || [...expectedKeys].some(key => !actualRecords.has(key))) throw failure('Vercel : inventaire final inattendu ; synchronisation interrompue.')
      receipts.environments[plan.target] ||= {}
      for (const name of plan.names.filter(n => plan.values[n])) {
        const r = actualRecords.get(name)
        if (!r) throw failure('Vercel : variable indispensable absente à la vérification finale.')
        if (decoder.readable(actual.values[name]) && actual.values[name] !== plan.values[name]) throw failure('Vercel : valeur différente du plan à la relecture finale.')
        if (!decoder.readable(actual.values[name])) plan.unverified.push(name)
        if (decoder.readable(actual.values[name]) || plan.operations.some(op => op.key === name && op.kind !== 'remove')) receipts.environments[plan.target][name] = { sha256: security.hash(plan.values[name]), stamp: stamp(r), proof: decoder.readable(actual.values[name]) ? 'value' : 'metadata_only' }
      }
      for (const file of [...FILES[plan.target], `.env.storage.${plan.target}.local`]) if (report.files.includes(file)) {
        const current = fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8') : null
        if (current !== originalTexts[file]) throw failure('Fichier local modifié pendant la transaction ; restauration nécessaire.')
        state.localAttempts.push({ file, sha256: security.hash(fileTexts[file]) }); save()
        core.writePrivate(path.join(root, file), fileTexts[file])
      }
      for (const file of FILES[plan.target]) {
        const local = core.readEnv(path.join(root, file))
        if (plan.names.some(name => plan.values[name] && local[name] !== plan.values[name])) throw failure('Fichiers locaux : relecture différente du plan.')
      }
      report.environments[plan.target].status = plan.unverified.length ? 'APPLIQUÉ — comparaison des secrets masqués NON VÉRIFIABLE' : 'VALEURS ET CONNEXIONS VÉRIFIÉES'
    }
    core.writePrivate(receiptFile, JSON.stringify(receipts, null, 2) + '\n')
    state.phase = 'complete'; save(); writing = false
    report.status = plans.some(p => p.unverified.length) ? 'CONFIGURATION APPLIQUÉE — VÉRIFICATION PARTIELLE' : blobWrite ? 'CONFIGURATION VALIDÉE (sondes fournisseurs incluses)' : 'CONFIGURATION VALIDÉE (Blob : lecture seulement)'
    return report
  } catch (error) {
    // Provider messages and payloads must NEVER become report/log content.
    report.status = 'INTERROMPU — AUCUNE VALIDATION GLOBALE'
    report.errors.push(error.configSafe ? error.message : error.vercelApi ? `Vercel : ${require('./lib/config-vercel-api.cjs').safeFailure(error.vercelApi).reason} (HTTP ${require('./lib/config-vercel-api.cjs').safeFailure(error.vercelApi).httpStatus || 'indisponible'}).` : 'Opération non confirmée ; erreurs fournisseur masquées. Vérifier les étapes et les paramètres indiqués.')
    if (writing && state) {
      state.phase = 'rolling-back'; save()
      report.restoration = await rollback(driver, project, state.attempts)
      report.restoration.push(...restoreFiles(root, state))
      for (const target of TARGETS) if (report.environments[target]) report.environments[target].status = report.restoration.length ? 'ÉCHEC — RESTAURATION PARTIELLE' : 'TRANSACTION ANNULÉE — RESTAURATION VÉRIFIÉE'
      state.phase = report.restoration.length ? 'rollback-incomplete' : 'preparing'
      if (!report.restoration.length) { state.attempts = []; state.localAttempts = [] }
      save()
    }
    return report
  } finally {
    if (!dryRun && locked) {
      try { core.writePrivate(path.join(folder, 'manager-report.json'), JSON.stringify(report, null, 2) + '\n') }
      catch { report.status = 'INTERROMPU — RAPPORT NON ENREGISTRÉ'; report.errors.push('Rapport privé non sauvegardé : vérifier les permissions et l’espace disque.') }
      finally {
        try { fs.rmSync(lock, { force: true }) }
        catch { report.status = 'INTERROMPU — VERROU NON RETIRÉ'; report.errors.push('Verrou local non retiré ; contrôler le processus avant reprise.') }
      }
    }
    console.log(render(report))
  }
}
module.exports = { FILES, BASE_REQUIRED, SESSION_KEYS, planTarget, summary, verifyOperation, signature, rollback, restoreFiles, render, manage }
