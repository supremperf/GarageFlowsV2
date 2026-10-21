'use strict'
/**
 * SYNCHRONISATION VERS VERCEL — les trois environnements, et tout ce qui doit
 * être refusé.
 *
 * Les instantanés sont construits à la main, à la forme exacte de ceux que
 * `providers/vercel.js` produit. Aucun test de ce fichier n'écrit chez le
 * fournisseur : on vérifie le PLAN d'opérations, c'est-à-dire la décision, qui
 * est précisément l'endroit où une erreur serait coûteuse.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const aides = require('./helpers.js')
const pipeline = require('../core/pipeline.js')
const engine = require('../core/engine.js')
const manifeste = require('../config/manifest.js')

const unifie = manifeste.charger(aides.RACINE_PROJET, { scanner: false })

/**
 * Construit l'état minimal attendu par `construireOperations`, avec un plan
 * fabriqué à partir de décisions explicites.
 */
function etatAvec({ cible, snapshot, decisions }) {
  const definition = engine.CIBLES[cible]
  return {
    unifie,
    cibles: [cible],
    snapshots: { [definition.vercel]: snapshot },
    plan: { cibles: { [cible]: { cible, definition, decisions } } },
  }
}

function prise(nom, valeur, extras = {}) {
  return {
    nom, cible: extras.cible || 'production', valeur,
    action: extras.action || 'recuperer', statut: extras.statut || 'REUSED',
    categorie: 'B-recuperable', raison: 'test', avertissements: [], anomalies: [],
    origine: 'test', confiance: 'declaree', empreinte: 'aaaaaaaaaaaa', requise: true,
  }
}

test('synchronisation — une variable requise absente est créée dans la bonne cible', () => {
  const snapshot = aides.instantaneVercel({ cible: 'production', lisibles: {} })
  const etat = etatAvec({
    cible: 'production',
    snapshot,
    decisions: [prise('UPSTASH_REDIS_REST_URL', aides.VALEURS_TEST.redisUrl)],
  })
  const operations = pipeline.construireOperations(etat, {})
  assert.equal(operations.aFaire.length, 1)
  assert.equal(operations.aFaire[0].genre, 'creer')
  assert.equal(operations.aFaire[0].cible, 'production')
  assert.ok(operations.aFaire[0].marque.startsWith('GarageFlows configurateur'), 'une marque de propriété doit être posée')
})

test('synchronisation — une variable déjà identique ne produit aucune opération', () => {
  const snapshot = aides.instantaneVercel({
    cible: 'production',
    lisibles: { UPSTASH_REDIS_REST_URL: aides.VALEURS_TEST.redisUrl },
  })
  const etat = etatAvec({
    cible: 'production',
    snapshot,
    decisions: [prise('UPSTASH_REDIS_REST_URL', aides.VALEURS_TEST.redisUrl)],
  })
  const operations = pipeline.construireOperations(etat, {})
  assert.deepEqual(operations.aFaire, [])
  assert.deepEqual(operations.refusees, [], 'aucun refus à signaler : la configuration est correcte')
})

test('synchronisation — une variable non relisible n est jamais remplacée à l aveugle', () => {
  const snapshot = aides.instantaneVercel({ cible: 'production', cachees: ['NEXTAUTH_SECRET'] })
  const etat = etatAvec({
    cible: 'production',
    snapshot,
    decisions: [prise('NEXTAUTH_SECRET', aides.VALEURS_TEST.base64_32)],
  })
  const operations = pipeline.construireOperations(etat, { autoriserRemplacementVercel: true })
  assert.deepEqual(operations.aFaire, [])
  assert.equal(operations.refusees.length, 1)
  assert.ok(/non relisible/i.test(operations.refusees[0].raison))
})

