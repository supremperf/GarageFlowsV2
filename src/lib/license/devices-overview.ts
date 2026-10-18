/** Transport client : absence de contexte ≠ panne ≠ liste vide. Aucun détail serveur reflété. */
export interface LicenseDeviceOverview {
  seats: number
  activeCount: number
  devices: Array<{
    deviceId: string
    status: string
    name: string | null
    platform: string | null
    lastSeenAt: string | null
  }>
}
const unavailable = () => new Error('Liste des postes indisponible. Réessayez plus tard.')
export async function loadLicenseDeviceOverview(fetcher: typeof fetch = fetch): Promise<LicenseDeviceOverview | null> {
  let response: Response
  try { response = await fetcher('/api/license/devices', { cache: 'no-store' }) } catch { throw unavailable() }
  if (response.status === 401 || response.status === 404) return null
  const d = await response.json().catch(() => null)
  if (!response.ok || d?.ok !== true || !Number.isSafeInteger(d.seats) || d.seats < 0 ||
      !Number.isSafeInteger(d.activeCount) || d.activeCount < 0 || !Array.isArray(d.devices) ||
      !d.devices.every((p: unknown) => {
        if (!p || typeof p !== 'object') return false
        const row = p as Record<string, unknown>
        return typeof row.deviceId === 'string' && typeof row.status === 'string' &&
          ['name', 'platform', 'lastSeenAt'].every(k => row[k] === null || typeof row[k] === 'string')
      })) throw unavailable()
  return { seats: d.seats, activeCount: d.activeCount, devices: d.devices }
}
