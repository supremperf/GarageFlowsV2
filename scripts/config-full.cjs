'use strict'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const core = require('./config-core.cjs')
const { loadPolicy, assertNoAliases, assertSafeServerOverrides } = require('./config-policy.cjs')
const services = require('./config-services.cjs')
const { audit, render } = require('./config-audit.cjs')

async function full(api) {
  const root = api.root
  const tools = api.services || services
  const policy = loadPolicy(root)
  const names = core.namesForProfile(policy.names, 'licences')
  const folder = path.join(root, 'GarageFlow-configuration')
  const report = { schemaVersion: 1, startedAt: new Date().toISOString(), status: 'in-progress', steps: [], pending: [] }
  let lockFd
  const lock = path.join(folder, 'config.lock')
  const saveReport = () => core.writePrivate(path.join(folder, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  async function step(id, action) {
    console.log(`\n▶ ${id}`)
    const record = { id, status: 'running' }
    report.steps.push(record); saveReport()
    try { const result = await action(); record.status = 'done'; saveReport(); return result }
    catch (error) { record.status = 'failed'; report.status = 'interrupted'; saveReport(); throw error }
  }
  function pending(id, reason) { report.pending.push({ id, reason }); saveReport(); console.log(`  À fournir/vérifier : ${reason}`) }
  console.log(`\nCONFIG COMPLET — ${policy.entries.length} variables classées, ${policy.names.length} paramètres applicatifs.`)
  console.log('Plan : inventaire → dépendances → accès Vercel/Neon/Redis → secrets/licences → fichiers/keygen/client → SQL → Vercel → santé → publication locale.')
  console.log('Les comptes externes, ressources choisies et éventuels frais restent sous votre contrôle. Aucun reset, aucune rotation automatique, aucune création de comptes fictifs.')
  console.log('Une autorisation initiale couvre les installations npm, fichiers locaux, migrations sur une BASE VIDE et déploiement sur le projet Vercel que vous autorisez. Une base existante et un changement d’autorité exigent une confirmation supplémentaire.')
  console.log('La configuration de production n’est pas exécutée sur vos comptes tant que vous n’autorisez pas ce plan.')
  if (await api.question('Saisir AUTORISER pour exécuter le plan complet (Entrée = annuler)') !== 'AUTORISER') return
  if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('Le dépôt exige Node.js 22.x. Installer cette version avant de continuer.')
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 })
  try {
    try { lockFd = fs.openSync(lock, 'wx', 0o600) }
    catch { throw new Error('Un plan complet est déjà en cours ou interrompu (GarageFlow-configuration/config.lock). Vérifier qu’aucun config ne tourne avant de retirer ce verrou et reprendre.') }
    fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, startedAt: report.startedAt }))
    fs.closeSync(lockFd); lockFd = true
    await step('inventaire-du-dépôt', async () => {
      const result = (api.audit || audit)(root)
      core.writePrivate(path.join(folder, 'repository-audit.md'), render(result))
      console.log(`${result.files} fichiers inventoriés, ${result.textFiles} textes lus. Aucune valeur secrète dans le rapport.`)
    })
    await step('dépendances-et-clients-Prisma', async () => {
      if (!fs.existsSync(path.join(root, 'node_modules/prisma/build/index.js')) || !fs.existsSync(path.join(root, 'node_modules/next/package.json'))) {
        console.log('Installation verrouillée par package-lock.json ; sorties brutes masquées.')
        await api.execute([api.npmCli(), 'ci'], { env: { ...process.env, VERCEL: '1' }, label: 'npm ci' })
      }
      const cli = path.join(root, 'node_modules/prisma/build/index.js')
      await api.execute([cli, 'generate'], { env: { ...process.env, VERCEL: '1' }, label: 'Client SQLite' })
      await api.execute([cli, 'generate', '--schema', 'prisma/server/schema.prisma'], { env: { ...process.env, VERCEL: '1' }, label: 'Client PostgreSQL' })
    })
    const serverFile = path.join(root, '.env.server.local')
    let env = core.readEnv(serverFile)
    const legacy = core.readEnv(path.join(root, '.env'))
    let moveLegacy = false
    if (/^postgres(ql)?:/.test(legacy.DATABASE_URL || '')) {
      console.log('Une ancienne configuration serveur est dans .env ; elle serait lue par les builds Electron.')
      if (!await api.yes('Migrer cette configuration vers .env.server.local et conserver une copie locale privée avant de créer le profil desktop')) throw new Error('Ancien profil laissé intact, migration locale non autorisée.')
      env = { ...legacy, ...env }; moveLegacy = true
    }
    assertNoAliases(env, policy)
    const excluded = Object.keys(env).filter(n => env[n] && policy.manifest.variables.some(v => v.name === n) && !names.includes(n))
    if (excluded.length) {
      console.log(`Variables hors profil serveur : ${excluded.join(', ')}. Les variables de publication/runtime/debug ne doivent pas être envoyées à Vercel.`)
      if (!await api.yes('Autoriser leur retrait du profil serveur à la sauvegarde, après avoir conservé les originaux dans votre coffre')) throw new Error('Variables hors profil conservées ; configuration serveur non modifiée.')
      for (const n of excluded) delete env[n]
    }
    const remote = await step('accès-et-configuration-Vercel', () => api.setupVercel())
    // Reject obsolete names even if they came from an integration; don't quietly paper over them.
    assertNoAliases(remote.values, policy)
    assertSafeServerOverrides(remote)
    env = await api.importRemote(env, remote, names)
    // Recovery from local issuer configuration is safe only after matching the Vercel target.
    const keygenFile = path.join(root, 'keys/server_config.json')
    if (!env.GARAGEFLOW_API_KEY && fs.existsSync(keygenFile)) {
      let existing
      try { existing = JSON.parse(fs.readFileSync(keygenFile, 'utf8')) } catch { throw new Error('Configuration keygen locale invalide.') }
      if (existing.api_key) {
        if (existing.url && env.NEXTAUTH_URL && existing.url.replace(/\/$/, '') !== env.NEXTAUTH_URL.replace(/\/$/, '')) throw new Error('Keygen et Vercel désignent des serveurs différents ; confirmer/corriger la cible manuellement.')
        env.GARAGEFLOW_API_KEY = existing.api_key
      }
    }
    await step('PostgreSQL-Neon-ou-existant', async () => {
      if (!env.DATABASE_URL || !env.DIRECT_URL) {
        if (env.DATABASE_URL && !/\.neon\.tech/.test(env.DATABASE_URL)) await api.secretField(env, 'DIRECT_URL', 'URL directe d’origine du fournisseur PostgreSQL existant')
        else await api.configureNeon(env, { auto: true })
      }
      // Validate before any SQL/client call; never guess a direct URL for an unknown provider.
      for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
        if (!/^postgres(ql)?:\/\//i.test(env[name] || '')) {
          await api.secretField(env, name, `${name} PostgreSQL d’origine`)
          if (!/^postgres(ql)?:\/\//i.test(env[name] || '')) throw new Error(`${name} : PostgreSQL requis.`)
        }
      }
      const connectionIssues = core.validate({ DATABASE_URL: env.DATABASE_URL, DIRECT_URL: env.DIRECT_URL }, 'pwa', { vercel: true })
        .filter(message => message.startsWith('DATABASE_URL') || message.startsWith('DIRECT_URL'))
      if (connectionIssues.length) throw new Error(connectionIssues.join(' '))
    })
    const database = await step('inspection-SQL-lecture-seule', () => tools.inspectDatabase(root, env.DIRECT_URL))
    console.log(database.empty ? 'Base sans données métier : initialisation possible.' : 'Base contient des données : préservation des clés et sauvegarde indispensables.')
    await step('URLs-publiques', async () => {
      if (!env.NEXTAUTH_URL) {
        const linked = JSON.parse(fs.readFileSync(path.join(root, '.vercel/project.json'), 'utf8'))
        let candidate = ''
        try {
          const project = JSON.parse(await api.tool('vercel', ['api', `/v9/projects/${encodeURIComponent(linked.projectId)}?teamId=${encodeURIComponent(linked.orgId)}`]))
          const aliases = project.targets?.production?.alias || []
          const domain = aliases.find(a => typeof a === 'string' && /^[a-z0-9.-]+$/.test(a))
          if (domain) candidate = `https://${domain}`
        } catch { /* No verified public alias yet: ask the user, do not fabricate a DNS record. */ }
        env.NEXTAUTH_URL = await api.question('URL publique HTTPS cible (DNS/domaine doit vous appartenir)', { defaultValue: candidate })
      }
      env.GF_APP_URL ||= env.NEXTAUTH_URL
    })
    await step('Redis-Upstash-et-test-REST', async () => {
      await tools.configureUpstash(env, api)
      await tools.testRedis(env, api.fetch || fetch)
    })
    if (!env.ANTHROPIC_API_KEY) {
      console.log('Accès optionnel : OCR existant nécessite une clé Anthropic. Entrée sans clé laisse OCR/IA désactivé ; le Copilot LLM n’est pas implémenté dans ce dépôt.')
      await api.secretField(env, 'ANTHROPIC_API_KEY', 'Clé API Anthropic (facultatif, saisie masquée)')
    }
    await step('secrets-indépendants-et-licences', async () => {
      const missing = Object.keys(core.GENERATED).filter(n => names.includes(n) && !env[n])
      if (!database.empty) {
        for (const name of missing) {
          if (['GF_PORTAL_SECRET', 'GF_SIGNATURE_SECRET'].includes(name) && env.NEXTAUTH_SECRET) {
            env[name] = env.NEXTAUTH_SECRET
            console.log(`${name} : repli historique sur NEXTAUTH_SECRET préservé, pas de rotation des signatures/liens existants.`)
            continue
          }
          console.log(`${name} absent du poste et non récupéré depuis Vercel. Une base utilisée ne prouve pas qu’un secret n’a jamais existé.`)
          await api.secretField(env, name, `${name} : clé ORIGINALE du coffre, ou NONUTILISE si domaine jamais configuré`)
          if (env[name] === 'NONUTILISE') {
            if (!await api.yes(`Confirmer explicitement que ${name} n’a JAMAIS protégé de données/jetons existants`)) throw new Error('Original nécessaire, aucune génération de remplacement.')
            delete env[name]
          } else if (!env[name]) throw new Error(`${name} : original nécessaire pour la base existante.`)
        }
      }
      env = core.fillMissing(env, names, 'licences')
      // Provision the optional credential cipher only on a fresh, empty DB. Feature stays OFF.
      if (database.empty && !env.GF_EINVOICE_CREDENTIALS_KEY) env.GF_EINVOICE_CREDENTIALS_KEY = crypto.randomBytes(32).toString('base64')
      if (!env.GF_PRIVATE_KEY) await api.licenseKey(env)
      console.log('La clé de licence doit correspondre aux ancrages publics. Aucune licence client commerciale n’est créée automatiquement.')
      const compromised = JSON.parse(fs.readFileSync(path.join(root, 'scripts/compromised-secrets.json'), 'utf8'))
      for (const entry of compromised.entries) {
        if (env[entry.env] && crypto.createHash('sha256').update(env[entry.env]).digest('hex').startsWith(entry.sha256Prefix)) throw new Error(`${entry.env} : empreinte connue compromise ; rotation explicite nécessaire hors de ce plan.`)
      }
      let issues = core.validate(env, 'licences', { vercel: true, publicPem: core.embeddedLicenseKey(root) })
      while (issues.length) {
        console.log(issues.join('\n'))
        if (!await api.yes('Corriger uniquement les valeurs bloquantes', true)) throw new Error('Variables invalides : rien synchronisé.')
        await api.advanced(env, names)
        issues = core.validate(env, 'licences', { vercel: true, publicPem: core.embeddedLicenseKey(root) })
      }
    })
    await step('sauvegarde-des-profils-et-keygen', async () => {
      core.writePrivate(serverFile, core.serializeEnv(env, [...names, ...Object.keys(env).filter(n => !policy.manifest.variables.some(v => v.name === n))], 'licences'))
      if (moveLegacy) {
        const backup = path.join(root, '.env.legacy-server.local')
        if (fs.existsSync(backup)) throw new Error('Copie .env.legacy-server.local déjà présente, aucun écrasement autorisé.')
        core.writePrivate(backup, fs.readFileSync(path.join(root, '.env'), 'utf8'))
      }
      const localPrivate = path.join(root, 'keys/private.pem')
      const encrypted = fs.existsSync(localPrivate) && /ENCRYPTED PRIVATE KEY|Proc-Type:\s*4,ENCRYPTED/.test(fs.readFileSync(localPrivate, 'utf8'))
      let authorizeApiReplacement = false
      if (fs.existsSync(keygenFile)) {
        const cfg = JSON.parse(fs.readFileSync(keygenFile, 'utf8'))
        if (cfg.api_key && cfg.api_key !== env.GARAGEFLOW_API_KEY) {
          authorizeApiReplacement = await api.yes('Clé API du keygen différente : aligner uniquement le fichier local sur la valeur de ce Vercel autorisé (aucune rotation serveur)')
        }
      }
      tools.configureKeygen(root, env, { privatePassphrase: encrypted ? await api.licensePassphrase(localPrivate) : undefined, authorizeApiReplacement })
      console.log('Serveur → .env.server.local ; émetteur → keys/private.pem + public.pem + server_config.json. Secrets non affichés.')
    })
    await step('desktop-SQLite-et-endpoints-compilés', async () => {
      const desktopNames = core.namesForProfile(policy.names, 'desktop')
      let desktop = moveLegacy ? {} : { ...legacy }
      const desktopKnown = new Set(desktopNames)
      const serverOnly = Object.keys(desktop).filter(n => policy.manifest.variables.some(v => v.name === n) && !desktopKnown.has(n) && desktop[n])
      if (serverOnly.length) {
        console.log(`.env contient des paramètres serveur : ${serverOnly.join(', ')}.`)
        if (!await api.yes('Retirer ces paramètres du profil desktop (les originaux sont dans le profil serveur/coffre)')) throw new Error('Profil desktop incompatible conservé.')
        for (const n of serverOnly) delete desktop[n]
      }
      const localDatabase = await tools.inspectDesktop(root, desktop.DATABASE_URL || 'file:./dev.db')
      if (!localDatabase.empty) {
        for (const name of Object.keys(core.GENERATED).filter(n => desktopNames.includes(n) && !desktop[n])) {
          if (name === 'GF_SIGNATURE_SECRET' && desktop.NEXTAUTH_SECRET) {
            desktop[name] = desktop.NEXTAUTH_SECRET
            console.log('Signature desktop : repli historique préservé, aucune rotation des preuves existantes.')
            continue
          }
          console.log(`${name} manque pour une SQLite contenant des données. Importer l’original ou déclarer explicitement un domaine jamais configuré.`)
          await api.secretField(desktop, name, `${name} desktop : clé ORIGINALE ou NONUTILISE`)
          if (desktop[name] === 'NONUTILISE') {
            if (!await api.yes(`Confirmer que ${name} n’a jamais été utilisée pour cette base desktop`)) throw new Error('Clé desktop d’origine requise.')
            delete desktop[name]
          } else if (!desktop[name]) throw new Error(`${name} desktop : original nécessaire.`)
        }
      }
      desktop = core.fillMissing(desktop, desktopNames, 'desktop')
      desktop.GF_APP_URL ||= env.GF_APP_URL
      desktop.GF_LICENSE_SERVER ||= env.NEXTAUTH_URL
      desktop.GF_UPDATE_SERVER ||= env.NEXTAUTH_URL
      const issues = core.validate(desktop, 'desktop')
      if (issues.length) throw new Error('Desktop : configuration existante invalide ; corriger avec node config --profile desktop.')
      core.writePrivate(path.join(root, '.env'), core.serializeEnv(desktop, [...desktopNames, ...Object.keys(desktop).filter(n => !policy.manifest.variables.some(v => v.name === n))], 'desktop'))
      tools.ensureDesktopDatabase(root, desktop.DATABASE_URL)
      await api.execute([path.join(root, 'scripts/setup-dev.js')], { env: { ...process.env, VERCEL: '',
        DATABASE_URL: desktop.DATABASE_URL, NEXTAUTH_SECRET: desktop.NEXTAUTH_SECRET }, label: 'SQLite desktop' })
      const packagableEndpoints = [desktop.GF_LICENSE_SERVER, desktop.GF_UPDATE_SERVER, desktop.GF_APP_URL].every(v => /^https:\/\//i.test(v || ''))
      if (packagableEndpoints && await api.yes('Aligner aussi les défauts PUBLICS compilés des futurs clients sur les endpoints desktop validés (ne modifie pas les installations existantes)', true)) {
        const files = tools.patchClientDefaults(root, desktop.GF_LICENSE_SERVER, { updateUrl: desktop.GF_UPDATE_SERVER, appUrl: desktop.GF_APP_URL })
        if (files.length) console.log(`Ancrages publics modifiés : ${files.join(', ')}. À reconstruire et distribuer aux clients.`)
      } else pending('client-defaults', 'Les clients packagés conservent leur autorité compilée actuelle ; reconstruire/configurer leurs endpoints pour un autre serveur.')
    })
    await step('migrations-PostgreSQL-et-détection-de-drift', async () => {
      if (!database.empty && await api.question('Base utilisée : sauvegarde/PITR vérifié ? Saisir MIGRER pour appliquer les migrations') !== 'MIGRER') throw new Error('Migration de la base utilisée non autorisée ; fichiers locaux conservés, aucun déploiement.')
      const cli = path.join(root, 'node_modules/prisma/build/index.js')
      const options = { env: api.childEnv(env, true), label: 'Migrations PostgreSQL' }
      await api.execute([cli, 'migrate', 'deploy', '--schema', 'prisma/server/schema.prisma'], options)
      await api.execute([cli, 'migrate', 'status', '--schema', 'prisma/server/schema.prisma'], options)
      // Exit-code 2 means drift. Never replace migrate deploy by destructive db push.
      try {
        await api.execute([cli, 'migrate', 'diff', '--from-schema-datasource', 'prisma/server/schema.prisma',
          '--to-schema-datamodel', 'prisma/server/schema.prisma', '--exit-code'], { ...options, label: 'Vérification de drift SQL' })
      } catch (error) {
        if (error.exitCode === 2) throw new Error('Drift SQL détecté (code Prisma 2) : la base diffère du schéma attendu. Aucun déploiement autorisé. Diagnostic lecture seule : node config --diagnose-sql. Ne pas utiliser reset/db push pour contourner ce contrôle.')
        throw new Error(`Comparaison SQL impossible (code Prisma ${Number.isInteger(error.exitCode) ? error.exitCode : 'indisponible'}). Ce résultat ne prouve pas un drift. Aucun déploiement autorisé. Diagnostic lecture seule : node config --diagnose-sql.`)
      }
      console.log('Migrations et schéma vérifiés.')
    })
    if (database.empty) await step('première-licence-admin', async () => {
      if (!await api.yes('Créer la première licence ADMIN pour accéder au control-plane (privilèges complets)')) {
        pending('admin-access', 'Licence admin à émettre avec le keygen ; aucun privilège attribué automatiquement.'); return
      }
      console.log(await tools.bootstrapAdmin(root, env))
      console.log('Jeton uniquement dans keys/bootstrap-admin-license.json. Ne jamais le partager ni l’inclure dans un installateur.')
    })
    await step('variables-Vercel-production', async () => {
      if (!await api.syncVercel(env, names, remote, { authorized: true })) throw new Error('Synchronisation non autorisée, pas de déploiement.')
    })
    await step('déploiement-et-santé', async () => {
      const output = await api.tool('vercel', ['deploy', '--prod', '--yes'], { label: 'Déploiement production' })
      const matches = [...output.matchAll(/https:\/\/[a-zA-Z0-9-]+\.vercel\.app/g)]
      const url = matches.at(-1)?.[0]
      if (!url) throw new Error('Déploiement accepté, mais URL non reconnue : vérifier les deployments Vercel avant de poursuivre.')
      const health = JSON.parse(await api.tool('vercel', ['curl', '/api/health', '--deployment', url]))
      if (health.status !== 'ok') throw new Error('Sonde du nouveau déploiement non saine : plan interrompu, vérifier les logs Vercel.')
      console.log('Nouveau déploiement : /api/health répond status=ok.')
      try {
        const response = await (api.fetch || fetch)(`${new URL(env.NEXTAUTH_URL).origin}/api/health`, { redirect: 'error', signal: AbortSignal.timeout(10000) })
        if (!response.ok || (await response.json()).status !== 'ok') throw new Error()
      } catch { pending('public-domain', 'Le domaine public ne répond pas à la sonde : vérifier DNS/alias/protection Vercel dans le compte autorisé.') }
    })
    await step('signature-locale-des-mises-à-jour', async () => {
      const cfg = path.join(folder, 'publisher.json')
      let keyFile = api.publisherFile || path.join(os.homedir(), '.garageflows-publisher/update-signing.pem')
      if (fs.existsSync(cfg)) {
        try { keyFile = JSON.parse(fs.readFileSync(cfg, 'utf8')).keyFile } catch { throw new Error('Configuration de publication locale illisible.') }
      }
      keyFile = tools.assertExternalFile(root, keyFile)
      if (!fs.existsSync(keyFile)) {
        console.log('Publication : importer le PEM Ed25519 ORIGINAL depuis le coffre si des clients ont déjà reçu des mises à jour.')
        const supplied = await api.question('Chemin du PEM Ed25519 hors dépôt ; Entrée pour préparer un NOUVEAU canal')
        if (supplied) keyFile = tools.assertExternalFile(root, path.resolve(supplied))
        else {
          console.log('Une nouvelle clé ne répare pas le parc existant : les anciens clients ne la connaissent pas. Les anciennes clés publiques seront conservées.')
          if (await api.question('Saisir NOUVEAU-CANAL pour générer une nouvelle clé (Entrée = laisser à configurer)') !== 'NOUVEAU-CANAL') {
            pending('publisher-key', 'Clé Ed25519 originale et accès au serveur de publication garagesite3 requis.'); return
          }
          const pair = crypto.generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
          tools.installPublisherKey(root, keyFile, pair.privateKey)
        }
      }
      if (fs.existsSync(keyFile)) {
        const installed = tools.installPublisherKey(root, keyFile, fs.readFileSync(keyFile, 'utf8'))
        console.log(`Signature locale préparée ; clé publique ${installed.keyId} alignée. Clé privée exclusivement dans le coffre externe.`)
      }
      pending('publisher-service', 'La publication distante dépend de garagesite3, absent de ce checkout. Reporter la clé publique/keyId et autoriser ce serveur séparément ; aucune clé privée envoyée à la PWA.')
    })
    await step('prérequis-keygen-Python', async () => {
      let python
      for (const command of ['python3', 'python', 'py']) {
        try { await tools.run(command, ['-c', 'import sys; assert sys.version_info >= (3, 10)'], { cwd: root, label: 'Python 3.10+' }); python = command; break }
        catch { /* Try the next launcher, never execute arbitrary shell text. */ }
      }
      if (!python) { pending('python', 'Installer Python >=3.10 sur ce poste pour utiliser le keygen. Les clés et paramètres sont déjà placés.'); return }
      try { await tools.run(python, ['-c', 'import cryptography'], { cwd: root, label: 'Python cryptography' }) }
      catch {
        try { await tools.run(python, ['-m', 'pip', 'install', '--user', 'cryptography>=41'], { cwd: root, label: 'Installation cryptography' }) }
        catch { pending('python-cryptography', 'Installation cryptography impossible (droits/réseau/environnement géré). Installer dans un environnement Python autorisé.'); return }
      }
      core.writePrivate(path.join(folder, 'keygen-runtime.json'), JSON.stringify({ python }) + '\n')
    })
    pending('persistent-updates', 'La publication/upload des installateurs de ce dépôt utilise aussi des fichiers locaux : sur Vercel, hébergement durable des binaires ou service de publication externe requis.')
    pending('persistent-backups', 'Le service de sauvegarde PWA utilise encore le disque : sur Vercel, stockage objet durable + adaptation du code nécessaires. Ne pas utiliser /tmp comme sauvegarde permanente.')
    pending('business-access', 'Identité légale/SIRET, SMTP, comptes des plateformes de facturation et éventuelle clé OCR nécessitent vos données/accès. Facturation électronique reste OFF ; les saisir dans l’application ou le profil ciblé.')
    report.status = report.pending.length ? 'configured-with-external-actions' : 'complete'
    report.finishedAt = new Date().toISOString(); saveReport()
    console.log('\nPlan technique exécuté. Les opérations réellement réussies et les limites restantes sont dans GarageFlow-configuration/report.json (sans secrets).')
    console.log('Aucune prétention « tout est opérationnel » tant que les actions externes/stockage durable ne sont pas résolues.')
  } catch (error) {
    report.status = 'interrupted'; report.finishedAt = new Date().toISOString()
    if (lockFd) saveReport()
    throw error
  } finally { if (lockFd) fs.rmSync(lock, { force: true }) }
}
module.exports = { full }
