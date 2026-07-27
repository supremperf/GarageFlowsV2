/**
 * Centralized environment & secret validator.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Single source of truth for every security-critical environment variable in
 * GarageFlow. Its contract:
 *
 *   1. No critical secret may EVER fall back to a hard-coded / default value.
 *   2. A required secret that is absent or weak throws an explicit {@link EnvError}
 *      (actionable message + generation command) instead of silently degrading.
 *   3. Feature secrets (Stripe, SMTP, Anthropic, cloud storage, …) are validated
 *      when present and required only when their feature is actually enabled.
 *   4. Secret rotation is first-class: every JWT secret exposes an ordered list
 *      of keys — the current signing key first, then previously-valid keys that
 *      stay accepted for verification during a configurable grace window.
 *
 * This module is **Edge-runtime safe**: it imports no Node-only APIs (no `crypto`,
 * no `fs`) so it can be used from `middleware.ts` as well as Node route handlers.
 * Secret access is lazy (function calls), never at import time, so `next build`
 * never evaluates a secret and a missing var fails at request/boot time — not at
 * bundle time.
 *
 * @see src/instrumentation.ts — calls {@link assertStartupEnv} to stop the server
 *      from booting at all when a mandatory secret is missing.
 */

/** Minimum length (characters) accepted for any cryptographic secret. */
export const MIN_SECRET_LENGTH = 16

/**
 * Values that must never be accepted as a real secret. These are the historical
 * hard-coded fallbacks, documented placeholders and the value that used to be
 * committed to `.env.example`. Any of them means "not configured".
 */
const KNOWN_WEAK_SECRETS: ReadonlySet<string> = new Set([
  'gf-electron-local-secret-2026-xK9mP3qR',
  'fallback-dev-secret-change-in-production',
  'fallback-portal-secret-change-in-production',
  'gf-dev-record-mac-insecure-fallback',
  'CHANGE_ME_run_openssl_rand_base64_32',
  'CHANGE_ME_openssl_rand_base64_32',
  'changeme',
  'change-me',
  'secret',
  'password',
  'default',
  'test',
  // Value historically committed to .env.example (now compromised — reject it).
  '3jvKZFYUKLjGTI/mneyeY0fUN/FNp9d1XzOgnOij7+I=',
])

/** Thrown when a required environment variable is missing or invalid. */
export class EnvError extends Error {
  constructor(
    /** The offending environment variable name. */
    public readonly variable: string,
    message: string,
  ) {
    super(message)
    this.name = 'EnvError'
  }
}

/** A single validation problem produced by {@link validateCriticalEnv}. */
export interface EnvIssue {
  variable: string
  /** `error` blocks startup; `warning` is advisory (e.g. an unset feature). */
  level: 'error' | 'warning'
  message: string
}

/**
 * Returns `true` when `value` is a usable secret: present, long enough and not a
 * known placeholder/default. Exported for reuse by the health check and tests.
 */
export function isStrongSecret(value: string | undefined | null): value is string {
  if (!value) return false
  const trimmed = value.trim()
  if (trimmed.length < MIN_SECRET_LENGTH) return false
  if (KNOWN_WEAK_SECRETS.has(trimmed)) return false
  return true
}

/**
 * Read a required secret or throw an explicit, actionable {@link EnvError}.
 *
 * @param name         Environment variable name (for the error message).
 * @param genHint      Shell command that generates a suitable value.
 */
function requireSecret(name: string, genHint = 'openssl rand -base64 32'): string {
  const raw = process.env[name]
  if (!raw || !raw.trim()) {
    throw new EnvError(
      name,
      `[env] ${name} is required but not set. GarageFlow refuses to start without it.\n` +
        `      Generate one with:  ${genHint}\n` +
        `      Then add it to your .env (or deployment secrets).`,
    )
  }
  const trimmed = raw.trim()
  if (trimmed.length < MIN_SECRET_LENGTH) {
    throw new EnvError(
      name,
      `[env] ${name} is too short (min ${MIN_SECRET_LENGTH} chars). Generate a strong value with: ${genHint}`,
    )
  }
  if (KNOWN_WEAK_SECRETS.has(trimmed)) {
    throw new EnvError(
      name,
      `[env] ${name} uses a known default/placeholder value and is considered compromised.\n` +
        `      Generate a fresh secret with:  ${genHint}`,
    )
  }
  return trimmed
}

/**
 * Read an optional secret. Returns `null` when unset, but still throws if the
 * value is present yet weak — a misconfigured feature secret is worse than an
 * absent one because it gives a false sense of security.
 */
