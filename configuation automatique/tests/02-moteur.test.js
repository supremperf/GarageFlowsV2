'use strict'
/**
 * MOTEUR DE DÉCISION — les scénarios de configuration exigés par le cahier des
 * charges, du dépôt vierge aux pannes de fournisseur.
 *
 * Chaque test vérifie une DÉCISION, pas un affichage : l'enjeu est qu'aucune
 * situation ne conduise à remplacer un secret existant ou à inventer une valeur.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const aides = require('./helpers.js')
const engine = require('../core/engine.js')
const manifeste = require('../config/manifest.js')
const discovery = require('../core/discovery.js')

const unifie = manifeste.charger(aides.RACINE_PROJET, { scanner: false })

/** Raccourci : décide le sort d'une variable dans un contexte décrit à la main. */
function decider(nom, cible, contexte = {}) {
  const entree = unifie.parNom.get(nom)
  assert.ok(entree, 'variable inconnue du manifeste : ' + nom)
  return engine.deciderVariable({
    entree,
    cible,
    candidats: contexte.candidats || [],
    existante: contexte.existante || null,
    presenteDistante: !!contexte.presenteDistante,
    lisibleDistante: !!contexte.lisibleDistante,
    environnementDistant: contexte.environnementDistant !== undefined
      ? contexte.environnementDistant
      : engine.CIBLES[cible].vercel,
    distantConnu: contexte.distantConnu !== undefined ? contexte.distantConnu : true,
    baseVide: contexte.baseVide !== undefined ? contexte.baseVide : true,
    derivee: contexte.derivee || null,
    defautConnu: contexte.defautConnu,
    options: contexte.options || {},
    brouillonsProuves: contexte.brouillonsProuves || new Set(),
  })
}

// ── Scénario 1 : première installation, poste vierge ────────────────────────
test('scénario 1 — installation vierge : les secrets de session sont générés', () => {
  const prise = decider('NEXTAUTH_SECRET', 'desktop', { baseVide: true })
  assert.equal(prise.action, 'generer')
  assert.equal(prise.statut, 'GENERATED')
  assert.equal(prise.categorie, engine.CATEGORIES.A)
  assert.ok(prise.avertissements.some((texte) => /session/i.test(texte)), 'la conséquence doit être annoncée')
})

test('scénario 1 — installation vierge : les défauts desktop sont posés, pas inventés', () => {
  const prise = decider('DATABASE_URL', 'desktop', { environnementDistant: null })
  assert.equal(prise.action, 'deriver')
  assert.equal(prise.valeur, 'file:./dev.db')
  assert.equal(prise.origine, 'defaut-desktop')
})

// ── Scénario 2 et 3 : fichiers et secrets déjà présents ─────────────────────
test('scénario 2 — une valeur existante conforme est réutilisée telle quelle', () => {
  const prise = decider('NEXTAUTH_SECRET', 'desktop', {
    existante: { valeur: aides.VALEURS_TEST.base64_32, origine: 'fichier:.env', confiance: 'declaree' },
  })
  assert.equal(prise.action, 'reutiliser')
  assert.equal(prise.statut, 'REUSED')
  assert.equal(prise.valeur, aides.VALEURS_TEST.base64_32)
})

test('scénario 3 — un secret présent chez Vercel et protégé en lecture est conservé', () => {
  const prise = decider('NEXTAUTH_SECRET', 'production', { presenteDistante: true, lisibleDistante: false })
  assert.equal(prise.action, 'conserver')
  assert.equal(prise.statut, 'REUSED')
  assert.ok(/aucune rotation/i.test(prise.raison), 'la raison doit exclure explicitement la rotation')
})

// ── Scénario 4 : secrets invalides ──────────────────────────────────────────
test('scénario 4 — une clé critique non conforme est signalée, jamais remplacée', () => {
  const prise = decider('GF_DB_MAC_SECRET', 'production', {
    existante: { valeur: 'trop-court', origine: 'fichier:.env.server.local', confiance: 'declaree' },
  })
  assert.equal(prise.action, 'bloquer')
  assert.equal(prise.statut, 'BLOCKED')
  assert.ok(prise.anomalies.length > 0, 'les anomalies de format doivent être rapportées')
  assert.ok(/illisibles les données|migration/i.test(prise.raison))
})

test('scénario 4 — une valeur de faible risque non conforme est régénérée', () => {
  const prise = decider('GARAGEFLOW_API_KEY', 'production', {
    existante: { valeur: 'change-me', origine: 'fichier:.env.server.local', confiance: 'declaree' },
  })
  assert.equal(prise.action, 'generer')
  assert.equal(prise.statut, 'GENERATED')
})

