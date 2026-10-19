/**
 * Export quotidien de 20 h — un compte à rebours n'est pas une horloge.
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * L'échéance était un `setTimeout` de plusieurs heures, réarmé après coup. Deux
 * façons de ne jamais exporter :
 *
 *  · le poste dort. Un garage ferme à 19 h ; l'ordinateur passe en veille, et le
 *    compte à rebours ne s'écoule pas comme l'horloge murale ;
 *  · le poste est éteint. Aucun minuteur ne survit : l'échéance de 20 h était
 *    perdue, sans rattrapage au rallumage. Un garage qui éteint son PC en
 *    partant n'a JAMAIS eu d'export quotidien.
 *
 * ─── Ce qu'il ne fallait PAS faire ──────────────────────────────────────────
 * Exporter à chaque passage « pour être sûr ». La règle tient en une phrase —
 * au plus un export par jour, à 20 h, ou dès que possible après — et les cas
 * ci-dessous la verrouillent dans les deux sens.
 */
import { describe, it, expect } from 'vitest'
const { evaluerEcheanceExport } = require('../../../electron/echeance-export.js')

/** Instant LOCAL : l'export est réglé sur l'heure du garage, pas sur UTC. */
const local = (jour: number, heure: number, minute = 0) =>
  new Date(2026, 7, jour, heure, minute, 0, 0).getTime()

const evaluer = (maintenant: number, dernierExport: number | null) =>
  evaluerEcheanceExport({ maintenant, dernierExport })

describe('l’heure venue, l’export part', () => {
  it('20 h 02, dernier export hier soir : on exporte', () => {
    const v = evaluer(local(16, 20, 2), local(15, 20, 1))
    expect(v.doitExporter).toBe(true)
    expect(v.motif).toBe('heure')
  })

  it('19 h 58, dernier export hier soir : pas encore', () => {
    expect(evaluer(local(16, 19, 58), local(15, 20, 1)).doitExporter).toBe(false)
  })

  it('déjà exporté ce soir : on n’exporte pas une deuxième fois', () => {
    expect(evaluer(local(16, 22, 0), local(16, 20, 1)).doitExporter).toBe(false)
  })
})

describe('une échéance manquée est RATTRAPÉE', () => {
  it('poste éteint le soir, rallumé à 8 h : on exporte au rallumage', () => {
    // Le cas courant d'un garage qui éteint son PC en partant. Sans rattrapage,
    // ce poste n'exportait jamais.
    const v = evaluer(local(17, 8, 30), local(15, 20, 1))
    expect(v.doitExporter, 'c’était le jour perdu').toBe(true)
    expect(v.motif).toBe('rattrapage')
  })

  it('rallumé à 8 h alors que l’export d’hier soir a bien eu lieu : rien à faire', () => {
    const v = evaluer(local(17, 8, 30), local(16, 20, 1))
    expect(v.doitExporter, 'un rattrapage ne doit pas doubler un export réussi').toBe(false)
  })

  it('aucun export jamais enregistré : on exporte', () => {
    expect(evaluer(local(16, 9, 0), null).doitExporter).toBe(true)
  })

  it('mémoire illisible (valeur non numérique) : on exporte plutôt que de sauter', () => {
    const v = evaluerEcheanceExport({
      maintenant: local(16, 9, 0),
      dernierExport: Number.NaN,
    })
    expect(v.doitExporter).toBe(true)
  })
})

describe('une horloge fausse ne fait pas sauter l’export', () => {
  it('dernier export daté dans le futur : on exporte quand même', () => {
    const v = evaluer(local(16, 21, 0), local(20, 20, 0))
    expect(v.doitExporter, 'une date bricolée ne doit pas servir à se taire').toBe(true)
    expect(v.motif).toBe('horloge')
  })
})

describe('l’échéance de référence est le dernier 20 h ATTEINT', () => {
  it('à 8 h, l’échéance visée est celle de la veille', () => {
    const v = evaluer(local(17, 8, 0), local(16, 20, 30))
    expect(v.echeance).toBe(local(16, 20, 0))
  })

  it('à 21 h, l’échéance visée est celle du soir même', () => {
    const v = evaluer(local(17, 21, 0), local(17, 20, 30))
    expect(v.echeance).toBe(local(17, 20, 0))
  })
})
