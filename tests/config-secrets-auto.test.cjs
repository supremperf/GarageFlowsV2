'use strict'
/**
 * Résolution automatique des variables « non relisibles » chez Vercel.
 *
 * Ces tests figent la politique, parce que son échec est INVISIBLE en relecture
 * et coûteux en production :
 *
 *   • avant ce correctif, `node config` s'arrêtait sur « valeur de production
 *     nécessaire pour poursuivre » dès qu'une variable existait chez Vercel sans
 *     être relisible — impossible de configurer une installation neuve ;
 *   • à l'inverse, générer et pousser une nouvelle valeur sur une installation
 *     ÉTABLIE détruirait sessions, appareils et données chiffrées.
 *
 * La frontière entre les deux est donc testée dans les deux sens.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const auto = require('../scripts/lib/config-secrets-auto.cjs')

const root = path.resolve(__dirname, '..')
const core = require('../scripts/config-core.cjs')

const GENERABLES = Object.keys(core.GENERATED)

function genererFactice(valeur) {
  return (nom) => `valeur-generee-${valeur}-${nom}`
}

test('une valeur présente localement est adoptée : aucune génération, aucun remplacement', () => {
  const r = auto.resoudreValeursCachees({
    noms: ['DEVICE_TOKEN_PEPPER'], local: { DEVICE_TOKEN_PEPPER: 'pepper-local' },
    generables: GENERABLES, rotationAutorisee: true,
  })
  assert.deepEqual(r.valeurs, { DEVICE_TOKEN_PEPPER: 'pepper-local' })
  assert.deepEqual(r.locales, ['DEVICE_TOKEN_PEPPER'])
  assert.deepEqual(r.generees, [])
  assert.deepEqual(r.remplacements, [])
})

test('un écart avec le reçu du dernier envoi est signalé, jamais avalé', () => {
  const valeur = 'pepper-modifie-localement'
  const recus = { DEVICE_TOKEN_PEPPER: { sha256: auto.empreinte('ancienne-valeur-poussee'), projet: 'app' } }
  const r = auto.resoudreValeursCachees({ noms: ['DEVICE_TOKEN_PEPPER'], local: { DEVICE_TOKEN_PEPPER: valeur }, recus, generables: GENERABLES, rotationAutorisee: true })
  assert.deepEqual(r.divergences, ['DEVICE_TOKEN_PEPPER'])
  assert.deepEqual(r.remplacements, [], 'une dérive ne remplace rien toute seule')

  // Le reçu est bien une simple empreinte : la valeur poussée n'y figure pas.
  const coherent = { DEVICE_TOKEN_PEPPER: { sha256: auto.empreinte(valeur), projet: 'app' } }
  assert.deepEqual(auto.resoudreValeursCachees({ noms: ['DEVICE_TOKEN_PEPPER'], local: { DEVICE_TOKEN_PEPPER: valeur }, recus: coherent }).divergences, [])
})

test('une clé symétrique absente partout est générée et marquée pour remplacement', () => {
  const r = auto.resoudreValeursCachees({
    noms: ['DEVICE_TOKEN_PEPPER', 'GF_PORTAL_SECRET'], local: {},
    generables: GENERABLES, rotationAutorisee: true, generer: genererFactice('x'),
  })
  assert.deepEqual(r.generees, ['DEVICE_TOKEN_PEPPER', 'GF_PORTAL_SECRET'])
  assert.deepEqual(r.remplacements, ['DEVICE_TOKEN_PEPPER', 'GF_PORTAL_SECRET'])
  assert.equal(r.valeurs.GF_PORTAL_SECRET, 'valeur-generee-x-GF_PORTAL_SECRET')
})

test('SANS autorisation, aucune rotation silencieuse sur une installation établie', () => {
  const r = auto.resoudreValeursCachees({
    noms: ['DEVICE_TOKEN_PEPPER'], local: {}, generables: GENERABLES, rotationAutorisee: false,
  })
  assert.deepEqual(r.generees, [])
  assert.deepEqual(r.remplacements, [])
  assert.deepEqual(r.aFournir, ['DEVICE_TOKEN_PEPPER'], 'la valeur d’origine reste exigée')
})

test('DATABASE_URL n’est JAMAIS fabriquée : elle vient du fournisseur ou reste à fournir', () => {
  const avecFournisseur = auto.resoudreValeursCachees({
    noms: ['DATABASE_URL'], local: {}, generables: GENERABLES, rotationAutorisee: true,
    fournisseurs: { DATABASE_URL: 'postgresql://reelle@neon/base' }, generer: genererFactice('interdite'),
  })
  assert.deepEqual(avecFournisseur.fournies, ['DATABASE_URL'])
  assert.deepEqual(avecFournisseur.generees, [], 'jamais de génération pour une URL de base')
  assert.equal(avecFournisseur.valeurs.DATABASE_URL, 'postgresql://reelle@neon/base')

  const sansFournisseur = auto.resoudreValeursCachees({
    noms: ['DATABASE_URL'], local: {}, generables: GENERABLES, rotationAutorisee: true, generer: genererFactice('interdite'),
  })
  assert.deepEqual(sansFournisseur.aFournir, ['DATABASE_URL'])
  assert.equal(sansFournisseur.valeurs.DATABASE_URL, undefined, 'aucune URL inventée')
})

test('un identifiant de service non générable demande une valeur, il ne la fabrique pas', () => {
  const r = auto.resoudreValeursCachees({
    noms: ['SMTP_PASSWORD', 'UPSTASH_REDIS_REST_TOKEN'], local: {},
    generables: GENERABLES, rotationAutorisee: true, generer: genererFactice('interdite'),
  })
  assert.deepEqual(r.aFournir, ['SMTP_PASSWORD', 'UPSTASH_REDIS_REST_TOKEN'])
  assert.deepEqual(r.generees, [])
})

test('« installation neuve » se prouve par l’absence de témoins de production', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-frais-'))
  assert.equal(auto.premiereInstallation(dir), true)

  fs.writeFileSync(path.join(dir, '.env.server.local'), 'NEXTAUTH_SECRET=x\n')
  assert.equal(auto.premiereInstallation(dir), false)
  fs.rmSync(path.join(dir, '.env.server.local'))

  fs.mkdirSync(path.join(dir, 'keys'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'keys', 'private.pem'), 'PEM')
  assert.equal(auto.premiereInstallation(dir), false)
  fs.rmSync(path.join(dir, 'keys'), { recursive: true })

  // Un reçu d'envoi précédent suffit : des clés ont déjà servi.
  const recus = auto.cheminRecus(dir)
  fs.mkdirSync(path.dirname(recus), { recursive: true })
  fs.writeFileSync(recus, '{}')
  assert.equal(auto.premiereInstallation(dir), false)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('aucun témoin MAIS base serveur non vide ne vaut pas « installation neuve »', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-frais2-'))
  assert.equal(auto.premiereInstallation(dir, { serveurNeuf: false }), false)
  assert.equal(auto.premiereInstallation(dir, { serveurNeuf: true }), true)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('un reçu illisible est ignoré au lieu de fonder une décision', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-recus-'))
  const fichier = path.join(dir, 'recus.json')
  fs.writeFileSync(fichier, '{ pas du json')
  assert.deepEqual(auto.lireRecus(dir, { fichier }), {})
  fs.writeFileSync(fichier, '{"schema":1,"noms":[]}')
  assert.deepEqual(auto.lireRecus(dir, { fichier }), {}, 'noms non objet : refusé')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('le reçu ne contient QUE des empreintes, en permissions privées', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-ecrire-'))
  const fichier = path.join(dir, 'secrets-receipt.json')
  const secret = 'secret-de-test-a-ne-jamais-ecrire'
  auto.ecrireRecus(dir, { projet: 'app.garageflows.fr', valeurs: { DEVICE_TOKEN_PEPPER: secret }, origines: { DEVICE_TOKEN_PEPPER: 'profil local' } }, { fichier })
  const texte = fs.readFileSync(fichier, 'utf8')
  assert.ok(!texte.includes(secret), 'aucune valeur secrète dans le reçu')
  assert.ok(texte.includes(auto.empreinte(secret)), 'l’empreinte, elle, est présente')
  assert.equal(JSON.parse(texte).projet, 'app.garageflows.fr')
  if (process.platform !== 'win32') assert.equal(fs.statSync(fichier).mode & 0o777, 0o600)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('verifierRecus distingue accord, dérive et absence de reçu', () => {
  const valeur = 'pepper-actuel'
  const recus = { DEVICE_TOKEN_PEPPER: { sha256: auto.empreinte(valeur), projet: 'app' } }
  const verdict = auto.verifierRecus(recus, { DEVICE_TOKEN_PEPPER: valeur, GF_PORTAL_SECRET: 'autre' }, 'app')
  assert.deepEqual(verdict.coherents, ['DEVICE_TOKEN_PEPPER'])
  assert.deepEqual(verdict.inconnus, ['GF_PORTAL_SECRET'])
  assert.deepEqual(auto.verifierRecus(recus, { DEVICE_TOKEN_PEPPER: 'modifié' }, 'app').divergents, ['DEVICE_TOKEN_PEPPER'])
  assert.deepEqual(auto.verifierRecus(recus, { DEVICE_TOKEN_PEPPER: valeur }, 'autre-projet').inconnus, ['DEVICE_TOKEN_PEPPER'], 'un reçu d’un autre projet ne vaut rien')
})

test('écriture Vercel : ajout simple, ou retrait + recréation pour un remplacement', () => {
  assert.deepEqual(auto.planEcritureVercel('GF_PORTAL_SECRET', { sensible: true, present: false }), [
    ['env', 'add', 'GF_PORTAL_SECRET', 'production', '--sensitive', '--yes'],
  ])
  assert.deepEqual(auto.planEcritureVercel('GF_PORTAL_SECRET', { sensible: true, present: true, remplacer: true }), [
    ['env', 'rm', 'GF_PORTAL_SECRET', 'production', '--yes'],
    ['env', 'add', 'GF_PORTAL_SECRET', 'production', '--sensitive', '--yes'],
  ])
  // Présente mais sans remplacement décidé : aucune suppression.
  assert.deepEqual(auto.planEcritureVercel('GF_UPDATE_CHANNEL', { sensible: false, present: true }), [
    ['env', 'add', 'GF_UPDATE_CHANNEL', 'production', '--no-sensitive', '--yes'],
  ])
})


/**
 * Scénarios RÉELS, exécutés dans un bac à sable : le wizard est lancé en
 * sous-processus avec le même `config` que l'utilisateur, sur un projet Vercel
 * simulé dont deux variables existent sans être relisibles.
 *
 * C'est exactement la situation qui bloquait `node config` :
 *   DATABASE_URL / DEVICE_TOKEN_PEPPER « existe chez Vercel mais sa valeur n'est
 *   pas relisible » → arrêt du plan.
 */
