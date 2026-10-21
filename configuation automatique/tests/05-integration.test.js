'use strict'
/**
 * INTÉGRATION — le configurateur réel, exécuté de bout en bout.
 *
 * Ces tests lancent `config.js` dans le dépôt, en mode SIMULATION et HORS
 * LIGNE : aucune écriture de fichier, aucune mutation distante, aucun accès
 * réseau. Ce qui est vérifié, c'est ce qu'aucun test unitaire ne peut montrer :
 * que les vingt étapes s'enchaînent, que le rapport est produit, qu'il ne
 * contient aucune valeur, et que deux exécutions successives aboutissent aux
 * mêmes décisions — la définition opérationnelle de l'idempotence.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const aides = require('./helpers.js')

const POINT_ENTREE = path.join(aides.RACINE_PROJET, 'configuation automatique', 'config.js')
const DOSSIER_RAPPORTS = path.join(aides.RACINE_PROJET, 'configuation automatique', 'reports')

/** Lance le configurateur et rend son code de sortie, sa sortie et son rapport. */
function lancer(args, options = {}) {
  const resultat = spawnSync(process.execPath, [POINT_ENTREE, ...args], {
    cwd: aides.RACINE_PROJET,
    encoding: 'utf8',
    timeout: options.timeout || 600000,
    env: { ...process.env, NO_COLOR: '1' },
  })
  let rapport = null
  const dernier = path.join(DOSSIER_RAPPORTS, 'dernier-rapport.json')
  try {
    rapport = JSON.parse(fs.readFileSync(dernier, 'utf8'))
  } catch { /* pas de rapport : le test le constatera */ }
  return { code: resultat.status, sortie: (resultat.stdout || '') + (resultat.stderr || ''), rapport }
}

test('intégration — l aide s affiche sans rien exécuter', () => {
  const resultat = lancer(['--aide'])
  assert.equal(resultat.code, 0)
  assert.ok(/CENTRE DE CONFIGURATION|configuration automatique/i.test(resultat.sortie))
  assert.ok(/--simulation/.test(resultat.sortie), 'les options doivent être documentées')
  assert.ok(/AUTORISATIONS EXPLICITES/.test(resultat.sortie), 'les autorisations doivent être listées')
})

test('intégration — une option inconnue est refusée au lieu d être ignorée', () => {
  const resultat = lancer(['--option-qui-nexiste-pas'])
  assert.equal(resultat.code, 2)
  assert.ok(/Option inconnue/.test(resultat.sortie))
})

test('intégration — les vingt étapes s exécutent en simulation hors ligne', { timeout: 600000 }, () => {
  const resultat = lancer(['--simulation', '--hors-ligne'])
  assert.ok(resultat.rapport, 'un rapport doit être écrit')
  const numerotees = resultat.rapport.etapes.filter((etape) => etape.numero !== null)
  // Les vingt étapes du cahier des charges, PLUS l'étape 0 des trois sélections
  // (projet, branche, environnement) : elle précède tout le reste parce que
  // l'environnement choisi borne les écritures de toutes les suivantes.
  assert.equal(numerotees.length, 21,
    'les vingt étapes du cahier des charges, précédées de l étape 0 des sélections')
  for (let numero = 0; numero <= 20; numero++) {
    assert.ok(numerotees.some((etape) => etape.numero === numero), 'étape ' + numero + ' manquante')
  }
  const etapeSelections = numerotees.find((etape) => etape.numero === 0)
  assert.match(etapeSelections.titre, /projet, branche, environnement/)
  assert.equal(resultat.rapport.simulation, true)
  // Aucune écriture ni mutation en simulation.
  assert.deepEqual(resultat.rapport.fichiers.crees, [])
  assert.deepEqual(resultat.rapport.fichiers.modifies, [])
  assert.deepEqual(resultat.rapport.vercel.synchronisations, [])
})

