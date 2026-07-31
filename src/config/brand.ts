/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  White-label brand configuration — SINGLE SOURCE OF TRUTH for product identity
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  An acquirer can rebrand GarageFlow WITHOUT editing dozens of components by
 *  overriding this configuration through one of three layers (highest priority
 *  first):
 *
 *    1. Environment variables (`GF_BRAND_*`) — CI/CD-friendly, no file edits.
 *    2. A JSON file `brand.config.json` at the project root (or the path in
 *       `GF_BRAND_CONFIG`) — a full or partial override, deep-merged over defaults.
 *    3. The typed defaults below (current GarageFlow identity).
 *
 *  Every value is validated with Zod. If an override is malformed the loader
 *  logs a single warning and falls back to safe defaults — it NEVER throws, so a
 *  bad brand file can never break a build or a running app.
 *
 *  Consumed by: src/config/app.ts (product name), the logo/header components,
 *  e-mail templates, legal pages and the Electron packaging metadata. See
 *  docs/WHITE_LABEL_GUIDE.md for the full rebrand surface and the parts that are
 *  still inline (documented honestly).
 */

import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'

/** Hex colour like #2563eb (3 or 6 hex digits). */
const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'must be a hex colour, e.g. #2563eb')

const brandSchema = z.object({
  /** Full product name shown in the UI, window titles and documents. */
  productName: z.string().min(1).max(60),
  /** Compact name for tight spaces (tabs, taskbar). */
  shortName: z.string().min(1).max(30),
  /** Company that publishes the product (commercial name). */
  companyName: z.string().min(1).max(80),
  /** Registered legal entity name (invoices, contracts, legal notice). */
  companyLegalName: z.string().min(1).max(120),
  /** One-line marketing tagline. */
  tagline: z.string().max(160),

  /** Two-part wordmark used by the logo lockup (e.g. "Garage" + "Flow"). */
  wordmark: z.object({
    primary: z.string().min(1).max(30),
    secondary: z.string().max(30),
  }),

  /** Theme colours (hex). Primary drives buttons/links/accents. */
  colors: z.object({
    primary: hexColor,
    primaryDark: hexColor,
    accent: hexColor,
  }),

  /** Public domains (no scheme). */
  domains: z.object({
    marketing: z.string().min(1),
    app: z.string().min(1),
    docs: z.string().min(1),
  }),

  /** Customer support / help contacts. */
  support: z.object({
    email: z.string().email(),
    phone: z.string().max(40).optional().default(''),
    url: z.string().url(),
  }),

  /** Transactional e-mail identity. */
  mail: z.object({
    fromName: z.string().min(1).max(60),
    fromAddress: z.string().email(),
    replyTo: z.string().email(),
  }),

  /** Legal references shown on legal pages and documents. */
  legal: z.object({
    entity: z.string().min(1).max(120),
    siren: z.string().max(20).optional().default(''),
    address: z.string().max(200).optional().default(''),
    termsUrl: z.string().url(),
    privacyUrl: z.string().url(),
    legalNoticeUrl: z.string().url(),
  }),

  /** Asset paths (relative to /public or the component that imports them). */
  assets: z.object({
    logoLight: z.string().min(1),
    logoDark: z.string().min(1),
    favicon: z.string().min(1),
    /** Windows .ico used by electron-builder (relative to project root). */
    windowsIcon: z.string().min(1),
  }),

  /** Windows packaging metadata (electron-builder / installer). */
  packaging: z.object({
    /** Product name embedded in the executable and shown in Windows. */
    productName: z.string().min(1).max(60),
    /** Reverse-DNS application id (electron `setAppUserModelId`). */
    appId: z.string().min(1),
    /** Installer/executable base name (no extension). */
    executableName: z.string().min(1),
  }),

  /** Commercial contact for the buyer package / footers. */
  commercial: z.object({
    email: z.string().email(),
    url: z.string().url(),
  }),
})

export type Brand = z.infer<typeof brandSchema>

/** Current GarageFlow identity — the safe, validated default. */
const DEFAULT_BRAND: Brand = {
  productName: 'GarageFlow',
  shortName: 'GarageFlow',
  companyName: 'GarageFlow',
  companyLegalName: 'GarageFlow',
  tagline: "Logiciel de gestion et planning d'atelier automobile",
  wordmark: { primary: 'Garage', secondary: 'Flow' },
  colors: { primary: '#2563eb', primaryDark: '#1d4ed8', accent: '#60a5fa' },
  domains: {
    marketing: 'garageflows.fr',
    app: 'app.garageflows.fr',
    docs: 'garageflows.fr/aide',
  },
  support: {
    email: 'support@garageflows.fr',
    phone: '',
    url: 'https://garageflows.fr/aide',
  },
  mail: {
    fromName: 'GarageFlow',
    fromAddress: 'no-reply@garageflows.fr',
    replyTo: 'support@garageflows.fr',
  },
  legal: {
    entity: 'GarageFlow',
    siren: '',
    address: '',
    termsUrl: 'https://garageflows.fr/conditions',
    privacyUrl: 'https://garageflows.fr/rgpd',
    legalNoticeUrl: 'https://garageflows.fr/mentions-legales',
  },
  assets: {
    logoLight: '/icon.png',
    logoDark: '/icon.png',
    favicon: '/favicon.ico',
    windowsIcon: 'icon.ico',
  },
  packaging: {
    productName: 'GarageFlow',
    appId: 'com.garageflow.app',
    executableName: 'GarageFlow',
  },
  commercial: {
    email: 'contact@garageflows.fr',
    url: 'https://garageflows.fr',
  },
}

