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

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { isWeakSecret } from '@/lib/auth-secret'
import { logger } from '@/lib/logger'
import { diagnostiquerSecretsTotp, type DiagnosticTotp } from '@/lib/portal/totp-storage'
import { validateEnv } from '@/lib/env'

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

/**
 * Le limiteur de débit distribué est une dépendance CRITIQUE en production PWA :
 * son indisponibilité met connexion et activation de licence en fail-closed. Une
 * sonde qui n'interroge que la base déclare donc « ok » un déploiement où plus
 * personne ne peut se connecter. On la teste — avec un délai court, la sonde ne
 * devant jamais devenir elle-même une source de lenteur.
 */
async function redisState(): Promise<'pass' | 'fail' | 'skipped'> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) return 'skipped'
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/ping`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2000),
      cache: 'no-store',
    })
    return res.ok ? 'pass' : 'fail'
  } catch {
    return 'fail'
  }
}

/**
 * Migrations : une base joignable mais en retard de migration produit des
 * erreurs Prisma P2021/P2022 sur des routes métier, longtemps après le
 * déploiement. `_prisma_migrations` porte la réponse ; son absence signifie
 * « base non migrée », pas « sonde en échec ».
 */
async function migrationsState(): Promise<'pass' | 'fail' | 'unknown'> {
  try {
    const { prisma } = await import('@/lib/db')
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `select count(*) as n from "_prisma_migrations" where finished_at is null and rolled_back_at is null`,
    )
    return Number(rows?.[0]?.n ?? 0) === 0 ? 'pass' : 'fail'
  } catch {
    return 'unknown'
  }
}

/** Comparaison à temps constant — même arbitrage que les routes d'administration. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

/**
 * Le détail par dépendance renseigne un attaquant sur l'état de l'infrastructure
 * (« la base est tombée ») : il reste donc réservé à l'exploitant, authentifié
 * par la même clé que les routes d'administration. La réponse ANONYME ne change
 * pas d'un octet — c'est une décision de sécurité délibérée de ce service.
 */
function operatorAuthorized(req: NextRequest): boolean {
  const provided = req.headers.get('x-gf-key')?.trim() ?? ''
  const expected = process.env.GARAGEFLOW_API_KEY?.trim() ?? ''
  if (!provided || !expected || expected.length < 16) return false
  return safeEqual(provided, expected)
}

export async function GET(req: NextRequest) {
  const isElectron = process.env.ELECTRON === '1'

  // ── Public (serveur/PWA) : status minimal, rien d'autre ─────────────────────
  if (!isElectron) {
    const ok = await dbReachable()

    if (!operatorAuthorized(req)) {
      return NextResponse.json(
        { status: ok ? 'ok' : 'degraded' },
        { status: ok ? 200 : 503, headers: NO_STORE },
      )
    }

    // ── Exploitant authentifié : ventilation par dépendance ─────────────────
    // Aucun secret, aucune URL, aucun message Prisma : uniquement pass/fail et
    // les NOMS des variables invalides (validateEnv n'expose jamais de valeur).
    const [redis, migrations] = await Promise.all([redisState(), migrationsState()])
    const env = validateEnv()
    const healthy = ok && redis !== 'fail' && migrations !== 'fail' && env.ok
    return NextResponse.json(
      {
        status: healthy ? 'ok' : 'degraded',
        checks: {
          process: 'pass',
          environment: env.ok ? 'pass' : 'fail',
          database: ok ? 'pass' : 'fail',
          redis,
          migrations,
        },
        envIssues: env.issues,
        ts: new Date().toISOString(),
      },
      { status: healthy ? 200 : 503, headers: NO_STORE },
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

  // Local startup challenge: proves ownership of the utility process without
  // returning its internal API secret. The public PWA response is unchanged.
  const challenge = req?.headers?.get('x-gf-startup-challenge') ?? ''
  const startupKey = process.env.GF_INTERNAL_EXPORT_KEY
  const startupProof = /^[a-f0-9]{32}$/.test(challenge) && startupKey && startupKey.length >= 32
    ? crypto.createHmac('sha256', startupKey).update('GF_DESKTOP_STARTUP_V1|' + challenge).digest('hex')
    : null

  return NextResponse.json(
    {
      ...(startupProof ? { startupProof } : {}),
      // Identité EXPLICITE : le démarrage d'Electron tenait pour « prêt » tout
      // serveur répondant sur 127.0.0.1:4028. Si une autre application occupe
      // ce port, la fenêtre chargeait la sienne. Ce marqueur permet de le
      // distinguer, et de le DIRE au lieu d'afficher n'importe quoi.
      app: 'garageflows',
      ok,
      env: checks,
      db: ok ? 'connected' : 'error',
      ...(totp ? { totp } : {}),
      ts: new Date().toISOString(),
    },
    { status: ok ? 200 : 503, headers: NO_STORE },
  )
}
