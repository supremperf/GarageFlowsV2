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

/**
 * Plateforme ANNONCÉE par le client, validée contre une liste blanche.
 *
 * Elle ne peut pas être devinée côté serveur : le cloud sert les deux surfaces
 * depuis le même processus. Une valeur inconnue ou absente retombe sur
 * `unknown`, qui est désormais le cas le plus STRICT (cf. `minVersionFor`) —
 * annoncer une plateforme ne peut donc qu'ajouter de la précision, jamais
 * relâcher un contrôle.
 */
export function parseClientPlatform(value: unknown): ClientPlatform {
  return value === 'electron' || value === 'pwa' ? value : 'unknown'
}

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

/**
 * Version minimale exigée pour une plateforme (vide = pas de minimum).
 *
 * `unknown` retenait `null` : n'importe quel client qui ne s'identifiait pas
 * échappait donc à la politique. Or c'était précisément le cas de TOUS les
 * clients Electron, la plateforme étant déduite côté serveur de
 * `process.env.ELECTRON`, jamais positionné sur le cloud — le mécanisme d'arrêt
 * des versions obsolètes ne s'appliquait à personne (GF31-AUD-053).
 *
 * Un client non identifié se voit désormais appliquer le minimum le PLUS
 * CONTRAIGNANT parmi ceux configurés : ne pas se nommer ne peut plus être un
 * moyen d'échapper à la règle. Quand aucun minimum n'est configuré — le défaut —
 * rien ne change.
 */
export function minVersionFor(platform: ClientPlatform): string | null {
  const electron = process.env.GF_MIN_ELECTRON_VERSION?.trim() || null
  const pwa = process.env.GF_MIN_PWA_VERSION?.trim() || null
  if (platform === 'electron') return electron
  if (platform === 'pwa') return pwa
  if (!electron) return pwa
  if (!pwa) return electron
  return compareVersions(electron, pwa) >= 0 ? electron : pwa
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