/** Deep-merge `override` (partial, untyped) over `base`. Arrays/scalars replace. */
function deepMerge<T>(base: T, override: unknown): T {
  if (override === null || typeof override !== 'object' || Array.isArray(override)) {
    return base
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    const current = out[key]
    if (
      value && typeof value === 'object' && !Array.isArray(value) &&
      current && typeof current === 'object' && !Array.isArray(current)
    ) {
      out[key] = deepMerge(current, value)
    } else if (value !== undefined) {
      out[key] = value
    }
  }
  return out as T
}

/** Read the JSON override layer (file path in GF_BRAND_CONFIG, inline JSON, or brand.config.json). */
function readJsonOverride(): unknown {
  const raw = process.env.GF_BRAND_CONFIG?.trim()
  try {
    if (raw) {
      // Inline JSON is supported so containers can inject the whole brand at runtime.
      if (raw.startsWith('{')) return JSON.parse(raw)
      if (fs.existsSync(raw)) return JSON.parse(fs.readFileSync(raw, 'utf8'))
    }
    const rootFile = path.join(process.cwd(), 'brand.config.json')
    if (fs.existsSync(rootFile)) return JSON.parse(fs.readFileSync(rootFile, 'utf8'))
  } catch (err) {
    // A malformed brand file must never break the app — warn once, ignore it.
    console.warn('[brand] ignoring malformed brand override:', (err as Error).message)
  }
  return {}
}

/** Collect the discrete `GF_BRAND_*` environment overrides into a partial brand tree. */
function readEnvOverride(): Record<string, unknown> {
  const e = process.env
  const set = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined)
  const tree: Record<string, unknown> = {}
  const assign = (pathKeys: string[], value: string | undefined) => {
    if (value === undefined) return
    let node = tree
    for (let i = 0; i < pathKeys.length - 1; i++) {
      node[pathKeys[i]] = node[pathKeys[i]] ?? {}
      node = node[pathKeys[i]] as Record<string, unknown>
    }
    node[pathKeys[pathKeys.length - 1]] = value
  }

  assign(['productName'], set(e.GF_BRAND_PRODUCT_NAME))
  assign(['shortName'], set(e.GF_BRAND_SHORT_NAME))
  assign(['companyName'], set(e.GF_BRAND_COMPANY))
  assign(['companyLegalName'], set(e.GF_BRAND_COMPANY_LEGAL))
  assign(['tagline'], set(e.GF_BRAND_TAGLINE))
  assign(['wordmark', 'primary'], set(e.GF_BRAND_WORDMARK_PRIMARY))
  assign(['wordmark', 'secondary'], set(e.GF_BRAND_WORDMARK_SECONDARY))
  assign(['colors', 'primary'], set(e.GF_BRAND_PRIMARY_COLOR))
  assign(['colors', 'primaryDark'], set(e.GF_BRAND_PRIMARY_DARK_COLOR))
  assign(['colors', 'accent'], set(e.GF_BRAND_ACCENT_COLOR))
  assign(['domains', 'marketing'], set(e.GF_BRAND_MARKETING_DOMAIN))
  assign(['domains', 'app'], set(e.GF_BRAND_APP_DOMAIN))
  assign(['domains', 'docs'], set(e.GF_BRAND_DOCS_DOMAIN))
  assign(['support', 'email'], set(e.GF_BRAND_SUPPORT_EMAIL))
  assign(['support', 'phone'], set(e.GF_BRAND_SUPPORT_PHONE))
  assign(['support', 'url'], set(e.GF_BRAND_SUPPORT_URL))
  assign(['mail', 'fromName'], set(e.GF_BRAND_MAIL_FROM_NAME))
  assign(['mail', 'fromAddress'], set(e.GF_BRAND_MAIL_FROM))
  assign(['mail', 'replyTo'], set(e.GF_BRAND_MAIL_REPLY_TO))
  assign(['legal', 'entity'], set(e.GF_BRAND_LEGAL_ENTITY))
  assign(['legal', 'siren'], set(e.GF_BRAND_LEGAL_SIREN))
  assign(['legal', 'address'], set(e.GF_BRAND_LEGAL_ADDRESS))
  assign(['packaging', 'productName'], set(e.GF_BRAND_EXE_PRODUCT_NAME))
  assign(['packaging', 'appId'], set(e.GF_BRAND_APP_ID))
  assign(['packaging', 'executableName'], set(e.GF_BRAND_EXECUTABLE_NAME))
  assign(['commercial', 'email'], set(e.GF_BRAND_COMMERCIAL_EMAIL))
  assign(['commercial', 'url'], set(e.GF_BRAND_COMMERCIAL_URL))

  return tree
}

/**
 * Resolve the effective brand: defaults ← JSON file ← environment.
 * Exported for tests; the app should import the memoised `BRAND` below.
 */
export function resolveBrand(): Brand {
  let merged: unknown = DEFAULT_BRAND
  merged = deepMerge(merged as Brand, readJsonOverride())
  merged = deepMerge(merged as Brand, readEnvOverride())

  const parsed = brandSchema.safeParse(merged)
  if (parsed.success) return parsed.data

  // Any invalid override degrades gracefully to the validated defaults.
  console.warn(
    '[brand] brand override failed validation — using defaults. Issues:',
    parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
  )
  return DEFAULT_BRAND
}

/** Memoised, validated brand identity. Import this everywhere product identity is shown. */
export const BRAND: Brand = resolveBrand()

/** The pristine defaults, exported for tests and reset flows. */
export const DEFAULT_BRAND_CONFIG: Brand = DEFAULT_BRAND
