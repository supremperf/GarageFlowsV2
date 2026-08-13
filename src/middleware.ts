import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { getToken } from 'next-auth/jwt'
import { getAuthSecret } from '@/lib/auth-secret'
import { PORTAIL_BASE, PORTAIL_BASE_HERITE } from '@/lib/portal/routes'

/**
 * GarageFlow middleware — niveau page uniquement (toutes les routes /api/* sont
 * exclues : elles gèrent leur propre authentification).
 *
 * Ordre CORRIGÉ (durcissement) — la session NextAuth est vérifiée AVANT la
 * licence gf_session, ce qui supprime les boucles /, /login, /license observées
 * quand un utilisateur était authentifié NextAuth mais pas encore licencié.
 *
 *  1. Exclure d'emblée les assets statiques / PWA, /api/* et le portail client
 *     (/clients/* — officiel — ainsi que /portal/*, hérité et redirigé).
 *  2. Lire la session NextAuth (getToken) — priorité à l'authentification.
 *     `secureCookie` est déduit du protocole réel de la requête (repli sur l'autre
 *     nom de cookie) pour ne JAMAIS rater une session valide sur HTTPS.
 *  2b. Session MÉCANICIEN (gf_session typ=mechanic, AUTO-PORTANTE, SANS NextAuth) :
 *      confinée à l'espace /mechanic. Elle est vérifiée juste après NextAuth car un
 *      mécanicien n'a jamais de compte staff : l'exigence d'auth §5 le renverrait
 *      à tort vers /login. Ce n'est PAS un retour à « licence avant NextAuth » — le
 *      flux garage/admin conserve strictement l'ordre NextAuth-d'abord ci-dessous ;
 *      seule cette classe de session distincte (typ=mechanic, signée HS256) court-circuite.
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
    // Portail client public — authentification DÉDIÉE (PortalUser), jamais une
    // session garage. `/clients` est l'URL officielle ; `/portal` reste exclu le
    // temps que les liens déjà diffusés traversent la redirection permanente
    // déclarée dans next.config.mjs — le middleware s'exécute AVANT elle, si
    // bien qu'un `/portal/<jeton>` non exclu ici partirait vers /license au lieu
    // d'être redirigé vers /clients.
    pathname.startsWith(PORTAIL_BASE) ||
    pathname.startsWith(PORTAIL_BASE_HERITE) ||
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
    // Un cookie gf_session sans signature valide, EXPIRÉ ou mal formé est un cas
    // NORMAL d'exploitation (jamais connecté, session expirée, ou secret tourné →
    // l'utilisateur se ré-authentifie). Le journaliser en warn à CHAQUE requête est
    // du bruit — typiquement le flot « erreur=E » après une rotation de
    // NEXTAUTH_SECRET, où tous les anciens cookies échouent la vérification.
    //
    // On classe via le `code` STABLE de jose (contrairement à err.name, minifié en
    // « E » dans le build de production) et on ne journalise QUE l'inattendu (ex.
    // secret mal configuré → getAuthSecret lève). Sécurité inchangée : fail-closed,
    // on renvoie null dans tous les cas. Jamais de cookie ni de secret journalisé.
    const code =
      typeof (err as { code?: unknown }).code === 'string'
        ? (err as { code: string }).code
        : err instanceof Error
          ? err.name
          : 'ErreurInconnue'
    const EXPECTED_SESSION_FAILURES = new Set([
      'ERR_JWS_SIGNATURE_VERIFICATION_FAILED', // secret tourné / cookie forgé
      'ERR_JWT_EXPIRED',                        // session expirée
      'ERR_JWS_INVALID',                        // cookie tronqué / mal formé
      'ERR_JWT_INVALID',
      'ERR_JWT_CLAIM_VALIDATION_FAILED',
    ])
    if (!EXPECTED_SESSION_FAILURES.has(code)) {
      console.warn(`[middleware] échec vérification gf_session INATTENDU chemin=${pathname} code=${code}`)
    }
    return null
  }
}

function redirectTo(req: NextRequest, target: string): NextResponse {
  return NextResponse.redirect(new URL(target, req.url))
}

/**
 * Un mécanicien ne voit QUE l'espace /mechanic. On confine sa navigation ici
 * (les autorisations réelles restent vérifiées côté API — ce garde-fou n'est
 * qu'une couche d'ergonomie/UX, jamais l'unique protection).
 */