test('synchronisation — une variable d intégration Marketplace est laissée intacte', () => {
  const snapshot = aides.instantaneVercel({
    cible: 'preview',
    lisibles: { DATABASE_URL: aides.VALEURS_TEST.urlPoolee },
    protegees: ['DATABASE_URL'],
  })
  const etat = etatAvec({
    cible: 'preview',
    snapshot,
    decisions: [prise('DATABASE_URL', aides.VALEURS_TEST.urlDirecte, { cible: 'preview' })],
  })
  const operations = pipeline.construireOperations(etat, { autoriserRemplacementVercel: true })
  assert.deepEqual(operations.aFaire, [])
  assert.ok(/intégration/i.test(operations.refusees[0].raison))
})

test('synchronisation — une divergence n est pas corrigée sans autorisation explicite', () => {
  const snapshot = aides.instantaneVercel({
    cible: 'preview',
    lisibles: { UPSTASH_REDIS_REST_URL: 'https://ancienne-base.upstash.io' },
  })
  const decisions = [prise('UPSTASH_REDIS_REST_URL', aides.VALEURS_TEST.redisUrl, { cible: 'preview' })]
  const etat = etatAvec({ cible: 'preview', snapshot, decisions })

  const sansAutorisation = pipeline.construireOperations(etat, {})
  assert.deepEqual(sansAutorisation.aFaire, [])
  assert.ok(/--autoriser-remplacement-vercel/.test(sansAutorisation.refusees[0].raison))

  const avecAutorisation = pipeline.construireOperations(etat, { autoriserRemplacementVercel: true })
  assert.equal(avecAutorisation.aFaire.length, 1)
  assert.equal(avecAutorisation.aFaire[0].genre, 'remplacer')
})

test('synchronisation — une rotation critique reste refusée même autorisée', () => {
  const snapshot = aides.instantaneVercel({
    cible: 'production',
    lisibles: { GF_DB_MAC_SECRET: aides.VALEURS_TEST.hex_32 },
  })
  const etat = etatAvec({
    cible: 'production',
    snapshot,
    decisions: [prise('GF_DB_MAC_SECRET', aides.octetsVaries(9).toString('hex'))],
  })
  const operations = pipeline.construireOperations(etat, { autoriserRemplacementVercel: true })
  assert.deepEqual(operations.aFaire, [])
  assert.equal(operations.refusees[0].statut, 'BLOCKED')
  assert.ok(/migration/i.test(operations.refusees[0].raison))
})

test('synchronisation — une variable partagée entre environnements n est pas mutée', () => {
  const snapshot = aides.instantaneVercel({ cible: 'production', lisibles: { NEXTAUTH_URL: 'https://ancien.test' } })
  // Un enregistrement couvrant deux cibles : le scinder est une décision manuelle.
  snapshot.enregistrements[0].target = ['production', 'preview']
  const etat = etatAvec({
    cible: 'production',
    snapshot,
    decisions: [prise('NEXTAUTH_URL', 'https://app.garageflows.fr')],
  })
  const operations = pipeline.construireOperations(etat, { autoriserRemplacementVercel: true })
  assert.deepEqual(operations.aFaire, [])
  assert.ok(/plusieurs environnements/i.test(operations.refusees[0].raison))
})

test('synchronisation — rien n est envoyé vers une cible que la politique n autorise pas', () => {
  // NEXTAUTH_URL n'a que la cible production : en Preview, l'URL est dynamique.
  const snapshot = aides.instantaneVercel({ cible: 'preview', lisibles: {} })
  const etat = etatAvec({
    cible: 'preview',
    snapshot,
    decisions: [prise('NEXTAUTH_URL', 'https://app.garageflows.fr', { cible: 'preview' })],
  })
  const operations = pipeline.construireOperations(etat, {})
  assert.deepEqual(operations.aFaire, [], 'aucune opération hors politique')
})

