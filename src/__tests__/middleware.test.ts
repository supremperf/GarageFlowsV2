/**
 * Tests du middleware de page GarageFlow (src/middleware.ts).
 *
 * Objectif : prouver que la session NextAuth est vérifiée AVANT la licence
 * gf_session et qu'aucune boucle /, /login, /license ne subsiste.
 *
 * - getToken (next-auth/jwt) est simulé (mock) et piloté par test.
 * - Les cookies gf_session sont de VRAIS JWT signés (jose) avec le secret de
 *   test : la vérification cryptographique du middleware est donc réelle.
 * - NextRequest/NextResponse proviennent de next/server (aucun serveur lancé).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SignJWT } from 'jose'

// Secret fort (≥16, non générique) : getAuthSecret() l'accepte.
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'x'.repeat(48)

// ── getToken piloté par test ────────────────────────────────────────────────
const getTokenMock = vi.hoisted(() => vi.fn())
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }))

import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'

// ── Helpers ─────────────────────────────────────────────────────────────────
function secretBytes(): Uint8Array {
  return new TextEncoder().encode(process.env.NEXTAUTH_SECRET)
}

/** Signe un gf_session valide (par défaut) ou avec une charge choisie. */
async function gfSession(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secretBytes())
}

function reqFor(path: string, opts: { gf?: string } = {}): NextRequest {
  const headers = new Headers()
  if (opts.gf !== undefined) headers.set('cookie', `gf_session=${opts.gf}`)
  return new NextRequest(`http://localhost:3000${path}`, { headers })
}

/** true si le middleware a laissé passer (NextResponse.next()). */
function passed(res: Response): boolean {
  return res.headers.get('x-middleware-next') === '1'
}

/** Chemin (+ query) de la redirection, ou null si ce n'est pas une redirection. */
function redirectPath(res: Response): string | null {
  const loc = res.headers.get('location')
  if (!loc) return null
  const u = new URL(loc)
  return u.pathname + u.search
}

/** Simule un utilisateur connecté NextAuth. */
function loggedIn(): void {
  getTokenMock.mockResolvedValue({ sub: 'user-1', id: 'user-1' })
}
/** Simule un utilisateur non connecté. */
function loggedOut(): void {
  getTokenMock.mockResolvedValue(null)
}

const SECRET_BACKUP = process.env.NEXTAUTH_SECRET

beforeEach(() => {
  getTokenMock.mockReset()
  process.env.NEXTAUTH_SECRET = SECRET_BACKUP
})
afterEach(() => {
  process.env.NEXTAUTH_SECRET = SECRET_BACKUP
})

// ── 1. Ressources statiques / PWA : jamais de middleware ─────────────────────
describe('assets publics — jamais de logique auth/licence', () => {
  const assets = [
    '/manifest.webmanifest',
    '/sw.js',
    '/offline.html',
    '/favicon.ico',
    '/robots.txt',
    '/sitemap.xml',
    '/icons/icon-192.png',
    '/logo.svg',
    '/styles/app.css',
    '/fonts/inter.woff2',
    '/_next/static/chunk.js',
    '/api/health',
    '/portal/login',
  ]
  for (const path of assets) {
    it(`laisse passer ${path} sans appeler getToken`, async () => {
      const res = await middleware(reqFor(path))
      expect(passed(res)).toBe(true)
      expect(getTokenMock).not.toHaveBeenCalled()
    })
  }
})

// ── 2. Pages d'authentification ──────────────────────────────────────────────
describe('pages d\'authentification (/login, /register)', () => {
  it('utilisateur NON connecté sur /login → laisser passer', async () => {
    loggedOut()
    const res = await middleware(reqFor('/login'))
    expect(passed(res)).toBe(true)
  })

  it('utilisateur NON connecté sur /register → laisser passer', async () => {
    loggedOut()
    const res = await middleware(reqFor('/register'))
    expect(passed(res)).toBe(true)
  })

  it('utilisateur connecté sur /login → redirection vers /', async () => {
    loggedIn()
    const res = await middleware(reqFor('/login'))
    expect(res.status).toBe(307)
    expect(redirectPath(res)).toBe('/')
  })

  it('utilisateur connecté sur /register → redirection vers /', async () => {
    loggedIn()
    const res = await middleware(reqFor('/register'))
    expect(redirectPath(res)).toBe('/')
  })
})

