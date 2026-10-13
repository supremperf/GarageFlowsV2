/**
 * GF31-AUD-004 — NON-RÉGRESSION : `savePhoto` ne doit jamais écrire hors du
 * dossier des photos, ni écrire autre chose qu'une image.
 *
 * Le défaut : l'extension du fichier était dérivée du type MIME fourni par
 * l'appelant — `mime.split('/')[1]`. La regex d'entrée
 * (`/^data:([^;]+);base64,(.+)$/`) accepte tout sauf « ; » dans le type, donc
 * aussi les séparateurs de chemin. Sur Windows, un type
 * « x/..\..\..\..\evil.bat » donnait l'extension « ..\..\..\..\evil.bat », que
 * `path.join` normalisait ensuite : le fichier remontait l'arborescence, avec un
 * contenu entièrement choisi par l'appelant. Un type « x/exe » suffisait par
 * ailleurs à déposer un exécutable dans le dossier des photos.
 *
 * Surface d'attaque : `/api/mechanic/jobs/[id]/photos` — donc le rôle le MOINS
 * privilégié du produit (mécanicien sur la PWA) — ainsi que
 * `/api/jobs/[id]/photos`, `/api/inspections/[id]` et `/api/garages` (logo).
 *
 * Ces tests exercent le VRAI système de fichiers dans un dossier temporaire :
 * ils vérifient qu'aucun fichier n'apparaît hors du dossier des photos.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SEP = String.fromCharCode(92) // « \ » — écrit ainsi pour rester lisible

let RACINE = ''   // dossier temporaire englobant
let PHOTOS = ''   // GF_PHOTOS_DIR
let savePhoto: (dataUrl: string, subDir: string) => string | null

/** 1×1 pixel PNG valide, en base64. */
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** Tous les fichiers présents sous un dossier, chemins relatifs. */
function listerFichiers(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out.push(path.relative(RACINE, p))
    }
  }
  walk(dir)
  return out
}

beforeAll(async () => {
  RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-photo-'))
  // Le dossier des photos est VOLONTAIREMENT imbriqué : une remontée doit avoir
  // de la place pour sortir et devenir observable.
  PHOTOS = path.join(RACINE, 'data', 'photos')
  fs.mkdirSync(PHOTOS, { recursive: true })
  process.env.GF_PHOTOS_DIR = PHOTOS
  ;({ savePhoto } = await import('@/lib/photo-store'))
})

afterAll(() => {
  if (RACINE && fs.existsSync(RACINE)) fs.rmSync(RACINE, { recursive: true, force: true })
})

beforeEach(() => {
  // On repart d'un dossier photos vide, mais on conserve la racine.
  fs.rmSync(PHOTOS, { recursive: true, force: true })
  fs.mkdirSync(PHOTOS, { recursive: true })
})

describe('GF31-AUD-004 — type MIME hostile', () => {
  const remontees = [
    `x/..${SEP}..${SEP}..${SEP}..${SEP}evil.bat`,
    `x/..${SEP}evil.bat`,
    'x/../../../../evil.bat',
    'x/../evil.bat',
  ]

  it.each(remontees)('refuse le type « %s » et n’écrit rien hors du dossier photos', (mime) => {
    const res = savePhoto(`data:${mime};base64,${PNG_1PX}`, 'jobs/job1')
    expect(res).toBeNull()
    // Aucun fichier nulle part sous la racine (donc ni dedans, ni dehors).
    expect(listerFichiers(RACINE)).toEqual([])
  })

  const nonImages = ['application/javascript', 'x/exe', 'text/html', 'application/x-msdownload', 'x/bat']

  it.each(nonImages)('refuse le type non-image « %s »', (mime) => {
    expect(savePhoto(`data:${mime};base64,${PNG_1PX}`, 'jobs/job1')).toBeNull()
    expect(listerFichiers(RACINE)).toEqual([])
  })
})

describe('GF31-AUD-004 — sous-dossier hostile', () => {
  const sousDossiers = [
    'jobs/../../../evil',
    `jobs/..${SEP}..${SEP}..${SEP}evil`,
    '../evil',
    'jobs/j1/j2/j3/j4', // profondeur non prévue
    'jobs/j 1',         // espace : hors du jeu autorisé
  ]

  it.each(sousDossiers)('refuse le sous-dossier « %s »', (subDir) => {
    expect(savePhoto(`data:image/png;base64,${PNG_1PX}`, subDir)).toBeNull()
    expect(listerFichiers(RACINE)).toEqual([])
  })
})

describe('GF31-AUD-004 — le cas nominal reste intact', () => {
  it.each([
    ['image/jpeg', 'jpg'],
    ['image/jpg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['image/gif', 'gif'],
  ])('enregistre bien une image %s avec l’extension %s', (mime, ext) => {
    const rel = savePhoto(`data:${mime};base64,${PNG_1PX}`, 'jobs/job1')
    expect(rel).not.toBeNull()
    expect(rel!.startsWith('jobs/job1/photo_')).toBe(true)
    expect(rel!.endsWith(`.${ext}`)).toBe(true)

    // Le fichier existe RÉELLEMENT, au bon endroit, avec le bon contenu.
    const complet = path.join(PHOTOS, rel!)
    expect(fs.existsSync(complet)).toBe(true)
    expect(fs.readFileSync(complet).equals(Buffer.from(PNG_1PX, 'base64'))).toBe(true)

    // Et il est bien SOUS le dossier des photos.
    const relatif = path.relative(path.resolve(PHOTOS), path.resolve(complet))
    expect(relatif.startsWith('..')).toBe(false)
  })

  it('tolère la casse du type MIME', () => {
    expect(savePhoto(`data:IMAGE/PNG;base64,${PNG_1PX}`, 'logos')).not.toBeNull()
  })
})
