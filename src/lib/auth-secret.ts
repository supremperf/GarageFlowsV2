/**
 * Accès CENTRALISÉ aux secrets de signature — AUCUN repli codé en dur.
 *
 * Un secret partagé, prédictible ou générique permettrait de forger :
 *  - le cookie de session `gf_session` (→ accès admin) ;
 *  - les tokens du portail client et de signature de devis (→ IDOR global).
 *
 * Politique :
 *  - Production : on LÈVE si le secret est absent, vide, trop court ou générique
 *    (fail-fast au démarrage via instrumentation ; fail-closed à l'exécution).
 *  - Développement : on lève aussi, avec un message clair — sans jamais afficher
 *    la valeur. Le secret doit être fourni via .env (généré par setup-dev.js) ou,
 *    dans l'app Electron, injecté par le process principal (secret par installation).
 *
 * Compatible Edge (middleware) ET Node : n'importe AUCUN module Node.
 */

import { ServerMisconfiguredError } from '@/lib/errors/apiErrors'

/** Valeurs connues comme faibles / d'exemple / anciens replis à bannir. */
const KNOWN_WEAK = new Set<string>([
  'gf-electron-local-secret-2026-xK9mP3qR',
  'fallback-dev-secret-change-in-production',
  'fallback-portal-secret-change-in-production',
  'CHANGE_ME_run_openssl_rand_base64_32',
  'changeme',
  'secret',
  'change_me',
])

const WEAK_MARKERS = ['change_me', 'change-me', 'placeholder', 'example', 'your-secret', 'votre_secret', 'replace_with']

/** Un secret est-il absent, trop court (<16) ou manifestement générique ? */
export function isWeakSecret(v: string | undefined | null): boolean {
  if (!v || v.trim().length < 16) return true
  if (KNOWN_WEAK.has(v)) return true
  const low = v.toLowerCase()
  return WEAK_MARKERS.some((m) => low.includes(m))
}

function refuse(name: string): never {
  throw new ServerMisconfiguredError(name)
}

/** Secret de session/JWT. Lève si absent/faible (jamais de repli en dur). */
export function getAuthSecret(): string {
  const s = process.env.NEXTAUTH_SECRET
  if (isWeakSecret(s)) refuse('NEXTAUTH_SECRET')
  return s as string
}

/**
 * Secret du portail client + signature de devis. Utilise GF_PORTAL_SECRET s'il
 * est fort, sinon retombe sur NEXTAUTH_SECRET (jamais sur une constante en dur).
 */
export function getPortalSecret(): string {
  const p = process.env.GF_PORTAL_SECRET
  if (p && !isWeakSecret(p)) return p
  return getAuthSecret()
}
