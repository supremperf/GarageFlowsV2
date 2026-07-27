/**
 * Next.js startup instrumentation.
 *
 * `register()` runs once when a server instance boots. It enforces that every
 * mandatory secret is present and strong *before* the app serves any request —
 * the hard "refuse to start" gate required by the security policy. A missing or
 * weak `NEXTAUTH_SECRET` (or `GF_DB_MAC_SECRET` in production) throws here, which
 * aborts boot with an explicit, actionable message instead of silently running
 * on a compromised default.
 *
 * Guarded to the Node.js server runtime only: it is a no-op during the static
 * build phase and in the Edge runtime (which validates lazily, per request).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  const { assertStartupEnv } = await import('./lib/env')
  assertStartupEnv()
}
