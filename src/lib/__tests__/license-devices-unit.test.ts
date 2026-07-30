/**
 * Tests unitaires des primitives de src/lib/license/devices.ts :
 * génération/hachage du deviceToken, hachage du HWID, comparaison à temps
 * constant, pepper. Le comportement transactionnel (plafond, concurrence) est
 * prouvé sur une vraie base dans license-devices.postgres.int.test.ts.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'x'.repeat(48)

import {
  generateDeviceToken,
  hashDeviceToken,
  hashHwid,
  timingSafeEqualHex,
  getDevicePepper,
} from '@/lib/license/devices'
import { normalizeHwid, isValidHwidFormat } from '@/lib/license/verify'

describe('generateDeviceToken', () => {
  it('produit 32 octets CSPRNG en base64url (43 caractères, 256 bits)', () => {
    const t = generateDeviceToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(t, 'base64url')).toHaveLength(32)
  })

  it('ne produit jamais deux fois le même jeton', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateDeviceToken()))
    expect(seen.size).toBe(500)
  })
})

describe('hashDeviceToken / hashHwid', () => {
  it('le haché est un HMAC hex 64, déterministe, différent du jeton', () => {
    const t = generateDeviceToken()
    const h1 = hashDeviceToken(t)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    expect(h1).toBe(hashDeviceToken(t))
    expect(h1).not.toContain(t)
  })

  it('deux jetons différents ⇒ hachés différents (séparation de domaine token/hwid)', () => {
    const a = generateDeviceToken()
    const b = generateDeviceToken()
    expect(hashDeviceToken(a)).not.toBe(hashDeviceToken(b))
    // Même entrée dans les deux domaines → hachés différents (préfixes de domaine)
    const hex64 = 'a'.repeat(64)
    expect(hashDeviceToken(hex64)).not.toBe(hashHwid(hex64))
  })

  it('le HWID est normalisé avant hachage (casse/espaces)', () => {
    const hwid = 'A'.repeat(64)
    expect(hashHwid(` ${hwid} `)).toBe(hashHwid(hwid.toLowerCase()))
  })
})

describe('normalizeHwid / isValidHwidFormat (rappel contrat)', () => {
  it('accepte uniquement un SHA-256 hex de 64 caractères', () => {
    expect(isValidHwidFormat('a'.repeat(64))).toBe(true)
    expect(isValidHwidFormat('A'.repeat(64))).toBe(true)  // normalisé
    expect(isValidHwidFormat('a'.repeat(63))).toBe(false)
    expect(isValidHwidFormat('g'.repeat(64))).toBe(false)
    expect(isValidHwidFormat('')).toBe(false)
    expect(isValidHwidFormat(undefined)).toBe(false)
  })

  it('normalise casse et espaces uniquement', () => {
    expect(normalizeHwid('  AbC  ')).toBe('abc')
  })
})

describe('timingSafeEqualHex', () => {
  it('égalité stricte uniquement', () => {
    const h = hashDeviceToken(generateDeviceToken())
    expect(timingSafeEqualHex(h, h)).toBe(true)
    expect(timingSafeEqualHex(h, h.slice(0, 63) + (h.endsWith('0') ? '1' : '0'))).toBe(false)
    expect(timingSafeEqualHex(h, h.slice(1))).toBe(false) // longueurs différentes
  })
})

describe('getDevicePepper', () => {
  afterEach(() => {
    delete process.env.DEVICE_TOKEN_PEPPER
    vi.unstubAllEnvs()
  })

  it('utilise DEVICE_TOKEN_PEPPER quand il est fort', () => {
    process.env.DEVICE_TOKEN_PEPPER = 'p'.repeat(32)
    expect(getDevicePepper()).toBe('p'.repeat(32))
  })

  it('repli sur NEXTAUTH_SECRET hors production PWA', () => {
    delete process.env.DEVICE_TOKEN_PEPPER
    expect(getDevicePepper()).toBe(process.env.NEXTAUTH_SECRET)
  })

  it('production PWA sans pepper fort → refuse (jamais de secret par défaut)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.DEVICE_TOKEN_PEPPER
    delete process.env.ELECTRON
    expect(() => getDevicePepper()).toThrow(/DEVICE_TOKEN_PEPPER/)
  })

  it('un pepper faible/générique est refusé comme absent', () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.DEVICE_TOKEN_PEPPER = 'changeme'
    delete process.env.ELECTRON
    expect(() => getDevicePepper()).toThrow(/DEVICE_TOKEN_PEPPER/)
  })
})