function optionalSecret(name: string, genHint = 'openssl rand -base64 32'): string | null {
  const raw = process.env[name]
  if (!raw || !raw.trim()) return null
  const trimmed = raw.trim()
  if (!isStrongSecret(trimmed)) {
    throw new EnvError(
      name,
      `[env] ${name} is set but weak (too short or a known placeholder). ` +
        `Either unset it to disable the feature, or set a strong value: ${genHint}`,
    )
  }
  return trimmed
}

/**
 * Parse a comma-separated list of previous secrets (rotation grace window).
 * Blank and weak entries are dropped so a stray comma never widens trust.
 */
function previousSecrets(name: string): string[] {
  const raw = process.env[name]
  if (!raw) return []
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(s => isStrongSecret(s))
}

const encoder = new TextEncoder()
const toKey = (s: string): Uint8Array => encoder.encode(s)
/** De-duplicate while preserving order (current key must stay first). */
const uniq = (arr: string[]): string[] => Array.from(new Set(arr))

// ─── NextAuth / session secret ───────────────────────────────────────────────

/**
 * The current, mandatory authentication secret (`NEXTAUTH_SECRET`).
 * Used to sign the NextAuth session JWT and the signed `gf_session` cookie.
 * @throws {EnvError} when missing or weak.
 */
export function authSecret(): string {
  return requireSecret('NEXTAUTH_SECRET')
}

/**
 * All accepted auth secrets for **verification**, newest first:
 * `[NEXTAUTH_SECRET, ...NEXTAUTH_SECRET_PREVIOUS]`.
 *
 * Signing always uses index 0; older keys remain valid only for verification so
 * that in-flight sessions survive a rotation. Set `NEXTAUTH_SECRET_PREVIOUS` to
 * the old value(s) (comma-separated) for the length of your grace window, then
 * remove it once the longest session/token has expired.
 */
export function authSecretKeys(): Uint8Array[] {
  return uniq([authSecret(), ...previousSecrets('NEXTAUTH_SECRET_PREVIOUS')]).map(toKey)
}

// ─── Portal / signature token secret ─────────────────────────────────────────

/**
 * Signing key for customer-portal and quote-signature JWTs.
 * Prefers the dedicated `GF_PORTAL_SECRET`; otherwise derives from the auth
 * secret so tokens issued before the dedicated var existed keep working.
 */
export function portalSigningKey(): Uint8Array {
  const dedicated = optionalSecret('GF_PORTAL_SECRET')
  return toKey(dedicated ?? authSecret())
}

/**
 * All accepted portal secrets for **verification**, newest first. Includes the
 * dedicated portal secret and its rotation history, then the auth keys — so a
 * portal token signed before `GF_PORTAL_SECRET` was introduced still verifies.
 */
export function portalVerifyKeys(): Uint8Array[] {
  const dedicated = optionalSecret('GF_PORTAL_SECRET')
  const authKeys = uniq([authSecret(), ...previousSecrets('NEXTAUTH_SECRET_PREVIOUS')])
  if (!dedicated) return authKeys.map(toKey)
  return uniq([dedicated, ...previousSecrets('GF_PORTAL_SECRET_PREVIOUS'), ...authKeys]).map(toKey)
}

// ─── Internal export / migration key ─────────────────────────────────────────

/**
 * Shared key guarding the internal export/migrate endpoints.
 * @throws {EnvError} when missing or weak.
 */
export function internalExportKey(): string {
  return requireSecret('GF_INTERNAL_EXPORT_KEY', 'openssl rand -hex 32')
}

// ─── DB integrity (record MAC) secret ────────────────────────────────────────

/**
 * HMAC key protecting the integrity of local `LicenseKey` rows (`GF_DB_MAC_SECRET`).
 * Mandatory in production and in packaged Electron. In pure local development it
 * may be absent, in which case callers fall back to a clearly-labelled dev value
 * (see {@link dbMacSecretOrDev}) — that value is never reachable in production.
 * @throws {EnvError} in production when missing or weak.
 */
export function dbMacSecret(): string {
  return requireSecret('GF_DB_MAC_SECRET', 'openssl rand -hex 32')
}

// ─── Optional feature secrets ────────────────────────────────────────────────

/** Anthropic API key (plate OCR / AI features). `null` disables those features. */
export function anthropicApiKey(): string | null {
  const raw = process.env.ANTHROPIC_API_KEY?.trim()
  return raw ? raw : null
}

/** Base64-encoded ECDSA private key for admin license generation, or `null`. */
export function licensePrivateKey(): string | null {
  const raw = process.env.GF_PRIVATE_KEY?.trim()
  return raw ? raw : null
}

export interface SmtpConfig {
  host: string
  port: number
  user: string
  pass: string
  from: string
  secure: boolean
}

/**
 * SMTP configuration for outbound email, or `null` when email is not configured.
 * When any SMTP variable is present, the full set is required and validated —
 * a half-configured mailer is treated as an error, never silently ignored.
 */
