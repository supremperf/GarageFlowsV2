#!/usr/bin/env node
'use strict'

/**
 * `next build`, protégé contre le parcours du profil Windows par le traçage.
 *
 * ─── Le défaut (établi par lecture de @vercel/nft, embarqué par Next 15) ─────
 *
 * Le runtime Prisma (`@prisma/client/runtime/library.js`, et la copie générée
 * sous `src/generated/server-client`) embarque `dotenv`, qui fait
 * `readFileSync(path.join(os.homedir(), …))`. nft évalue `os.homedir()` en
 * chemin LITTÉRAL et, la suite étant dynamique, programme un glob
 * `<dossier personnel>/**\/*`. Il ne l'abandonne que si
 * `path.relative(outputFileTracingRoot, <glob>)` commence par `..\` :
 *
 *   C:\Users\Jean\Desktop\GarageFlowsV2  +  C:\Users\Jean  → ..\..\**\*        ignoré
 *   D:\Projets\GarageFlowsV2             +  C:\Users\Jean  → C:\Users\Jean\**\* PARCOURU
 *
 * Projet et profil sur deux LECTEURS différents (cas du runner CI : D:\a\… et
 * C:\Users\runneradmin ; cas d'un poste qui range ses projets sur D:) : le glob
 * énumère le profil, rencontre les jonctions héritées `Application Data`,
 * `Cookies`… dont Windows refuse l'énumération à TOUT utilisateur, et la
 * compilation s'arrête : « glob error EPERM … scandir '…\Application Data' —
 * Failed to compile ». Le produit ne lit jamais ce dossier.
 *
 * ─── Le correctif ───────────────────────────────────────────────────────────
 *
 * Dans ce seul cas, `next build` (et lui seul) reçoit un dossier personnel VIDE
 * sous `node_modules/.cache/gf-build-home` : le glob y est écarté par
 * l'exclusion `**\/node_modules/**` que Next applique déjà au traçage. Rien
 * n'est exclu du projet, aucun contrôle n'est désactivé : si la trace était
 * incomplète, `verify:standalone` puis `verify:installer` échoueraient.
 * Les caches npm / Electron / electron-builder (APPDATA, LOCALAPPDATA) ne
 * sont pas touchés. Quand le profil est déjà hors d'atteinte (même lecteur,
 * Linux, macOS), l'environnement est transmis tel quel.
 *
 * Code de sortie : celui de `next build`, inchangé.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const RACINE = path.resolve(__dirname, '..')

/** Vrai si nft écartera de lui-même un glob sur `home` (même logique que nft). */
function profilHorsTracage(racine, home, chemins = path) {
  if (!home) return true
  const relatif = chemins.relative(racine, chemins.join(home, '**'))
  return relatif.startsWith(`..${chemins.sep}`)
}

function environnementDeConstruction(env = process.env, { racine = RACINE, home = os.homedir(), chemins = path } = {}) {
  if (profilHorsTracage(racine, home, chemins)) return { env, isole: null }
  const isole = chemins.join(racine, 'node_modules', '.cache', 'gf-build-home')
  const suivant = { ...env, USERPROFILE: isole, HOME: isole }
  if (chemins.sep === '\\') {
    const racineLecteur = chemins.parse(isole).root // ex. « D:\\ »
    suivant.HOMEDRIVE = racineLecteur.replace(/\\+$/, '')
    suivant.HOMEPATH = isole.slice(racineLecteur.length - 1)
  }
  return { isole, env: suivant }
}

module.exports = { profilHorsTracage, environnementDeConstruction }

if (require.main === module) {
  const { env, isole } = environnementDeConstruction()
  if (isole) {
    fs.mkdirSync(isole, { recursive: true })
    console.log(`ℹ️  Dossier personnel hors de portée de l'exclusion du traçage (${os.homedir()} — autre lecteur ?).`)
    console.log(`   next build utilisera un dossier personnel vide : ${path.relative(RACINE, isole)}`)
  }
  const nextBin = require.resolve('next/dist/bin/next', { paths: [RACINE] })
  const child = spawn(process.execPath, [nextBin, 'build', ...process.argv.slice(2)], {
    cwd: RACINE, env, stdio: 'inherit', windowsHide: true,
  })
  child.once('error', (error) => { console.error(`next build : lancement impossible (${error.message})`); process.exit(1) })
  child.once('exit', (code, signal) => {
    if (signal) { console.error(`next build interrompu par le signal ${signal}`); process.exit(1) }
    process.exit(code ?? 1)
  })
}
