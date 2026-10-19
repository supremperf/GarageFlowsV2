'use strict'
// GARDE — artefacts d'évidence vs faux positifs Gitleaks.
//
// La règle `generic-api-key` de Gitleaks associe un mot-clé anglais
// (token, key, secret, password, credential, auth…) suivi d'une valeur
// hexadécimale de 64 caractères à une clé d'API. Les artefacts d'évidence
// publient des EMPREINTES SHA-256, jamais des secrets ; leurs champs ne
// doivent donc pas employer ces mots-clés — sinon la porte CI « Secret scan »
// échoue sur un faux positif (constaté : 104 alertes sur
// `campagne-100-licences.json`, champ `tokenSha256`).
//
// Ce test ne remplace PAS Gitleaks : il verrouille la cause exacte du faux
// positif pour qu'elle ne revienne pas silencieusement.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ARTIFACTS = path.join(__dirname, '..', 'artifacts', 'verification')
const KEYWORD_HEX = /"[^"]*(?:token|secret|password|passwd|credential|api[_-]?key|auth)[^"]*"\s*:\s*"[0-9a-f]{64}"/i
const JWT_LIKE = /[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/

function fichiersJson() {
  return fs.readdirSync(ARTIFACTS).filter((nom) => nom.endsWith('.json'))
}

test('aucun artefact ne présente un champ à mot-clé secret suivi d’une empreinte', () => {
  const fichiers = fichiersJson()
  assert.ok(fichiers.length > 0, 'artifacts/verification doit contenir des preuves')
  for (const nom of fichiers) {
    const texte = fs.readFileSync(path.join(ARTIFACTS, nom), 'utf8')
    assert.doesNotMatch(texte, KEYWORD_HEX, `${nom} : champ à mot-clé secret + hex64 (faux positif Gitleaks)`)
  }
})

test('la campagne publie des empreintes, jamais un jeton de licence brut', () => {
  const nom = 'campagne-100-licences.json'
  const texte = fs.readFileSync(path.join(ARTIFACTS, nom), 'utf8')
  const rapport = JSON.parse(texte)
  assert.equal(rapport.licenses.length, 105)
  assert.equal(rapport.allPassed, true)
  for (const licence of rapport.licenses) {
    assert.match(licence.empreinteJetonSha256, /^[0-9a-f]{64}$/)
    assert.match(licence.empreinteLidSha256, /^[0-9a-f]{64}$/)
    assert.equal(Object.hasOwn(licence, 'token'), false)
    assert.equal(Object.hasOwn(licence, 'tokenSha256'), false)
  }
  assert.doesNotMatch(texte, JWT_LIKE, 'aucun jeton signé (3 segments) dans la preuve publique')
})
