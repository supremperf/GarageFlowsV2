/**
 * Tests des jetons de session/2FA du portail client (src/lib/portal/session.ts).
 *
 * Prouve l'expiration, le rejet d'un jeton falsifié, d'un mauvais secret et le
 * cloisonnement des types (une preuve 2FA ne vaut pas une session, et vice
 * versa). Aucune dépendance réseau/BD.
 */
import { describe, it, expect } from 'vitest'
import { SignJWT } from 'jose'
import {
  signPortalSession,
  verifyPortalSession,
  signTwoFactorChallenge,
  verifyTwoFactorChallenge,
} from '@/lib/portal/session'

// Secret fort requis par getPortalSecret() (repli sur NEXTAUTH_SECRET).
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'x'.repeat(48)

const secret = () => new TextEncoder().encode(process.env.NEXTAUTH_SECRET)
const nowSec = () => Math.floor(Date.now() / 1000)

describe('portal session — signature & vérification', () => {
  it('aller-retour valide', async () => {
    const token = await signPortalSession({ sub: 'user-1', sid: 'dev-1' })
    expect(await verifyPortalSession(token)).toEqual({ sub: 'user-1', sid: 'dev-1' })
  })

  it('jeton absent/null → null', async () => {
    expect(await verifyPortalSession(null)).toBeNull()
    expect(await verifyPortalSession(undefined)).toBeNull()
    expect(await verifyPortalSession('')).toBeNull()
  })

  it('jeton EXPIRÉ → null', async () => {
    const expired = await new SignJWT({ sid: 'dev-1', typ: 'portal-session' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuedAt(nowSec() - 3600)
      .setExpirationTime(nowSec() - 60)
      .sign(secret())
    expect(await verifyPortalSession(expired)).toBeNull()
  })

  it('jeton FALSIFIÉ (signature altérée) → null', async () => {
    const token = await signPortalSession({ sub: 'user-1', sid: 'dev-1' })
    const parts = token.split('.')
    parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith('A') ? 'BB' : 'AA')
    expect(await verifyPortalSession(parts.join('.'))).toBeNull()
  })

  it('jeton signé avec un AUTRE secret → null', async () => {
    const forged = await new SignJWT({ sid: 'dev-1', typ: 'portal-session' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(new TextEncoder().encode('y'.repeat(48)))
    expect(await verifyPortalSession(forged)).toBeNull()
  })

  it('une preuve 2FA ne vaut PAS une session (typ cloisonné)', async () => {
    const challenge = await signTwoFactorChallenge('user-1')
    expect(await verifyPortalSession(challenge)).toBeNull()
  })
})

describe('portal 2FA challenge — signature & vérification', () => {
  it('aller-retour valide → renvoie l\'id utilisateur', async () => {
    const token = await signTwoFactorChallenge('user-42')
    expect(await verifyTwoFactorChallenge(token)).toBe('user-42')
  })

  it('challenge EXPIRÉ → null', async () => {
    const expired = await new SignJWT({ typ: 'portal-2fa' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-42')
      .setIssuedAt(nowSec() - 3600)
      .setExpirationTime(nowSec() - 60)
      .sign(secret())
    expect(await verifyTwoFactorChallenge(expired)).toBeNull()
  })

  it('une session ne vaut PAS une preuve 2FA (typ cloisonné)', async () => {
    const session = await signPortalSession({ sub: 'user-42', sid: 'dev-1' })
    expect(await verifyTwoFactorChallenge(session)).toBeNull()
  })

  it('challenge falsifié → null', async () => {
    const token = await signTwoFactorChallenge('user-42')
    const parts = token.split('.')
    parts[1] = parts[1].slice(0, -2) + (parts[1].endsWith('A') ? 'BB' : 'AA')
    expect(await verifyTwoFactorChallenge(parts.join('.'))).toBeNull()
  })
})
