'use strict'
// A separate, consented storage connection operation. Never part of the main
// env transaction: after it completes, node config takes fresh inventories.
const fs = require('node:fs')
const path = require('node:path')
const core = require('./config-core.cjs')
const security = require('./lib/config-credentials.cjs')
const decoder = require('./lib/config-vercel-env.cjs')
const { TARGETS, validName, cloud } = require('./lib/config-cloud.cjs')
const { VAULT, FILES, signature } = require('./config-manager.cjs')
function failure(message) { const error = new Error(message); error.configSafe = true; return error }
const same = (a, b) => !!a?.projectId && !!a?.orgId && a.projectId === b?.projectId && a.orgId === b?.orgId
const scopes = connection => connection.environments || connection.envVarEnvironments || []
const blobName = name => validName(name) && /_(?:READ_WRITE_TOKEN|STORE_ID|WEBHOOK_PUBLIC_KEY)$/.test(name)
const connectionStamp = c => JSON.stringify([c.id, c.projectId, [...scopes(c)].sort(), c.envVarPrefix,
  [...(c.environmentVariables || [])].sort(), c.makeEnvVarsSensitive, c.skipReadWriteToken])
const storeStamp = store => JSON.stringify([store.id, store.type, store.projectsMetadata.map(connectionStamp).sort()])
function inspectPlan(plan, project, store, target, action, applied) {
  if (plan?.action !== action || plan.store?.id !== store.id || !['blob', 'unknown'].includes(plan.store.type) ||
    !Array.isArray(plan.projects) || plan.projects.length !== 1 || plan.projects[0].id !== project.projectId ||
    !Array.isArray(plan.environments) || plan.environments.length !== 1 || plan.environments[0] !== target ||
    plan.auth?.effective !== 'oidc' || plan.auth?.readWriteToken !== true || plan.applied !== applied ||
    !Array.isArray(plan.envVars?.add) || !Array.isArray(plan.envVars?.remove) || !Array.isArray(plan.envVars?.keep) || plan.envVars.remove.length ||
    [...plan.envVars.add, ...plan.envVars.keep].some(name => !blobName(name)) ||
    ![...plan.envVars.add, ...plan.envVars.keep].some(name => name.endsWith('_READ_WRITE_TOKEN'))) {
    throw failure('Rattachement Blob : plan inattendu, suppressions, cible différente ou token statique absent ; aucune suite automatique.')
  }
  return { action, storeId: store.id, target, add: plan.envVars.add, keep: plan.envVars.keep, remove: [] }
}
async function setupBlob(api, { target, driver = cloud(api) } = {}) {
  if (!TARGETS.includes(target)) throw failure('Utiliser node config --connect-blob --environment development (ou preview / production).')
  const root = api.root, folder = path.join(root, VAULT), lock = path.join(folder, 'manager.lock')
  let locked = false, backup, attempted = false, journal, mainState, mainText, verifiedSnapshot
  const mainFile = path.join(folder, 'manager-state.json')
  try {
    if (process.env.DEBUG || process.env.NEXT_PUBLIC_DEBUG) throw failure('Désactiver DEBUG/NEXT_PUBLIC_DEBUG avant le rattachement Blob.')
    const destinations = [...Object.values(FILES).flat(), ...TARGETS.map(t => `.env.storage.${t}.local`), `${VAULT}/blob-setup-report.json`, `${VAULT}/manager.lock`, `${VAULT}/manager-state.json`]
    if (!security.gitProtection(root, destinations).ok) throw failure('Protection Git/fichiers privés non confirmée ; aucun rattachement.')
    console.log(`Réparation Blob uniquement — cible ${target}. Aucun déploiement, migration, création de store ni suppression de connexion.`)
    console.log('Le CLI officiel peut ajouter un rattachement et ses variables, dont un token statique privé, après sauvegarde et confirmation. Les autres cibles ne doivent pas changer.')
    if (await api.question('Pour préparer ce rattachement, saisir AUTORISER BLOB') !== 'AUTORISER BLOB') return { status: 'ANNULÉ', target }
    const project = await driver.connect()
    if (!await api.yes(`Confirmer projet ${project.projectId}, équipe ${project.orgId}, rattachement Blob ${target} uniquement`)) return { status: 'ANNULÉ', target }
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') fs.chmodSync(folder, 0o700)
    try { const fd = fs.openSync(lock, 'wx', 0o600); fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd); locked = true }
    catch { throw failure('Configuration déjà en cours/interrompue ; vérifier le processus et manager.lock avant de reprendre.') }
    // Do not collide with the main transaction's recovery or overwrite its drafts.
    try {
      mainText = fs.readFileSync(mainFile, 'utf8')
      mainState = JSON.parse(mainText)
      if (!same(mainState.project, project) || ['applying', 'rolling-back', 'rollback-incomplete'].includes(mainState.phase)) throw failure('Journal principal lié à une autre cible ou transaction à restaurer : relancer node config avant tout rattachement.')
    } catch (error) { if (error.code !== 'ENOENT') throw error.configSafe ? error : failure('Journal principal illisible : aucun rattachement.') }
    const stores = await driver.listBlobResources(project)
    if (!stores.length) throw failure('Aucun store Blob visible dans cette équipe. Vérifier le compte/équipe Vercel ou créer le store dans son tableau de bord ; aucun store inventé.')
    const chosen = await api.select(`${target} — sélectionner le store Blob existant à rattacher`, stores.map(s => ({ id: s.id, name: `${s.name} (${s.id})` })))
    if (!stores.some(s => s.id === chosen.id)) throw failure('Store Blob non issu de l’inventaire autorisé.')
    const store = await driver.blobResource(project, chosen.id)
    const connections = store.projectsMetadata.filter(c => c.projectId === project.projectId && Array.isArray(scopes(c)) && scopes(c).includes(target))
    if (connections.length > 1) throw failure('Plusieurs connexions Blob couvrent cette cible : séparer les portées dans Vercel, aucune suppression automatique.')
    const before = {}
    for (const t of TARGETS) before[t] = await driver.read(project, t)
    const preserveDraft = (fresh, allowedKeys) => {
      if (!mainState) return
      const previous = mainState.sourceStamps?.[target], next = signature(fresh)
      if (previous === next) return
      if (previous) {
        let rows
        try { rows = JSON.parse(previous) } catch { throw failure('Empreinte du brouillon illisible ; aucun écrasement de reprise.') }
        const keep = rows => rows.filter(row => !allowedKeys.has(row[0]))
        if (!Array.isArray(rows) || rows.some(row => !Array.isArray(row))) throw failure('Empreinte du brouillon invalide ; aucun écrasement de reprise.')
        if (JSON.stringify(keep(rows)) !== JSON.stringify(keep(JSON.parse(next)))) {
          console.log('Des variables hors Blob ont changé depuis le brouillon : node config contrôlera cette dérive avant de reprendre.')
          return
        }
      }
      if (fs.readFileSync(mainFile, 'utf8') !== mainText) throw failure('Brouillon modifié en parallèle : aucun écrasement du fichier de reprise.')
      mainState.sourceStamps ||= {}
      mainState.sourceStamps[target] = next
      core.writePrivate(mainFile, JSON.stringify(mainState, null, 2) + '\n')
    }
    const verify = async () => {
      const fresh = await driver.read(project, target)
      const ids = await driver.blobStores(project, target, fresh)
      verifiedSnapshot = fresh
      if (!ids.includes(store.id)) throw failure('Rattachement Blob non confirmé à la relecture ; aucun succès revendiqué.')
      const token = core.normalizeInput('BLOB_READ_WRITE_TOKEN', fresh.values.BLOB_READ_WRITE_TOKEN)
      if (!decoder.readable(token)) return { connection: true, api: 'NON VÉRIFIÉE — token Vercel illisible ; node config demandera une valeur locale' }
      const entries = JSON.parse(fs.readFileSync(path.join(root, 'scripts/compromised-secrets.json'), 'utf8')).entries
      if (security.compromised(token, entries)) return { connection: true, api: 'NON VÉRIFIÉE — token exposé ; renouveler ou décider explicitement dans node config' }
      if (driver.ensureBlobClient) await driver.ensureBlobClient()
      const result = await driver.probeBlob({ BLOB_READ_WRITE_TOKEN: token }, [store.id])
      if (result?.associated !== true || result?.list !== true) throw failure('Rattachement présent, mais contrôle de lecture Blob non confirmé ; vérifier le token et les droits.')
      return { connection: true, api: 'LISTE BLOB VÉRIFIÉE' }
    }
    if (connections.length && decoder.readable(before[target].values.BLOB_READ_WRITE_TOKEN)) {
      const checks = await verify()
      preserveDraft(verifiedSnapshot, new Set((connections[0].environmentVariables || []).filter(blobName)))
      console.log(`Rattachement ${target} déjà confirmé, aucune mutation. ${checks.api}. Taper ensuite dans CMD : node config`)
      return { status: 'RATTACHEMENT DÉJÀ CONFIRMÉ', target, checks }
    }
    // Never shrink a shared connection or change credentials in another target.
    if (connections.length && (scopes(connections[0]).length !== 1 || scopes(connections[0])[0] !== target)) {
      throw failure('Connexion partagée entre cibles sans token lisible : ne pas la réduire. Vérifier le token local dans node config ou séparer cette connexion dans Vercel avant une réparation ciblée.')
    }
    const action = connections.length ? 'update' : 'connect'
    const args = ['storage', action, store.id, '--project', project.projectId, '--scope', project.orgId,
      '--environment', target, '--auth', 'oidc', '--add-rw-token']
    const preview = () => api.tool('vercel', [...args, '--dry-run', '--json']).then(text => {
      try { return inspectPlan(JSON.parse(text), project, store, target, action, false) }
      catch (error) { throw error.configSafe ? error : failure('Plan CLI Blob illisible ; contenu masqué, aucune mutation.') }
    })
    const plan = await preview()
    console.log(`Plan Blob : ${action}, store ${store.id}, projet ${project.projectId}, cible ${target} uniquement.`)
    console.log(`Variables ajoutées : ${plan.add.join(', ') || 'aucune'} ; conservées : ${plan.keep.join(', ') || 'aucune'} ; suppressions : aucune. Valeurs non affichées.`)
    backup = fs.mkdtempSync(path.join(folder, 'blob-connect-backup-')); fs.chmodSync(backup, 0o700)
    core.writePrivate(path.join(backup, 'before.json'), JSON.stringify({ project, store, environments: before }, null, 2) + '\n')
    journal = { schema: 1, project, storeId: store.id, target, plan, phase: 'prepared', automaticRollback: false }
    const save = () => core.writePrivate(path.join(backup, 'journal.json'), JSON.stringify(journal, null, 2) + '\n')
    save()
    console.log(`Sauvegarde privée créée : ${VAULT}/${path.basename(backup)}. Les valeurs masquées ne sont pas restaurables ; aucun détachement automatique en cas d’échec.`)
    if (!await api.yes(`Autoriser ${action} du store ${store.id} pour ${target}, avec ajout explicite du token statique et variables OIDC dans Vercel`)) return { status: 'PLAN NON APPLIQUÉ', target }
    if (!same(await driver.connect({ dryRun: true }), project)) throw failure('Projet/équipe modifiés avant rattachement ; aucune mutation.')
    for (const t of TARGETS) if (signature(await driver.read(project, t)) !== signature(before[t])) throw failure('Variables Vercel modifiées pendant la préparation : relancer sans écraser les changements concurrents.')
    if (storeStamp(await driver.blobResource(project, store.id)) !== storeStamp(store)) throw failure('Connexions du store modifiées pendant la préparation ; aucune mutation.')
    if (JSON.stringify(await preview()) !== JSON.stringify(plan)) throw failure('Plan Blob modifié pendant la préparation ; aucune mutation.')
    journal.phase = 'applying'; save(); attempted = true
    const output = await api.tool('vercel', [...args, '--yes', '--json'])
    try { inspectPlan(JSON.parse(output), project, store, target, action, true) }
    catch (error) { throw error.configSafe ? error : failure('Réponse de rattachement illisible ; vérifier la relecture et le journal privé.') }
    for (const t of TARGETS.filter(t => t !== target)) {
      if (signature(await driver.read(project, t)) !== signature(before[t])) throw failure('Une autre cible a changé pendant le rattachement ; état non confirmé, sauvegarde conservée. Aucun rollback aveugle.')
    }
    const afterStore = await driver.blobResource(project, store.id)
    const untouched = store.projectsMetadata.filter(c => c.projectId !== project.projectId || !scopes(c).includes(target))
    if (untouched.some(c => !afterStore.projectsMetadata.some(after => connectionStamp(after) === connectionStamp(c)))) {
      throw failure('Une connexion hors cible a changé : état non confirmé, sauvegarde conservée ; aucun détachement automatique.')
    }
    const checks = await verify()
    const allowedKeys = new Set([...plan.add, ...plan.keep])
    const nonBlob = snapshot => ({ records: snapshot.records.filter(r => !allowedKeys.has(r.key)),
      values: Object.fromEntries(Object.entries(snapshot.values).filter(([key]) => !allowedKeys.has(key))) })
    if (signature(nonBlob(before[target])) !== signature(nonBlob(verifiedSnapshot))) throw failure('Des variables hors plan Blob ont changé : journal conservé, aucune mise à jour automatique des brouillons.')
    preserveDraft(verifiedSnapshot, allowedKeys)
    journal.phase = 'verified'; journal.checks = checks; save()
    const report = { status: 'RATTACHEMENT BLOB VÉRIFIÉ', target, project, storeId: store.id, checks, backup: path.basename(backup), nextCommand: 'node config' }
    core.writePrivate(path.join(folder, 'blob-setup-report.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(`Rattachement ${target} vérifié par relecture. ${checks.api}.`)
    console.log('Dans le même dossier CMD, taper maintenant : node config. La synchronisation globale prendra de nouveaux inventaires ; les brouillons privés ont été conservés.')
    return report
  } catch (error) {
    if (attempted && backup && journal) {
      journal.phase = 'unverified'
      try { core.writePrivate(path.join(backup, 'journal.json'), JSON.stringify(journal, null, 2) + '\n') } catch { /* original private backup remains */ }
    }
    throw failure(`${attempted ? 'Rattachement tenté mais NON CONFIRMÉ ; sauvegarde privée conservée, aucun détachement automatique. ' : ''}${error.configSafe ? error.message : 'Commande/API Blob non confirmée : vérifier droits Vercel, connexion et réseau. Sorties fournisseur masquées.'}`)
  } finally {
    if (locked) {
      try { fs.rmSync(lock, { force: true }) }
      catch { throw failure('Verrou de configuration non retiré : contrôler le processus et les permissions avant reprise.') }
    }
  }
}
module.exports = { inspectPlan, setupBlob }
