/**
 * Politique de compatibilité des clients (versions minimales + fin de la
 * tolérance « ancien client sans jeton d'appareil »).
 *
 * Objectif : ne pas conserver indéfiniment une compatibilité qui contourne le
 * contrôle des sièges. Un ancien client qui ne présente pas de jeton d'appareil
 * (device auth) n'est toléré QUE pendant une fenêtre de migration explicitement
 * configurée ; passé le délai, il reçoit DEVICE_TOKEN_REQUIRED (jamais
 * allowed:true). En dessous de la version minimale, il reçoit UPGRADE_REQUIRED.
 *
 * Tout est configurable par variables d'environnement (aucune valeur en dur qui
 * imposerait une politique) :
 *   GF_MIN_ELECTRON_VERSION       version minimale du client Electron (ex. 1.1.0)
 *   GF_MIN_PWA_VERSION            version minimale de la PWA (ex. 1.0.0)
 *   GF_DEVICE_AUTH_DEADLINE       date RFC3339 de fin de tolérance sans jeton.
 *                                 - non définie → jeton d'appareil EXIGÉ
 *                                   immédiatement (défaut sûr, pas de bypass) ;
 *                                 - date FUTURE → fenêtre de migration jusque-là ;
 *                                 - date PASSÉE → exigé.
 */

export type ClientPlatform = 'electron' | 'pwa' | 'unknown'

/** Compare deux versions numériques « a.b.c ». -1 / 0 / 1. Non-numériques ⇒ 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10))
  const pb = b.split('.').map((n) => parseInt(n, 10))
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0
    const y = Number.isFinite(pb[i]) ? pb[i] : 0
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}

/** Version minimale exigée pour une plateforme (vide = pas de minimum). */
export function minVersionFor(platform: ClientPlatform): string | null {
  if (platform === 'electron') return process.env.GF_MIN_ELECTRON_VERSION?.trim() || null
  if (platform === 'pwa') return process.env.GF_MIN_PWA_VERSION?.trim() || null
  return null
}

/**
 * La version présentée est-elle supportée ? Une version absente/mal formée est
 * considérée comme NON supportée dès qu'un minimum est configuré.
 */
export function isVersionSupported(platform: ClientPlatform, version: string | undefined): boolean {
  const min = minVersionFor(platform)
  if (!min) return true // aucun minimum configuré pour cette plateforme
  if (!version || !/^\d+(\.\d+)*$/.test(version)) return false
  return compareVersions(version, min) >= 0
}

/** Date limite de tolérance des heartbeats sans jeton d'appareil, ou null. */
export function deviceAuthDeadline(): Date | null {
  const raw = process.env.GF_DEVICE_AUTH_DEADLINE?.trim()
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Un heartbeat SANS jeton d'appareil est-il encore toléré (fenêtre de migration) ?
 * - Aucune date configurée → NON (jeton exigé immédiatement, défaut sûr).
 * - Date future → OUI jusqu'à l'échéance.
 * - Date passée → NON.
 * @param now injectable pour les tests.
 */
export function seatlessCheckTolerated(now: Date = new Date()): boolean {
  const deadline = deviceAuthDeadline()
  if (!deadline) return false
  return now.getTime() < deadline.getTime()
}
