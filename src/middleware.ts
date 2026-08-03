import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { getToken } from 'next-auth/jwt'
import { getAuthSecret } from '@/lib/auth-secret'

/**
 * GarageFlow middleware — niveau page uniquement (toutes les routes /api/* sont
 * exclues : elles gèrent leur propre authentification).
 *
 * Ordre CORRIGÉ — la session NextAuth est vérifiée AVANT la licence gf_session,
 * ce qui supprime les boucles /, /login, /license observées quand un utilisateur
 * était authentifié NextAuth mais pas encore licencié.
 *
 *  1. Exclure d'emblée les assets statiques / PWA, /api/* et /portal/*.
 *  2. Lire la session NextAuth (getToken) — priorité à l'authentification.
 *     Un cookie de session présent mais indéchiffrable (secret tourné) est purgé
 *     lors du renvoi vers /login — évite la boucle et le bruit JWT_SESSION_ERROR.
 *  3. Pages d'auth (/login, /register) : laisser passer si non connecté,
 *     renvoyer vers / si déjà connecté.
 *  4. /license : accessible non connecté ; connecté + licence valide → sortir.
 *  5. Pages privées : exiger d'abord une session NextAuth (sinon → /login).
 *  6. /admin/* : NextAuth valide + gf_session typ=admin (sinon → /license).
 *  7. Routes privées normales : exiger une licence gf_session valide (→ /license).
 *
 * Sécurité :
 *  - getToken() ne peut JAMAIS faire planter le middleware (fail-closed, pas de 500).
 *  - La vérification cryptographique de gf_session est conservée (jwtVerify HS256).
 *  - Aucun secret ni contenu de jeton/cookie n'est journalisé.
 */

// ── Assets publics : jamais de logique d'auth/licence. Défense en profondeur :
// le matcher les exclut déjà, mais on re-vérifie ici (tests + robustesse). ──────
const PUBLIC_FILE = /\.(?:png|jpe?g|svg|webp|ico|css|js|map|woff2?|ttf)$/i
const PUBLIC_EXACT = new Set<string>([
  '/manifest.webmanifest',
  '/sw.js',
  '/offline.html',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
])

function isPublicAsset(pathname: string): boolean {
  return (
    pathname.startsWith('/_next') ||
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/portal') || // portail client public — auth dédiée
    pathname.startsWith('/icons/') || // icônes PWA
    PUBLIC_EXACT.has(pathname) ||
    PUBLIC_FILE.test(pathname)
  )
}

function getJwtSecret(): Uint8Array {
  // Aucun repli codé en dur : getAuthSecret() LÈVE si le secret est absent/faible.
  // verifySessionJwt() intercepte l'erreur → null → fail-closed (redirection /license).
  return new TextEncoder().encode(getAuthSecret())
}

/**
 * Vérifie cryptographiquement le cookie gf_session (HS256) et renvoie {typ, lid}
 * ou null en cas d'échec. Journalise UNIQUEMENT le chemin et le type d'erreur —
 * jamais le contenu du cookie ni le secret.
 */
async function verifySessionJwt(
  req: NextRequest,
  pathname: string,
): Promise<{ typ: string; lid: string } | null> {
  const raw = req.cookies.get('gf_session')?.value
  if (!raw) return null
  try {
    const { payload } = await jwtVerify(raw, getJwtSecret())
    if (typeof payload.typ !== 'string' || typeof payload.lid !== 'string') {
      console.warn(`[middleware] gf_session rejeté (charge utile invalide) chemin=${pathname}`)
      return null
    }
    return { typ: payload.typ, lid: payload.lid }
  } catch (err) {
    // Ne jamais afficher le cookie ni le secret : uniquement le nom de l'erreur.
    const kind = err instanceof Error ? err.name : 'ErreurInconnue'
    console.warn(`[middleware] échec vérification gf_session chemin=${pathname} erreur=${kind}`)
    return null
  }
}

function redirectTo(req: NextRequest, target: string): NextResponse {
  return NextResponse.redirect(new URL(target, req.url))
}

// ── Nettoyage sûr d'un cookie de session NextAuth périmé (mission §4.4) ────────
// Après une rotation de NEXTAUTH_SECRET, un ancien cookie chiffré (JWE) n'est
// plus déchiffrable → getToken renvoie null et NextAuth journalise
// JWT_SESSION_ERROR à chaque requête vers /api/auth/session. Quand on constate
// qu'un cookie de session est présent MAIS ne produit aucune session valide, on
// le purge proprement : plus de boucle, plus de bruit de log. On ne purge que si
// le cookie est réellement présent (aucun Set-Cookie superflu sinon).
const NEXTAUTH_SESSION_COOKIES = [
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
] as const

