/**
 * Session MÉCANICIEN — validation serveur centralisée (PWA + Electron).
 *
 * Une clé MECHANIC ne licencie JAMAIS l'application garage : elle ouvre un
 * espace mécanicien strictement restreint (planning et interventions du
 * mécanicien attribué). Ce module revalide, à CHAQUE requête de l'espace
 * mécanicien, toute la chaîne de confiance — aucune valeur envoyée par le
 * client n'est fiable :
 *
 *   1. cookie gf_session valide, signé (jose) ET de type 'mechanic' ;
 *   2. licence en base : existe, type 'mechanic', intègre (recordMac),
 *      active / non expirée / non révoquée / non suspendue ;
 *   3. licence rattachée à un garage (garageId) cohérent avec la session ;
 *   4. attribution : la licence porte un mechanicId, et il correspond à celui
 *      de la session (une réattribution invalide immédiatement l'ancienne) ;
 *   5. licence Garage parente : existe, type garage, active / non expirée ;
 *   6. le mécanicien existe et appartient au même garage ;
 *   7. appareil (did) : existe, actif, appartient à la licence.
 *
 * Contrairement à validateLicensedSession (licence garage, désactivée sous
 * Electron), CE contrôle est TOUJOURS actif — y compris sous Electron : un
 * mécanicien ne doit jamais accéder à des données hors de son périmètre, même
 * en mode local.
 */

import { jwtVerify } from 'jose'
import { prisma } from '@/lib/db'
import { getAuthSecret } from '@/lib/auth-secret'
import { verifyRecordMac } from '@/lib/license/record-mac'

export interface MechanicContext {
  licenseId: string
  deviceId: string | null
  garageId: string
  mechanicId: string
}

export type MechanicFailureCode =
  | 'MECHANIC_SESSION_MISSING'
  | 'MECHANIC_LICENSE_UNKNOWN'
  | 'MECHANIC_LICENSE_TAMPERED'
  | 'MECHANIC_LICENSE_REVOKED'
  | 'MECHANIC_LICENSE_SUSPENDED'
  | 'MECHANIC_LICENSE_EXPIRED'
  | 'MECHANIC_KEY_UNASSIGNED'
  | 'MECHANIC_UNKNOWN'
  | 'PARENT_LICENSE_INVALID'
  | 'MECHANIC_DEVICE_REVOKED'
  | 'MECHANIC_FORBIDDEN'

export type MechanicResult =
  | { ok: true; ctx: MechanicContext }
  | { ok: false; status: number; code: MechanicFailureCode; reason: string }

// Messages NEUTRES : ne jamais révéler l'existence d'un autre garage/mécanicien.
const FAIL: Record<MechanicFailureCode, { status: number; reason: string }> = {
  MECHANIC_SESSION_MISSING:  { status: 401, reason: 'Accès mécanicien requis. Activez votre clé.' },
  MECHANIC_LICENSE_UNKNOWN:  { status: 401, reason: 'Clé mécanicien introuvable. Réactivez votre clé.' },
  MECHANIC_LICENSE_TAMPERED: { status: 403, reason: 'Erreur d\'intégrité. Contactez le support.' },
  MECHANIC_LICENSE_REVOKED:  { status: 403, reason: 'Cette clé mécanicien a été révoquée.' },
  MECHANIC_LICENSE_SUSPENDED:{ status: 403, reason: 'Cette clé mécanicien est temporairement suspendue.' },
  MECHANIC_LICENSE_EXPIRED:  { status: 403, reason: 'Cette clé mécanicien a expiré.' },
  MECHANIC_KEY_UNASSIGNED:   { status: 403, reason: 'Cette clé n\'est pas encore attribuée à un mécanicien. Contactez le responsable du garage.' },
  MECHANIC_UNKNOWN:          { status: 403, reason: 'Accès mécanicien indisponible. Contactez le responsable du garage.' },
  PARENT_LICENSE_INVALID:    { status: 403, reason: 'La licence du garage n\'est plus valide.' },
  MECHANIC_DEVICE_REVOKED:   { status: 403, reason: 'Cet appareil a été révoqué. Réactivez votre clé.' },
  MECHANIC_FORBIDDEN:        { status: 403, reason: 'Action non autorisée.' },
}

function fail(code: MechanicFailureCode): MechanicResult {
  return { ok: false, code, ...FAIL[code] }
}

interface GfMechanicSession {
  lid: string
  did?: string
  gid: string
  mid: string
}

/** Décode et vérifie le cookie gf_session ; n'accepte QUE typ='mechanic'. */
async function readMechanicSession(raw: string): Promise<GfMechanicSession | null> {
  if (!raw) return null
  try {
    const secret = new TextEncoder().encode(getAuthSecret())
    const { payload } = await jwtVerify(raw, secret)
    if (payload.typ !== 'mechanic') return null
    if (typeof payload.lid !== 'string' || typeof payload.gid !== 'string' || typeof payload.mid !== 'string') {
      return null
    }
    return {
      lid: payload.lid,
      gid: payload.gid,
      mid: payload.mid,
      did: typeof payload.did === 'string' ? payload.did : undefined,
    }
  } catch {
    return null
  }
}