// ── 3. Pages privées : NextAuth d'abord ──────────────────────────────────────
describe('pages privées — priorité NextAuth', () => {
  it('utilisateur NON connecté sur / → /login?callbackUrl=/', async () => {
    loggedOut()
    const res = await middleware(reqFor('/'))
    expect(res.status).toBe(307)
    expect(redirectPath(res)).toBe('/login?callbackUrl=%2F')
  })

  it('conserve le chemin complet dans callbackUrl', async () => {
    loggedOut()
    const res = await middleware(reqFor('/dashboard/clients'))
    const loc = new URL(res.headers.get('location') as string)
    expect(loc.pathname).toBe('/login')
    expect(loc.searchParams.get('callbackUrl')).toBe('/dashboard/clients')
  })

  it('utilisateur connecté SANS licence sur / → /license (pas de boucle)', async () => {
    loggedIn()
    const res = await middleware(reqFor('/')) // aucun cookie gf_session
    expect(res.status).toBe(307)
    expect(redirectPath(res)).toBe('/license')
  })

  it('utilisateur connecté AVEC licence valide sur / → laisser passer', async () => {
    loggedIn()
    const gf = await gfSession({ typ: 'premium', lid: 'lid-1', did: 'dev-1' })
    const res = await middleware(reqFor('/', { gf }))
    expect(passed(res)).toBe(true)
  })
})

// ── 4. /license ──────────────────────────────────────────────────────────────
describe('/license', () => {
  it('utilisateur NON connecté → laisser voir la page', async () => {
    loggedOut()
    const res = await middleware(reqFor('/license'))
    expect(passed(res)).toBe(true)
  })

  it('utilisateur connecté SANS licence → rester sur /license', async () => {
    loggedIn()
    const res = await middleware(reqFor('/license'))
    expect(passed(res)).toBe(true)
  })

  it('utilisateur connecté AVEC licence non-admin → redirection vers /', async () => {
    loggedIn()
    const gf = await gfSession({ typ: 'premium', lid: 'lid-1' })
    const res = await middleware(reqFor('/license', { gf }))
    expect(redirectPath(res)).toBe('/')
  })

  it('utilisateur connecté AVEC licence admin → redirection vers /admin/licenses', async () => {
    loggedIn()
    const gf = await gfSession({ typ: 'admin', lid: 'lid-admin' })
    const res = await middleware(reqFor('/license', { gf }))
    expect(redirectPath(res)).toBe('/admin/licenses')
  })
})

// ── 5. Routes admin ──────────────────────────────────────────────────────────
describe('/admin/* — NextAuth + gf_session typ=admin', () => {
  it('connecté AVEC licence admin sur /admin/licenses → laisser passer', async () => {
    loggedIn()
    const gf = await gfSession({ typ: 'admin', lid: 'lid-admin' })
    const res = await middleware(reqFor('/admin/licenses', { gf }))
    expect(passed(res)).toBe(true)
  })

  it('connecté AVEC licence NON admin sur /admin/licenses → /license', async () => {
    loggedIn()
    const gf = await gfSession({ typ: 'premium', lid: 'lid-1' })
    const res = await middleware(reqFor('/admin/licenses', { gf }))
    expect(redirectPath(res)).toBe('/license')
  })

  it('connecté SANS licence sur /admin/licenses → /license', async () => {
    loggedIn()
    const res = await middleware(reqFor('/admin/licenses'))
    expect(redirectPath(res)).toBe('/license')
  })

  it('NON connecté sur /admin/licenses → /login (jamais admin via NextAuth seul)', async () => {
    loggedOut()
    const res = await middleware(reqFor('/admin/licenses'))
    const loc = new URL(res.headers.get('location') as string)
    expect(loc.pathname).toBe('/login')
  })
})

