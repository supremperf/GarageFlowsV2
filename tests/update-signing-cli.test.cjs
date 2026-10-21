'use strict'

/**
 * Signature des mises à jour — point d'entrée `npm run sign-update`.
 *
 * Ces tests exécutent le VRAI script et le VRAI vérificateur client
 * (`electron/update-verify.js`, via keygen-verify-update.cjs). Aucune clé de
 * production n'est utilisée : une paire Ed25519 éphémère est générée par test et
 * son ancre publique est injectée dans un processus dédié.
 *
 * Ce qui est prouvé :
 *   · absence de clé → refus explicite, aucun manifeste ;
 *   · clé d'un autre algorithme → refus (seul Ed25519 est accepté) ;
 *   · clé ne correspondant pas à l'ancre du keyId → refus AVANT signature ;
 *   · signature nominale → manifeste vérifié par le module client ;
 *   · binaire modifié après signature → détection (SHA-256) ;
 *   · manifeste falsifié → refus ;
 *   · la sortie ne contient jamais la clé privée ;
 *   · un installeur au nom fixe (sans version) est signable sans
 *     --allow-mismatch, la version venant de package.json.
 */

const assert = require('node:assert/strict')
const { test } = require('node:test')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const RACINE = path.resolve(__dirname, '..')
const SCRIPT = path.join(RACINE, 'scripts', 'gf_sign_update.js')
const VERIFICATEUR = path.join(RACINE, 'scripts', 'keygen-verify-update.cjs')
const VERSION = JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8')).version

function dossierTemporaire() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-sign-update-'))
}

function paireEd25519() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  return {
    privee: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publique: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

function installer(dossier, nom = `GarageFlows-Setup-${VERSION}.exe`, octets = 'installeur-de-test') {
  const fichier = path.join(dossier, nom)
  fs.writeFileSync(fichier, Buffer.from(octets))
  return fichier
}

function lancer(args, env = {}) {
  const propre = { ...process.env }
  delete propre.GF_UPDATE_SIGNING_KEY
  delete propre.GF_UPDATE_SIGNING_KEY_FILE
  delete propre.GF_UPDATE_DOWNLOAD_BASE_URL
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: RACINE,
    encoding: 'utf8',
    env: { ...propre, ...env },
    maxBuffer: 16 * 1024 * 1024,
  })
}

function verifier(manifeste, publique, keyId, currentVersion = '0.0.0') {
  const res = spawnSync(process.execPath, [
    VERIFICATEUR,
    '--manifest', manifeste,
    '--public-keys', JSON.stringify({ [keyId]: publique }),
    '--current-version', currentVersion,
  ], { cwd: RACINE, encoding: 'utf8' })
  let json = null
  try { json = JSON.parse((res.stdout || '').trim().split('\n').pop()) } catch { /* null */ }
  return { status: res.status, json, sortie: (res.stdout || '') + (res.stderr || '') }
}

test('sans clé : refus explicite, aucun manifeste', () => {
  const dossier = dossierTemporaire()
  const fichier = installer(dossier)
  const res = lancer(['--file', fichier])
  assert.equal(res.status, 1)
  assert.match(res.stderr, /aucune clé de signature configurée/i)
  assert.match(res.stderr, /gf-update-2026-2/)
  assert.equal(fs.existsSync(fichier.replace(/\.exe$/, '.manifest.json')), false)
  fs.rmSync(dossier, { recursive: true, force: true })
})

test('clé non Ed25519 : refus avant toute signature', () => {
  const dossier = dossierTemporaire()
  const fichier = installer(dossier)
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const res = lancer(['--file', fichier], { GF_UPDATE_SIGNING_KEY: pem })
  assert.equal(res.status, 1)
  assert.match(res.stderr, /seul Ed25519/i)
  assert.equal(fs.existsSync(fichier.replace(/\.exe$/, '.manifest.json')), false)
  fs.rmSync(dossier, { recursive: true, force: true })
})

test('clé étrangère pour un keyId déjà embarqué : refus', () => {
  const dossier = dossierTemporaire()
  const fichier = installer(dossier)
  const { privee } = paireEd25519()
  const res = lancer(['--file', fichier, '--key-id', 'gf-update-2026-2'], { GF_UPDATE_SIGNING_KEY: privee })
  assert.equal(res.status, 1)
  assert.match(res.stderr, /ne correspond PAS à l’ancre publique/i)
  assert.equal(fs.existsSync(fichier.replace(/\.exe$/, '.manifest.json')), false)
  fs.rmSync(dossier, { recursive: true, force: true })
})

