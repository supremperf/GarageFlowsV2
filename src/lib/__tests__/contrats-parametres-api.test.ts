/**
 * GF-005 — un paramètre de requête que la route ne lit pas est un filtre ABSENT,
 * pas une erreur : la réponse arrive en 200, avec des données arbitraires.
 *
 * ─── Le défaut d'origine ────────────────────────────────────────────────────
 * L'autocomplétion de plaque de la modale d'intervention appelait
 * `/api/vehicles?query=<saisie>`. La route ne lit que `plate`, `clientId` et
 * `q` : la requête partait donc SANS aucun critère et renvoyait les quinze
 * véhicules les plus récemment touchés du garage. Le réceptionniste tapait
 * « AB-123 », se voyait proposer la Clio de Mme Durand, cliquait — et
 * `selectVehicle` écrasait d'un coup plaque, modèle, `vehicleId` ET nom du
 * client. L'intervention était enregistrée sur le véhicule et le client de
 * quelqu'un d'autre, sans le moindre signe à l'écran.
 *
 * Rien ne pouvait le signaler : la requête est valide, la réponse est un 200,
 * TypeScript ne voit qu'une chaîne d'URL.
 *
 * ─── Ce que ce garde vérifie ────────────────────────────────────────────────
 * Pour CHAQUE appel client dont l'URL porte une chaîne de requête littérale, la
 * route correspondante doit réellement lire chacun des paramètres nommés.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const API = path.join(RACINE, 'src/app/api')

/** ORDRE IMPOSÉ (GF-DUR-046) : lignes `//` d'abord, blocs ensuite. */
function sansCommentaires(src: string): string {
  return src
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
}

function fichiers(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (['node_modules', '__tests__'].includes(e.name)) continue
      fichiers(p, acc)
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) acc.push(p)
  }
  return acc
}

/**
 * Résout `/api/a/${x}/b` vers son fichier `route.ts`.
 * Un segment interpolé (`${…}`) correspond au dossier dynamique `[param]`.
 * Renvoie `null` si aucune route ne correspond (l'appel vise alors autre chose,
 * par exemple une route externe : on ne conclut rien).
 */
function resoudreRoute(cheminApi: string, racineApi = API): string | null {
  const segments = cheminApi.split('/').filter(Boolean).slice(1)
  let dir = racineApi
  for (const seg of segments) {
    if (!fs.existsSync(dir)) return null
    const dossiers = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())
    const dynamique = seg.includes('${')
    const choix = (!dynamique ? dossiers.find((e) => e.name === seg) : undefined)
      ?? dossiers.find((e) => e.name.startsWith('['))
    if (!choix) return null
    dir = path.join(dir, choix.name)
  }
  const f = path.join(dir, 'route.ts')
  return fs.existsSync(f) ? f : null
}

/** Appels client dont l'URL porte une chaîne de requête littérale. */
const APPELS = /['"`](\/api\/[^'"`?\s]*)\?([^'"`]*)['"`]/g

/** Un paramètre est-il réellement lu par la route ? */
function luPar(source: string, param: string): boolean {
  return new RegExp(`searchParams\\.get\\(\\s*['"\`]${param}['"\`]`).test(source)
    || new RegExp(`['"\`]${param}['"\`]\\s*\\)`).test(source)
}

/** Inventaire des couples (appel client, paramètre) et de ceux qui sont ignorés. */
function inventaire(racineSrc: string, racineApi = API) {
  const examines: string[] = []
  const ignores: string[] = []
  for (const f of fichiers(racineSrc)) {
    if (f.includes(path.join('src', 'app', 'api'))) continue
    const src = sansCommentaires(fs.readFileSync(f, 'utf8'))
    for (const m of Array.from(src.matchAll(APPELS))) {
      const [, cheminApi, requete] = m
      const params = Array.from(requete.matchAll(/(?:^|&)([A-Za-z_][A-Za-z0-9_]*)=/g), (x: RegExpMatchArray) => x[1])
      if (!params.length) continue
      const route = resoudreRoute(cheminApi, racineApi)
      if (!route) continue
      const rsrc = fs.readFileSync(route, 'utf8')
      const rel = path.relative(RACINE, f).replace(/\\/g, '/')
      const relRoute = path.relative(RACINE, route).replace(/\\/g, '/')
      for (const p of params) {
        const cle = `${rel} → ${cheminApi}?${p}=`
        if (examines.includes(cle)) continue
        examines.push(cle)
        if (!luPar(rsrc, p)) ignores.push(`${cle}  (ignoré par ${relRoute})`)
      }
    }
  }
  return { examines, ignores }
}

describe('paramètres de requête — le client et la route parlent la même langue (GF-005)', () => {
  it('le détecteur voit bien un paramètre ignoré (auto-contrôle)', () => {
    // Un garde-fou qui ne trouve jamais rien parce qu'il ne cherche pas au bon
    // endroit est pire qu'aucun garde-fou : on prouve d'abord qu'il détecte.
    const route = "const q = searchParams.get('q') ?? ''"
    expect(luPar(route, 'q')).toBe(true)
    expect(luPar(route, 'query'), 'le nom EXACT doit compter').toBe(false)
  })

  it('la route véhicules lit bien le paramètre que la modale envoie', () => {
    const modale = sansCommentaires(fs.readFileSync(path.join(RACINE, 'src/components/JobModal.tsx'), 'utf8'))
    const appel = modale.match(/\/api\/vehicles\?([A-Za-z_][A-Za-z0-9_]*)=/)
    expect(appel, 'appel d’autocomplétion véhicule introuvable').toBeTruthy()
    const routeSrc = fs.readFileSync(path.join(RACINE, 'src/app/api/vehicles/route.ts'), 'utf8')
    expect(luPar(routeSrc, appel![1]), `la route ignore « ${appel![1]} »`).toBe(true)
  })

  it('aucun appel client n’envoie un paramètre que sa route ignore', () => {
    const { examines, ignores } = inventaire(path.join(RACINE, 'src'))
    // Si le nombre examiné tombe à zéro, c'est le garde qui est cassé, pas le
    // code : on l'affirme explicitement.
    expect(examines.length, 'aucun appel analysé — le détecteur ne trouve plus les URL').toBeGreaterThan(15)
    expect(ignores, 'un paramètre ignoré n’est pas une erreur : c’est un filtre qui disparaît').toEqual([])
  })
})