// ── 6. Cas de sécurité : cookies / tokens invalides ──────────────────────────
describe('sécurité — fail-closed', () => {
  it('cookie gf_session invalide (mauvaise signature) → /license', async () => {
    loggedIn()
    const res = await middleware(reqFor('/', { gf: 'aaa.bbb.ccc' }))
    expect(res.status).toBe(307)
    expect(redirectPath(res)).toBe('/license')
  })

  it('cookie gf_session signé avec un AUTRE secret → /license', async () => {
    loggedIn()
    const forged = await new SignJWT({ typ: 'admin', lid: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(new TextEncoder().encode('y'.repeat(48))) // mauvais secret
    const res = await middleware(reqFor('/admin/licenses', { gf: forged }))
    expect(redirectPath(res)).toBe('/license')
  })

  it('token NextAuth invalide (getToken lève) → traité comme non connecté, pas de 500', async () => {
    getTokenMock.mockRejectedValue(new Error('JWEDecryptionFailed'))
    const res = await middleware(reqFor('/'))
    expect(res.status).toBe(307)
    expect(redirectPath(res)).toBe('/login?callbackUrl=%2F')
  })

  it('absence de NEXTAUTH_SECRET → getToken lève → fail-closed vers /login, pas de 500', async () => {
    delete process.env.NEXTAUTH_SECRET
    // Sans secret, next-auth getToken lève : on le simule ici.
    getTokenMock.mockRejectedValue(new Error('MISSING_NEXTAUTH_SECRET'))
    const res = await middleware(reqFor('/'))
    expect(res.status).toBe(307)
    expect(redirectPath(res)).toBe('/login?callbackUrl=%2F')
  })

  it('absence de NEXTAUTH_SECRET → vérification gf_session échoue (getAuthSecret lève) → /license', async () => {
    // Connecté NextAuth, mais le secret disparaît : la licence ne peut plus être
    // vérifiée cryptographiquement → null → fail-closed vers /license, sans 500.
    const gf = await gfSession({ typ: 'premium', lid: 'lid-1' })
    loggedIn() // getToken simulé, indépendant du secret
    delete process.env.NEXTAUTH_SECRET
    const res = await middleware(reqFor('/', { gf }))
    expect(res.status).toBe(307)
    expect(redirectPath(res)).toBe('/license')
  })

  it('charge utile gf_session sans typ/lid → rejetée → /license', async () => {
    loggedIn()
    const gf = await gfSession({ foo: 'bar' }) // ni typ ni lid
    const res = await middleware(reqFor('/', { gf }))
    expect(redirectPath(res)).toBe('/license')
  })
})

// ── 6bis. Lecture de session robuste sur HTTPS (fix boucle /login) ───────────
describe('lecture de session — secureCookie robuste (fix boucle /login prod)', () => {
  function reqHttps(path: string, cookie?: string): NextRequest {
    const headers = new Headers({ 'x-forwarded-proto': 'https' })
    if (cookie) headers.set('cookie', cookie)
    return new NextRequest(`https://app.garageflows.fr${path}`, { headers })
  }

  it('HTTPS : getToken est appelé avec secureCookie=true (cookie __Secure-)', async () => {
    getTokenMock.mockResolvedValue({ sub: 'u', id: 'u' })
    await middleware(reqHttps('/'))
    expect(getTokenMock).toHaveBeenCalledWith(expect.objectContaining({ secureCookie: true }))
  })

  it('repli : secureCookie=true → null, on retente l\'autre nom et on trouve la session', async () => {
    getTokenMock.mockReset()
    getTokenMock.mockResolvedValueOnce(null)                    // 1er appel (secure)
    getTokenMock.mockResolvedValueOnce({ sub: 'u', id: 'u' })   // repli (non secure)
    const gf = await gfSession({ typ: 'premium', lid: 'lid-1' })
    const res = await middleware(reqHttps('/', `gf_session=${gf}`))
    expect(passed(res)).toBe(true)               // session trouvée au repli → licence OK
    expect(getTokenMock).toHaveBeenCalledTimes(2)
  })

  it('RÉGRESSION : connecté sur / SANS licence → /license (JAMAIS /login, pas de boucle)', async () => {
    getTokenMock.mockResolvedValue({ sub: 'u', id: 'u' }) // session NextAuth valide
    const res = await middleware(reqHttps('/'))            // aucun gf_session
    expect(redirectPath(res)).toBe('/license')
    expect(redirectPath(res)).not.toBe('/login?callbackUrl=%2F')
  })
})

// ── 7. Non-régression : le flux nominal ne boucle jamais ─────────────────────
describe('non-régression — aucune boucle de redirection', () => {
  it('connexion réussie puis / → /license → (activation) → / accessible', async () => {
    // Étape A : connecté, pas encore de licence → / renvoie vers /license.
    loggedIn()
    const a = await middleware(reqFor('/'))
    expect(redirectPath(a)).toBe('/license')

    // Étape B : sur /license, connecté sans licence → on reste (pas de retour /login).
    const b = await middleware(reqFor('/license'))
    expect(passed(b)).toBe(true)
    expect(redirectPath(b)).toBeNull()

    // Étape C : après activation (gf_session valide), / est accessible.
    const gf = await gfSession({ typ: 'premium', lid: 'lid-1', did: 'dev-1' })
    const c = await middleware(reqFor('/', { gf }))
    expect(passed(c)).toBe(true)
  })

  it('l\'ancienne boucle / → /login → / → /license → /login n\'existe plus', async () => {
    // Connecté sans licence : / ne renvoie PLUS vers /login (l\'ancien bug).
    loggedIn()
    const res = await middleware(reqFor('/'))
    expect(redirectPath(res)).not.toBe('/login')
    expect(redirectPath(res)).toBe('/license')
  })
})