function hasStaleAuthCookie(req: NextRequest): boolean {
  return NEXTAUTH_SESSION_COOKIES.some((name) => req.cookies.has(name))
}

function clearStaleAuthCookies(req: NextRequest, res: NextResponse): NextResponse {
  if (!hasStaleAuthCookie(req)) return res
  // Le préfixe __Secure- impose l'attribut Secure pour être accepté/supprimé.
  res.cookies.set('next-auth.session-token', '', {
    path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax',
  })
  res.cookies.set('__Secure-next-auth.session-token', '', {
    path: '/', maxAge: 0, httpOnly: true, secure: true, sameSite: 'lax',
  })
  return res
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl

  // ── 1. Exclusions immédiates (assets, PWA, /api/*, /portal/*) ──────────────
  if (isPublicAsset(pathname)) {
    return NextResponse.next()
  }

  // ── 2. Session NextAuth D'ABORD (priorité à l'authentification) ────────────
  // getToken() peut LEVER (en-tête Authorization/Bearer malformé, secret absent…).
  // Un échec ne doit jamais provoquer un 500 (DoS de page) : on considère
  // l'utilisateur comme non connecté (fail-closed) et on journalise sans secret.
  let token: Awaited<ReturnType<typeof getToken>> = null
  try {
    token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  } catch (err) {
    const kind = err instanceof Error ? err.name : 'ErreurInconnue'
    console.error(`[middleware] getToken a échoué chemin=${pathname} erreur=${kind}`)
    token = null
  }
  const isLoggedIn = Boolean(token?.sub || token?.id)

  const isAuthPage = pathname === '/login' || pathname === '/register'

  // ── 3. Pages d'authentification (/login, /register) ────────────────────────
  if (isAuthPage) {
    // Déjà connecté → renvoyer vers l'accueil (la licence sera vérifiée sur /).
    if (isLoggedIn) return redirectTo(req, '/')
    // Non connecté → laisser accéder à la page ; purger au passage un éventuel
    // cookie de session périmé (secret tourné) pour éviter les JWT_SESSION_ERROR.
    return clearStaleAuthCookies(req, NextResponse.next())
  }

  // ── 4. Page /license (traitée avant l'exigence d'auth générale) ────────────
  if (pathname === '/license') {
    // Non connecté → laisser voir la page (l'activation suit la connexion).
    if (!isLoggedIn) return NextResponse.next()
    // Connecté : si une licence valide existe déjà, sortir de /license.
    const session = await verifySessionJwt(req, pathname)
    if (session) {
      return redirectTo(req, session.typ === 'admin' ? '/admin/licenses' : '/')
    }
    // Connecté sans licence valide → rester sur /license pour l'activer.
    return NextResponse.next()
  }

  // ── 5. Pages privées : exiger une session NextAuth AVANT la licence ────────
  if (!isLoggedIn) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('callbackUrl', pathname + req.nextUrl.search)
    // Redirection + purge d'un cookie de session périmé le cas échéant (§4.4) :
    // supprime toute boucle potentielle et le bruit JWT_SESSION_ERROR.
    return clearStaleAuthCookies(req, NextResponse.redirect(loginUrl))
  }

  // ── 6. Routes admin : NextAuth valide (ci-dessus) + gf_session typ=admin ────
  if (pathname.startsWith('/admin')) {
    const session = await verifySessionJwt(req, pathname)
    if (session?.typ === 'admin') return NextResponse.next()
    // Jamais d'accès admin sur la seule foi de NextAuth.
    return redirectTo(req, '/license')
  }

  // ── 7. Routes privées normales : exiger une licence gf_session valide ──────
  const session = await verifySessionJwt(req, pathname)
  if (!session) {
    return redirectTo(req, '/license')
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Exécuter le middleware sur toutes les routes de PAGE, SAUF :
     *  - /api/*     : les API gèrent leur propre authentification ;
     *  - /_next/*   : assets internes Next.js ;
     *  - /portal/*  : portail client public (auth dédiée) ;
     *  - /icons/*   : icônes PWA ;
     *  - tout chemin contenant un « . » → manifest.webmanifest, sw.js, offline.html,
     *    favicon.ico, robots.txt, sitemap.xml, *.png, *.css, *.js, *.woff2, …
     * Les ressources statiques / PWA n'entrent donc JAMAIS dans le middleware.
     */
    '/((?!api|_next|portal|icons|.*\\.).*)',
  ],
}