test('synchronisation — le type Vercel suit la nature de la variable', () => {
  const noyau = require(path.join(aides.RACINE_PROJET, 'scripts/config-core.cjs'))
  const snapshot = aides.instantaneVercel({ cible: 'production', lisibles: {} })
  const etat = etatAvec({
    cible: 'production',
    snapshot,
    decisions: [
      prise('GF_PRODUCTION_DB_FINGERPRINT', 'a'.repeat(64)),
      prise('DEVICE_TOKEN_PEPPER', aides.VALEURS_TEST.base64_32),
    ],
  })
  const operations = pipeline.construireOperations(etat, {})
  const parNom = Object.fromEntries(operations.aFaire.map((operation) => [operation.nom, operation]))
  assert.equal(noyau.isSecret('GF_PRODUCTION_DB_FINGERPRINT'), false)
  assert.equal(parNom.GF_PRODUCTION_DB_FINGERPRINT.type, 'plain', 'une empreinte publique n est pas chiffrée inutilement')
  assert.equal(parNom.DEVICE_TOKEN_PEPPER.type, 'encrypted', 'un secret est chiffré')
})

test('échec d authentification Vercel — aucune lecture, aucune supposition de projet', async () => {
  const racine = aides.depotFactice()
  try {
    const fournisseur = require('../providers/vercel.js')
    // Aucun `.vercel/project.json` dans le dépôt factice : la détection doit
    // s'arrêter sur « projet non lié » sans inventer d'identifiant.
    const client = fournisseur.client(racine)
    assert.equal(client.projetLie(), null)

    // Un fichier de lien invalide ne doit pas davantage être accepté.
    aides.ecrire(racine, '.vercel/project.json', JSON.stringify({ projectId: 'invalide', orgId: 'invalide' }))
    assert.equal(client.projetLie(), null)

    aides.ecrire(racine, '.vercel/project.json', JSON.stringify({
      projectId: 'prj_AAAAAAAAAAAAAAAA', orgId: 'team_BBBBBBBBBBBBBBBB', projectName: 'exemple',
    }))
    const lie = client.projetLie()
    assert.equal(lie.projectId, 'prj_AAAAAAAAAAAAAAAA')
  } finally {
    aides.nettoyer(racine)
  }
})

test('fournisseur indisponible — PostgreSQL injoignable est rapporté, jamais contourné', async () => {
  const fournisseur = require('../providers/postgres.js')
  const sonde = await fournisseur.sonder(aides.RACINE_PROJET, {
    DATABASE_URL: 'postgresql://utilisateur:motdepasse@127.0.0.1:1/absente?sslmode=require',
    DIRECT_URL: 'postgresql://utilisateur:motdepasse@127.0.0.1:1/absente?sslmode=require',
  })
  assert.equal(sonde.poolee, false)
  assert.equal(sonde.directe, false)
  assert.ok(sonde.erreur, 'une cause doit être rapportée')
  assert.equal(sonde.vide, null, 'aucune conclusion sur le contenu d une base injoignable')
})

test('fournisseur indisponible — Redis injoignable ne devient jamais un succès', async () => {
  const fournisseur = require('../providers/upstash.js')
  const sonde = await fournisseur.sonder(aides.RACINE_PROJET, {
    UPSTASH_REDIS_REST_URL: 'https://exemple-inexistant-12345.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: aides.VALEURS_TEST.redisToken,
  }, { fetch: async () => { throw new Error('réseau indisponible') } })
  assert.equal(sonde.joignable, false)
  assert.ok(sonde.erreur)
})

test('fournisseur — un endpoint Redis hors domaine Upstash est refusé avant tout envoi', async () => {
  const fournisseur = require('../providers/upstash.js')
  let appele = false
  const sonde = await fournisseur.sonder(aides.RACINE_PROJET, {
    UPSTASH_REDIS_REST_URL: 'https://collecteur-de-jetons.exemple',
    UPSTASH_REDIS_REST_TOKEN: aides.VALEURS_TEST.redisToken,
  }, { fetch: async () => { appele = true; return { ok: true, json: async () => ({ result: 'PONG' }) } } })
  assert.equal(appele, false, 'le jeton ne doit jamais partir vers un domaine tiers')
  assert.equal(sonde.joignable, false)
  assert.ok(sonde.forme.some((probleme) => /upstash\.io/.test(probleme)))
})