function bacASable(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-import-remonte-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.vercel'), { recursive: true })
  for (const fichier of ['config', '.env.example', 'scripts/config-core.cjs', 'scripts/config-policy.cjs',
    'scripts/garageflow-env-manifest.json', 'scripts/lib/config-secrets-auto.cjs']) {
    fs.copyFileSync(path.join(root, fichier), path.join(dir, fichier))
  }
  fs.writeFileSync(path.join(dir, '.vercel', 'project.json'),
    JSON.stringify({ projectName: 'app.garageflows.fr', projectId: 'prj_test', orgId: 'team_test' }))
  fs.writeFileSync(path.join(dir, 'scenario.js'), `
    const wizard = require(${JSON.stringify(path.join(dir, 'config'))})
    const core = require(${JSON.stringify(path.join(dir, 'scripts/config-core.cjs'))})
    const noms = core.namesForProfile(require(${JSON.stringify(path.join(dir, 'scripts/config-policy.cjs'))}).loadPolicy(${JSON.stringify(dir)}).names, 'licences')
    const remote = { values: {}, hidden: new Set(['DEVICE_TOKEN_PEPPER', 'GF_PORTAL_SECRET']),
      present: new Set(['DEVICE_TOKEN_PEPPER', 'GF_PORTAL_SECRET', 'NEXTAUTH_SECRET']), stamps: {}, confirmedLocal: {} }
    ;(async () => {
      const env = await wizard.importRemote({}, remote, noms)
      console.log('PEPPER_OCTETS=' + Buffer.from(env.DEVICE_TOKEN_PEPPER || '', 'base64').length)
      console.log('PORTAIL_OCTETS=' + Buffer.from(env.GF_PORTAL_SECRET || '', 'base64').length)
      console.log('REMPLACEMENTS=' + [...(remote.replacements || [])].sort().join(','))
    })().catch(e => { console.error('ERREUR: ' + e.message); process.exitCode = 1 })
  `)
  return dir
}

