import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Module CommonJS du processus principal — PUR, donc réellement exécutable ici
// (contrairement à main.js, qui charge `electron`).
const {
  BACKOFF_STEPS_MS, backoffDelayMs, shouldAttemptActivation, afterRefusal, cleared, humanDelay,
} = require('../../../electron/activation-backoff')

/**
 * RÉGRESSION — refus explicite rejoué à chaque battement.
 *
 * Observé le 2026-08-08 (clé mécanicien non attribuée, LES DEUX autorités
 * refusant) :
 *
 *   22:09:38 server refused — remote — Cette clé n'est pas encore attribuée…
 *   22:09:38 server refused — local  — …
 *   22:10:06 server refused — local  — …
 *   22:10:07 server refused — local  — …
 *
 * Le garde précédent ne bornait le repli local QUE derrière un refus DISTANT.
 * Quand les deux autorités refusent, plus rien ne limitait les tentatives : le
 * cycle repartait à chaque battement, sur les deux serveurs.
 *
 * Un refus explicite est une décision qui attend un geste humain. On espace donc
 * les tentatives — sans jamais les abandonner, la situation pouvant se débloquer
 * côté serveur à l'insu de l'application.
 */
describe('activation-backoff — espacer les tentatives après un refus explicite', () => {
  it('sans refus en cours, on tente à chaque battement', () => {
    // Une autorité INJOIGNABLE ne doit surtout pas être ralentie : il faut
    // repartir dès le retour du réseau.
    expect(shouldAttemptActivation({ refused: false, retryAt: null, now: 1_000 })).toBe(true)
    expect(shouldAttemptActivation({ refused: false, retryAt: 9_999_999, now: 1_000 })).toBe(true)
  })

  it('pendant le délai, aucune tentative ; après, on retente', () => {
    const now = 1_000_000
    expect(shouldAttemptActivation({ refused: true, retryAt: now + 60_000, now })).toBe(false)
    expect(shouldAttemptActivation({ refused: true, retryAt: now, now })).toBe(true)
    expect(shouldAttemptActivation({ refused: true, retryAt: now - 1, now })).toBe(true)
  })

  it('les délais croissent puis se plafonnent', () => {
    expect(backoffDelayMs(1)).toBe(60_000)          // 1 min
    expect(backoffDelayMs(2)).toBe(300_000)         // 5 min
    expect(backoffDelayMs(3)).toBe(900_000)         // 15 min
    expect(backoffDelayMs(4)).toBe(3_600_000)       // 1 h
    // Plafonné : jamais d'abandon, jamais d'attente absurde.
    expect(backoffDelayMs(50)).toBe(3_600_000)
    expect(backoffDelayMs(0)).toBe(60_000)          // borne basse défensive
  })

  it('chaque refus consécutif repousse la tentative suivante', () => {
    const now = 500_000
    const a = afterRefusal({ refusalStreak: 0, now })
    expect(a).toEqual({ refusalStreak: 1, retryAt: now + 60_000, delayMs: 60_000 })
    const b = afterRefusal({ refusalStreak: a.refusalStreak, now })
    expect(b.refusalStreak).toBe(2)
    expect(b.delayMs).toBeGreaterThan(a.delayMs)
  })

  it('un succès remet tout à neuf', () => {
    expect(cleared()).toEqual({ refusalStreak: 0, retryAt: null })
    // …et l'on retente immédiatement au battement suivant.
    const { refusalStreak, retryAt } = cleared()
    expect(refusalStreak).toBe(0)
    expect(shouldAttemptActivation({ refused: false, retryAt, now: 0 })).toBe(true)
  })

  it('SCÉNARIO RÉEL : quatre battements de 30 s ne produisent qu\'UNE tentative', () => {
    // Reproduit la cadence observée (~30 s) après un premier refus explicite.
    let state = afterRefusal({ refusalStreak: 0, now: 0 })
    let tentatives = 0
    for (const t of [30_000, 60_000 - 1, 90_000, 120_000]) {
      if (shouldAttemptActivation({ refused: true, retryAt: state.retryAt, now: t })) {
        tentatives++
        state = afterRefusal({ refusalStreak: state.refusalStreak, now: t })
      }
    }
    // Avant correctif : 4 tentatives (une par battement). Après : 1, à 90 s.
    expect(tentatives).toBe(1)
  })

  it('formate le délai lisiblement pour le journal', () => {
    expect(humanDelay(60_000)).toBe('1 min')
    expect(humanDelay(900_000)).toBe('15 min')
    expect(humanDelay(3_600_000)).toBe('1 h')
  })

  it('les paliers sont strictement croissants', () => {
    for (let i = 1; i < BACKOFF_STEPS_MS.length; i++) {
      expect(BACKOFF_STEPS_MS[i]).toBeGreaterThan(BACKOFF_STEPS_MS[i - 1])
    }
  })
})