test('intégration — hors ligne, aucun succès de connexion n est revendiqué', { timeout: 600000 }, () => {
  const resultat = lancer(['--simulation', '--hors-ligne'])
  assert.ok(resultat.rapport)
  assert.deepEqual(resultat.rapport.connexions, [], 'aucune connexion ne peut être testée hors ligne')
  const etapeConnexions = resultat.rapport.etapes.find((etape) => etape.numero === 17)
  for (const ligne of etapeConnexions.lignes) {
    assert.notEqual(ligne.statut, 'SUCCESS', 'aucun SUCCESS de connexion hors ligne : ' + ligne.sujet)
  }
})

test('intégration — hors ligne, aucune génération pour un environnement distant', { timeout: 600000 }, () => {
  const resultat = lancer(['--simulation', '--hors-ligne'])
  assert.ok(resultat.rapport)
  const generees = resultat.rapport.variables.filter((variable) => variable.action === 'generer')
  for (const variable of generees) {
    assert.equal(variable.cible, 'desktop',
      variable.nom + ' : une génération pour « ' + variable.cible + ' » exige de prouver son absence en ligne')
  }
})

test('intégration — le rapport ne contient aucune valeur secrète', { timeout: 600000 }, () => {
  const resultat = lancer(['--simulation', '--hors-ligne'])
  assert.ok(resultat.rapport)
  const texte = JSON.stringify(resultat.rapport)

  // 1. Aucune valeur des fichiers d'environnement du poste.
  const fichierEnv = require('../utils/env-file.js')
  for (const nom of ['.env', '.env.local', '.env.server.local', '.env.development.local', '.env.preview.local']) {
    const contenu = aides.lire(aides.RACINE_PROJET, nom)
    if (!contenu) continue
    for (const [cle, valeur] of Object.entries(fichierEnv.valeurs(contenu))) {
      if (!valeur || valeur.length < 8) continue
      if (/^file:/.test(valeur) || /^https?:\/\/[^@]*$/.test(valeur)) continue
      assert.ok(!texte.includes(valeur), 'valeur de ' + cle + ' présente dans le rapport')
    }
  }

  // 2. Aucune valeur des brouillons laissés par une configuration interrompue.
  const brouillon = path.join(aides.RACINE_PROJET, 'GarageFlow-configuration/manager-state.json')
  if (fs.existsSync(brouillon)) {
    const etat = JSON.parse(fs.readFileSync(brouillon, 'utf8'))
    for (const valeurs of Object.values(etat.drafts || {})) {
      for (const [cle, valeur] of Object.entries(valeurs)) {
        if (typeof valeur !== 'string' || valeur.length < 12) continue
        // Les valeurs de configuration non secrètes (URL publique, booléens)
        // peuvent légitimement apparaître : on cible le matériel sensible.
        const redact = require('../security/redact.js')
        if (!redact.estSensible(cle, valeur)) continue
        assert.ok(!texte.includes(valeur), 'valeur de brouillon ' + cle + ' présente dans le rapport')
      }
    }
  }

  // 3. Aucun matériel de clé privée.
  assert.ok(!texte.includes('BEGIN EC PRIVATE KEY'))
  assert.ok(!texte.includes('BEGIN PRIVATE KEY'))
  const privee = aides.lire(aides.RACINE_PROJET, 'keys/private.pem')
  if (privee) {
    const base64 = Buffer.from(privee, 'utf8').toString('base64')
    assert.ok(!texte.includes(base64), 'la clé privée encodée ne doit jamais figurer dans un rapport')
  }
})

test('intégration — la sortie terminale ne contient aucune valeur secrète', { timeout: 600000 }, () => {
  const resultat = lancer(['--simulation', '--hors-ligne'])
  const fichierEnv = require('../utils/env-file.js')
  const redact = require('../security/redact.js')
  const contenu = aides.lire(aides.RACINE_PROJET, '.env')
  if (contenu) {
    for (const [cle, valeur] of Object.entries(fichierEnv.valeurs(contenu))) {
      if (!redact.estSensible(cle, valeur)) continue
      assert.ok(!resultat.sortie.includes(valeur), 'valeur de ' + cle + ' affichée dans le terminal')
    }
  }
})