function confineMechanic(pathname: string, req: NextRequest): NextResponse {
  if (pathname === '/mechanic' || pathname.startsWith('/mechanic/')) {
    return NextResponse.next()
  }
  return redirectTo(req, '/mechanic')
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
  //
  // ROBUSTESSE (boucle /login corrigée) : sur HTTPS (app.garageflows.fr) NextAuth
  // stocke le cookie « __Secure-next-auth.session-token » ; getToken DOIT donc
  // chercher ce nom. On déduit `secureCookie` du protocole RÉEL de la requête (et
  // non de NEXTAUTH_URL, qui peut être mal configuré) et on tente en repli l'autre
  // nom : ainsi une session valide n'est JAMAIS ratée (sinon l'utilisateur venait
  // de se connecter mais le middleware le voyait déconnecté → renvoi /login en
  // boucle).
  let token: Awaited<ReturnType<typeof getToken>> = null
  const secret = process.env.NEXTAUTH_SECRET
  const isSecureReq =
    (req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '')) === 'https'
  try {
    token = await getToken({ req, secret, secureCookie: isSecureReq })
    if (!token) token = await getToken({ req, secret, secureCookie: !isSecureReq })
  } catch (err) {
    const kind = err instanceof Error ? err.name : 'ErreurInconnue'
    console.error(`[middleware] getToken a échoué chemin=${pathname} erreur=${kind}`)
    token = null
  }
  const isLoggedIn = Boolean(token?.sub || token?.id)

  // ── 2b. Session MÉCANICIEN (auto-portante, sans NextAuth) ──────────────────
  // Vérifiée une seule fois ici puis réutilisée plus bas (`gfSession`). Un
  // mécanicien détenteur d'un gf_session signé typ=mechanic est confiné à
  // /mechanic AVANT l'exigence d'auth NextAuth §5 (sinon il serait renvoyé vers
  // /login alors qu'il n'a — et ne doit avoir — aucun compte staff). Le flux
  // garage/admin ci-dessous reste strictement NextAuth-d'abord.
  const gfSession = await verifySessionJwt(req, pathname)
  if (gfSession?.typ === 'mechanic') {
    return confineMechanic(pathname, req)
  }

  const isAuthPage = pathname === '/login' || pathname === '/register'

  // ── 3. Pages d'authentification (/login, /register) ────────────────────────
  if (isAuthPage) {
    // Déjà connecté → renvoyer vers l'accueil (la licence sera vérifiée sur /).
    if (isLoggedIn) return redirectTo(req, '/')
    // Non connecté → laisser accéder à la page. On ne SUPPRIME JAMAIS le cookie de
    // session ici : une purge automatique détruirait une session valide au moindre
    // getToken null transitoire (cause de la boucle /login observée). Un cookie
    // réellement périmé (secret tourné) sera simplement écrasé à la reconnexion.
    return NextResponse.next()
  }

  // ── 4. Page /license (traitée avant l'exigence d'auth générale) ────────────
  if (pathname === '/license') {
    // Non connecté → laisser voir la page (l'activation suit la connexion).
    if (!isLoggedIn) return NextResponse.next()
    // Connecté : si une licence valide existe déjà, sortir de /license.
    if (gfSession) {
      return redirectTo(req, gfSession.typ === 'admin' ? '/admin/licenses' : '/')
    }
    // Connecté sans licence valide → rester sur /license pour l'activer.
    return NextResponse.next()
  }

  // ── 5. Pages privées : exiger une session NextAuth AVANT la licence ────────
  if (!isLoggedIn) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('callbackUrl', pathname + req.nextUrl.search)
    // On NE supprime PAS le cookie ici (voir §3) : une purge automatique
    // détruirait une session valide au moindre getToken null transitoire.
    return NextResponse.redirect(loginUrl)
  }

  // ── 6. Routes admin : NextAuth valide (ci-dessus) + gf_session typ=admin ────
  if (pathname.startsWith('/admin')) {
    if (gfSession?.typ === 'admin') return NextResponse.next()
    // Jamais d'accès admin sur la seule foi de NextAuth.
    return redirectTo(req, '/license')
  }

  // ── 6b. Une session GARAGE/staff ne doit pas se retrouver dans l'espace ─────
  // mécanicien (les API /api/mechanic/* refuseraient de toute façon).
  if (pathname === '/mechanic' || pathname.startsWith('/mechanic/')) {
    return redirectTo(req, '/')
  }

  // ── 7. Routes privées normales : exiger une licence gf_session valide ──────
  if (!gfSession) {
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
     *  - /clients/* : portail client public, URL OFFICIELLE (auth dédiée) ;
     *  - /portal/*  : ancienne URL du portail, redirigée en 308 vers /clients —
     *                 le middleware s'exécutant AVANT les redirections de
     *                 next.config.mjs, l'omettre enverrait les liens déjà
     *                 diffusés (QR codes imprimés, e-mails envoyés) vers
     *                 /license au lieu de la redirection ;
     *  - /icons/*   : icônes PWA ;
     *  - tout chemin contenant un « . » → manifest.webmanifest, sw.js, offline.html,
     *    favicon.ico, robots.txt, sitemap.xml, *.png, *.css, *.js, *.woff2, …
     * Les ressources statiques / PWA n'entrent donc JAMAIS dans le middleware.
     */
    '/((?!api|_next|clients|portal|icons|.*\\.).*)',
  ],
}
