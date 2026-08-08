/**
 * RÉGRESSION — ce que l'application DIT quand un appareil ne s'enregistre pas.
 *
 * Reproduit à partir du journal réel du poste de l'opérateur (2026-08-08,
 * clé mécanicien pas encore attribuée) :
 *
 *   20:35:05  [license/activate] server refused — Cette clé n'est pas encore attribuée…
 *   20:35:53  [license/check]    activation refusée par l'autorité — …        ← une fois
 *   20:36:07  [license/activate] server refused — …                            ← ça continue
 *   20:36:37  [license/check]    5 tentatives sans succès — autorité injoignable ?  ← FAUX
 *
 * L'autorité répondait, clairement, à chaque tentative. Le garde anti-répétition
 * du motif faisait tomber le contrôle dans la branche « injoignable » dès le
 * deuxième battement, et l'application accusait le réseau d'une décision
 * délibérée du serveur.
 *
 * Contrairement aux tests voisins qui verrouillent le TEXTE de main.js (non
 * importable : il charge `electron`), la décision vit désormais dans un module
 * pur — on éprouve donc le comportement, pas une expression régulière.
 */
import { describe, it, expect } from 'vitest'

// `require` et non `import` : le module est du CommonJS chargé par le processus
// principal Electron, et il doit le rester — c'est le même fichier qui tourne en
// production, pas une transposition.
const { activationReport, ACTIVATION_REFUSED } = require('../../../electron/activation-report')

const WARN_AT = 5
const REFUS_MECANICIEN = 'Cette clé n\'est pas encore attribuée à un mécanicien. Contactez le responsable du garage.'

describe('electron/activation-report — refus explicite', () => {
  it('journalise le motif au premier battement et remonte un overlay', () => {
    const r = activationReport({ refusal: REFUS_MECANICIEN, streak: 1, loggedRefusal: null, warnAt: WARN_AT })
    expect(r.log).toContain(REFUS_MECANICIEN)
    expect(r.overlay).toEqual({ status: ACTIVATION_REFUSED, reason: REFUS_MECANICIEN })
    expect(r.loggedRefusal).toBe(REFUS_MECANICIEN)
  })

  it('ne répète PAS la ligne de journal aux battements suivants', () => {
    const r = activationReport({ refusal: REFUS_MECANICIEN, streak: 2, loggedRefusal: REFUS_MECANICIEN, warnAt: WARN_AT })
    expect(r.log).toBeNull()
  })

  it('renvoie l\'overlay à CHAQUE battement — il doit survivre à un rechargement', () => {
    for (const streak of [1, 2, 5, 40]) {
      const r = activationReport({ refusal: REFUS_MECANICIEN, streak, loggedRefusal: REFUS_MECANICIEN, warnAt: WARN_AT })
      expect(r.overlay, `battement ${streak}`).toEqual({ status: ACTIVATION_REFUSED, reason: REFUS_MECANICIEN })
    }
  })

  it('n\'accuse JAMAIS le réseau quand l\'autorité a répondu — y compris au seuil', () => {
    // Le défaut d'origine, exactement : streak === warnAt AVEC un refus connu.
    const r = activationReport({ refusal: REFUS_MECANICIEN, streak: WARN_AT, loggedRefusal: REFUS_MECANICIEN, warnAt: WARN_AT })
    expect(r.log).toBeNull()
    expect(JSON.stringify(r)).not.toContain('injoignable')
  })

  it('un motif DIFFÉRENT est journalisé de nouveau', () => {
    const autre = 'Nombre maximal d\'appareils atteint pour cette licence (1).'
    const r = activationReport({ refusal: autre, streak: 9, loggedRefusal: REFUS_MECANICIEN, warnAt: WARN_AT })
    expect(r.log).toContain(autre)
    expect(r.loggedRefusal).toBe(autre)
  })

  it('le statut d\'overlay n\'est pas « revoked » — une licence valide n\'est pas révoquée', () => {
    const r = activationReport({ refusal: REFUS_MECANICIEN, streak: 1, loggedRefusal: null, warnAt: WARN_AT })
    expect(r.overlay!.status).not.toBe('revoked')
    expect(r.overlay!.status).not.toBe('device_limit') // absent de la table → repli « révoqué »
  })
})

describe('electron/activation-report — autorité réellement injoignable', () => {
  it('reste silencieux sous le seuil', () => {
    for (const streak of [1, 2, 3, 4]) {
      const r = activationReport({ refusal: null, streak, loggedRefusal: null, warnAt: WARN_AT })
      expect(r.log, `battement ${streak}`).toBeNull()
      expect(r.overlay).toBeNull()
    }
  })

  it('signale UNE fois au seuil, et n\'affiche aucun overlay', () => {
    const r = activationReport({ refusal: null, streak: WARN_AT, loggedRefusal: null, warnAt: WARN_AT, authority: null })
    expect(r.log).toContain('injoignable')
    // Hors ligne, on ne bloque pas l'utilisation : aucun overlay.
    expect(r.overlay).toBeNull()
  })

  it('ne parle PAS d\'injoignabilité quand le repli local a délivré un jeton', () => {
    // Journal du 2026-08-08 19:39 : l'autorité distante répondait à chaque
    // battement (« allowed: true | deviceRequired: true ») pendant que le repli
    // local délivrait des jetons qu'elle ignorait. Elle était tout sauf injoignable.
    const r = activationReport({ refusal: null, streak: WARN_AT, loggedRefusal: null, warnAt: WARN_AT, authority: 'local' })
    expect(r.log).not.toContain('injoignable')
    expect(r.log).toContain('repli local')
    expect(r.overlay).toBeNull()
  })

  it('ne le répète pas au-delà du seuil', () => {
    const r = activationReport({ refusal: null, streak: WARN_AT + 1, loggedRefusal: null, warnAt: WARN_AT })
    expect(r.log).toBeNull()
  })
})

describe('electron/activation-report — l\'overlay connaît le statut émis', () => {
  it('le composant d\'overlay possède une entrée pour ce statut', () => {
    // Sans elle, `STATUS_CONFIG[status] ?? STATUS_CONFIG.revoked` annonçait une
    // révocation à quelqu'un dont la licence est valide.
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../components/LicenseRevokedOverlay.tsx'),
      'utf8',
    )
    expect(src).toContain(`${ACTIVATION_REFUSED}: {`)
  })
})