test('intégration — deux exécutions successives donnent les mêmes décisions', { timeout: 900000 }, () => {
  const premier = lancer(['--simulation', '--hors-ligne'])
  const second = lancer(['--simulation', '--hors-ligne'])
  assert.ok(premier.rapport && second.rapport)

  const decisions = (rapport) => rapport.variables
    .map((variable) => [variable.nom, variable.cible, variable.action, variable.statut].join('|'))
    .sort()
  assert.deepEqual(decisions(second.rapport), decisions(premier.rapport),
    'les décisions doivent être stables d une exécution à l autre')

  // Les étapes et leur statut doivent également coïncider.
  const etapes = (rapport) => rapport.etapes
    .filter((etape) => etape.numero !== null)
    .map((etape) => etape.numero + ':' + etape.statut)
  assert.deepEqual(etapes(second.rapport), etapes(premier.rapport))

  // Chaque exécution produit son propre rapport : l'idempotence porte sur les
  // décisions, pas sur l'identifiant d'exécution.
  assert.notEqual(second.rapport.executionId, premier.rapport.executionId)
})

test('intégration — le verrou empêche deux exécutions simultanées', { timeout: 600000 }, () => {
  const verrou = require('../core/lock.js')
  const prise = verrou.prendre(aides.RACINE_PROJET)
  assert.equal(prise.pris, true)
  try {
    const resultat = lancer(['--simulation', '--hors-ligne'])
    assert.equal(resultat.code, 3, 'le code de sortie doit signaler un verrou pris')
    assert.ok(/configuration est en cours/i.test(resultat.sortie))
  } finally {
    prise.liberer()
  }
})

test('intégration — le rapport décrit chaque variable du contrat', { timeout: 600000 }, () => {
  const resultat = lancer(['--simulation', '--hors-ligne'])
  assert.ok(resultat.rapport)
  const manifeste = resultat.rapport.manifeste
  assert.ok(manifeste.entrees > 100, 'le manifeste complet doit être rapporté')
  assert.equal(manifeste.fiches.length, manifeste.entrees)
  // Les variables requises en production sont nommées explicitement.
  assert.ok(manifeste.requisesProduction.includes('DATABASE_URL'))
  assert.ok(manifeste.requisesProduction.includes('NEXTAUTH_SECRET'))
  // L'analyse du dépôt est présente, avec ses limites.
  assert.ok(resultat.rapport.analyse.fichiersAnalyses > 100)
  assert.ok(Array.isArray(resultat.rapport.analyse.divergences.consommeesHorsContrat))
})

test('intégration — les statuts employés respectent leur définition', { timeout: 600000 }, () => {
  const resultat = lancer(['--simulation', '--hors-ligne'])
  assert.ok(resultat.rapport)
  const connus = ['SUCCESS', 'REUSED', 'GENERATED', 'SYNCHRONIZED', 'WARNING', 'BLOCKED', 'FAILED', 'SKIPPED']
  for (const etape of resultat.rapport.etapes) {
    for (const ligne of etape.lignes || []) {
      assert.ok(connus.includes(ligne.statut), 'statut inattendu : ' + ligne.statut)
    }
  }
  // SYNCHRONIZED ne peut pas apparaître sans mutation : en simulation, aucune.
  const synchronises = resultat.rapport.etapes
    .flatMap((etape) => etape.lignes || [])
    .filter((ligne) => ligne.statut === 'SYNCHRONIZED')
  assert.deepEqual(synchronises, [], 'aucune synchronisation ne peut être revendiquée en simulation')
})

test('intégration — aucun module du configurateur n emploie un générateur non cryptographique', () => {
  const dossier = path.join(aides.RACINE_PROJET, 'configuation automatique')
  const fautifs = []
  const parcourir = (courant) => {
    for (const entree of fs.readdirSync(courant, { withFileTypes: true })) {
      const complet = path.join(courant, entree.name)
      if (entree.isDirectory()) {
        if (entree.name === 'reports' || entree.name === 'tests') continue
        parcourir(complet)
        continue
      }
      if (!entree.name.endsWith('.js')) continue
      const texte = fs.readFileSync(complet, 'utf8')
      if (/Math\.random\s*\(/.test(texte)) fautifs.push(path.relative(dossier, complet))
    }
  }
  parcourir(dossier)
  assert.deepEqual(fautifs, [], 'aucun secret ne doit dépendre de Math.random')
})
