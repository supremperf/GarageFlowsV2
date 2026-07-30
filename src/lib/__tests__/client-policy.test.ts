/**
 * Politique de compatibilité des clients : versions minimales et fin de la
 * tolérance « ancien client sans jeton d'appareil ».
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  compareVersions,
  isVersionSupported,
  seatlessCheckTolerated,
  deviceAuthDeadline,
} from '@/lib/license/client-policy'

const KEYS = ['GF_MIN_ELECTRON_VERSION', 'GF_MIN_PWA_VERSION', 'GF_DEVICE_AUTH_DEADLINE'] as const
const saved: Record<string, string | undefined> = {}
for (const k of KEYS) saved[k] = process.env[k]

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('compareVersions', () => {
  it('compare correctement', () => {
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1)
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
  })
})

describe('isVersionSupported', () => {
  it('sans minimum configuré → toujours supporté', () => {
    delete process.env.GF_MIN_ELECTRON_VERSION
    expect(isVersionSupported('electron', undefined)).toBe(true)
    expect(isVersionSupported('electron', '0.0.1')).toBe(true)
  })

  it('avec minimum : accepte >=, refuse < et version absente/malformée', () => {
    process.env.GF_MIN_ELECTRON_VERSION = '1.1.0'
    expect(isVersionSupported('electron', '1.1.0')).toBe(true)
    expect(isVersionSupported('electron', '1.2.3')).toBe(true)
    expect(isVersionSupported('electron', '1.0.9')).toBe(false)
    expect(isVersionSupported('electron', undefined)).toBe(false)
    expect(isVersionSupported('electron', 'abc')).toBe(false)
  })

  it('minimum PWA indépendant de celui d\'Electron', () => {
    process.env.GF_MIN_PWA_VERSION = '2.0.0'
    delete process.env.GF_MIN_ELECTRON_VERSION
    expect(isVersionSupported('pwa', '1.9.9')).toBe(false)
    expect(isVersionSupported('electron', '1.0.0')).toBe(true) // pas de min Electron
  })
})

describe('seatlessCheckTolerated (fenêtre de migration device auth)', () => {
  it('sans date configurée → NON toléré (défaut sûr : jeton exigé)', () => {
    delete process.env.GF_DEVICE_AUTH_DEADLINE
    expect(deviceAuthDeadline()).toBeNull()
    expect(seatlessCheckTolerated()).toBe(false)
  })

  it('date FUTURE → toléré jusqu\'à l\'échéance', () => {
    process.env.GF_DEVICE_AUTH_DEADLINE = '2999-01-01T00:00:00Z'
    expect(seatlessCheckTolerated(new Date('2026-01-01T00:00:00Z'))).toBe(true)
  })

  it('date PASSÉE → non toléré', () => {
    process.env.GF_DEVICE_AUTH_DEADLINE = '2020-01-01T00:00:00Z'
    expect(seatlessCheckTolerated(new Date('2026-01-01T00:00:00Z'))).toBe(false)
  })

  it('date invalide → ignorée (non toléré)', () => {
    process.env.GF_DEVICE_AUTH_DEADLINE = 'pas-une-date'
    expect(deviceAuthDeadline()).toBeNull()
    expect(seatlessCheckTolerated()).toBe(false)
  })
})