test('signature nominale : manifeste vérifié par le module client, sans fuite de clé', () => {
  const dossier = dossierTemporaire()
  const fichier = installer(dossier)
  const { privee, publique } = paireEd25519()
  const keyId = 'gf-test-update'
  const res = lancer(['--file', fichier, '--key-id', keyId], { GF_UPDATE_SIGNING_KEY: privee })
  assert.equal(res.status, 0, res.stderr + res.stdout)
  assert.match(res.stdout, /Signature vérifiée par le module client/)
  assert.doesNotMatch(res.stdout + res.stderr, /BEGIN PRIVATE KEY/)
  assert.doesNotMatch(res.stdout + res.stderr, new RegExp(privee.split('\n')[1].slice(0, 20)))

  const manifeste = fichier.replace(/\.exe$/, '.manifest.json')
  assert.ok(fs.existsSync(manifeste))
  const signe = JSON.parse(fs.readFileSync(manifeste, 'utf8'))
  assert.equal(signe.manifest.keyId, keyId)
  assert.equal(signe.manifest.sha256, crypto.createHash('sha256').update(fs.readFileSync(fichier)).digest('hex'))
  assert.equal(typeof signe.signature, 'string')

  const v = verifier(manifeste, publique, keyId)
  assert.equal(v.status, 0, v.sortie)
  assert.equal(v.json.ok, true)
  fs.rmSync(dossier, { recursive: true, force: true })
})

test('binaire modifié après signature : l’empreinte signée ne correspond plus', () => {
  const dossier = dossierTemporaire()
  const fichier = installer(dossier)
  const { privee, publique } = paireEd25519()
  const keyId = 'gf-test-update'
  const res = lancer(['--file', fichier, '--key-id', keyId], { GF_UPDATE_SIGNING_KEY: privee })
  assert.equal(res.status, 0, res.stderr)

  const manifeste = fichier.replace(/\.exe$/, '.manifest.json')
  const signe = JSON.parse(fs.readFileSync(manifeste, 'utf8'))

  // Le manifeste reste cryptographiquement VALIDE (il est immuable) ; ce qui
  // change, c'est que les octets téléchargés ne produisent plus l'empreinte
  // signée. C'est exactement le contrôle fait par le téléchargeur Electron
  // avant exécution (`expectedSha` vs SHA-256 réel).
  assert.equal(verifier(manifeste, publique, keyId).json.ok, true)
  fs.appendFileSync(fichier, Buffer.from('octets-ajoutes-apres-signature'))
  const reel = crypto.createHash('sha256').update(fs.readFileSync(fichier)).digest('hex')
  assert.notEqual(reel, signe.manifest.sha256)
  assert.notEqual(fs.statSync(fichier).size, signe.manifest.size)
  fs.rmSync(dossier, { recursive: true, force: true })
})

test('manifeste falsifié : signature refusée', () => {
  const dossier = dossierTemporaire()
  const fichier = installer(dossier)
  const { privee, publique } = paireEd25519()
  const keyId = 'gf-test-update'
  assert.equal(lancer(['--file', fichier, '--key-id', keyId], { GF_UPDATE_SIGNING_KEY: privee }).status, 0)
  const manifeste = fichier.replace(/\.exe$/, '.manifest.json')
  const signe = JSON.parse(fs.readFileSync(manifeste, 'utf8'))
  signe.manifest.version = '99.0.0'
  fs.writeFileSync(manifeste, JSON.stringify(signe))
  const v = verifier(manifeste, publique, keyId)
  assert.equal(v.json.ok, false)
  fs.rmSync(dossier, { recursive: true, force: true })
})

test('installeur au nom fixe sans version : signable, version issue de package.json', () => {
  const dossier = dossierTemporaire()
  const fichier = installer(dossier, 'GarageFlows-Setup.exe')
  const { privee, publique } = paireEd25519()
  const keyId = 'gf-test-update'
  const res = lancer(['--file', fichier, '--key-id', keyId], { GF_UPDATE_SIGNING_KEY: privee })
  assert.equal(res.status, 0, res.stderr + res.stdout)
  const manifeste = fichier.replace(/\.exe$/, '.manifest.json')
  const signe = JSON.parse(fs.readFileSync(manifeste, 'utf8'))
  assert.equal(signe.manifest.version, VERSION)
  assert.equal(signe.manifest.fileName, 'GarageFlows-Setup.exe')
  assert.equal(verifier(manifeste, publique, keyId).json.ok, true)
  fs.rmSync(dossier, { recursive: true, force: true })
})

test('fichier absent : refus, rien n’est signé', () => {
  const dossier = dossierTemporaire()
  const { privee } = paireEd25519()
  const res = lancer(['--file', path.join(dossier, 'absent.exe')], { GF_UPDATE_SIGNING_KEY: privee })
  assert.equal(res.status, 1)
  assert.match(res.stderr, /installeur introuvable/i)
  fs.rmSync(dossier, { recursive: true, force: true })
})
