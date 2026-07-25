export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'

const KNOWN_DEFAULT_SECRETS = new Set([
  'gf-electron-local-secret-2026-xK9mP3qR',
  'fallback-dev-secret-change-in-production',
  'changeme',
  'secret',
])

// GET /api/health — lightweight startup check (no auth, no DB)
// Returns env var presence and basic status so the UI can show
// a helpful setup screen instead of a silent blue screen.
export async function GET() {
  const isElectron = process.env.ELECTRON === '1'
  const rawSecret = process.env.NEXTAUTH_SECRET ?? ''
  const usingDefaultSecret = KNOWN_DEFAULT_SECRETS.has(rawSecret)

  const checks = {
    DATABASE_URL:    !!process.env.DATABASE_URL,
    NEXTAUTH_SECRET: !!rawSecret,
    NEXTAUTH_URL:    !!process.env.NEXTAUTH_URL,
  }

  // In non-Electron (web) deployments, using the default secret is a security risk
  const warnings: string[] = []
  if (!isElectron && usingDefaultSecret) {
    warnings.push('NEXTAUTH_SECRET uses a known default value — set a strong unique secret in production')
  }

  const missing = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([k]) => k)

  if (missing.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        missing,
        fix: [
          'Créez un fichier .env à la racine du projet avec :',
          'DATABASE_URL="file:./dev.db"',
          'NEXTAUTH_URL="http://localhost:3000"',
          'NEXTAUTH_SECRET="votre_secret_ici"',
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
