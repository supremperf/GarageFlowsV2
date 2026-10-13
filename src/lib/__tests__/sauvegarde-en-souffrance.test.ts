/**
 * Sauvegardes en souffrance — le silence était le défaut.
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * Quand la sauvegarde horaire échouait, `runBackup` écrivait « Backup hourly
 * ÉCHOUÉE » dans `garageflow.log` et rendait `false`. Le minuteur ignorait ce
 * `false`. Aucun écran ne changeait, aucun message n'apparaissait : un poste
 * dont le disque est plein, dont le dossier est verrouillé par un antivirus, ou
 * dont le serveur interne s'est arrêté, pouvait passer des semaines sans une
 * seule sauvegarde valide. On ne s'en apercevait que le jour où il fallait
 * restaurer.
 *
 * ─── Ce qu'il ne fallait PAS faire ──────────────────────────────────────────
 * Avertir au premier échec, ni à chaque heure. Une sauvegarde ratée à 14 h alors
 * que celle de 13 h est passée n'est pas un incident ; et un avertissement qui
 * revient toutes les heures devient un bruit qu'on ferme sans lire — donc un
 * avertissement qu'on ne verra pas non plus le jour où il compte.
 */
import { describe, it, expect } from 'vitest'
const {
  evaluerSauvegardes,
  formulerAge,
} = require('../../../electron/sauvegarde-en-souffrance.js')

const H = 60 * 60 * 1000
const MAINTENANT = new Date('2026-08-16T14:00:00Z').getTime()

type Verdict = { alerter: boolean; motif: string | null; ageMs: number | null }

const evaluer = (over: Record<string, unknown> = {}): Verdict => evaluerSauvegardes({
  sauvegardes: [],
  maintenant: MAINTENANT,
  dernierAvertissement: 0,
  premierDemarrage: MAINTENANT - 400 * H,
  ...over,
})

const ilYA = (heures: number) => [{ nom: 'garageflow_x.db', mtimeMs: MAINTENANT - heures * H }]

describe('on ne crie pas pour un contretemps', () => {
  it('sauvegarde réussie il y a une heure : rien à dire', () => {
    const v = evaluer({ sauvegardes: ilYA(1) })
    expect(v.alerter).toBe(false)
    expect(v.motif).toBe(null)
  })

  it('sauvegarde réussie il y a 23 h : encore dans les clous', () => {
    expect(evaluer({ sauvegardes: ilYA(23) }).alerter).toBe(false)
  })

  it('installation neuve sans aucune sauvegarde : on laisse le poste vivre', () => {
    // Cinq minutes après l'installation, l'absence de sauvegarde est normale.
    const v = evaluer({ sauvegardes: [], premierDemarrage: MAINTENANT - 5 * 60 * 1000 })
    expect(v.alerter, 'un poste installé il y a cinq minutes n’a rien à se reprocher').toBe(false)
  })
})

describe('on parle quand plus rien ne passe', () => {
  it('25 h sans sauvegarde réussie : avertissement', () => {
    const v = evaluer({ sauvegardes: ilYA(25) })
    expect(v.alerter, 'c’était le cas silencieux').toBe(true)
    expect(v.motif).toBe('trop-ancienne')
  })

  it('poste ancien, aucune sauvegarde jamais écrite : avertissement', () => {
    const v = evaluer({ sauvegardes: [], premierDemarrage: MAINTENANT - 400 * H })
    expect(v.alerter).toBe(true)
    expect(v.motif).toBe('aucune')
    expect(v.ageMs).toBe(null)
  })

  it('la plus RÉCENTE des sauvegardes fait foi, pas la première trouvée', () => {
    // L'ordre de `readdir` n'est pas garanti : une vieille sauvegarde en tête de
    // liste ne doit pas déclencher d'alerte alors qu'une récente existe.
    const v = evaluer({
      sauvegardes: [
        { nom: 'vieux', mtimeMs: MAINTENANT - 300 * H },
        { nom: 'recent', mtimeMs: MAINTENANT - 2 * H },
      ],
    })
    expect(v.alerter).toBe(false)
  })

  it('une entrée sans date valable est ignorée, pas prise pour une sauvegarde', () => {
    const v = evaluer({
      sauvegardes: [{ nom: 'illisible', mtimeMs: Number.NaN }],
      premierDemarrage: MAINTENANT - 400 * H,
    })
    expect(v.motif).toBe('aucune')
  })
})

describe('on ne répète pas tous les quarts d’heure', () => {
  it('déjà averti il y a deux heures : on se tait', () => {
    const v = evaluer({ sauvegardes: ilYA(50), dernierAvertissement: MAINTENANT - 2 * H })
    expect(v.alerter).toBe(false)
    expect(v.motif, 'le motif reste rendu — c’est l’ALERTE qu’on retient').toBe('trop-ancienne')
  })

  it('averti il y a plus de 24 h : on redit', () => {
    const v = evaluer({ sauvegardes: ilYA(50), dernierAvertissement: MAINTENANT - 25 * H })
    expect(v.alerter).toBe(true)
  })
})

describe('une horloge qui recule ne fabrique pas d’âge négatif', () => {
  it('sauvegarde datée dans le futur : âge ramené à zéro, aucune alerte', () => {
    const v = evaluer({ sauvegardes: [{ nom: 'futur', mtimeMs: MAINTENANT + 10 * H }] })
    expect(v.ageMs).toBe(0)
    expect(v.alerter).toBe(false)
  })
})

describe('l’âge est dit en français lisible', () => {
  it.each([
    [3 * H, '3 heures'],
    [1 * H, '1 heure'],
    [96 * H, '4 jours'],
  ])('%i ms → %s', (age, attendu) => {
    expect(formulerAge(age)).toBe(attendu)
  })

  it('aucune sauvegarde : « jamais »', () => {
    expect(formulerAge(null)).toBe('jamais')
  })
})
