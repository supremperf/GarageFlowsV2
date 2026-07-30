/**
 * VIN providers — a pluggable chain so the engine can enrich the deterministic
 * offline decode with data from one or more external services, while remaining
 * fully functional offline.
 */
import { decodeVinOffline } from './decode'
import type { VinInfo } from './types'

export interface VinProvider {
  readonly name: string
  /** Return the fields this provider can resolve, or null if it has nothing. */
  decode(vin: string): Promise<Partial<VinInfo> | null>
}

/** Deterministic, offline provider — the always-available base of the chain. */
export class OfflineProvider implements VinProvider {
  readonly name = 'offline'
  constructor(private readonly nowYear?: number) {}
  async decode(vin: string): Promise<Partial<VinInfo> | null> {
    return decodeVinOffline(vin, this.nowYear)
  }
}

/**
 * Optional external provider backed by the free NHTSA vPIC API (no key required).
 * Not part of the default chain (kept offline-first and network-free for tests);
 * add it explicitly when outbound network is available:
 *
 *   new VinEngine({ providers: [new OfflineProvider(), new NhtsaProvider()] })
 */
export class NhtsaProvider implements VinProvider {
  readonly name = 'nhtsa'
  constructor(private readonly timeoutMs = 6000) {}

  async decode(vin: string): Promise<Partial<VinInfo> | null> {
    try {
      const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`
      const res = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) })
      if (!res.ok) return null
      const json = (await res.json()) as { Results?: Array<Record<string, string>> }
      const r = json.Results?.[0]
      if (!r) return null
      const out: Partial<VinInfo> = {}
      if (r.Make) out.manufacturer = titleCase(r.Make)
      if (r.PlantCountry) out.country = r.PlantCountry
      const year = Number(r.ModelYear)
      if (Number.isInteger(year) && year > 1900) out.modelYear = year
      return Object.keys(out).length ? out : null
    } catch {
      return null // graceful: the offline base still applies
    }
  }
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
