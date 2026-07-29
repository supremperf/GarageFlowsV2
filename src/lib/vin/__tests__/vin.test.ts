import { describe, it, expect } from 'vitest'
import {
  validateVin,
  normalizeVin,
  computeCheckDigit,
  isCheckDigitValid,
  decodeVinOffline,
  modelYearFromVin,
  VinEngine,
  MemoryVinCache,
  VinValidationError,
  OfflineProvider,
  type VinProvider,
} from '../index'

// Canonical NHTSA example — valid North-American VIN, check digit '3', MY 2003.
const HONDA = '1HGCM82633A004352'

describe('normalizeVin', () => {
  it('uppercases and strips spaces/dashes', () => {
    expect(normalizeVin(' 1hgcm8-2633a004352 ')).toBe(HONDA)
  })
})

describe('validateVin', () => {
  it('accepts a valid VIN and confirms the check digit', () => {
    const v = validateVin(HONDA)
    expect(v.ok).toBe(true)
    expect(v.errors).toHaveLength(0)
    expect(v.checkDigitValid).toBe(true)
  })

  it('rejects a wrong length', () => {
    const v = validateVin('1HGCM8')
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toMatch(/Longueur/)
  })

  it('rejects forbidden characters I/O/Q', () => {
    const v = validateVin('1HGCM8263OA004352') // an O in position 10
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toMatch(/interdits/)
  })

  it('flags an invalid check digit without failing format', () => {
    // Flip the check digit (position 9) from 3 to 4 — shape stays valid.
    const v = validateVin('1HGCM82643A004352')
    expect(v.ok).toBe(true)
    expect(v.checkDigitValid).toBe(false)
  })
})

describe('computeCheckDigit', () => {
  it('computes the canonical example', () => {
    expect(computeCheckDigit(HONDA)).toBe('3')
  })
  it('computes the all-ones VIN (check digit 1)', () => {
    const allOnes = '1'.repeat(17)
    expect(computeCheckDigit(allOnes)).toBe('1')
    expect(isCheckDigitValid(allOnes)).toBe(true)
  })
})

describe('modelYearFromVin', () => {
  it('resolves the earlier cycle when position 7 is a digit', () => {
    const { resolved, candidates } = modelYearFromVin(HONDA, 2026)
    expect(resolved).toBe(2003)
    expect(candidates).toEqual([2003])
  })

  it('prefers the 2010+ cycle when position 7 is a letter', () => {
    // pos7 = 'A' (letter), pos10 = 'A' → candidates 1980 & 2010, resolve 2010.
    const { resolved, candidates } = modelYearFromVin('WVWZZZAA0AA000001', 2026)
    expect(candidates).toEqual([1980, 2010])
    expect(resolved).toBe(2010)
  })
})

describe('decodeVinOffline', () => {
  it('decodes a North-American VIN fully', () => {
    const info = decodeVinOffline(HONDA, 2026)!
    expect(info).not.toBeNull()
    expect(info.wmi).toBe('1HG')
    expect(info.manufacturer).toBe('Honda (US)')
    expect(info.region).toBe('Amérique du Nord')
    expect(info.country).toBe('États-Unis')
    expect(info.modelYear).toBe(2003)
    expect(info.checkDigitValid).toBe(true)
    expect(info.checkDigitApplicable).toBe(true)
    expect(info.serialNumber).toBe('004352')
  })

  it('decodes a European VIN (check digit not applicable)', () => {
    const info = decodeVinOffline('VF74J5FS8HZ000001', 2026)!
    expect(info.manufacturer).toBe('Citroën')
    expect(info.region).toBe('Europe')
    expect(info.country).toBe('France')
    expect(info.checkDigitApplicable).toBe(false)
  })

  it('returns null for an invalid shape', () => {
    expect(decodeVinOffline('NOT-A-VIN', 2026)).toBeNull()
  })
})

describe('VinEngine', () => {
  it('decodes offline with high confidence for a valid known VIN', async () => {
    const engine = new VinEngine({ nowYear: 2026 })
    const r = await engine.decode(HONDA)
    expect(r.source).toBe('offline')
    expect(r.confidence).toBe('high')
    expect(r.manufacturer).toBe('Honda (US)')
    expect(r.warnings).toHaveLength(0)
  })

  it('throws VinValidationError on an invalid VIN', async () => {
    const engine = new VinEngine({ nowYear: 2026 })
    await expect(engine.decode('123')).rejects.toBeInstanceOf(VinValidationError)
  })

  it('serves the second lookup from cache', async () => {
    const engine = new VinEngine({ nowYear: 2026, cache: new MemoryVinCache() })
    const first = await engine.decode(HONDA)
    expect(first.source).toBe('offline')
    const second = await engine.decode(HONDA)
    expect(second.source).toBe('cache')
  })

  it('merges an external provider over the offline base', async () => {
    const mock: VinProvider = {
      name: 'mock',
      async decode() {
        return { manufacturer: 'Tesla', modelYear: 2022 }
      },
    }
    const engine = new VinEngine({
      nowYear: 2026,
      providers: [new OfflineProvider(2026), mock],
    })
    // Unknown WMI 'ZZZ' → offline manufacturer null, provider fills it.
    const r = await engine.decode('ZZZ99999999999999')
    expect(r.manufacturer).toBe('Tesla')
    expect(r.source).toBe('mock')
    expect(r.confidence).toBe('high')
  })

  it('survives a throwing provider (offline base stands)', async () => {
    const boom: VinProvider = {
      name: 'boom',
      async decode() {
        throw new Error('provider down')
      },
    }
    const engine = new VinEngine({ nowYear: 2026, providers: [new OfflineProvider(2026), boom] })
    const r = await engine.decode(HONDA)
    expect(r.manufacturer).toBe('Honda (US)')
    expect(r.source).toBe('offline')
  })
})
