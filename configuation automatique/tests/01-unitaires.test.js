'use strict'
/**
 * Briques de base : édition des fichiers .env, génération de secrets,
 * masquage, politique de destination.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const aides = require('./helpers.js')
const fichierEnv = require('../utils/env-file.js')
const secrets = require('../security/secrets.js')
const redact = require('../security/redact.js')
const destinations = require('../config/destinations.js')
const manifeste = require('../config/manifest.js')

const noyau = require(path.join(aides.RACINE_PROJET, 'scripts/config-core.cjs'))

test('fichier .env — ce qui est écrit est relu à l identique par l application', () => {
  const cas = [
    'simple', 'avec espace', 'guill"emet', 'anti\\slash', 'dollar$VAR',
    "apostro'phe", 'valeur # diese', aides.VALEURS_TEST.base64_32,
    aides.VALEURS_TEST.urlPoolee, 'accent' + fichierEnv.ACCENT_GRAVE + 'grave',
  ]
  for (const valeur of cas) {
    const resultat = fichierEnv.appliquer('', { TEST_VALEUR: valeur })
    assert.equal(noyau.parseEnv(resultat.texte).TEST_VALEUR, valeur, 'relecture par config-core : ' + JSON.stringify(valeur))
    assert.equal(fichierEnv.valeurs(resultat.texte).TEST_VALEUR, valeur, 'relecture locale : ' + JSON.stringify(valeur))
  }
})

test('fichier .env — les commentaires et les variables tierces sont préservés', () => {
  const avant = [
    '# Bloc de documentation important',
    '#   objectif : expliquer la variable',
    'AUTRE_VARIABLE="intacte"',
    '',
    '# CIBLE=',
    '# fin du fichier',
  ].join('\n') + '\n'
  const resultat = fichierEnv.appliquer(avant, { CIBLE: 'valeur' })
  assert.ok(resultat.texte.includes('# Bloc de documentation important'), 'commentaire conservé')
  assert.ok(resultat.texte.includes('#   objectif : expliquer la variable'), 'documentation conservée')
  assert.ok(resultat.texte.includes('AUTRE_VARIABLE="intacte"'), 'variable tierce conservée')
  assert.ok(resultat.texte.includes('# fin du fichier'), 'commentaire final conservé')
  // La déclaration documentée « # CIBLE= » est renseignée SUR PLACE, et non
  // dupliquée en fin de fichier : deux déclarations du même nom seraient un piège.
  assert.deepEqual(resultat.decommentees, ['CIBLE'])
  assert.equal((resultat.texte.match(/^CIBLE=/gm) || []).length, 1)
})

test('fichier .env — un doublon est neutralisé en gardant la déclaration effective', () => {
  const avant = 'A="premiere"\nB="b"\nA="seconde"\n'
  const resultat = fichierEnv.appliquer(avant, {})
  assert.deepEqual(resultat.dedoublonnees, ['A'])
  // dotenv applique la DERNIÈRE déclaration : c'est celle qu'il faut garder.
  assert.equal(fichierEnv.valeurs(resultat.texte).A, 'seconde')
  assert.equal(fichierEnv.valeurs(resultat.texte).B, 'b')
  assert.ok(resultat.texte.includes('doublon neutralisé'), 'la trace de la ligne retirée est conservée en commentaire')
})

test('fichier .env — une valeur mal formée est détectée puis réparée', () => {
  const avant = 'MAUVAIS="guillemet non ferme\n'
  assert.deepEqual(fichierEnv.analyser(avant).malformees, ['MAUVAIS'])
  const resultat = fichierEnv.appliquer(avant, { MAUVAIS: 'propre' })
  assert.deepEqual(resultat.reparees, ['MAUVAIS'])
  assert.equal(noyau.parseEnv(resultat.texte).MAUVAIS, 'propre')
})

test('fichier .env — appliquer deux fois la même valeur ne modifie rien (idempotence)', () => {
  const premier = fichierEnv.appliquer('EXISTANT="v"\n', { CIBLE: 'valeur' })
  const second = fichierEnv.appliquer(premier.texte, { CIBLE: 'valeur' })
  assert.equal(second.texte, premier.texte)
  assert.deepEqual(second.inchangees, ['CIBLE'])
  assert.deepEqual(second.ajoutees, [])
})

test('fichier .env — un nom de variable non représentable est refusé', () => {
  assert.throws(() => fichierEnv.appliquer('', { 'NOM INVALIDE': 'v' }), /Nom de variable invalide/)
  assert.throws(() => fichierEnv.encoder('NOM', 'valeur\navec saut'), /monoligne/)
})

test('secrets — chaque spécification produit une valeur conforme et exploitable', () => {
  for (const nom of Object.keys(secrets.SPECIFICATIONS)) {
    const produit = secrets.generer(nom)
    assert.deepEqual(secrets.anomalies(nom, produit.valeur), [], nom + ' doit être conforme')
    const specification = secrets.specification(nom)
    const octets = specification.encodage === 'hex'
      ? Buffer.from(produit.valeur, 'hex')
      : Buffer.from(produit.valeur, 'base64')
    assert.equal(octets.length, specification.octets, nom + ' : entropie attendue')
  }
})

test('secrets — les clés AES font exactement 32 octets après décodage base64', () => {
  for (const nom of ['GF_SMTP_CIPHER_KEY', 'GF_BACKUP_KEY', 'GF_EINVOICE_CREDENTIALS_KEY']) {
    const produit = secrets.generer(nom)
    assert.ok(secrets.aesValide(produit.valeur), nom + ' doit satisfaire aesValid du dépôt')
  }
})

test('secrets — deux générations successives diffèrent, et une collision est refusée', () => {
  const premier = secrets.generer('NEXTAUTH_SECRET').valeur
  const second = secrets.generer('NEXTAUTH_SECRET', { exclure: new Set([premier]) }).valeur
  assert.notEqual(premier, second)
  // Un générateur qui rendrait toujours la même valeur doit être rejeté, pas
  // contourné : on vérifie qu'il ne boucle pas indéfiniment.
  assert.throws(
    () => secrets.generer('NEXTAUTH_SECRET', {
      exclure: new Set([Buffer.alloc(32, 1).toString('base64')]),
      aleatoire: () => Buffer.alloc(32, 1),
    }),
    /génération impossible/i)
})

test('secrets — une source aléatoire défaillante est détectée, jamais utilisée', () => {
  // Entropie nulle : format valide, valeur inacceptable.
  assert.throws(() => secrets.generer('GF_DB_MAC_SECRET', { aleatoire: () => Buffer.alloc(32, 0) }), /génération impossible|entropie/i)
  // Taille incorrecte : le contrat du générateur n'est pas respecté.
  assert.throws(() => secrets.generer('GF_DB_MAC_SECRET', { aleatoire: () => Buffer.alloc(8, 3) }), /source aléatoire invalide/i)
})

test('secrets — un secret générique ou trop court est déclaré non conforme', () => {
  assert.equal(secrets.conforme('NEXTAUTH_SECRET', 'change-me-please').conforme, false)
  assert.equal(secrets.conforme('NEXTAUTH_SECRET', 'court').conforme, false)
  assert.equal(secrets.conforme('GF_DB_MAC_SECRET', 'ZZZZ').conforme, false)
  // Une variable sans spécification n'est jamais déclarée non conforme : le
  // configurateur ne doit pas inventer une règle de format.
  assert.equal(secrets.conforme('NEXTAUTH_URL', 'https://exemple.test').conforme, true)
})

test('masquage — une valeur surveillée disparaît de toute sortie', () => {
  redact.reinitialiser()
  const secret = aides.VALEURS_TEST.base64_32
  redact.enregistrer(secret)
  const message = 'Erreur du fournisseur : la valeur ' + secret + ' est refusée.'
  const propre = redact.nettoyer(message)
  assert.ok(!propre.includes(secret), 'la valeur ne doit plus apparaître')
  assert.ok(propre.includes(redact.MARQUEUR))
  assert.equal(redact.contientSecret(propre), false)
  redact.reinitialiser()
})

test('masquage — le mot de passe d une URL est masqué même isolé', () => {
  redact.reinitialiser()
  redact.enregistrer(aides.VALEURS_TEST.urlPoolee)
  const propre = redact.nettoyer('mot de passe utilisé : motdepasse-de-test')
  assert.ok(!propre.includes('motdepasse-de-test'))
  redact.reinitialiser()
})

test('masquage — les motifs de jetons sont neutralisés sans liste préalable', () => {
  redact.reinitialiser()
  const exemples = [
    'vercel_blob_rw_ABCdef123456_abcdefghijklmnop',
    'sk-ant-abcdefghijklmnopqrstuvwxyz0123',
    'postgresql://utilisateur:motdepasse@hote.exemple/base',
    '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----',
  ]
  for (const exemple of exemples) {
    const propre = redact.nettoyer('valeur : ' + exemple)
    assert.ok(propre.includes(redact.MARQUEUR), 'motif reconnu : ' + exemple.slice(0, 24))
    assert.ok(!propre.includes('motdepasse'), 'aucun identifiant résiduel')
  }
  redact.reinitialiser()
})

test('masquage — ce qui n est pas un secret reste lisible', () => {
  redact.reinitialiser()
  // Un chemin SQLite local et un nom d'hôte doivent rester visibles : un
  // rapport où la base est « [valeur masquée] » n'aide pas à diagnostiquer.
  assert.equal(redact.estSensible('DATABASE_URL', 'file:./dev.db'), false)
  assert.equal(redact.estSensible('PGHOST', 'ep-exemple-pooler.c-1.eu-central-1.aws.neon.tech'), false)
  assert.equal(redact.estSensible('EINVOICING_SANDBOX_ONLY', 'true'), false)
  assert.equal(redact.estSensible('GF_EINVOICE_CREDENTIALS_KEY_VERSION', '1'), false)
  // En revanche, tout ce qui porte un nom de secret ou ressemble à un secret l'est.
  assert.equal(redact.estSensible('NEXTAUTH_SECRET', aides.VALEURS_TEST.base64_32), true)
  assert.equal(redact.estSensible('DATABASE_URL', aides.VALEURS_TEST.urlPoolee), true)
  assert.equal(redact.estSensible('UNE_VARIABLE', 'vercel_blob_rw_ABCdef123456_abcdefgh'), true)
  redact.reinitialiser()
})

test('destinations — la politique est cohérente avec le manifeste du dépôt', () => {
  const unifie = manifeste.charger(aides.RACINE_PROJET, { scanner: false })
  assert.deepEqual(destinations.verifierPolitique(unifie.entrees), [])
})

test('destinations — aucun secret serveur ne part vers le client ou vers Vercel', () => {
  const unifie = manifeste.charger(aides.RACINE_PROJET, { scanner: false })
  for (const nom of destinations.INTERDITES_COTE_CLIENT) {
    const entree = unifie.parNom.get(nom)
    if (!entree) continue
    assert.ok(!entree.destination.fichiers.includes(destinations.FICHIERS.desktop), nom + ' ne doit pas atteindre .env')
    assert.deepEqual(entree.destination.cibles, [], nom + ' ne doit avoir aucune cible Vercel')
  }
  // Un nom public portant un secret est refusé quelle que soit sa portée.
  const regle = destinations.destination({ name: 'NEXT_PUBLIC_API_SECRET', action: 'application', scope: 'server' })
  assert.equal(regle.categorieDestination, 'interdite')
  assert.deepEqual(regle.cibles, [])
})

test('destinations — les valeurs propres à un environnement ne sont jamais recopiées', () => {
  for (const nom of ['DATABASE_URL', 'DIRECT_URL', 'NEXTAUTH_SECRET', 'GF_DB_MAC_SECRET']) {
    assert.equal(destinations.copiableEntreEnvironnements(nom), false, nom + ' ne doit pas être copiable')
  }
  // L'empreinte de la base de production DOIT être identique partout, sinon la
  // garde d'isolation de src/lib/env.ts ne peut rien comparer.
  assert.equal(destinations.copiableEntreEnvironnements('GF_PRODUCTION_DB_FINGERPRINT'), true)
})

test('manifeste — chaque variable du contrat a une fiche complète', () => {
  const unifie = manifeste.charger(aides.RACINE_PROJET, { scanner: false })
  assert.ok(unifie.entrees.length > 100, 'le manifeste du dépôt doit être chargé')
  for (const entree of unifie.entrees) {
    const fiche = entree.fiche
    assert.equal(fiche.nom, entree.name)
    for (const champ of ['fonction', 'environnement', 'format', 'generation', 'fournisseur', 'impactModification', 'siAbsente', 'destination']) {
      assert.ok(fiche[champ] !== undefined && fiche[champ] !== null && fiche[champ] !== '',
        entree.name + ' : la fiche doit renseigner « ' + champ + ' »')
    }
    assert.equal(typeof fiche.obligatoire, 'boolean')
    assert.ok(Array.isArray(fiche.ciblesVercel))
  }
})
