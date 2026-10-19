'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { INSTALLER_NAME, peInfo, comparePayload, publish, digest } = require('../scripts/lib/windows-delivery.cjs')
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-delivery-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'dist'))
  const header = Buffer.alloc(512); header.write('MZ'); header.writeUInt32LE(128, 60); header.writeUInt32LE(0x4550, 128); header.writeUInt16LE(0x14c, 132)
  const fd = fs.openSync(path.join(root, 'dist', INSTALLER_NAME), 'wx')
  fs.writeSync(fd, header); fs.ftruncateSync(fd, 21 * 1024 * 1024); fs.closeSync(fd)
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.1.0' }))
  fs.writeFileSync(path.join(root, 'release-manifest.json'), JSON.stringify({ packageVersion: '1.1.0', git: { commit: 'a'.repeat(40), dirty: false } }))
  return root
}
test('single offline NSIS per-user contract preserves identity, data and protections', () => {
  const p = require('../package.json')
  assert.equal(p.build.appId, 'com.garageflow.app')
  assert.equal(p.build.nsis.artifactName, INSTALLER_NAME)
  assert.equal(p.build.nsis.perMachine, false)
  assert.equal(p.build.nsis.allowElevation, false)
  assert.equal(p.build.nsis.deleteAppDataOnUninstall, false)
  assert.deepEqual(p.build.win.target, [{ target: 'nsis', arch: ['x64'] }])
  assert.equal(p.build.asar, true)
  assert.equal(p.build.directories.output, 'dist')
  assert.ok(!p.build.files.some(f => /keygen|private\.pem/.test(f) && !f.startsWith('!')))
})
test('publication requires actual payload inspection, validates PE and keeps release to one EXE', async t => {
  const root = fixture(t)
  await assert.rejects(publish(root, {}), /NSIS inspection/)
  const report = await publish(root, { payloadVerified: true, offlinePayloadEmbedded: true, payloadFiles: 2 })
  assert.deepEqual(fs.readdirSync(path.join(root, 'release')), [INSTALLER_NAME])
  assert.equal(report.sha256, await digest(path.join(root, 'release', INSTALLER_NAME)))
  assert.equal(report.size, 21 * 1024 * 1024)
  assert.equal(report.cleanMachineLicensedBusinessWorkflowVerified, false)
  assert.ok(fs.existsSync(path.join(root, 'artifacts/windows-delivery/delivery.json')))
})
test('foreign release files and invalid PE are refused without deleting user files', async t => {
  const root = fixture(t)
  fs.mkdirSync(path.join(root, 'release'))
  fs.writeFileSync(path.join(root, 'release', 'keep.txt'), 'preserve')
  await assert.rejects(publish(root, { payloadVerified: true, offlinePayloadEmbedded: true }), /foreign files/)
  assert.equal(fs.readFileSync(path.join(root, 'release/keep.txt'), 'utf8'), 'preserve')
  fs.writeFileSync(path.join(root, 'dist/bad.exe'), Buffer.alloc(1024))
  assert.throws(() => peInfo(path.join(root, 'dist/bad.exe'), 64), /Invalid Windows/)
})
test('actual payload comparison rejects missing, extra and altered files', async t => {
  const root = fixture(t), a = path.join(root, 'a'), b = path.join(root, 'b')
  fs.mkdirSync(a); fs.mkdirSync(b)
  fs.writeFileSync(path.join(a, 'app'), 'current'); fs.writeFileSync(path.join(b, 'app'), 'stale')
  await assert.rejects(comparePayload(a, b), /content differs/)
  fs.writeFileSync(path.join(b, 'app'), 'current')
  assert.equal(await comparePayload(a, b), 1)
  fs.writeFileSync(path.join(b, 'foreign'), 'extra')
  await assert.rejects(comparePayload(a, b), /inventory differs/)
})

