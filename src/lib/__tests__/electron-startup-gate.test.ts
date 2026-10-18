/**
 * GF-DUR-019 — une licence bloquée n'ouvre plus l'application.
 *
 * ─── Le défaut, tel qu'il se produisait ─────────────────────────────────────
 * Le blocage (révoquée, suspendue, altérée) était bien persisté et signé, mais
 * relu APRÈS `createMainWindow()` :
 *
 *     licence stockée → jeton ECDSA vérifié → serveur Next démarré →
 *     fenêtre ouverte → tableau de bord chargé et AFFICHÉ →
 *     … puis, au `did-finish-load`, un calque venait le recouvrir.
 *
 * Une licence révoquée ouvrait donc réellement l'application — planning,
 * clients, factures — le temps d'un chargement de page. Le jeton, lui, reste
 * cryptographiquement valide : ce n'est pas lui qui porte la révocation.
 *
 * Un calque n'est pas un contrôle d'accès.
 *
 * Deux niveaux de preuve ici : la POLITIQUE (module pur) et sa PLACE dans la
 * séquence de démarrage — car une politique correcte appliquée trop tard ne vaut
 * rien, et c'était précisément le défaut.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

// `electron/startup-gate.js` est du CommonJS — c'est main.js qui le consomme, et
// il doit rester chargeable par lui. On l'exige donc tel quel plutôt que d'en
// maintenir une copie ESM qui pourrait diverger.
const gate = createRequire(import.meta.url)('../../../electron/startup-gate.js')

const MAIN = readFileSync(path.resolve(__dirname, '../../../electron/main.js'), 'utf8')

const LICENCE = { lid: 'LIC-A', typ: 'pro' }

describe('politique d\'ouverture au démarrage', () => {
  it('sans licence : activation', () => {
    expect(gate.decisionDemarrage({ licence: null, blocage: null })).toEqual({ action: 'activation' })
  })

  it('licence valide et aucun blocage : ouverture', () => {
    expect(gate.decisionDemarrage({ licence: LICENCE, blocage: null })).toEqual({ action: 'ouvrir' })
  })

  for (const statut of ['revoked', 'suspended', 'tampered']) {
    it(`licence « ${statut} » : activation, jamais ouverture`, () => {
      const d = gate.decisionDemarrage({
        licence: LICENCE,
        blocage: { status: statut, lid: 'LIC-A', reason: 'Motif serveur' },
      })
      expect(d.action).toBe('activation')
      expect(d.statut).toBe(statut)
      // Le motif du serveur est repris tel quel : l'exploitant doit savoir
      // pourquoi, sinon il rappelle son revendeur pour rien.
      expect(d.motif).toBe('Motif serveur')
    })
  }

  it('un blocage SANS lid s\'applique — en cas de doute on n\'ouvre pas', () => {
    // Ce cas existe : le blocage peut être écrit avant que la licence soit
    // connue. L'ignorer serait ouvrir sur une incertitude.
    expect(gate.decisionDemarrage({ licence: LICENCE, blocage: { status: 'revoked' } }).action)
      .toBe('activation')
  })

  it('le blocage d\'une AUTRE clé n\'empêche pas la nouvelle d\'ouvrir', () => {
    // Sinon un exploitant à qui l'on remet une clé neuve resterait bloqué par
    // l'ancienne, sans aucun recours.
    expect(gate.decisionDemarrage({
      licence: LICENCE,
      blocage: { status: 'revoked', lid: 'LIC-ANCIENNE' },
    })).toEqual({ action: 'ouvrir' })
  })

  it('un statut non terminal ne bloque pas', () => {
    for (const statut of ['active', 'grace', 'unknown', '']) {
      expect(gate.decisionDemarrage({ licence: LICENCE, blocage: { status: statut, lid: 'LIC-A' } }).action)
        .toBe('ouvrir')
    }
  })
})

describe('après la fenêtre d\'activation', () => {
  it('recoller la clé bloquée est REFUSÉ', () => {
    // Sans ce second contrôle, l'activation rouvrirait l'application — en
    // particulier hors ligne, où elle ne peut pas interroger l'autorité.
    const d = gate.decisionApresActivation({
      licence: LICENCE,
      blocage: { status: 'suspended', lid: 'LIC-A', reason: 'Impayé' },
    })
    expect(d.action).toBe('refus')
    expect(d.motif).toBe('Impayé')
  })

  it('une clé différente et valide ouvre', () => {
    expect(gate.decisionApresActivation({
      licence: { lid: 'LIC-NEUVE' },
      blocage: { status: 'revoked', lid: 'LIC-A' },
    })).toEqual({ action: 'ouvrir' })
  })

  it('aucune licence activée : refus', () => {
    expect(gate.decisionApresActivation({ licence: null, blocage: null }).action).toBe('refus')
  })
})

describe('purge du blocage', () => {
  it('purgé seulement quand il vise une AUTRE clé', () => {
    expect(gate.purgerBlocage({ status: 'revoked', lid: 'LIC-ANCIENNE' }, 'LIC-A')).toBe(true)
    expect(gate.purgerBlocage({ status: 'revoked', lid: 'LIC-A' }, 'LIC-A')).toBe(false)
    // Un blocage sans `lid` n'est jamais purgé : il s'applique par défaut.
    expect(gate.purgerBlocage({ status: 'revoked' }, 'LIC-A')).toBe(false)
    expect(gate.purgerBlocage(null, 'LIC-A')).toBe(false)
  })
})

describe('la décision est prise AVANT toute ouverture', () => {
  /**
   * Une politique correcte appliquée trop tard ne vaut rien : c'était
   * exactement le défaut. Ces contrôles portent donc sur la SÉQUENCE.
   */
  const iDecision = MAIN.indexOf('decisionDemarrage(')
  const iApres = MAIN.indexOf('decisionApresActivation(')
  const iServeur = MAIN.indexOf('await startNextServer()')
  // L'APPEL, pas la définition : `indexOf('createMainWindow()')` tombait sur la
  // signature de la fonction, située bien plus haut dans le fichier — le test
  // aurait comparé la mauvaise position et n'aurait rien prouvé.
  const iFenetre = MAIN.search(/^\s*createMainWindow\(\)\s*$/m)

  it('les quatre repères existent dans main.js', () => {
    for (const [nom, i] of [['decisionDemarrage', iDecision], ['decisionApresActivation', iApres],
      ['startNextServer', iServeur], ['createMainWindow', iFenetre]] as const) {
      expect(i, `${nom} introuvable`).toBeGreaterThan(-1)
    }
  })

  it('le contrôle précède le démarrage du serveur Next', () => {
    expect(iDecision).toBeLessThan(iServeur)
    expect(iApres).toBeLessThan(iServeur)
  })

  it('le contrôle précède l\'ouverture de la fenêtre principale', () => {
    expect(iDecision).toBeLessThan(iFenetre)
    expect(iApres).toBeLessThan(iFenetre)
  })

  it('plus aucun calque « did-finish-load » ne sert de contrôle d\'accès', () => {
    // L'ancien mécanisme : ouvrir, puis recouvrir. Le supprimer est la moitié
    // du correctif — l'autre étant de décider plus tôt.
    expect(MAIN).not.toMatch(/did-finish-load[\s\S]{0,200}license:revoked/)
  })

  it('la clé bloquée fait QUITTER, elle n\'ouvre pas une fenêtre masquée', () => {
    const bloc = MAIN.slice(iApres, iApres + 1200)
    expect(bloc).toMatch(/action === 'refus'/)
    expect(bloc).toMatch(/app\.quit\(\)/)
  })
})
