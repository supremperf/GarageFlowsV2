/**
 * VinEngine — orchestrates the provider chain with caching, fallback and a
 * confidence/source verdict. Storage-agnostic (search history is persisted by
 * the API layer, not here).
 */
import { decodeVinOffline } from './decode'
import { OfflineProvider, type VinProvider } from './providers'
import type { VinDecodeResult, VinInfo } from './types'
import { validateVin } from './validate'

/** Pluggable cache. The default is a bounded in-memory Map with TTL. */
export interface VinCache {
  get(vin: string): VinDecodeResult | undefined
  set(vin: string, result: VinDecodeResult): void
}

export class MemoryVinCache implements VinCache {
  private readonly store = new Map<string, { at: number; result: VinDecodeResult }>()
  constructor(
    private readonly ttlMs = 24 * 60 * 60 * 1000,
    private readonly maxEntries = 5000,
    private readonly now: () => number = () => Date.now(),
  ) {}
  get(vin: string): VinDecodeResult | undefined {
    const hit = this.store.get(vin)
    if (!hit) return undefined
    if (this.now() - hit.at > this.ttlMs) {
      this.store.delete(vin)
      return undefined
    }
    return hit.result
  }
  set(vin: string, result: VinDecodeResult): void {
    if (this.store.size >= this.maxEntries) {
      // Evict the oldest inserted entry (Map preserves insertion order).
      const oldest = this.store.keys().next().value
      if (oldest !== undefined) this.store.delete(oldest)
    }
    this.store.set(vin, { at: this.now(), result })
  }
}

/** Thrown when the input is not a valid 17-char VIN. Carries the validation. */
export class VinValidationError extends Error {
  constructor(public readonly validation: ReturnType<typeof validateVin>) {
    super(validation.errors.join(' '))
    this.name = 'VinValidationError'
  }
}

export interface VinEngineOptions {
  providers?: VinProvider[]
  cache?: VinCache
  nowYear?: number
}

export class VinEngine {
  private readonly providers: VinProvider[]
  private readonly cache: VinCache
  private readonly nowYear: number

  constructor(opts: VinEngineOptions = {}) {
    this.nowYear = opts.nowYear ?? new Date().getFullYear()
    this.providers = opts.providers ?? [new OfflineProvider(this.nowYear)]
    this.cache = opts.cache ?? new MemoryVinCache()
  }

  /** Validate only (no decode) — useful for form-level checks. */
  validate(raw: string) {
    return validateVin(raw)
  }

  /**
   * Decode a VIN through the provider chain. Throws VinValidationError when the
   * VIN is not a valid 17-char shape. Offline data is the base; each provider's
   * non-null fields are merged over it. Results are cached by normalized VIN.
   */
  async decode(raw: string): Promise<VinDecodeResult> {
    const validation = validateVin(raw)
    if (validation.normalized.length !== 17 || /[IOQ]/.test(validation.normalized)) {
      // Hard shape errors (length / forbidden chars) — cannot decode.
      throw new VinValidationError(validation)
    }
    const vin = validation.normalized

    const cached = this.cache.get(vin)
    if (cached) return { ...cached, source: 'cache' }

    // Deterministic base — guaranteed since the shape validated above.
    const base = decodeVinOffline(vin, this.nowYear) as VinInfo
    let merged: VinInfo = { ...base }
    const contributingProviders: string[] = []

    for (const provider of this.providers) {
      if (provider.name === 'offline') continue // base already applied
      try {
        const partial = await provider.decode(vin)
        if (partial) {
          merged = mergeInfo(merged, partial)
          contributingProviders.push(provider.name)
        }
      } catch {
        // Provider failure never breaks the chain — offline base stands.
      }
    }

    const warnings: string[] = []
    if (!validation.checkDigitValid) {
      warnings.push(
        base.checkDigitApplicable
          ? 'Chiffre de contrôle (position 9) invalide — VIN possiblement erroné.'
          : 'Chiffre de contrôle non conforme (fréquent sur les VIN européens).',
      )
    }
    if (!merged.manufacturer) {
      warnings.push('Constructeur non identifié à partir du WMI (base hors-ligne).')
    }

    const source = contributingProviders.length
      ? contributingProviders.join('+')
      : 'offline'
    const confidence = verdictConfidence(merged, validation.checkDigitValid, contributingProviders.length > 0)

    const result: VinDecodeResult = { ...merged, source, confidence, warnings }
    this.cache.set(vin, result)
    return result
  }
}

function mergeInfo(base: VinInfo, partial: Partial<VinInfo>): VinInfo {
  const out = { ...base } as unknown as Record<string, unknown>
  for (const [k, v] of Object.entries(partial)) {
    if (v !== null && v !== undefined) out[k] = v
  }
  return out as unknown as VinInfo
}

function verdictConfidence(
  info: VinInfo,
  checkDigitValid: boolean,
  enriched: boolean,
): VinDecodeResult['confidence'] {
  if (enriched && info.manufacturer) return 'high'
  if (info.manufacturer && (checkDigitValid || !info.checkDigitApplicable)) return 'high'
  if (info.manufacturer) return 'medium'
  return 'low'
}
