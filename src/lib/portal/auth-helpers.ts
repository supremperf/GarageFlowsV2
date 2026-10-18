import { resolveRouteContext, type PromisedRouteContext } from '@/lib/route-context'
/**
 * Shared helpers for the authenticated client-portal endpoints (Phase 2):
 * session cookie handling, request-context loading, garage resolution and simple
 * evidence extraction. Keeps the auth routes free of duplicated boilerplate.
 */

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import type { PortalUser, PortalDevice } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifyPortalSession, signPortalSession } from '@/lib/portal/session'
import { clientIpFrom } from '@/lib/security/rate-limit'
import { logger } from '@/lib/logger'

export const PORTAL_COOKIE = 'gf_portal'
export const PORTAL_SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 days (seconds)

/** Set the HttpOnly portal session cookie on a response. */
export function setPortalCookie(res: NextResponse, token: string): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.headers.append(
    'Set-Cookie',
    `${PORTAL_COOKIE}=${token}; Path=/; Max-Age=${PORTAL_SESSION_MAX_AGE}; SameSite=Lax; HttpOnly${secure}`,
  )
}

/** Clear the portal session cookie. */
export function clearPortalCookie(res: NextResponse): void {
  res.headers.append('Set-Cookie', `${PORTAL_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`)
}

/**
 * IP cliente pour le rate limiting du portail (sujet de limite).
 *
 * SÉCURITÉ : n'utilise PAS directement x-forwarded-for/x-real-ip (forgeables
 * hors proxy de confiance — un attaquant ferait tourner l'en-tête pour obtenir
 * un bucket distinct par requête et neutraliser la limite). On délègue à
 * clientIpFrom() (source UNIQUE, même modèle de confiance que le reste de l'app :
 * en-têtes pris en compte uniquement derrière Vercel/TRUST_PROXY_HEADERS, sinon
 * clé constante « unverified »). Retourne toujours une valeur exploitable.
 */
export function clientIp(req: NextRequest): string | null {
  return clientIpFrom(req)
}

export function userAgent(req: NextRequest): string | null {
  return req.headers.get('user-agent')
}

export interface PortalContext {
  user: PortalUser
  device: PortalDevice
}

/**
 * Load the authenticated portal user + device from the session cookie, or null.
 *
 * ─── Accès DÉSACTIVÉ par le garage (GF-PORT-002) ────────────────────────────
 * Le contrôle est fait ICI et non dans chaque route : c'est le seul point par
 * lequel passent toutes les routes authentifiées du portail. Un accès coupé doit
 * l'être immédiatement, y compris pour une session déjà ouverte — sinon un
 * client écarté conserverait l'accès jusqu'à l'expiration de son cookie.
 */
export async function loadPortalContext(req: NextRequest): Promise<PortalContext | null> {
  const claims = await verifyPortalSession(req.cookies.get(PORTAL_COOKIE)?.value)
  if (!claims) return null

  const device = await prisma.portalDevice.findUnique({ where: { sessionId: claims.sid } })
  if (!device || device.revokedAt) return null

  const user = await prisma.portalUser.findUnique({ where: { id: claims.sub } })
  if (!user || user.id !== device.portalUserId) return null

  // Accès coupé par le garage : la session en cours cesse de valoir, sans
  // attendre son expiration ni un nouveau login.
  if (user.disabledAt) return null

  // Best-effort last-seen touch (never blocks the request).
  prisma.portalDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } }).catch(() => {})

  return { user, device }
}

/** Like {@link loadPortalContext} but throws a 401 NextResponse when unauthenticated. */
export async function requirePortalContext(req: NextRequest): Promise<PortalContext> {
  const ctx = await loadPortalContext(req)
  if (!ctx) throw NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  return ctx
}

export interface PortalRouteOptions {
  /**
   * La route reste accessible tant que le mot de passe TEMPORAIRE n'a pas été
   * changé. À réserver aux routes qui permettent précisément de le changer —
   * sinon la contrainte serait impossible à lever.
   */
  autoriseMotDePasseTemporaire?: boolean
}

/**
 * Wrap an authenticated portal route: injects the {@link PortalContext}, turns a
 * thrown 401 into the response, and never leaks internal errors to the client.
 *
 * ─── Mot de passe temporaire (GF-PORT-003) ──────────────────────────────────
 * Quand le garage ouvre un accès, il remet un mot de passe TEMPORAIRE. Tant
 * qu'il n'a pas été changé, aucune donnée du portail n'est servie : ni les
 * factures, ni les devis, ni les véhicules. Le contrôle est fait au SERVEUR et
 * pas seulement par une redirection d'interface — masquer un écran n'empêche
 * personne d'appeler l'API directement.
 */
export function withPortalAuth<RouteCtx = { params: Record<string, string | string[]> }>(
  handler: (req: NextRequest, portal: PortalContext, routeCtx: RouteCtx) => Promise<NextResponse>,
  options: PortalRouteOptions = {},
) {
  // Last overload is the public Next 15 contract; first retains direct callers.
  function wrapped(req: NextRequest, routeCtx: RouteCtx): Promise<NextResponse>
  function wrapped(req: NextRequest, routeCtx: PromisedRouteContext<RouteCtx>): Promise<NextResponse>
  async function wrapped(req: NextRequest, routeCtx: RouteCtx | PromisedRouteContext<RouteCtx>): Promise<NextResponse> {
    try {
      const portal = await requirePortalContext(req)

      if (portal.user.mustChangePassword && !options.autoriseMotDePasseTemporaire) {
        return NextResponse.json(
          {
            error: 'Vous devez d’abord définir votre mot de passe.',
            code: 'PASSWORD_CHANGE_REQUIRED',
          },
          { status: 403 },
        )
      }

      return await handler(req, portal, await resolveRouteContext(routeCtx) as RouteCtx)
    } catch (e) {
      if (e instanceof NextResponse) return e
      logger.error('[portal] route error:', e)
      return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
    }
  }
  return wrapped
}

/**
 * Create a PortalDevice row and sign a session token bound to it.
 * Returns the token to set as the cookie plus the new session id.
 */
export async function issuePortalSession(
  portalUserId: string,
  req: NextRequest,
): Promise<{ token: string; sessionId: string }> {
  const sessionId = crypto.randomUUID()
  await prisma.portalDevice.create({
    data: { portalUserId, sessionId, userAgent: userAgent(req), ipAddress: clientIp(req) },
  })
  const token = await signPortalSession({ sub: portalUserId, sid: sessionId })
  return { token, sessionId }
}

/**
 * Resolve the target garage for a portal operation. Uses the provided slug, or
 * the sole garage when the deployment has exactly one. Returns null when the
 * garage is ambiguous (multiple garages, no slug) or not found.
 */
export async function resolveGarageId(slug?: string | null): Promise<string | null> {
  if (slug) {
    const g = await prisma.garage.findUnique({ where: { slug }, select: { id: true } })
    return g?.id ?? null
  }
  const garages = await prisma.garage.findMany({ take: 2, select: { id: true } })
  return garages.length === 1 ? garages[0].id : null
}
