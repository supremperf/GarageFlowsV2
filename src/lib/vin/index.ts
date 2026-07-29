/**
 * VIN intelligent decoder — public entry point.
 *
 * Usage:
 *   import { vinEngine } from '@/lib/vin'
 *   const result = await vinEngine.decode('1HGCM82633A004352')
 *
 * The default engine is offline-first (deterministic, no network). To enrich with
 * an external provider where outbound network is allowed:
 *   new VinEngine({ providers: [new OfflineProvider(), new NhtsaProvider()] })
 */
export * from './types'
export { validateVin, normalizeVin, isValidVinFormat, computeCheckDigit, isCheckDigitValid } from './validate'
export {
  decodeVinOffline,
  regionFromVin,
  countryFromVin,
  manufacturerFromVin,
  modelYearFromVin,
} from './decode'
export { OfflineProvider, NhtsaProvider, type VinProvider } from './providers'
export { VinEngine, MemoryVinCache, VinValidationError, type VinCache, type VinEngineOptions } from './engine'

import { VinEngine } from './engine'

/**
 * Process-wide default engine (offline-first, shared 24 h cache). Suitable for the
 * single-process Electron server. Swap for a multi-provider engine in web builds.
 */
export const vinEngine = new VinEngine()