describe('electron/main — câblage de l\'espacement', () => {
  const mainSrc = fs.readFileSync(path.resolve(__dirname, '../../../electron/main.js'), 'utf8')

  it('le battement consulte le garde AVANT toute tentative', () => {
    const start = mainSrc.indexOf('if (result.deviceRequired)')
    const end = mainSrc.indexOf('if (result.allowed === false)', start)
    const branch = mainSrc.slice(start, end)
    const guard = branch.indexOf('activationThrottled()')
    const attempt = branch.indexOf('await activateOnServerAuto()')
    expect(guard).toBeGreaterThan(-1)
    expect(attempt).toBeGreaterThan(-1)
    // L'ordre compte : décider AVANT d'appeler, sinon l'appel a déjà eu lieu.
    expect(guard).toBeLessThan(attempt)
  })

  /**
   * RÉGRESSION — le garde ne couvrait qu'UN appelant sur quatre.
   *
   * Observé le 2026-08-09 à 00:40 sur le paquet installé, clé mécanicien non
   * attribuée :
   *
   *   00:40:28 [license/activate] server refused — remote — …
   *   00:40:28 [license/activate] refus explicite — prochaine tentative dans 1 min
   *   00:40:55 [license/activate] server refused — remote — …      ← 27 s plus tard
   *
   * Le battement périodique appelle `activateOnServer()` DEUX fois : une fois
   * en tête (« pas encore de jeton d'appareil ? »), une fois dans la branche
   * `deviceRequired`. Seule la seconde était bornée. Or un refus ne délivre
   * jamais de jeton : la première condition restait vraie à chaque battement, et
   * le délai annoncé n'était pas tenu.
   */
  it('TOUT enregistrement automatique est borné, pas seulement celui de la branche', () => {
    // Les appels dans les gestionnaires d'action UTILISATEUR sont légitimement
    // hors backoff : on les identifie par le reset qui les précède.
    // On raisonne sur le CODE seul : les commentaires citent `activateOnServer()`
    // en prose, et les compter donnerait de faux positifs.
    const code = mainSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')       // blocs /* … */
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')   // // … (le [^:] épargne les URL)

    // `activateOnServer` non suffixé de `Auto` : appel DIRECT, donc hors garde.
    const lignes = code.split('\n')
      .map((l, n) => ({ n: n + 1, t: l.trim() }))
      .filter((l) => /\bactivateOnServer\(\)/.test(l.t))

    expect(lignes.length, 'aucune référence trouvée — le test ne mesure plus rien').toBeGreaterThan(0)

    for (const { n, t } of lignes) {
      if (t.startsWith('async function activateOnServer(')) continue   // la définition
      if (t.startsWith('return activateOnServer()')) continue          // le corps du wrapper gardé

      // Tout autre appel direct doit être une ACTION UTILISATEUR, reconnaissable
      // au reset qui la précède immédiatement (≤ 5 lignes au-dessus).
      const amont = code.split('\n').slice(Math.max(0, n - 6), n - 1).join('\n')
      expect(
        /resetActivationBackoff\(\)/.test(amont),
        `ligne ${n} : « ${t} » appelle activateOnServer() directement sans être une ` +
        `action utilisateur. Le chemin automatique doit passer par activateOnServerAuto(), ` +
        `sinon la tentative rejoue malgré le délai annoncé.`,
      ).toBe(true)
    }
  })

  it('une action de l\'utilisateur remet le backoff à neuf', () => {
    // Saisie d'une licence et changement de clé : sa décision prime sur un délai
    // calculé pour des tentatives automatiques.
    expect(mainSrc).toMatch(/function resetActivationBackoff\(\)/)
    expect((mainSrc.match(/resetActivationBackoff\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })

  it('l\'overlay reste affiché pendant l\'attente', () => {
    // Sans cela, l'utilisateur perdrait de vue ce qu'on attend de lui.
    // On cherche l'USAGE dans la branche, pas l'import en tête de fichier.
    const branchStart = mainSrc.indexOf('if (result.deviceRequired)')
    const guardStart = mainSrc.indexOf('activationThrottled()', branchStart)
    expect(guardStart).toBeGreaterThan(branchStart)
    const bloc = mainSrc.slice(guardStart, mainSrc.indexOf('await activateOnServerAuto()', guardStart))
    expect(bloc).toMatch(/license:revoked/)
  })

  it('un succès annule l\'espacement', () => {
    expect(mainSrc).toMatch(/const fresh = cleared\(\)/)
  })
})
