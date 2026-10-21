'use strict'
/**
 * LES TROIS SÉLECTIONS — projet, branche, environnement.
 *
 * Ce qui est vérifié ici n'est pas l'ergonomie du menu mais ses CONSÉQUENCES :
 * l'environnement choisi borne les écritures, un choix absent ne se devine
 * jamais, et les préférences mémorisées ne portent aucun secret.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const aides = require('./helpers.js')
const selection = require('../core/selection.js')

/** Client Vercel factice : aucun réseau, réponses maîtrisées. */
function clientFactice(projets, lie) {
  return {
    projetLie: () => lie || null,
    appel: async () => ({ projects: projets }),
  }
}

const PROJETS = [
  { id: 'prj_aaa', name: 'app.garageflows.fr', accountId: 'team_1', framework: 'nextjs' },
  { id: 'prj_bbb', name: 'garagesite3', accountId: 'team_1', framework: 'nextjs' },
]
const LIE = { projectId: 'prj_aaa', orgId: 'team_1', projectName: 'app.garageflows.fr' }

// ── Bornage des écritures ───────────────────────────────────────────────────

test('sélection — chaque environnement borne les écritures à ses propres cibles', () => {
  assert.deepEqual(selection.CIBLES_ECRITURE.development, ['desktop', 'development'])
  assert.deepEqual(selection.CIBLES_ECRITURE.preview, ['preview'])
  assert.deepEqual(selection.CIBLES_ECRITURE.production, ['production'])
})

test('sélection — aucun environnement ne peut écrire dans la cible d un autre', () => {
  const cibleExclusive = { development: 'development', preview: 'preview', production: 'production' }
  for (const [environnement, cibles] of Object.entries(selection.CIBLES_ECRITURE)) {
    for (const [autre, cible] of Object.entries(cibleExclusive)) {
      if (autre === environnement) continue
      assert.equal(cibles.includes(cible), false,
        environnement + ' ne doit jamais écrire dans ' + cible)
    }
  }
})

test('sélection — le profil local .env appartient à DEVELOPMENT, pas à la production', () => {
  // Configurer la production ne doit pas réécrire le .env du poste : c'est la
  // confusion qui fait pointer un poste de développement vers la base client.
  assert.equal(selection.CIBLES_ECRITURE.production.includes('desktop'), false)
  assert.equal(selection.CIBLES_ECRITURE.preview.includes('desktop'), false)
  assert.equal(selection.CIBLES_ECRITURE.development.includes('desktop'), true)
})

test('sélection — les trois environnements, et seulement eux', () => {
  assert.deepEqual(selection.ENVIRONNEMENTS.map((element) => element.cle),
    ['development', 'preview', 'production'])
  for (const element of selection.ENVIRONNEMENTS) {
    assert.ok(element.libelle && element.detail, 'chaque environnement est décrit')
  }
})

// ── Mémoire des choix ───────────────────────────────────────────────────────

test('sélection — le dernier choix mémorisé est proposé en tête', () => {
  const liste = [{ nom: 'a' }, { nom: 'b' }, { nom: 'c' }]
  const cle = (element) => element.nom
  assert.deepEqual(selection.ordonnerSelonMemoire(liste, 'c', cle).map(cle), ['c', 'a', 'b'])
  assert.deepEqual(selection.ordonnerSelonMemoire(liste, 'a', cle).map(cle), ['a', 'b', 'c'])
  assert.deepEqual(selection.ordonnerSelonMemoire(liste, 'inconnu', cle).map(cle), ['a', 'b', 'c'])
  assert.deepEqual(selection.ordonnerSelonMemoire(liste, null, cle).map(cle), ['a', 'b', 'c'])
})

