/**
 * Période de grâce hors ligne — un garage qui installe pendant une panne ne doit
 * pas se retrouver verrouillé trente secondes plus tard.
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * `const lastOnlineTs = rec?.ts ?? 0` : sans état signé — le cas d'une
 * installation NEUVE qui n'a jamais joint l'autorité de licence — l'origine
 * valait 1970. La durée hors ligne dépassait cinquante ans, donc le seuil de
 * verrouillage de 72 h. Le logiciel se fermait au premier lancement, sur le
 * message « hors ligne depuis plus de 72 heures », sans que rien ne permette de
 * comprendre.
 *
 * ─── Ce qu'il ne fallait PAS faire ──────────────────────────────────────────
 * Écrire l'état au premier lancement : effacer `last_online.json` suffirait
 * alors à rester hors ligne indéfiniment. Le `?? 0` était fail-closed à dessein.
 * L'origine de repli est donc la CRÉATION DE LA BASE — un repère qu'on ne remet
 * pas à zéro sans perdre toutes ses données. Les deux derniers cas verrouillent
 * ce raisonnement.
 */
import { describe, it, expect } from 'vitest'
const { evaluerGraceHorsLigne } = require('../../../electron/grace-hors-ligne.js')

const H = 60 * 60 * 1000
const AVERTISSEMENT = 48 * H
const VERROU = 72 * H
const MAINTENANT = new Date('2026-08-15T12:00:00Z').getTime()

const evaluer = (over: Record<string, unknown> = {}) => evaluerGraceHorsLigne({
  enregistrement: null,
  naissanceBase: null,
  maintenant: MAINTENANT,
  horlogeIncoherente: false,
  seuilAvertissementMs: AVERTISSEMENT,
  seuilVerrouMs: VERROU,
  ...over,
})

describe('une installation neuve hors ligne peut travailler', () => {
  it('base créée à l’instant, aucun état : le logiciel FONCTIONNE', () => {
    const v = evaluer({ naissanceBase: MAINTENANT - 30 * 1000 })
    expect(v.decision, 'c’était un verrouillage 30 s après le premier lancement').toBe('ok')
    expect(v.premierLancement).toBe(true)
  })

  it('aucune base encore créée : l’origine est l’instant présent', () => {
    // Tout premier démarrage, avant même les migrations.
    const v = evaluer({ naissanceBase: null })
    expect(v.decision).toBe('ok')
    expect(v.offlineMs).toBe(0)
  })

  it('installée il y a 50 heures sans jamais être en ligne : avertissement, pas verrou', () => {
    const v = evaluer({ naissanceBase: MAINTENANT - 50 * H })
    expect(v.decision).toBe('avertissement')
  })

  it('installée il y a 4 jours sans jamais être en ligne : verrou légitime', () => {
    // Le garde conserve son sens : la grâce est une tolérance, pas une dispense.
    const v = evaluer({ naissanceBase: MAINTENANT - 96 * H })
    expect(v.decision).toBe('verrou')
    expect(v.motif).toBe('hors-ligne')
  })
})

describe('effacer l’état de connexion ne rallonge PAS la grâce', () => {
  it('base ancienne, état effacé : le verrou tient', () => {
    // C'est le contournement que le `?? 0` protégeait. L'ancrage sur la base le
    // referme : un poste qui travaille depuis des mois a une base ancienne.
    const v = evaluer({ enregistrement: null, naissanceBase: MAINTENANT - 200 * H })
    expect(v.decision, 'supprimer un fichier ne doit pas remettre le compteur à zéro').toBe('verrou')
  })

  it('un état signé récent prime sur la naissance de la base', () => {
    const v = evaluer({
      enregistrement: { ts: MAINTENANT - 2 * H },
      naissanceBase: MAINTENANT - 500 * H,
    })
    expect(v.decision).toBe('ok')
    expect(v.premierLancement).toBe(false)
  })
})

describe('les seuils et l’anti-recul d’horloge sont préservés', () => {
  it.each([
    ['47 h en ligne il y a peu', 47 * H, 'ok'],
    ['49 h', 49 * H, 'avertissement'],
    ['73 h', 73 * H, 'verrou'],
  ])('%s → %s', (_cas, ecart, attendu) => {
    expect(evaluer({ enregistrement: { ts: MAINTENANT - (ecart as number) } }).decision).toBe(attendu)
  })

  it('horloge reculée : verrou, quel que soit le reste', () => {
    const v = evaluer({ enregistrement: { ts: MAINTENANT - 1 * H }, horlogeIncoherente: true })
    expect(v.decision).toBe('verrou')
    expect(v.motif).toBe('horloge')
  })

  it('durée négative (date système reculée) : verrou', () => {
    const v = evaluer({ enregistrement: { ts: MAINTENANT + 10 * H } })
    expect(v.decision).toBe('verrou')
    expect(v.motif, 'gagner du temps en reculant la date reste impossible').toBe('horloge')
  })

  it('un état illisible est traité comme absent, pas comme une connexion', () => {
    const v = evaluer({ enregistrement: { ts: 'pas-un-nombre' }, naissanceBase: MAINTENANT - 200 * H })
    expect(v.premierLancement).toBe(true)
    expect(v.decision).toBe('verrou')
  })
})
