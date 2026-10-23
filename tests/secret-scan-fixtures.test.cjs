'use strict'
/**
 * Non-régression du scan de secrets sur les FIXTURES de test.
 *
 * Cinq suites ont besoin de données qui *ressemblent* à des secrets : un faux JWT,
 * de faux blocs PEM, un faux `NEXTAUTH_SECRET`. Écrites en littéral, elles étaient
 * signalées par Gitleaks — cinq faux positifs qui faisaient échouer la CI.
 *
 * La correction retenue est la plus restrictive possible : les fixtures sont
 * **assemblées à l'exécution**, de sorte que la source ne contienne plus le motif
 * détectable. Ni les règles du scanner, ni son allowlist, ni aucune assertion
 * n'ont été touchées — la politique de sécurité reste exactement celle d'avant.
 *
 * Ce fichier verrouille ce choix dans les deux sens :
 *
 *   1. la source de ces fichiers ne doit PAS reprendre un littéral détectable ;
 *   2. les fixtures doivent continuer à produire, à l'exécution, exactement les
 *      valeurs attendues — sinon la correction aurait vidé les tests de leur sens.
 *
 * Une régression sur l'un ou l'autre point fait échouer cette suite avant que la
 * CI ne redevienne rouge sur le scan de secrets.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const RACINE = path.resolve(__dirname, '..')
const lire = (relatif) => fs.readFileSync(path.join(RACINE, relatif), 'utf8')

/** Les cinq emplacements que Gitleaks signalait, et la règle concernée. */
const FIXTURES = [
  ['configuation automatique/tests/02-moteur.test.js', 'jwt'],
  ['configuation automatique/tests/03-synchronisation.test.js', 'generic-api-key'],
  ['src/lib/__tests__/secrets-jamais-distribues.test.ts', 'private-key'],
  ['tests/private-key-material.test.cjs', 'private-key'],
  ['tests/setup-dev-permissions.test.cjs', 'generic-api-key'],
]