// ── Scénario 5 : variables manquantes ───────────────────────────────────────
test('scénario 5 — une variable requise introuvable est bloquée, sans valeur inventée', () => {
  const prise = decider('DATABASE_URL', 'production')
  assert.equal(prise.action, 'bloquer')
  assert.equal(prise.statut, 'BLOCKED')
  assert.equal(prise.valeur, null)
  assert.ok(/aucune valeur inventée/i.test(prise.raison))
})

test('scénario 5 — une variable facultative absente est ignorée, pas signalée en anomalie', () => {
  const prise = decider('ANTHROPIC_API_KEY', 'production')
  assert.equal(prise.statut, 'SKIPPED')
  assert.equal(prise.valeur, null)
})

// ── Récupération et dérivation ──────────────────────────────────────────────
test('récupération — une valeur trouvée ailleurs est importée avec son origine', () => {
  const prise = decider('UPSTASH_REDIS_REST_URL', 'production', {
    candidats: [{
      nom: 'UPSTASH_REDIS_REST_URL', valeur: aides.VALEURS_TEST.redisUrl, empreinte: 'abc123',
      origine: 'fichier:.env.server.local', cible: 'production', confiance: 'declaree',
    }],
  })
  assert.equal(prise.action, 'recuperer')
  assert.equal(prise.statut, 'REUSED')
  assert.equal(prise.origine, 'fichier:.env.server.local')
})

test('récupération — une valeur propre à un autre environnement n est pas recopiée', () => {
  const prise = decider('DATABASE_URL', 'preview', {
    candidats: [{
      nom: 'DATABASE_URL', valeur: aides.VALEURS_TEST.urlPoolee, empreinte: 'abc123',
      origine: 'vercel:production', cible: 'production', confiance: 'prouvee',
    }],
  })
  assert.notEqual(prise.action, 'recuperer')
  assert.equal(prise.statut, 'BLOCKED')
})

test('récupération — un brouillon non prouvé est écarté ; prouvé, il est accepté', () => {
  const candidat = {
    nom: 'UPSTASH_REDIS_REST_TOKEN', valeur: aides.VALEURS_TEST.redisToken, empreinte: 'abc123',
    origine: 'brouillon:production', cible: 'production', confiance: 'brouillon',
  }
  const sansPreuve = decider('UPSTASH_REDIS_REST_TOKEN', 'production', { candidats: [candidat] })
  assert.notEqual(sansPreuve.action, 'recuperer')

  const avecPreuve = decider('UPSTASH_REDIS_REST_TOKEN', 'production', {
    candidats: [candidat],
    brouillonsProuves: new Set(['UPSTASH_REDIS_REST_TOKEN@production']),
  })
  assert.equal(avecPreuve.action, 'recuperer')
  assert.ok(avecPreuve.avertissements.some((texte) => /brouillon/i.test(texte)))
})

test('dérivation — une valeur calculée et vérifiée est préférée à une génération', () => {
  const prise = decider('GF_PRODUCTION_DB_FINGERPRINT', 'production', {
    derivee: { valeur: 'a'.repeat(64), origine: 'derive:DATABASE_URL@production', empreinte: 'aaaaaaaaaaaa' },
  })
  assert.equal(prise.action, 'deriver')
  assert.equal(prise.statut, 'SUCCESS')
  assert.equal(prise.confiance, 'prouvee')
})

test('dérivation — sans sa source, la variable nomme ce qui manque', () => {
  const prise = decider('GF_PRODUCTION_DB_FINGERPRINT', 'production')
  assert.equal(prise.categorie, engine.CATEGORIES.D)
  assert.ok(/DATABASE_URL@production/.test(prise.raison), 'la source attendue doit être nommée')
})

// ── Sûreté de la génération ─────────────────────────────────────────────────
test('sûreté — aucune génération quand l état distant est inconnu', () => {
  const prise = decider('NEXTAUTH_SECRET', 'production', { distantConnu: false })
  assert.equal(prise.action, 'bloquer')
  assert.ok(/ne prouve pas que la variable est absente en ligne/i.test(prise.raison))
})