test('NSIS inspection uses the current pinned builder toolset, not removed 7zip-bin', () => {
  assert.equal(typeof require('app-builder-lib/out/toolsets/7zip').getPath7za, 'function')
  const source = fs.readFileSync(path.join(__dirname, '../scripts/lib/windows-delivery.cjs'), 'utf8')
  assert.ok(!source.includes("require('7zip-bin')"))
  const scan = fs.readFileSync(path.join(__dirname, '../scripts/check-artifact-secrets.mjs'), 'utf8')
  assert.match(scan, /await inspectInstaller/)
  assert.match(scan, /res.status !== 0/)
})

// ─────────────────────────────────────────────────────────────────────────────
//  Diagnostic structurel de l'exécutable — NOMMER le défaut, pas le subir
//
//  Le contrat écrit en tête de `scripts/verify-installer.cjs` est de nommer un
//  par un : l'installeur d'une version précédente, « une archive vide ou
//  tronquée (téléchargement/copie interrompue) », un fichier qui n'est pas un
//  exécutable Windows, une charge utile incomplète. Or les contrôles de taille et
//  d'en-tête vivaient dans `peInfo()`, qui LÈVE : l'exception quittait `main()`
//  avant que la liste des problèmes soit assemblée. Une copie interrompue — la
//  façon la plus courante dont un Setup atteint un client — était annoncée par un
//  « Invalid Windows executable » nu : ni taille, ni seuil, ni étape suivante.
//  Ces tests verrouillent le diagnostic précis, et le fait que le vérificateur
//  passe bien par la forme qui ne lève pas.
// ─────────────────────────────────────────────────────────────────────────────

const { describePe } = require('../scripts/lib/windows-delivery.cjs')

/** Fabrique un PE minimal : MZ, offset d'en-tête, signature PE, architecture. */
function ecrirePe(fichier, { taille, offset = 128, machine = 0x8664, mz = true, signature = 0x4550 } = {}) {
  const entete = Buffer.alloc(Math.max(offset + 6, 512))
  if (mz) entete.write('MZ')
  entete.writeUInt32LE(offset, 60)
  if (signature !== null) entete.writeUInt32LE(signature, offset)
  entete.writeUInt16LE(machine, offset + 4)
  const fd = fs.openSync(fichier, 'wx')
  try {
    fs.writeSync(fd, entete)
    if (taille !== undefined) fs.ftruncateSync(fd, taille)
  } finally { fs.closeSync(fd) }
  return fichier
}

test('describePe distingue un fichier tronqué d’un fichier qui n’est pas un exécutable', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-pe-diagnostic-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const MINIMUM = 20 * 1024 * 1024

  const absent = describePe(path.join(root, 'rien.exe'), MINIMUM)
  assert.equal(absent.ok, false)
  assert.equal(absent.code, 'ABSENT')

  const vide = path.join(root, 'vide.exe')
  fs.writeFileSync(vide, '')
  assert.equal(describePe(vide, MINIMUM).code, 'EMPTY')

  const dechets = path.join(root, 'dechets.exe')
  fs.writeFileSync(dechets, Buffer.alloc(1024))
  const pasMz = describePe(dechets, MINIMUM)
  assert.equal(pasMz.code, 'NOT_MZ')
  assert.match(pasMz.message, /MZ/)

  // Un PE valide mais 20× trop petit : c'est LE cas de la copie interrompue.
  // Il doit dire sa taille ET le seuil, pas seulement « trop petit ».
  const tronque = ecrirePe(path.join(root, 'tronque.exe'), { taille: 1024 * 1024 })
  const petit = describePe(tronque, MINIMUM)
  assert.equal(petit.ok, false)
  assert.equal(petit.code, 'TRUNCATED_SIZE')
  assert.match(petit.message, /1048576/)
  assert.match(petit.message, /20971520/)

  // L'en-tête PE annoncé AU-DELÀ de la fin du fichier : troncature, pas
  // « en-tête invalide » — la nuance dit à l'éditeur de reprendre le fichier.
  const coupe = ecrirePe(path.join(root, 'coupe.exe'), { taille: 100 })
  assert.equal(describePe(coupe, 10).code, 'TRUNCATED_SIZE')

  const horsBornes = path.join(root, 'hors-bornes.exe')
  const brut = Buffer.alloc(512); brut.write('MZ'); brut.writeUInt32LE(0, 60)
  fs.writeFileSync(horsBornes, brut)
  assert.equal(describePe(horsBornes, 10).code, 'PE_OFFSET_OUT_OF_RANGE')

  const sansSignature = ecrirePe(path.join(root, 'sans-signature.exe'), { taille: 4096, signature: 0 })
  assert.equal(describePe(sansSignature, 10).code, 'BAD_PE_SIGNATURE')

  const valide = ecrirePe(path.join(root, 'valide.exe'), { taille: 21 * 1024 * 1024 })
  const ok = describePe(valide, MINIMUM)
  assert.equal(ok.ok, true)
  assert.equal(ok.size, 21 * 1024 * 1024)
  assert.equal(ok.machine, 0x8664)
})

