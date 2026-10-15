/**
 * GF-DUR-034 — aucune sauvegarde, aucun secret, ne part dans l'installateur.
 *
 * ─── Le défaut, constaté sur l'artefact réel ────────────────────────────────
 * `package.json` déclarait pour electron-builder :
 *
 *     "files": ["electron/**\/*", "package.json"]
 *
 * Un joker SANS filtre d'extension. Un script de rotation avait déposé
 * `electron/main.js.before-v171-20260813-164006` ; l'extension inhabituelle n'a
 * rien exclu du tout. Vérification faite sur le paquet livré :
 *
 *     dist/win-unpacked/resources/app.asar
 *       └── electron/main.js.before-v171-20260813-164006
 *
 * L'installateur `GarageFlows Setup 1.1.0.exe` du 13/08/2026 16:54 la contient —
 * la sauvegarde datait de 16:35, elle existait à la construction.
 *
 * ─── Ce que ça coûtait, et ce que ça aurait pu coûter ───────────────────────
 * Cette copie-là ne portait aucun secret : l'ancienne clé PUBLIQUE de licence,
 * et une version de `main.js` antérieure à la machine à états. Le vrai risque
 * n'est pas celle-ci, c'est la RÈGLE : tant que le joker n'exclut rien, le jour
 * où quelqu'un laisse `electron/.env.backup` ou `electron/config.old` dans le
 * dossier, il part chez tous les clients. Rien ne l'aurait signalé.
 *
 * ─── Ce que ce garde vérifie ────────────────────────────────────────────────
 * Les deux moitiés de la correction, parce que chacune seule est insuffisante :
 *  1. la configuration exclut explicitement les familles à risque ;
 *  2. l'arbre ne contient, ici et maintenant, aucun fichier de ce type dans une
 *     zone empaquetée.
 *
 * Il ne remplace pas l'inspection de l'artefact — un test de source ne peut pas
 * savoir ce qu'electron-builder a réellement écrit. Il empêche la RÉCIDIVE ; la
 * preuve, elle, se refait sur le paquet (voir docs et LISEZ-MOI des sauvegardes).
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')

/** Familles de fichiers qui n'ont RIEN à faire dans un paquet distribué. */
const MOTIFS_INTERDITS = [
  /\.before-/i,
  /\.bak$/i,
  /\.backup$/i,
  /\.old$/i,
  /\.orig$/i,
  /\.rej$/i,
  /~$/,
  /\.tmp$/i,
  /^\.env($|\.)/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
]

/** Exclusions attendues dans `build.files` — la moitié « configuration ». */
const EXCLUSIONS_ATTENDUES = [
  '!**/*.before-*',
  '!**/*.bak',
  '!**/*.backup',
  '!**/*.old',
  '!**/*.orig',
  '!**/.env*',
  '!**/*.pem',
  '!**/*.key',
]

function pkg(): { build: { files: string[]; extraResources: Array<Record<string, unknown>> } } {
  return JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8'))
}

function fichiers(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === 'dist') continue
      fichiers(p, acc)
    } else acc.push(p)
  }
  return acc
}

describe('l’installateur n’emporte ni sauvegarde ni secret (GF-DUR-034)', () => {
  it('`build.files` exclut explicitement les familles à risque', () => {
    // Sans ces exclusions, `electron/**/*` prend TOUT — c'est ainsi qu'une
    // sauvegarde s'est retrouvée dans `app.asar` de la 1.1.0.
    const manquantes = EXCLUSIONS_ATTENDUES.filter((e) => !pkg().build.files.includes(e))
    expect(manquantes, 'ajoutez ces exclusions à build.files').toEqual([])
  })

  it('`electron/` ne contient aucun fichier des familles interdites', () => {
    // Zone empaquetée par le joker : c'est celle qui compte le plus.
    const fautifs = fichiers(path.join(RACINE, 'electron'))
      .map((f) => path.basename(f))
      .filter((n) => MOTIFS_INTERDITS.some((m) => m.test(n)))
    expect(fautifs, 'déplacez ces fichiers hors de l’arbre de build').toEqual([])
  })

  it('aucune sauvegarde ne traîne dans les autres arbres du dépôt', () => {
    // `src/` n'est pas empaqueté tel quel, mais une sauvegarde y est du bruit
    // qui finit par migrer — et `prisma/`, `scripts/`, `public/` alimentent le
    // paquet par `extraResources` ou par le build.
    const fautifs: string[] = []
    for (const sous of ['src', 'scripts', 'prisma', 'public', 'keys']) {
      for (const f of fichiers(path.join(RACINE, sous))) {
        const n = path.basename(f)
        // `keys/` contient légitimement des `.pem` : ils sont filtrés par
        // `extraResources` (seul `public.pem` sort) et ignorés par git. On n'y
        // cherche que les SAUVEGARDES.
        const motifs = sous === 'keys'
          ? MOTIFS_INTERDITS.filter((m) => !/pem|key\$|p12|pfx|env/.test(m.source))
          : MOTIFS_INTERDITS
        if (motifs.some((m) => m.test(n))) fautifs.push(path.relative(RACINE, f).replace(/\\/g, '/'))
      }
    }
    expect(fautifs, 'déplacez ces fichiers hors du dépôt').toEqual([])
  })

  it('`extraResources` ne sort de `keys/` que la clé PUBLIQUE', () => {
    // Le filtre est la seule chose qui empêche `keys/private.pem` — présent sur
    // le poste de l'exploitant — de partir dans le paquet. Il a déjà manqué une
    // fois (clé de signature retrouvée dans un installateur).
    const k = pkg().build.extraResources.find((r) => String(r.from) === 'keys')
    expect(k, 'entrée extraResources pour keys/ absente').toBeTruthy()
    expect(k!.filter, 'le filtre de keys/ doit se limiter à public.pem').toEqual(['public.pem'])
  })

  it('`.gitignore` ignore aussi ces familles', () => {
    // Deuxième filet : une sauvegarde non suivie ne peut pas arriver par un
    // `git add -A` distrait chez quelqu'un d'autre.
    const gi = fs.readFileSync(path.join(RACINE, '.gitignore'), 'utf8')
    for (const regle of ['*.before-*', '*.bak', '*.backup', '*.orig']) {
      expect(gi, `.gitignore doit contenir ${regle}`).toContain(regle)
    }
  })
})