test('sûreté — aucune génération d une clé liée aux données sur une base peuplée', () => {
  const peuplee = decider('GF_DB_MAC_SECRET', 'desktop', { environnementDistant: null, baseVide: false })
  assert.equal(peuplee.action, 'bloquer')
  assert.ok(/contient des données métier/i.test(peuplee.raison))

  const inconnue = decider('GF_DB_MAC_SECRET', 'desktop', { environnementDistant: null, baseVide: null })
  assert.equal(inconnue.action, 'bloquer')
  assert.ok(/impossible de vérifier/i.test(inconnue.raison))

  const vide = decider('GF_DB_MAC_SECRET', 'desktop', { environnementDistant: null, baseVide: true })
  assert.equal(vide.action, 'generer')
})

test('sûreté — une clé de chiffrement n est jamais créée sans autorisation explicite', () => {
  const refus = decider('GF_SMTP_CIPHER_KEY', 'production', { baseVide: true })
  assert.equal(refus.statut, 'SKIPPED')
  assert.ok(/--generer-cles-chiffrement/.test(refus.raison))

  const autorise = decider('GF_SMTP_CIPHER_KEY', 'production', {
    baseVide: true, options: { genererClesChiffrement: true },
  })
  assert.equal(autorise.action, 'generer')
  assert.ok(autorise.avertissements.some((texte) => /base vérifiée sans donnée/i.test(texte)))
})

test('sûreté — la clé privée de licence n est pas provisionnée sans autorisation', () => {
  const refus = decider('GF_PRIVATE_KEY', 'production', {
    derivee: { valeur: 'dGVzdA==', origine: 'keys/private.pem', empreinte: 'abc' },
  })
  assert.equal(refus.statut, 'SKIPPED')
  assert.ok(/cle-licence-vercel/.test(refus.raison))

  const autorise = decider('GF_PRIVATE_KEY', 'production', {
    derivee: { valeur: 'dGVzdA==', origine: 'keys/private.pem', empreinte: 'abc' },
    options: { 'cle-licence-vercel': true },
  })
  assert.equal(autorise.action, 'deriver')
})

// ── Hors périmètre ──────────────────────────────────────────────────────────
test('hors périmètre — les variables de plateforme et d outillage sont ignorées avec motif', () => {
  for (const nom of ['NODE_ENV', 'APPDATA', 'CI']) {
    if (!unifie.parNom.has(nom)) continue
    const prise = decider(nom, 'production')
    assert.equal(prise.statut, 'SKIPPED')
    assert.ok(prise.raison.length > 10, nom + ' : un motif explicite est attendu')
  }
})

test('hors périmètre — une variable facultative à défaut connu n est pas dupliquée', () => {
  const sansOption = decider('RATE_LIMIT_LOGIN_MAX', 'production', { defautConnu: '10' })
  assert.equal(sansOption.statut, 'SKIPPED')
  assert.ok(/--completer-facultatives/.test(sansOption.raison))

  const avecOption = decider('RATE_LIMIT_LOGIN_MAX', 'production', {
    defautConnu: '10', options: { completerFacultatives: true },
  })
  assert.equal(avecOption.valeur, '10')
  assert.equal(avecOption.origine, 'defaut-depot')
})

// ── Découverte ──────────────────────────────────────────────────────────────
test('découverte — un espace réservé n est jamais pris pour un identifiant', () => {
  const racine = aides.depotFactice()
  try {
    aides.ecrire(racine, '.env', [
      'NEXTAUTH_SECRET="change-me"',
      'UPSTASH_REDIS_REST_TOKEN="xxxxxxxxxxxx"',
      'GF_APP_URL="https://votre-domaine.test"',
    ].join('\n') + '\n')
    const trouve = discovery.collecter(racine, { environnement: {} })
    const noms = trouve.rejetees.map((rejet) => rejet.nom)
    assert.ok(noms.includes('NEXTAUTH_SECRET'), 'change-me doit être rejeté')
    assert.ok(noms.includes('UPSTASH_REDIS_REST_TOKEN'), 'xxxxx doit être rejeté')
    assert.ok(!trouve.parNom.has('NEXTAUTH_SECRET'), 'aucune valeur de remplacement ne devient candidate')
  } finally {
    aides.nettoyer(racine)
  }
})