test('peInfo refuse toujours, mais porte désormais la cause précise', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-pe-refus-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const dechets = path.join(root, 'dechets.exe')
  fs.writeFileSync(dechets, Buffer.alloc(1024))
  // Contrat historique conservé : le refus reste reconnaissable.
  assert.throws(() => peInfo(dechets, 64), /Invalid Windows/)
  assert.throws(() => peInfo(dechets, 64), /MZ absente/, 'la cause précise accompagne le refus')

  const tronque = ecrirePe(path.join(root, 'tronque.exe'), { taille: 1024 })
  assert.throws(() => peInfo(tronque, 20 * 1024 * 1024), /Invalid PE header/)
  assert.throws(() => peInfo(tronque, 20 * 1024 * 1024), /tronqué|minimum/)

  // Un exécutable x86 32 bits n'est pas la cible : le refus doit le dire.
  const x86 = ecrirePe(path.join(root, 'x86.exe'), { taille: 21 * 1024 * 1024, machine: 0x14c })
  assert.equal(describePe(x86, 20 * 1024 * 1024).machine, 0x14c)
})

test('le vérificateur passe par le diagnostic qui ne lève pas, sinon le verdict est court-circuité', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/verify-installer.cjs'), 'utf8')
  // Le garde porte sur le CODE, pas sur la prose : ce fichier explique justement
  // pourquoi `peInfo()` n'y a plus sa place, et cette explication le nomme.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(ligne => !ligne.trim().startsWith('//'))
    .join('\n')
  // `peInfo` lève : réintroduit ici, il ferait exactement disparaître le
  // diagnostic nommé que ce fichier promet en tête.
  assert.ok(!/\bpeInfo\s*\(/.test(code), 'verify-installer.cjs ne doit plus appeler peInfo() directement')
  assert.ok(!/\bpeInfo\b/.test(code.replace(/describePe/g, '')), 'peInfo ne doit plus être importé non plus')
  assert.match(code, /describePe\(cheminExe, TAILLE_MINIMALE_OCTETS\)/)
  assert.match(code, /verdict\.ok/, 'un exécutable invalide doit entrer dans la liste des problèmes')
  assert.match(code, /problemes\.push\(\s*`exécutable Windows invalide/)
  // Chaque défaut structurel doit venir avec sa sortie de secours.
  assert.match(code, /SECOURS_PE/)
  assert.match(code, /npm run dist/)
  // Le verdict refuse toujours de livrer, et l'inspection réelle de la charge
  // utile NSIS reste atteinte uniquement quand l'exécutable est sain.
  assert.match(code, /process\.exit\(1\)/)
  assert.ok(code.indexOf('inspectNsis(RACINE, cheminExe)') > code.indexOf('problemes.length'))
  // Le refus du nom d'installeur et celui de la charge utile absente survivent.
  assert.match(code, /nom d’installeur inattendu/)
  assert.match(code, /win-unpacked absent/)
})
