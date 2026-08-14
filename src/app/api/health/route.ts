export const dynamic = 'force-dynamic'

/**
 * GET /api/health
 *
 * Version PUBLIQUE (serveur/PWA) : réponse MINIMALE — {"status":"ok"} (200) ou
 * {"status":"degraded"} (503). Aucun détail interne : pas de dbError, pas de
 * message Prisma, pas d'état des variables d'environnement, pas de stack.
 * Les diagnostics vont dans les logs serveur redactés.
 *
 * Version ELECTRON (ELECTRON=1, serveur limité à 127.0.0.1) : conserve le
 * diagnostic de configuration qui alimente l'écran de premier démarrage
 * (variables présentes/absentes + instructions). Ce mode n'est jamais exposé
 * publiquement : le serveur Electron n'écoute que sur la boucle locale.
 */

import { NextResponse } from 'next/server'
import { isWeakSecret } from '@/lib/auth-secret'
import { logger } from '@/lib/logger'
import { diagnostiquerSecretsTotp, type DiagnosticTotp } from '@/lib/portal/totp-storage'

const NO_STORE = { 'Cache-Control': 'no-store' }

async function dbReachable(): Promise<boolean> {
  try {
    const { prisma } = await import('@/lib/db')
    await prisma.$queryRaw`SELECT 1`
    return true
  } catch (err) {
    logger.error('[health] base de données injoignable', err)
    return false
  }
}

export async function GET() {
  const isElectron = process.env.ELECTRON === '1'

  // ── Public (serveur/PWA) : status minimal, rien d'autre ─────────────────────
  if (!isElectron) {
    const ok = await dbReachable()
    return NextResponse.json(
      { status: ok ? 'ok' : 'degraded' },
      { status: ok ? 200 : 503, headers: NO_STORE },
    )
  }

  // ── Electron (127.0.0.1 uniquement) : écran de configuration au démarrage ───
  const checks = {
    DATABASE_URL:    !!process.env.DATABASE_URL,
    NEXTAUTH_SECRET: !isWeakSecret(process.env.NEXTAUTH_SECRET),
    NEXTAUTH_URL:    !!process.env.NEXTAUTH_URL,
  }
  const missing = Object.entries(checks)
    .filter(([, present]) => !present)
    .map(([name]) => name)

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
      { status: 503, headers: NO_STORE },
    )
  }

  const ok = await dbReachable()

  // ── Secrets TOTP encore lisibles ? (GF-DUR-024) ────────────────────────────
  // Une rotation de `GF_TOTP_ENC_KEY` sans `_OLD` rend les seconds facteurs
  // illisibles. Sans ce décompte, l'exploitant l'apprend par un appel de client
  // bloqué, des heures après le redémarrage, quand le lien avec la rotation
  // n'est plus évident. Uniquement des compteurs : aucun secret ne sort d'ici.
  let totp: DiagnosticTotp | null = null
  if (ok) {
    try {
      const { prisma } = await import('@/lib/db')
      totp = await diagnostiquerSecretsTotp(prisma as never)
      if (totp.illisibles > 0) {
        logger.error('[health] secrets TOTP illisibles — rotation de clé sans GF_TOTP_ENC_KEY_OLD ?', {
          enroles: totp.enroles, illisibles: totp.illisibles,
        })
      }
    } catch (err) {
      // Le diagnostic ne doit jamais faire échouer la sonde elle-même.
      logger.warn('[health] diagnostic TOTP indisponible', err)
    }
  }

  return NextResponse.json(
    {
      ok,
      env: checks,
      db: ok ? 'connected' : 'error',
      ...(totp ? { totp } : {}),
      ts: new Date().toISOString(),
    },
    { status: ok ? 200 : 503, headers: NO_STORE },
  )
}