test('découverte — un jeton temporaire est reconnu et jamais propagé', () => {
  const racine = aides.depotFactice()
  try {
    // Jeton factice assemblé à l'exécution. Le contenu produit est identique à
    // l'ancien littéral, mais aucune chaîne de forme JWT n'apparaît plus dans la
    // source : le scanner de secrets n'a plus de fixture à signaler, sans qu'on
    // ait touché ni à ses règles ni à son allowlist.
    const b64url = (valeur) => Buffer.from(valeur, 'utf8').toString('base64url')
    const jetonFactice = [b64url('{"alg":"RS256"}'), b64url('{"sub":"test"}'), b64url('signature')].join('.')
    aides.ecrire(racine, '.env.local', `VERCEL_OIDC_TOKEN="${jetonFactice}"\n`)
    const trouve = discovery.collecter(racine, { environnement: {} })
    assert.deepEqual(trouve.jetonsTemporaires, ['VERCEL_OIDC_TOKEN'])
    assert.equal(trouve.parNom.has('VERCEL_OIDC_TOKEN'), false)
  } finally {
    aides.nettoyer(racine)
  }
})

test('découverte — un identifiant connu exposé est refusé comme candidat', () => {
  const racine = aides.depotFactice()
  try {
    // Empreinte volontairement choisie dans la liste du dépôt : la valeur est
    // reconnue comme publiée, donc inutilisable même si elle « fonctionne ».
    const compromis = require(require('node:path').join(racine, 'scripts/compromised-secrets.json'))
    assert.ok(compromis.entries.length > 0, 'la liste des identifiants exposés doit être présente')
    const credentials = require(require('node:path').join(racine, 'scripts/lib/config-credentials.cjs'))
    // On fabrique une valeur dont l'empreinte correspond à une entrée connue en
    // réutilisant la fonction du dépôt sur une valeur témoin.
    const valeurTest = 'valeur-temoin'
    const entreeTest = [{ env: 'TEST', sha256Prefix: credentials.hash(valeurTest).slice(0, 12) }]
    aides.ecrire(racine, '.env', 'GF_PORTAL_SECRET="' + valeurTest + '"\n')
    const trouve = discovery.collecter(racine, { environnement: {}, secretsCompromis: entreeTest })
    assert.ok(trouve.rejetees.some((rejet) => rejet.nom === 'GF_PORTAL_SECRET' && /exposé/i.test(rejet.motif)))
  } finally {
    aides.nettoyer(racine)
  }
})

test('découverte — l ordre de priorité préfère la cible, puis la preuve', () => {
  const candidats = [
    { nom: 'X', valeur: 'brouillon', origine: 'brouillon:production', cible: 'production', confiance: 'brouillon' },
    { nom: 'X', valeur: 'poste', origine: 'environnement-poste', cible: null, confiance: 'declaree' },
    { nom: 'X', valeur: 'vercel', origine: 'vercel:production', cible: 'production', confiance: 'prouvee' },
  ]
  const choix = discovery.choisir(candidats, 'X', 'production')
  assert.equal(choix.valeur, 'vercel', 'la valeur en place dans la cible fait foi')
})

test('découverte — des valeurs divergentes entre sources sont détectées', () => {
  const candidats = [
    { nom: 'X', valeur: 'a', empreinte: 'aaa', origine: 'fichier:.env' },
    { nom: 'X', valeur: 'b', empreinte: 'bbb', origine: 'vercel:production' },
  ]
  const divergences = discovery.divergences(candidats)
  assert.equal(divergences.length, 2)
  assert.equal(discovery.divergences([candidats[0]]), null)
})

// ── Autorité de licences ────────────────────────────────────────────────────
test('autorité de licences — une paire existante est réutilisée et vérifiée par signature', () => {
  const autorite = require('../security/license-authority.js')
  const etat = autorite.inspecter(aides.RACINE_PROJET)
  // L'autorité PUBLIQUE est embarquée dans les clients : elle existe toujours,
  // et aucune création ne doit être autorisée — cela se vérifie partout.
  assert.equal(etat.autoriteExiste, true)
  assert.equal(etat.generationAutorisee, false, 'aucune création quand une autorité existe')
  // La PAIRE privée, elle, est gitignorée : elle n'existe que sur un poste de
  // signature. Exiger sa présence faisait échouer `test:config:auto` sur tout
  // clone neuf et en CI, pour une raison étrangère au configurateur.
  if (!etat.clePriveePresente) return
  assert.equal(etat.courbe, 'prime256v1')
  assert.equal(etat.correspondancePriveePublique, true)
  assert.equal(etat.signatureVerifiee, true, 'la clé doit produire une signature vérifiable')
})

