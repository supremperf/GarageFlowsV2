/**
 * License system configuration.
 */

export const LICENSE_CONFIG = {
  /** Valid license types */
  types: ['trial', 'premium', 'enterprise', 'admin'] as const,

  /** Trial license duration in days */
  trialDays: 30,

  /** Revocation check interval in milliseconds (Electron periodic check) */
  checkIntervalMs: 12 * 60 * 60 * 1_000,   // 12 hours

  /** First revocation check delay after startup */
  firstCheckDelayMs: 60 * 1_000,            // 1 minute

  /** HWID tolerance: minimum matching hex chars out of 64 (75%) */
  hwidMinMatch: 48,

  /** Cookie names */
  cookies: {
    validated: 'gf_license_validated',
    type:      'gf_license_type',
  },

  /** Cookie max age in seconds */
  cookieMaxAge: 60 * 60 * 24 * 365 * 5,    // 5 years
} as const

export type LicenseType = typeof LICENSE_CONFIG.types[number]
