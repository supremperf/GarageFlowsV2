export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { isStrongSecret, validateCriticalEnv } from '@/lib/env'

/**
 * GET /api/health — lightweight startup check (no auth).
 *
 * Returns critical-env status and a DB ping so the UI can show a helpful setup
 * screen instead of a silent failure. The secret-strength logic is delegated to
 * the central validator ({@link validateCriticalEnv} / {@link isStrongSecret}) so
 * there is a single source of truth for what "properly configured" means.
 */
export async function GET() {
  const checks = {
    DATABASE_URL:    !!process.env.DATABASE_URL,
    // NEXTAUTH_SECRET must be present AND strong (not a known default).
    NEXTAUTH_SECRET: isStrongSecret(process.env.NEXTAUTH_SECRET),
    NEXTAUTH_URL:    !!process.env.NEXTAUTH_URL,
  }

  // Feature-secret warnings (Stripe/SMTP/portal misconfiguration) — advisory only.
  const { issues } = validateCriticalEnv({ requireDbMac: false })
  const warnings = issues.filter(i => i.level === 'warning').map(i => i.message)

  const missing = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([k]) => k)

  if (missing.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        missing,
        warnings: warnings.length ? warnings : undefined,
        fix: [
          'Créez un fichier .env à la racine du projet avec :',
          'DATABASE_URL="file:./dev.db"',
          'NEXTAUTH_URL="http://localhost:3000"',
          '# Générez un secret fort : openssl rand -base64 32',
          'NEXTAUTH_SECRET="<collez_le_secret_généré_ici>"',
          '',
          'Puis lancez : npx prisma db push',
        ].join('\n'),
      },
      { status: 503 }
    )
  }

  // Try a lightweight DB ping
  let dbOk = false
  let dbError: string | null = null
  try {
    const { prisma } = await import('@/lib/db')
    await prisma.$queryRaw`SELECT 1`
    dbOk = true
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err)
  }

  return NextResponse.json({
    ok: dbOk,
    env: checks,
    db: dbOk ? 'connected' : 'error',
    dbError,
    warnings: warnings.length ? warnings : undefined,
    ts: new Date().toISOString(),
  }, { status: dbOk ? 200 : 503 })
}
