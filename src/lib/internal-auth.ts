/**
 * Autorisation des routes /api/internal/* — réservées au process Electron LOCAL.
 *
 * Ces routes (export complet pour la sauvegarde bureau, migrations SQLite) ne
 * sont PAS des routes utilisateur. Elles sont appelées par le client Electron sur
 * la boucle locale (127.0.0.1). On exige donc :
 *  1. une clé interne FORTE (GF_INTERNAL_EXPORT_KEY, ≥ 16 car.) — pas de repli ;
 *  2. une comparaison en temps constant ;
 *  3. l'origine loopback : une requête relayée par un proxy/CDN (en-tête
 *     x-forwarded-for non-loopback) = déploiement web → REFUS. Cela neutralise
 *     tout accès inter-tenant si l'app était exposée sur le web.
 */
import crypto from 'crypto'

function timingEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export function internalRequestAuthorized(req: Request): boolean {
  const expected = process.env.GF_INTERNAL_EXPORT_KEY
  if (!expected || expected.length < 16) return false // clé absente/faible → route désactivée

  const key = req.headers.get('x-internal-key')
  if (!key || !timingEqual(key, expected)) return false

  // Loopback-only : une requête passée par un proxy porte un x-forwarded-for.
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const ip = fwd.split(',')[0].trim()
    if (!LOOPBACK.has(ip)) return false
  }
  return true
}