test('sélection — les préférences retiennent trois noms et JAMAIS un secret', () => {
  const racine = aides.dossierTemporaire()
  try {
    selection.ecrirePreferences(racine, {
      projet: 'app.garageflows.fr',
      branche: 'main',
      environnement: 'preview',
      // Un appelant distrait tente d'y déposer des valeurs sensibles.
      DATABASE_URL: 'postgresql://utilisateur:motdepasse@hote/base',
      GARAGEFLOW_API_KEY: 'a'.repeat(64),
      token: 'vercel_blob_rw_secret',
    })
    const brut = fs.readFileSync(selection.cheminPreferences(racine), 'utf8')
    assert.ok(!/motdepasse/.test(brut), 'aucun mot de passe')
    assert.ok(!/postgresql:\/\//.test(brut), 'aucune URL de connexion')
    assert.ok(!/a{64}/.test(brut), 'aucune clé API')
    assert.ok(!/vercel_blob_rw/.test(brut), 'aucun jeton de stockage')
    assert.ok(!/DATABASE_URL|GARAGEFLOW_API_KEY/.test(brut), 'aucun nom de variable secrète')

    const relu = selection.lirePreferences(racine)
    assert.equal(relu.projet, 'app.garageflows.fr')
    assert.equal(relu.branche, 'main')
    assert.equal(relu.environnement, 'preview')
  } finally {
    aides.nettoyer(racine)
  }
})

test('sélection — un fichier de préférences illisible ou absurde n est jamais fatal', () => {
  const racine = aides.dossierTemporaire()
  try {
    assert.equal(selection.lirePreferences(racine), null)
    fs.mkdirSync(path.dirname(selection.cheminPreferences(racine)), { recursive: true })
    fs.writeFileSync(selection.cheminPreferences(racine), 'ceci n est pas du JSON')
    assert.equal(selection.lirePreferences(racine), null)
    fs.writeFileSync(selection.cheminPreferences(racine),
      JSON.stringify({ environnement: 'prod-maison', projet: 42 }))
    assert.equal(selection.lirePreferences(racine), null,
      'un environnement inconnu et un projet non textuel ne sont pas retenus')
  } finally {
    aides.nettoyer(racine)
  }
})

test('sélection — les préférences vivent dans le dossier ignoré par Git', () => {
  const chemin = selection.cheminPreferences(aides.RACINE_PROJET)
  assert.ok(chemin.includes('GarageFlow-configuration'),
    'le fichier doit être dans GarageFlow-configuration/, ignoré par .gitignore')
  const gitignore = fs.readFileSync(path.join(aides.RACINE_PROJET, '.gitignore'), 'utf8')
  assert.ok(/^GarageFlow-configuration\/$/m.test(gitignore),
    '.gitignore doit couvrir GarageFlow-configuration/')
})

// ── Découverte ──────────────────────────────────────────────────────────────

test('sélection — les branches locales et distantes sont découvertes, la courante en tête', () => {
  const inventaire = selection.decouvrirBranches(aides.RACINE_PROJET)
  if (!inventaire.disponible) return   // dépôt Git absent : rien à prouver ici
  assert.ok(inventaire.branches.length >= 1)
  assert.equal(inventaire.branches[0].courante, true, 'la branche courante est proposée en premier')
  assert.ok(inventaire.courante, 'la branche courante est nommée')
  for (const branche of inventaire.branches) {
    assert.ok(branche.origines.length >= 1)
    for (const origine of branche.origines) assert.ok(['locale', 'distante'].includes(origine))
    assert.ok(!/^origin\//.test(branche.nom), 'une branche distante est proposée sous son nom court')
    assert.notEqual(branche.nom, 'HEAD', 'HEAD n est pas une branche')
  }
})

test('sélection — la découverte des projets marque celui qui est lié au dossier', async () => {
  const inventaire = await selection.decouvrirProjets(aides.RACINE_PROJET,
    clientFactice(PROJETS, LIE), {})
  assert.equal(inventaire.disponible, true)
  assert.equal(inventaire.projets.length, 2)
  assert.equal(inventaire.projets[0].nom, 'app.garageflows.fr')
  assert.equal(inventaire.projets[0].lie, true, 'le projet lié est proposé en premier')
})

test('sélection — hors ligne, aucun appel réseau et seul le projet lié est connu', async () => {
  const client = {
    projetLie: () => LIE,
    appel: async () => { throw new Error('la découverte hors ligne ne doit appeler personne') },
  }
  const inventaire = await selection.decouvrirProjets(aides.RACINE_PROJET, client, { horsLigne: true })
  assert.equal(inventaire.disponible, false)
  assert.equal(inventaire.projets.length, 1)
  assert.equal(inventaire.projets[0].nom, 'app.garageflows.fr')
  assert.match(inventaire.raison, /hors ligne/i)
})

test('sélection — une session Vercel absente n est pas une panne du configurateur', async () => {
  const client = {
    projetLie: () => LIE,
    appel: async () => { throw new Error('403 refusé') },
  }
  const inventaire = await selection.decouvrirProjets(aides.RACINE_PROJET, client, {})
  assert.equal(inventaire.disponible, false)
  assert.match(inventaire.raison, /indisponible/i)
  assert.equal(inventaire.projets.length, 1, 'le projet lié localement reste utilisable')
})

// ── Choix effectif ──────────────────────────────────────────────────────────

test('sélection — les options répondent aux trois étapes sans poser de question', async () => {
  for (const environnement of ['development', 'preview', 'production']) {
    const choix = await selection.choisir(aides.RACINE_PROJET,
      { projet: 'app.garageflows.fr', branche: 'main', environnement },
      clientFactice(PROJETS, LIE))
    assert.equal(choix.environnement, environnement)
    assert.equal(choix.sources.environnement, 'option')
    assert.equal(choix.sources.projet, 'option')
    assert.equal(choix.sources.branche, 'option')
    assert.deepEqual(choix.ciblesEcriture, [...selection.CIBLES_ECRITURE[environnement]])
  }
})

test('sélection — un environnement inconnu est refusé, jamais interprété', async () => {
  await assert.rejects(
    () => selection.choisir(aides.RACINE_PROJET, { environnement: 'prod' }, clientFactice(PROJETS, LIE)),
    (erreur) => {
      assert.equal(erreur.selection, true)
      assert.match(erreur.message, /development, preview ou production/)
      return true
    })
})

test('sélection — sans terminal ni option, aucun environnement n est DEVINÉ', async () => {
  // Deviner « production » serait le pire défaut possible ; deviner
  // « development » donnerait l'illusion d'une configuration appliquée.
  const choix = await selection.choisir(aides.RACINE_PROJET, {}, clientFactice(PROJETS, LIE))
  assert.equal(choix.environnement, null)
  assert.equal(choix.ciblesEcriture, null)
  assert.equal(choix.sources.environnement, 'non-selectionne')
  assert.ok(choix.avertissements.some((texte) => /Aucun environnement sélectionné/.test(texte)),
    'l absence de sélection doit être DITE')
})

test('sélection — un projet absent de l inventaire est conservé et signalé, jamais inventé', async () => {
  const choix = await selection.choisir(aides.RACINE_PROJET,
    { projet: 'projet-qui-n-existe-pas', environnement: 'preview' },
    clientFactice(PROJETS, LIE))
  assert.equal(choix.projet.nom, 'projet-qui-n-existe-pas')
  assert.equal(choix.projet.id, null, 'aucun identifiant n est fabriqué')
  assert.ok(choix.avertissements.some((texte) => /absent de l inventaire/.test(texte)))
})

test('sélection — une branche inconnue du dépôt est signalée et n est pas créée', async () => {
  const choix = await selection.choisir(aides.RACINE_PROJET,
    { branche: 'branche-inexistante-xyz', environnement: 'preview' },
    clientFactice(PROJETS, LIE))
  assert.equal(choix.branche.nom, 'branche-inexistante-xyz')
  if (selection.decouvrirBranches(aides.RACINE_PROJET).disponible) {
    assert.ok(choix.avertissements.some((texte) => /inconnue du dépôt/.test(texte)))
  }
})

test('sélection — changer d environnement change les cibles écrites, et rien d autre', async () => {
  const commun = { projet: 'app.garageflows.fr', branche: 'main' }
  const avant = await selection.choisir(aides.RACINE_PROJET,
    { ...commun, environnement: 'preview' }, clientFactice(PROJETS, LIE))
  const apres = await selection.choisir(aides.RACINE_PROJET,
    { ...commun, environnement: 'production' }, clientFactice(PROJETS, LIE))
  assert.equal(avant.projet.nom, apres.projet.nom)
  assert.equal(avant.branche.nom, apres.branche.nom)
  assert.notDeepEqual(avant.ciblesEcriture, apres.ciblesEcriture)
  assert.deepEqual(apres.ciblesEcriture, ['production'])
})

test('sélection — aucune valeur sensible dans l objet rapporté', async () => {
  const choix = await selection.choisir(aides.RACINE_PROJET,
    { projet: 'app.garageflows.fr', environnement: 'production' }, clientFactice(PROJETS, LIE))
  const serialise = JSON.stringify(choix)
  assert.ok(!/postgres(ql)?:\/\//i.test(serialise))
  assert.ok(!/vercel_blob_rw/i.test(serialise))
  assert.ok(!/[A-Za-z0-9+/]{40,}={0,2}/.test(serialise.replace(/prj_[A-Za-z0-9_-]+|team_[A-Za-z0-9_-]+/g, '')),
    'aucune chaîne de la longueur d un secret encodé')
})
