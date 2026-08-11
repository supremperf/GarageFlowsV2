/**
 * Politique de synchronisation quasi temps réel de la PWA mécanicien.
 *
 * Prouve les garanties annoncées : cadence < 3 s au premier plan, AUCUN appel
 * en arrière-plan ou hors ligne, rattrapage IMMÉDIAT au retour, et backoff
 * borné en cas d'échecs répétés (pas de boucle de reconnexion en rafale).
 */
import { describe, it, expect } from 'vitest'
import {
  initialLiveState, reduceLive, backoffDelay,
  LIVE_BASE_INTERVAL_MS, LIVE_MAX_BACKOFF_MS,
  type LiveState,
} from '@/lib/live-sync'

const start = () => reduceLive(initialLiveState(), 'start')
const feed = (state: LiveState, ...events: Parameters<typeof reduceLive>[1][]) =>
  events.reduce((s, e) => reduceLive(s, e), state)

describe('cadence nominale', () => {
  it('le démarrage déclenche un appel IMMÉDIAT puis programme la cadence', () => {
    const s = start()
    expect(s.fetchNow).toBe(true)
    expect(s.polling).toBe(true)
    expect(s.delayMs).toBe(LIVE_BASE_INTERVAL_MS)
  })

  it('la cadence tient l’objectif de latence (≤ 3 s)', () => {
    expect(LIVE_BASE_INTERVAL_MS).toBeLessThanOrEqual(3_000)
    // …et n'est pas absurde non plus (pas de polling à 100 ms).
    expect(LIVE_BASE_INTERVAL_MS).toBeGreaterThanOrEqual(2_000)
  })

  it('un succès conserve la cadence et n’enchaîne pas d’appel immédiat', () => {
    const s = feed(start(), 'success')
    expect(s.delayMs).toBe(LIVE_BASE_INTERVAL_MS)
    expect(s.fetchNow).toBe(false)
    expect(s.polling).toBe(true)
  })
})

describe('arrière-plan et perte de réseau : plus AUCUN appel', () => {
  it('passage en arrière-plan → polling arrêté', () => {
    const s = feed(start(), 'success', 'hidden')
    expect(s.polling).toBe(false)
    expect(s.fetchNow).toBe(false)
  })

  it('perte de réseau → polling arrêté', () => {
    const s = feed(start(), 'success', 'offline')
    expect(s.polling).toBe(false)
    expect(s.fetchNow).toBe(false)
  })

  it('un appel manuel en arrière-plan ne réarme pas la boucle', () => {
    const s = feed(start(), 'hidden', 'manual')
    expect(s.polling).toBe(false)
  })
})

describe('rattrapage immédiat (exigence « aucune intervention perdue »)', () => {
  it('retour au premier plan → appel immédiat et cadence nominale', () => {
    const s = feed(start(), 'success', 'hidden', 'visible')
    expect(s.fetchNow).toBe(true)
    expect(s.polling).toBe(true)
    expect(s.delayMs).toBe(LIVE_BASE_INTERVAL_MS)
  })

  it('retour du réseau → appel immédiat, backoff effacé', () => {
    const s = feed(start(), 'error', 'error', 'error', 'offline', 'online')
    expect(s.fetchNow).toBe(true)
    expect(s.consecutiveErrors).toBe(0)
    expect(s.delayMs).toBe(LIVE_BASE_INTERVAL_MS)
  })

  it('scénario complet : hors ligne, intervention créée côté garage, réseau revenu', () => {
    // 1. le mécanicien a la PWA ouverte
    let s = start()
    s = feed(s, 'success')
    // 2. réseau coupé → aucun appel programmé
    s = feed(s, 'offline')
    expect(s.polling).toBe(false)
    // 3. (le garage crée l'intervention pendant ce temps)
    // 4. réseau revenu → appel IMMÉDIAT, sans attendre le prochain tick
    s = feed(s, 'online')
    expect(s.fetchNow).toBe(true)
    expect(s.polling).toBe(true)
  })
})

describe('backoff borné', () => {
  it('double à chaque échec puis plafonne', () => {
    expect(backoffDelay(0)).toBe(LIVE_BASE_INTERVAL_MS)
    expect(backoffDelay(1)).toBe(LIVE_BASE_INTERVAL_MS * 2)
    expect(backoffDelay(2)).toBe(LIVE_BASE_INTERVAL_MS * 4)
    expect(backoffDelay(50)).toBe(LIVE_MAX_BACKOFF_MS)
  })

  it('n’excède JAMAIS le plafond, quel que soit le nombre d’échecs', () => {
    for (let i = 0; i < 200; i++) {
      const d = backoffDelay(i)
      expect(d).toBeGreaterThanOrEqual(LIVE_BASE_INTERVAL_MS)
      expect(d).toBeLessThanOrEqual(LIVE_MAX_BACKOFF_MS)
    }
  })

  it('un succès après des échecs efface le backoff', () => {
    const s = feed(start(), 'error', 'error', 'success')
    expect(s.consecutiveErrors).toBe(0)
    expect(s.delayMs).toBe(LIVE_BASE_INTERVAL_MS)
  })

  it('un échec ne relance jamais d’appel immédiat (pas de martèlement)', () => {
    const s = feed(start(), 'error')
    expect(s.fetchNow).toBe(false)
    expect(s.delayMs).toBeGreaterThan(LIVE_BASE_INTERVAL_MS)
  })
})

describe('options personnalisées', () => {
  it('respecte une cadence et un plafond fournis', () => {
    const opts = { baseIntervalMs: 1_000, maxBackoffMs: 5_000 }
    expect(backoffDelay(1, opts)).toBe(2_000)
    expect(backoffDelay(9, opts)).toBe(5_000)
    expect(reduceLive(initialLiveState(opts), 'start', opts).delayMs).toBe(1_000)
  })
})