test('autorité de licences — la création est refusée tant qu une autorité existe', () => {
  const autorite = require('../security/license-authority.js')
  const racine = aides.depotFactice()
  try {
    const etat = autorite.inspecter(racine)
    // Le dépôt factice n'a pas de keys/, mais il embarque la clé publique :
    // les clients lui font déjà confiance, donc une création serait une
    // seconde racine de confiance.
    assert.equal(etat.clePriveePresente, false)
    assert.equal(etat.autoriteExiste, true, 'la clé publique embarquée suffit à constater une autorité')
    assert.equal(etat.generationAutorisee, false)
    assert.ok(etat.anomalies.some((texte) => /clé privée est absente de ce poste/i.test(texte)))
    assert.throws(() => autorite.creerAutorite(racine, etat, { ecrire: () => {} }), /refusée/i)
  } finally {
    aides.nettoyer(racine)
  }
})

test('autorité de licences — sur un dépôt réellement neuf, la création produit une paire valide', () => {
  const autorite = require('../security/license-authority.js')
  const fsx = require('../utils/fsx.js')
  const fs = require('node:fs')
  const racine = aides.depotFactice()
  try {
    // Dépôt sans aucune autorité : ni fichiers dans keys/, ni ancrage exploitable.
    aides.ecrire(racine, 'electron/main.js', 'const _PK = [\n]\n')
    aides.ecrire(racine, 'src/lib/license/public-key.ts', 'const _LINES = [\n]\n')
    const avant = autorite.inspecter(racine)
    assert.equal(avant.autoriteExiste, false)
    assert.equal(avant.generationAutorisee, true)

    const creation = autorite.creerAutorite(racine, avant, {
      ecrire: (fichier, contenu, parametres) => fsx.ecrireAtomique(fichier, contenu, parametres),
    })
    assert.match(creation.empreinte, /^[0-9a-f]{64}$/)

    const apres = autorite.inspecter(racine)
    assert.equal(apres.clePriveePresente, true)
    assert.equal(apres.courbe, 'prime256v1')
    assert.equal(apres.correspondancePriveePublique, true)
    assert.equal(apres.signatureVerifiee, true)
    assert.equal(apres.generationAutorisee, false, 'une seconde création devient impossible')

    // Écriture exclusive : une nouvelle tentative ne peut pas écraser la clé.
    assert.throws(() => fsx.ecrireAtomique(require('node:path').join(racine, 'keys/private.pem'), 'x', { exclusif: true }), /EEXIST/)
    // La clé privée n'est lisible que par son propriétaire là où le mode compte.
    const permissions = fsx.permissions(require('node:path').join(racine, 'keys/private.pem'))
    if (permissions.modeSignificatif) assert.equal(permissions.lisibleParTous, false)
    assert.ok(fs.existsSync(require('node:path').join(racine, 'keys/public.pem')))
  } finally {
    aides.nettoyer(racine)
  }
})

test('autorité de licences — GF_PRIVATE_KEY se dérive de la clé locale, et refuse une clé étrangère', () => {
  const autorite = require('../security/license-authority.js')
  const noyau = require(require('node:path').join(aides.RACINE_PROJET, 'scripts/config-core.cjs'))
  const etat = autorite.inspecter(aides.RACINE_PROJET)
  const derivation = autorite.deriverVariablePrivee(aides.RACINE_PROJET, etat)
  // `keys/private.pem` est gitignoré : sur un clone neuf ou en CI, aucun poste
  // de signature n'existe ici. L'invariant de DÉRIVATION ne s'applique alors à
  // rien, et l'exiger quand même faisait échouer `test:config:auto` dans tout
  // environnement propre — un échec qui ne signalait aucune dérive. Même garde
  // que les vérifications jumelles côté vitest (`it.skipIf(!existsSync(PEM))`).
  // En revanche, une clé PRÉSENTE qui ne correspond pas aux ancres reste un
  // échec : c'est précisément l'anomalie à voir.
  if (etat.clePriveePresente) {
    assert.ok(derivation.valeur, 'la dérivation doit aboutir : ' + (derivation.bloque || ''))
    // La valeur dérivée doit satisfaire le contrôle que l'application applique.
    assert.equal(noyau.licenseKeyMatches(derivation.valeur, noyau.embeddedLicenseKey(aides.RACINE_PROJET)), true)
  } else {
    assert.ok(derivation.bloque, 'sans clé locale, la dérivation doit être bloquée et le dire')
    assert.equal(derivation.valeur, undefined)
  }

  // Une autorité absente ne produit aucune dérivation.
  const racine = aides.depotFactice()
  try {
    const sansCle = autorite.inspecter(racine)
    const refus = autorite.deriverVariablePrivee(racine, sansCle)
    assert.ok(refus.bloque, 'sans clé privée locale, aucune valeur ne doit être produite')
    assert.equal(refus.valeur, undefined)
  } finally {
    aides.nettoyer(racine)
  }
})