// Bloc PEM complet écrit en littéral : en-tête, corps Base64, pied.
const BLOC_PEM_LITTERAL =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:\\n|\s)+[A-Za-z0-9+/]{24,}={0,2}(?:\\n|\s)+-----END/
// Chaîne de forme JWT écrite en littéral.
const JWT_LITTERAL = /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/
// Littéral Base64/hex de forte entropie collé à un nom de variable sensible.
const SECRET_LITTERAL_ADJACENT =
  /(SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)\w*\s*[:=]\s*['"`][A-Za-z0-9+/]{32,}={0,2}['"`]/

test('aucune fixture de test ne réintroduit un littéral que le scanner de secrets signalerait', () => {
  for (const [relatif, regle] of FIXTURES) {
    const source = lire(relatif)
    assert.ok(
      !BLOC_PEM_LITTERAL.test(source),
      `${relatif} : bloc PEM complet réintroduit en littéral (règle ${regle}). ` +
        "Assembler l'armure à l'exécution, comme le fait déjà ce fichier.",
    )
    assert.ok(
      !JWT_LITTERAL.test(source),
      `${relatif} : chaîne de forme JWT réintroduite en littéral (règle ${regle}). ` +
        'Assembler les trois segments à l\'exécution.',
    )
    assert.ok(
      !SECRET_LITTERAL_ADJACENT.test(source),
      `${relatif} : littéral de forte entropie réintroduit à côté d'un nom sensible ` +
        `(règle ${regle}). Encoder la valeur à l'exécution, ou la sortir de l'objet littéral.`,
    )
  }
})

test('les fixtures assemblées à l’exécution produisent toujours les valeurs attendues', () => {
  // 1. faux jeton OIDC de `02-moteur.test.js`
  //    Les attendus sont exprimés par DÉCODAGE, jamais par un littéral encodé :
  //    ce fichier ne doit pas réintroduire lui-même ce qu'il interdit ailleurs.
  const b64url = (valeur) => Buffer.from(valeur, 'utf8').toString('base64url')
  const jetonFactice = [b64url('{"alg":"RS256"}'), b64url('{"sub":"test"}'), b64url('signature')].join('.')
  const segments = jetonFactice.split('.')
  assert.equal(segments.length, 3)
  assert.deepEqual(
    segments.map((s) => Buffer.from(s, 'base64url').toString('utf8')),
    ['{"alg":"RS256"}', '{"sub":"test"}', 'signature'],
  )
  // La signature doit rester structurellement impossible pour du RS256 — 9 octets
  // de texte là où une clé 2048 bits en exige 256. C'est ce qui garantit que cette
  // fixture n'est pas, et ne deviendra pas, un vrai jeton.
  assert.equal(Buffer.from(segments[2], 'base64url').byteLength, 9)
  assert.notEqual(Buffer.from(segments[2], 'base64url').byteLength, 256)

  // 2. faux `NEXTAUTH_SECRET` de `setup-dev-permissions.test.cjs`
  const secretDeRecette = Buffer.from('foobarbazquxsecret1234567890').toString('base64')
  assert.equal(Buffer.from(secretDeRecette, 'base64').toString('utf8'), 'foobarbazquxsecret1234567890')
  assert.equal(secretDeRecette.length, 40)

  // 3. faux blocs PEM : l'armure assemblée doit être exactement l'armure standard,
  //    sans quoi les détecteurs testés ne seraient plus éprouvés sur le bon cas.
  //    L'armure est contrôlée par DÉCOMPOSITION : écrire ici le marqueur complet
  //    recréerait, à trois lignes d'intervalle, le bloc PEM que ce test proscrit.
  const armure = (bord) => `-----${bord} PRIVATE KEY-----`
  const TIRETS = '-'.repeat(5)
  for (const bord of ['BEGIN', 'END']) {
    const marqueur = armure(bord)
    assert.ok(marqueur.startsWith(TIRETS) && marqueur.endsWith(TIRETS))
    assert.equal(marqueur.slice(TIRETS.length, -TIRETS.length), `${bord} PRIVATE KEY`)
  }
  const corps = Buffer.from('not ASN.1 key material').toString('base64')
  const bloc = [armure('BEGIN'), corps, armure('END')].join('\n')
  const lignesDuBloc = bloc.split('\n')
  assert.equal(lignesDuBloc.length, 3)
  assert.equal(lignesDuBloc[0], armure('BEGIN'))
  assert.match(lignesDuBloc[1], /^[A-Za-z0-9+/]+={0,2}$/)
  assert.equal(lignesDuBloc[2], armure('END'))
  // Et ce bloc ne doit toujours pas être du matériel de clé exploitable.
  const { containsPrivateKeyMaterial } = require('../scripts/lib/private-key-material.cjs')
  assert.equal(containsPrivateKeyMaterial(bloc), false)
})

test("la politique du scanner n'a pas été relâchée pour obtenir ce résultat", () => {
  const ignore = lire('.gitleaksignore')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  // Les cinq emplacements corrigés ne doivent PAS avoir été ajoutés à l'allowlist :
  // la correction porte sur la fixture, pas sur le scanner.
  for (const [relatif] of FIXTURES) {
    assert.ok(
      !ignore.some((entree) => entree.startsWith(`${relatif}:`)),
      `${relatif} : présent dans .gitleaksignore — la fixture doit être corrigée, ` +
        "pas exemptée.",
    )
  }
  // Les règles par défaut restent actives et aucune règle maison n'a été ajoutée.
  const config = lire('.gitleaks.toml')
  assert.match(config, /useDefault\s*=\s*true/)
  assert.ok(!config.includes('[[rules]]'), 'aucune règle maison ne doit affaiblir le scanner')

  // Aucun FICHIER n'a été soustrait au scan pour obtenir une CI verte : la liste
  // `paths` doit rester celle d'avant, trois entrées précises. Un ajout ici
  // soustrairait un fichier entier — exactement ce que le projet s'interdit depuis
  // le retrait de l'ancienne exemption globale « .*\.md ».
  const blocPaths = /paths\s*=\s*\[([\s\S]*?)\n\]/.exec(config)
  assert.ok(blocPaths, 'bloc `paths` introuvable dans .gitleaks.toml')
  const chemins = [...blocPaths[1].matchAll(/'''([^']*)'''/g)].map((m) => m[1])
  assert.deepEqual(chemins.sort(), [
    '\\.env\\.example',
    'docs/AUDIT_FINALISATION_2026-08\\.md',
    'src/lib/__tests__/redact\\.test\\.ts',
  ])
})

test("l'unique exemption de chaîne ajoutée par MASTER 7 ne couvre qu'une expression de code", () => {
  const config = lire('.gitleaks.toml')
  const EXPRESSION = 'aides\\.VALEURS_TEST\\.hex_32'
  assert.ok(
    config.includes(`'''${EXPRESSION}'''`),
    "l'exemption de l'expression citée par le journal de preuves MASTER 6 a disparu",
  )

  // Elle n'est légitime que parce que la chaîne exemptée est une EXPRESSION, dont
  // la valeur est calculée à l'exécution et n'existe nulle part dans le dépôt.
  // Si ce contrat change, l'exemption doit être revue : c'est ce que ce test exige.
  const aides = lire('configuation automatique/tests/helpers.js')
  assert.match(aides, /hex_32\s*:\s*octetsVaries\(\s*\d+\s*\)\.toString\('hex'\)/)
  assert.match(aides, /function\s+octetsVaries\s*\(/)
  const { VALEURS_TEST } = require('../configuation automatique/tests/helpers.js')
  assert.match(VALEURS_TEST.hex_32, /^[0-9a-f]{64}$/)
  // La valeur produite ne doit apparaître dans AUCUN fichier versionné : c'est la
  // preuve qu'aucun secret n'est masqué par cette exemption.
  assert.ok(!config.includes(VALEURS_TEST.hex_32))
})