export function smtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim()
  const anyPresent = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'].some(
    k => !!process.env[k]?.trim(),
  )
  if (!anyPresent) return null
  if (!host) throw new EnvError('SMTP_HOST', '[env] SMTP is partially configured: SMTP_HOST is missing.')

  const portRaw = process.env.SMTP_PORT?.trim()
  const port = portRaw ? Number(portRaw) : 587
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new EnvError('SMTP_PORT', `[env] SMTP_PORT must be a valid port number (got "${portRaw}").`)
  }
  const user = process.env.SMTP_USER?.trim()
  const pass = process.env.SMTP_PASS?.trim()
  const from = process.env.SMTP_FROM?.trim() ?? user
  if (!user || !pass) {
    throw new EnvError('SMTP_USER', '[env] SMTP is partially configured: SMTP_USER and SMTP_PASS are required.')
  }
  if (!from) throw new EnvError('SMTP_FROM', '[env] SMTP_FROM (or SMTP_USER) is required for outbound email.')

  return { host, port, user, pass, from, secure: port === 465 }
}

export interface StripeConfig {
  secretKey: string
  webhookSecret: string | null
}

/**
 * Stripe configuration for online payments, or `null` when not configured.
 * If `STRIPE_SECRET_KEY` is present it is validated; a webhook secret, when set,
 * is validated too.
 */
export function stripeConfig(): StripeConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim()
  if (!secretKey) return null
  if (secretKey.length < MIN_SECRET_LENGTH || !secretKey.startsWith('sk_')) {
    throw new EnvError('STRIPE_SECRET_KEY', '[env] STRIPE_SECRET_KEY is set but does not look like a Stripe secret key (sk_…).')
  }
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || null
  if (webhookSecret && !webhookSecret.startsWith('whsec_')) {
    throw new EnvError('STRIPE_WEBHOOK_SECRET', '[env] STRIPE_WEBHOOK_SECRET is set but does not look like a Stripe webhook secret (whsec_…).')
  }
  return { secretKey, webhookSecret }
}

// ─── Aggregate validation (startup / health) ─────────────────────────────────

/** Descriptor of a critical variable checked by {@link validateCriticalEnv}. */
interface CriticalVarSpec {
  name: string
  /** `required` blocks startup; `feature` is only validated when partly present. */
  kind: 'required' | 'feature'
  check: () => void
}

/**
 * Validate every critical variable and collect issues without throwing, so the
 * health endpoint and startup hook can present a complete diagnosis at once.
 *
 * @param opts.requireDbMac  Treat `GF_DB_MAC_SECRET` as mandatory (production /
 *                           Electron). Defaults to `true` in production.
 */
export function validateCriticalEnv(
  opts: { requireDbMac?: boolean } = {},
): { ok: boolean; issues: EnvIssue[] } {
  const requireDbMac = opts.requireDbMac ?? process.env.NODE_ENV === 'production'

  const specs: CriticalVarSpec[] = [
    { name: 'NEXTAUTH_SECRET', kind: 'required', check: () => void authSecret() },
    { name: 'GF_PORTAL_SECRET', kind: 'feature', check: () => void optionalSecret('GF_PORTAL_SECRET') },
    { name: 'SMTP', kind: 'feature', check: () => void smtpConfig() },
    { name: 'STRIPE_SECRET_KEY', kind: 'feature', check: () => void stripeConfig() },
    ...(requireDbMac
      ? [{ name: 'GF_DB_MAC_SECRET', kind: 'required' as const, check: () => void dbMacSecret() }]
      : []),
  ]

  const issues: EnvIssue[] = []
  for (const spec of specs) {
    try {
      spec.check()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      issues.push({
        variable: err instanceof EnvError ? err.variable : spec.name,
        level: spec.kind === 'required' ? 'error' : 'warning',
        message,
      })
    }
  }

  return { ok: issues.every(i => i.level !== 'error'), issues }
}

/**
 * Hard startup gate. Throws (aborting boot) when a mandatory secret is missing
 * or weak. Called from {@link file://src/instrumentation.ts}. Feature secrets
 * only emit a warning here — they must not block a deployment that does not use
 * that feature.
 */
export function assertStartupEnv(): void {
  const { issues } = validateCriticalEnv()
  const errors = issues.filter(i => i.level === 'error')
  const warnings = issues.filter(i => i.level === 'warning')

  for (const w of warnings) {
    // eslint-disable-next-line no-console
    console.warn(`[env] ⚠️  ${w.message}`)
  }
  if (errors.length > 0) {
    const detail = errors.map(e => ` • ${e.message}`).join('\n')
    throw new EnvError(
      errors[0].variable,
      `GarageFlow cannot start — ${errors.length} critical environment problem(s):\n${detail}`,
    )
  }
}