function executerScenario(dir) {
  const { spawnSync } = require('node:child_process')
  const resultat = spawnSync(process.execPath, [path.join(dir, 'scenario.js')], { encoding: 'utf8', input: '', timeout: 30_000 })
  return { ...resultat, sortie: `${resultat.stdout || ''}${resultat.stderr || ''}` }
}

test('installation neuve : les variables non relisibles sont GÉNÉRÉES et remplacées chez Vercel', t => {
  const dir = bacASable(t)
  const r = executerScenario(dir)
  assert.equal(r.status, 0, r.sortie)
  assert.match(r.sortie, /absent partout — généré automatiquement/)
  assert.match(r.sortie, /PEPPER_OCTETS=32/)
  assert.match(r.sortie, /PORTAIL_OCTETS=32/)
  assert.match(r.sortie, /REMPLACEMENTS=DEVICE_TOKEN_PEPPER,GF_PORTAL_SECRET/)
  assert.ok(!/valeur de production nécessaire/.test(r.sortie))
})

test('installation établie : pas de rotation silencieuse (le plan s’arrête, rien n’est généré)', t => {
  const dir = bacASable(t)
  // Un profil serveur existe : des jetons ont pu être produits avec ces clés.
  fs.writeFileSync(path.join(dir, '.env.server.local'), 'NEXTAUTH_SECRET=deja-en-service\n')
  const r = executerScenario(dir)
  assert.notEqual(r.status, 0)
  assert.match(r.sortie, /ne peuvent pas être générées/)
  assert.match(r.sortie, /DEVICE_TOKEN_PEPPER, GF_PORTAL_SECRET/)
  assert.ok(!/PEPPER_OCTETS=32/.test(r.sortie), 'aucune valeur ne doit être produite sans autorisation')
})

test('le wizard ne bloque plus et n’invente jamais une valeur', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'config'), 'utf8')
  // L'ancien cul-de-sac exactement tel qu'il s'affichait pour l'utilisateur.
  // (Le commentaire de documentation le CITE : c'est l'abandon à l'exécution,
  //  donc un `throw`, qui doit avoir disparu.)
  assert.ok(!/throw new Error\([^\n]*valeur de production nécessaire/.test(source),
    'le message d’abandon ne doit plus être levé')
  assert.ok(!source.includes("Aucune génération ni rotation autorisée."),
    'plus de refus global : la décision se prend variable par variable')
  assert.ok(source.includes("require('./scripts/lib/config-secrets-auto.cjs')"),
    'la politique vit dans une lib testable, pas dans le wizard')
  assert.ok(source.includes('premiereInstallationServeur()'),
    'la génération automatique s’appuie sur une preuve de fraîcheur')
  assert.ok(source.includes('enregistrerRecus('), 'un reçu d’envoi est écrit après synchronisation')
})