test('stockage — un jeton Blob dont le store n est pas rattaché est signalé', () => {
  const fournisseur = require('../providers/storage.js')
  const jeton = 'vercel_blob_rw_StOrEaBc123_ZZZZZZZZZZZZZZZZ'
  const associe = fournisseur.verifierBlob(aides.RACINE_PROJET, { BLOB_READ_WRITE_TOKEN: jeton },
    { storeIds: ['store_StOrEaBc123'], compromis: [] })
  assert.equal(associe.associe, true)

  const orphelin = fournisseur.verifierBlob(aides.RACINE_PROJET, { BLOB_READ_WRITE_TOKEN: jeton },
    { storeIds: ['store_AutreStore'], compromis: [] })
  assert.equal(orphelin.associe, false)
  assert.ok(/Connect Project/.test(orphelin.anomalies[0]), 'la marche à suivre doit être donnée')
})

test('stockage — un chemin de disque local est refusé pour une cible Vercel', () => {
  const fournisseur = require('../providers/storage.js')
  const resultat = fournisseur.verifierChemins({ GF_BACKUP_DIR: 'C:/sauvegardes' }, { cibleVercel: true })
  assert.equal(resultat.anomalies.length, 1)
  assert.ok(/éphémère/i.test(resultat.anomalies[0]))
})

test('facturation électronique — une configuration d émission réelle est refusée', () => {
  const fournisseur = require('../providers/einvoicing.js')
  const sur = fournisseur.verifier({})
  assert.equal(sur.etat.active, false)
  assert.equal(sur.etat.environnement, 'sandbox')
  assert.equal(sur.emissionReellePossible, false)

  const dangereux = fournisseur.verifier({
    EINVOICING_ENABLED: 'true', EINVOICING_OUTGOING_ENABLED: 'true',
    EINVOICING_SANDBOX_ONLY: 'false', EINVOICING_DEFAULT_ENVIRONMENT: 'production',
  })
  assert.equal(dangereux.emissionReellePossible, true)
  assert.ok(dangereux.anomalies.length >= 3, 'chaque facteur de risque doit être nommé')

  // Les valeurs que le configurateur accepte d'écrire sont toutes des défauts sûrs.
  const sures = fournisseur.valeursSures({})
  assert.equal(sures.EINVOICING_ENABLED, 'false')
  assert.equal(sures.EINVOICING_SANDBOX_ONLY, 'true')
  assert.equal(sures.EINVOICING_DEFAULT_ENVIRONMENT, 'sandbox')
})

test('SMTP — la clé de chiffrement absente n est pas créée en silence', () => {
  const fournisseur = require('../providers/smtp.js')
  const absente = fournisseur.verifier({})
  assert.equal(absente.cle, 'absente')
  assert.ok(/clé d origine/i.test(absente.consequence))

  const conforme = fournisseur.verifier({ GF_SMTP_CIPHER_KEY: aides.VALEURS_TEST.base64_32 })
  assert.equal(conforme.cle, 'presente-conforme')

  const invalide = fournisseur.verifier({ GF_SMTP_CIPHER_KEY: 'trop-court' })
  assert.equal(invalide.cle, 'presente-non-conforme')
  assert.ok(/Ne pas la remplacer/i.test(invalide.consequence))
})

test('Anthropic — la disponibilité n est jamais revendiquée sans test réel', async () => {
  const fournisseur = require('../providers/anthropic.js')
  const sansTest = await fournisseur.verifier({ ANTHROPIC_API_KEY: 'sk-ant-' + 'a'.repeat(30) })
  assert.equal(sansTest.disponibilite, 'non-testee')
  assert.deepEqual(sansTest.forme, [])

  const mauvaisFormat = await fournisseur.verifier({ ANTHROPIC_API_KEY: 'cle-quelconque' })
  assert.ok(mauvaisFormat.forme.length > 0)

  const teste = await fournisseur.verifier({ ANTHROPIC_API_KEY: 'sk-ant-' + 'a'.repeat(30) },
    { verifierEnLigne: true, fetch: async () => ({ status: 401 }) })
  assert.equal(teste.disponibilite, 'refusee')
})

