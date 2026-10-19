'use strict'
/**
 * GARDE — la détection de fuite `.env` dans un artefact distribué.
 *
 * Défaut réel : `.env.storage.example` (modèle fournisseur, TOUTES valeurs
 * vides) faisait échouer `npm run release:gate` à l'étape « Empaquetage +
 * vérification d'artefact RÉEL ». La règle ne reconnaissait que les noms
 * exacts `.env.example|sample|template`.
 *
 * La correction n'élargit pas la garde : un nom étendu n'est accepté que si
 * son CONTENU ne porte aucune valeur. Un `.env.production.example` contenant
 * un secret doit rester une fuite, et c'est ce que ces tests vérifient.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')

let mod

test('chargement du module de contrôle', async () => {
  mod = await import('../scripts/lib/env-artifact-check.mjs')
})

test('les trois noms historiques restent acceptés sans inspection', () => {
  for (const nom of ['.env.example', '.env.sample', '.env.template']) {
    assert.equal(mod.estGabarit(nom, () => 'SECRET=valeur'), true, nom)
  }
})

test('un gabarit étendu dont toutes les valeurs sont vides est accepté', () => {
  const contenu = [
    '# modèle fournisseur',
    'DATABASE_URL=',
    'DIRECT_URL=   ',
    'UPSTASH_REDIS_REST_TOKEN=  # vide',
    '',
  ].join('\n')
  assert.equal(mod.contenuSansValeur(contenu), true)
  assert.equal(mod.estGabarit('.env.storage.example', () => contenu), true)
})

test('un gabarit étendu qui contient une valeur est UNE FUITE', () => {
  for (const contenu of [
    'DATABASE_URL=postgresql://user:pass@host/db',
    'SECRET=abc',
    'export TOKEN=abc',
    'DATABASE_URL="postgres://x"',
    'ligne de texte libre',
  ]) {
    assert.equal(mod.contenuSansValeur(contenu), false, contenu)
    assert.equal(mod.estGabarit('.env.production.example', () => contenu), false, contenu)
  }
})

test('un fichier illisible n’est jamais blanchi', () => {
  assert.equal(mod.estGabarit('.env.storage.example', () => { throw new Error('EACCES') }), false)
})

test('les .env réels sont reconnus, les noms étendus ne le sont pas d’office', () => {
  for (const nom of ['.env', '.env.local', '.env.production', '.env.storage']) {
    assert.equal(mod.estEnvReel(nom), true, nom)
  }
  for (const nom of ['.env.example', '.env.storage.example', '.env.production.example', 'env']) {
    assert.equal(mod.estEnvReel(nom), false, nom)
  }
})

test('le scan d’un dossier racine ne remonte QUE les fuites réelles', () => {
  const fichiers = {
    '.env': 'SECRET=1',
    '.env.example': 'DATABASE_URL="file:./dev.db"',
    '.env.storage.example': 'DATABASE_URL=\n',
    '.env.production.example': 'DATABASE_URL=postgres://vraie:chose@h/db\n',
    'README.md': '# doc',
  }
  const io = {
    modeArtifact: true,
    exists: () => true,
    readdir: () => Object.keys(fichiers),
    stat: () => ({ isFile: () => true }),
    join: (dir, nom) => `${dir}/${nom}`,
  }
  const fuites = mod.fichiersEnvFuite(
    [{ dir: '/artefact', always: false }],
    (fichier) => fichiers[fichier.replace('/artefact/', '')],
    io,
  )
  assert.deepEqual(fuites.sort(), [
    '/artefact/.env',
    '/artefact/.env.production.example',
  ])
})

test('en mode dépôt, un .env à la racine est ignoré (gitignored, non distribué)', () => {
  const io = {
    modeArtifact: false,
    exists: () => true,
    readdir: () => ['.env'],
    stat: () => ({ isFile: () => true }),
    join: (dir, nom) => `${dir}/${nom}`,
  }
  assert.deepEqual(mod.fichiersEnvFuite([{ dir: '/repo', always: false }], () => 'SECRET=1', io), [])
})

test('un dossier standalone est scanné MÊME en mode dépôt', () => {
  const io = {
    modeArtifact: false,
    exists: () => true,
    readdir: () => ['.env'],
    stat: () => ({ isFile: () => true }),
    join: (dir, nom) => `${dir}/${nom}`,
  }
  assert.deepEqual(
    mod.fichiersEnvFuite([{ dir: '/repo/.next/standalone', always: true }], () => 'SECRET=1', io),
    ['/repo/.next/standalone/.env'],
  )
})
