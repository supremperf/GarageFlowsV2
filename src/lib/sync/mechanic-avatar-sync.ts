/**
 * Propagation POSTE → CLOUD de la photo de profil d'un mécanicien.
 *
 * Contrepartie de `pushMechanicAssignment` : sans elle, la photo ajoutée par le
 * patron sur son poste resterait sur le disque de ce poste, et le mécanicien
 * continuerait de voir ses initiales sur `app.garageflows.fr` comme dans sa PWA.
 *
 * Best-effort et borné dans le temps, comme les autres propagations : une panne
 * réseau ne doit jamais faire échouer l'enregistrement LOCAL de la photo. Mais
 * l'issue est RENDUE à l'appelant, pour que l'interface puisse dire
 * « enregistrée · synchronisation en attente » au lieu d'annoncer un succès
 * global qui n'a pas eu lieu.
 *
 * Ne lève jamais.
 */
import { prisma } from '@/lib/db'
import { cloudPost, isDesktopInstance } from '@/lib/sync/cloud-client'
import { readPhotoAsDataUrl } from '@/lib/photo-store'
import { AVATAR_MAX_BYTES } from '@/lib/mechanics/avatar-image'
import { shortId } from '@/lib/sync/garage-auth'
import { logger } from '@/lib/logger'

export interface AvatarSyncResult {
  synced: boolean
  /** Vrai quand il n'y avait rien à faire (instance cloud, ou photo déjà à jour). */
  skipped?: boolean
  code?: string
}

/** Licence GARAGE active du garage — celle qui prouve l'identité du poste. */
async function licenceGarage(garageId: string): Promise<string | null> {
  const licence = await prisma.licenseKey.findFirst({
    where: { garageId, status: 'active', licenseType: { not: 'mechanic' } },
    select: { token: true },
    orderBy: { createdAt: 'desc' },
  })
  return licence?.token ?? null
}

/**
 * Pousse la photo (ou son retrait) vers le cloud.
 *
 * @param mechanicId mécanicien concerné
 * @param supprimee  true quand la photo vient d'être RETIRÉE localement
 */
export async function pushMechanicAvatar(mechanicId: string, supprimee = false): Promise<AvatarSyncResult> {
  // Sur le cloud lui-même, la base EST la source de vérité : rien à remonter.
  if (!isDesktopInstance()) return { synced: true, skipped: true }

  try {
    const mechanic = await prisma.mechanic.findUnique({
      where: { id: mechanicId },
      select: { id: true, name: true, garageId: true, avatarPath: true, avatarHash: true, avatarUpdatedAt: true },
    })
    if (!mechanic) return { synced: false, code: 'LOCAL_DATA_MISSING' }

    const [garage, token] = await Promise.all([
      prisma.garage.findUnique({ where: { id: mechanic.garageId }, select: { id: true, name: true } }),
      licenceGarage(mechanic.garageId),
    ])
    if (!garage) return { synced: false, code: 'LOCAL_DATA_MISSING' }
    // Un poste sans licence garage active ne peut rien prouver au cloud. Ce n'est
    // pas une erreur d'exécution : c'est un poste qui n'est pas (encore) rattaché.
    if (!token) return { synced: false, code: 'NO_GARAGE_LICENSE' }

    let image: string | null = null
    if (!supprimee) {
      if (!mechanic.avatarPath) return { synced: false, code: 'LOCAL_DATA_MISSING' }
      // Relecture depuis le DISQUE : ce sont les octets réellement stockés qui
      // partent, pas une valeur reconstruite de mémoire qui pourrait diverger.
      image = readPhotoAsDataUrl(mechanic.avatarPath, AVATAR_MAX_BYTES)
      if (!image) return { synced: false, code: 'LOCAL_FILE_UNREADABLE' }
    }

    const out = await cloudPost('/api/sync/mechanic-avatar', {
      garageLicense: token,
      garage:   { id: garage.id, name: garage.name },
      mechanic: { id: mechanic.id, name: mechanic.name },
      image,
      // Empreinte : permet au cloud de ne rien refaire si l'image est identique.
      hash: supprimee ? null : mechanic.avatarHash,
      // Horodatage : protège d'un rattrapage tardif qui écraserait une photo
      // plus récente déjà reçue par le cloud.
      updatedAt: (mechanic.avatarUpdatedAt ?? new Date()).toISOString(),
    }, 20_000) // une image pèse plus qu'un statut : délai plus large

    if (out.ok) {
      logger.info('[sync/avatar:push] confirmée', {
        mecanicien: shortId(mechanic.id), garage: shortId(garage.id),
        action: supprimee ? 'suppression' : 'envoi',
        ignore: typeof out.data?.skipped === 'string' ? out.data.skipped : undefined,
      })
      return { synced: true, skipped: typeof out.data?.skipped === 'string' }
    }

    logger.warn('[sync/avatar:push] non confirmée', {
      mecanicien: shortId(mechanic.id), code: out.code ?? 'UNKNOWN', status: out.status ?? 0,
    })
    return { synced: false, code: out.code ?? 'UNKNOWN' }
  } catch (err) {
    logger.warn('[sync/avatar:push] erreur', { mecanicien: shortId(mechanicId), message: (err as Error)?.message })
    return { synced: false, code: 'LOCAL_ERROR' }
  }
}