test('isolation Preview — une base identique à la production est détectée', () => {
  const validateur = require('../validators/environments.js')
  const postgres = require('../providers/postgres.js')
  const empreinte = postgres.empreinteCible(aides.VALEURS_TEST.urlPoolee)

  const violee = validateur.verifier(aides.RACINE_PROJET, unifie, {
    preview: aides.instantaneVercel({
      cible: 'preview',
      lisibles: { DATABASE_URL: aides.VALEURS_TEST.urlPoolee, GF_PRODUCTION_DB_FINGERPRINT: empreinte },
    }),
  }, {})
  assert.equal(violee.isolationPreview.conclusion, 'VIOLÉE')
  assert.ok(violee.anomalies.some((texte) => /PRODUCTION/.test(texte)))

  const respectee = validateur.verifier(aides.RACINE_PROJET, unifie, {
    preview: aides.instantaneVercel({
      cible: 'preview',
      lisibles: {
        DATABASE_URL: 'postgresql://u:p@ep-autre-pooler.c-1.eu-central-1.aws.neon.tech/garageflow',
        GF_PRODUCTION_DB_FINGERPRINT: empreinte,
      },
    }),
  }, {})
  assert.equal(respectee.isolationPreview.conclusion, 'respectée')
})

test('isolation Preview — une garde non provisionnée est signalée comme absente', () => {
  const validateur = require('../validators/environments.js')
  const rapport = validateur.verifier(aides.RACINE_PROJET, unifie, {
    preview: aides.instantaneVercel({ cible: 'preview', lisibles: { DATABASE_URL: aides.VALEURS_TEST.urlPoolee } }),
  }, {})
  assert.equal(rapport.isolationPreview.conclusion, 'garde absente')
  assert.ok(rapport.anomalies.some((texte) => /isolation non provisionnée/i.test(texte)))
})

test('cohérence — un secret sous un nom public est une anomalie, pas un détail', () => {
  const validateur = require('../validators/environments.js')
  const rapport = validateur.verifier(aides.RACINE_PROJET, unifie, {
    production: aides.instantaneVercel({ cible: 'production', lisibles: { NEXT_PUBLIC_API_SECRET: 'valeur' } }),
  }, {})
  assert.equal(rapport.secretsSousNomPublic.length, 1)
  assert.ok(rapport.anomalies.some((texte) => /bundle navigateur/i.test(texte)))
})

test('cohérence — un alias historique du projet est distingué d un alias d intégration', () => {
  const validateur = require('../validators/environments.js')
  const duProjet = validateur.verifier(aides.RACINE_PROJET, unifie, {
    production: aides.instantaneVercel({ cible: 'production', lisibles: { PWA_DATABASE_URL: 'valeur' } }),
  }, {})
  assert.ok(duProjet.anomalies.some((texte) => /Alias historiques déclarés sur le projet/i.test(texte)))

  const integration = validateur.verifier(aides.RACINE_PROJET, unifie, {
    production: aides.instantaneVercel({
      cible: 'production', lisibles: { DATABASE_URL_UNPOOLED: 'valeur' }, protegees: ['DATABASE_URL_UNPOOLED'],
    }),
  }, {})
  assert.ok(integration.avertissements.some((texte) => /appartiennent au fournisseur/i.test(texte)))
  assert.ok(!integration.anomalies.some((texte) => /Alias historiques déclarés sur le projet/i.test(texte)))
})

test('cohérence — NODE_ENV ou ELECTRON sur le projet PWA sont des anomalies', () => {
  const validateur = require('../validators/environments.js')
  const rapport = validateur.verifier(aides.RACINE_PROJET, unifie, {
    production: aides.instantaneVercel({ cible: 'production', lisibles: { NODE_ENV: 'development', ELECTRON: '1' } }),
  }, {})
  assert.equal(rapport.surchargesRuntime.length, 2)
})
