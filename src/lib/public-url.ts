/**
 * Source de vérité UNIQUE des URL PUBLIQUES de GarageFlows.
 *
 * Une URL « publique » est une URL destinée à sortir du poste : lien portail
 * client, lien de signature de devis, lien inséré dans un e-mail ou un SMS.
 * Elle doit TOUJOURS pointer sur la PWA officielle.
 *
 * Elle ne doit JAMAIS être dérivée de :
 *   - `request.headers.host` / `origin`  (vaut `localhost:4028` sous Electron)
 *   - `window.location.origin`           (idem côté renderer)
 *   - `os.networkInterfaces()` / IP LAN  (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
 *   - `server.address()` / port Electron / hostname de la machine
 *
 * Les communications INTERNES d'Electron (le renderer qui parle à son serveur
 * Next embarqué sur http://localhost:4028) ne passent pas par ici et restent
 * inchangées : ce module ne concerne que ce qu'on remet au client.
 */

/** URL officielle compilée — même principe que OFFICIAL_LICENSE_SERVER. */
export const OFFICIAL_PUBLIC_APP_URL = 'https://app.garageflows.fr'

/**
 * Hôtes non routables depuis l'extérieur : loopback, LAN privé (RFC1918),
 * link-local/CGNAT, `.local` mDNS, et tout nom de machine sans point.
 */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true
  if (/^0\.|^127\./.test(h)) return true
  if (/^10\./.test(h)) return true
  if (/^192\.168\./.test(h)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true
  if (/^169\.254\./.test(h)) return true          // link-local / APIPA
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true // CGNAT
  // Hostname NetBIOS de la machine (« DESKTOP-XXXX ») : aucun point, non public.
  if (!h.includes('.') && !/^\d+$/.test(h)) return true
  return false
}

/**
 * Valide une URL candidate comme base publique.
 * Exige HTTPS et un hôte réellement joignable depuis l'extérieur.
 */
export function isUsablePublicBase(candidate: string | undefined | null): boolean {
  const raw = String(candidate ?? '').trim()
  if (!raw) return false
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== 'https:') return false
  return !isPrivateHost(u.hostname)
}

/**
 * Base publique effective, sans slash final.
 *
 * Ordre : `NEXT_PUBLIC_APP_URL` → `GF_APP_URL` → `NEXTAUTH_URL` → officielle.
 * Chaque candidat est VALIDÉ : sous Electron `NEXTAUTH_URL` vaut
 * `http://localhost:4028` (cf. electron/main.js), il est donc écarté et on
 * retombe sur l'URL officielle — jamais sur une adresse locale.
 */
export function publicAppUrl(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.GF_APP_URL,
    process.env.NEXTAUTH_URL,
  ]
  for (const c of candidates) {
    if (isUsablePublicBase(c)) return String(c).trim().replace(/\/+$/, '')
  }
  return OFFICIAL_PUBLIC_APP_URL
}

/** Construit une URL publique absolue à partir d'un chemin (`/portal/<token>`). */
export function publicUrlFor(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${publicAppUrl()}${p}`
}