/** Types de licence « garage » acceptés comme parent d'une clé mécanicien. */
const GARAGE_TYPES = new Set(['trial', 'premium', 'enterprise', 'admin'])

/**
 * Valide une session mécanicien à partir du cookie gf_session. Ne lève jamais.
 * Le garageId et le mechanicId retournés proviennent EXCLUSIVEMENT de la base,
 * jamais du client.
 */
export async function validateMechanicSession(opts: {
  rawGfSession: string
}): Promise<MechanicResult> {
  const session = await readMechanicSession(opts.rawGfSession)
  if (!session) return fail('MECHANIC_SESSION_MISSING')

  // 2. Licence en base.
  const license = await prisma.licenseKey.findUnique({ where: { licenseId: session.lid } })
  if (!license) return fail('MECHANIC_LICENSE_UNKNOWN')
  if (license.licenseType !== 'mechanic') return fail('MECHANIC_LICENSE_UNKNOWN')

  // Intégrité DB (anti-altération SQLite / base) — inclut mechanicId/parent.
  // Toute clé mécanicien est créée AVEC un recordMac (enregistrement + chaque
  // changement d'attribution/statut le recalculent) : un MAC ABSENT n'est donc
  // jamais légitime ici et est traité comme une altération (sinon un attaquant
  // pouvant écrire en base mettrait recordMac=NULL puis changerait mechanicId
  // pour usurper un autre mécanicien).
  const mac = verifyRecordMac({
    licenseId: license.licenseId,
    token: license.token,
    status: license.status,
    expiryAt: license.expiryAt,
    hwid: license.hwid,
    recordMac: license.recordMac,
    parentLicenseId: license.parentLicenseId,
    mechanicId: license.mechanicId,
  })
  if (mac.tampered || mac.missing) return fail('MECHANIC_LICENSE_TAMPERED')

  if (license.status === 'revoked' || license.revokedAt) return fail('MECHANIC_LICENSE_REVOKED')
  if (license.status === 'suspended') return fail('MECHANIC_LICENSE_SUSPENDED')
  if (license.expiryAt.getTime() < Date.now()) return fail('MECHANIC_LICENSE_EXPIRED')

  // 4. Attribution — la licence DOIT porter un mechanicId, ET il doit
  // correspondre à celui de la session (réattribution ⇒ ancienne session morte).
  if (!license.mechanicId) return fail('MECHANIC_KEY_UNASSIGNED')
  if (license.mechanicId !== session.mid) return fail('MECHANIC_FORBIDDEN')

  // 3. Rattachement au garage — cohérence session/base.
  //    (le garageId de confiance vient de la base.)
  const garageId = license.garageId
  if (!garageId || garageId !== session.gid) return fail('MECHANIC_FORBIDDEN')

  // 5. Licence Garage parente — doit être un garage valide.
  if (!license.parentLicenseId) return fail('PARENT_LICENSE_INVALID')
  const parent = await prisma.licenseKey.findUnique({ where: { licenseId: license.parentLicenseId } })
  if (!parent) return fail('PARENT_LICENSE_INVALID')
  if (!GARAGE_TYPES.has(parent.licenseType)) return fail('PARENT_LICENSE_INVALID')
  if (parent.status !== 'active' || parent.revokedAt) return fail('PARENT_LICENSE_INVALID')
  if (parent.expiryAt.getTime() < Date.now()) return fail('PARENT_LICENSE_INVALID')
  // Le parent doit être rattaché au même garage (défense en profondeur).
  if (parent.garageId && parent.garageId !== garageId) return fail('PARENT_LICENSE_INVALID')

  // 6. Le mécanicien existe et appartient au garage.
  const mechanic = await prisma.mechanic.findFirst({
    where: { id: license.mechanicId, garageId },
    select: { id: true },
  })
  if (!mechanic) return fail('MECHANIC_UNKNOWN')

  // 7. Appareil (device auth). Sous serveur/PWA, un appareil actif est requis ;
  // sous Electron, l'appareil local peut être absent (mono-poste) — on tolère
  // l'absence de did MAIS, si un did est présent, il doit être valide.
  const isElectron = process.env.ELECTRON === '1'
  if (session.did) {
    const device = await prisma.licenseDevice.findUnique({ where: { deviceId: session.did } })
    if (!device || device.licenseId !== license.licenseId) return fail('MECHANIC_DEVICE_REVOKED')
    if (device.status !== 'active') return fail('MECHANIC_DEVICE_REVOKED')
  } else if (!isElectron) {
    return fail('MECHANIC_DEVICE_REVOKED')
  }

  return {
    ok: true,
    ctx: { licenseId: license.licenseId, deviceId: session.did ?? null, garageId, mechanicId: license.mechanicId },
  }
}
