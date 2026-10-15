export const dynamic = 'force-dynamic'

/**
 * POST /api/sync/mechanic-avatar — propagation POSTE → CLOUD de la photo de
 * profil d'un mécanicien.
 *
 * ─── Pourquoi les octets voyagent, et pas un chemin ─────────────────────────
 * Le poste range la photo sur SON disque et n'en garde qu'une clé de stockage
 * locale. Cette clé ne veut rien dire pour `app.garageflows.fr` ni pour la PWA
 * du mécanicien, qui ont leur propre stockage : transmettre le chemin
 * produirait une image introuvable, et transmettre un chemin Windows serait pire
 * encore. C'est donc l'IMAGE qui est envoyée, et le cloud la range chez lui.
 *
 * ─── Le poste n'est pas cru sur parole ──────────────────────────────────────
 * Il prouve son identité par sa licence GARAGE signée — même mécanisme que
 * `/api/sync/mechanic-assignment` et `/api/sync/mechanic-status` — et le
 * `garageId` de confiance vient de cette licence, jamais du corps de la requête.
 * L'image est REVALIDÉE intégralement à l'arrivée (type réel, structure,
 * dimensions, taille) et ses métadonnées sont re-nettoyées : le cloud ne suppose
 * pas que le poste a bien fait son travail, ni qu'un poste est ce qu'il prétend.
 *
 * ─── Idempotence et ordre ───────────────────────────────────────────────────
 * `hash` permet de ne rien refaire quand la photo n'a pas changé — sans quoi
 * chaque tentative de rattrapage réécrirait un fichier identique et ferait
 * changer l'URL pour rien, invalidant les caches de tout le monde.
 * `updatedAt` protège de l'ordre d'arrivée : une propagation retardée par le
 * réseau ne doit jamais écraser une photo PLUS RÉCENTE déjà reçue.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateGarageLicense, shortId } from '@/lib/sync/garage-auth'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { savePhoto, deletePhoto, photosEnabled } from '@/lib/photo-store'
import { validerAvatar } from '@/lib/mechanics/avatar-image'
import { logger } from '@/lib/logger'

const FAILURE_STATUS: Record<string, number> = {
  MISSING_LICENSE: 400, LICENSE_INVALID: 403, NOT_A_GARAGE_LICENSE: 403,
  LICENSE_UNKNOWN: 403, LICENSE_REVOKED: 403, LICENSE_SUSPENDED: 403,
  LICENSE_EXPIRED: 403, GARAGE_MISMATCH: 403,
  GARAGE_ALREADY_CLAIMED: 409, LICENSE_NOT_BOUND: 409,
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

/** Horodatage fourni par le poste, ou `null` s'il est absent/illisible. */
function horodatage(v: unknown): Date | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function POST(req: Request) {
  const rl = await enforceRateLimit('license_status', clientIpFrom(req))
  if (!rl.ok) return rateLimitResponse(rl)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 }) }

  const garage     = (body.garage as Record<string, unknown>) ?? {}
  const mechanic   = (body.mechanic as Record<string, unknown>) ?? {}
  const garageId   = str(garage.id, 64)
  const mechanicId = str(mechanic.id, 64)
  if (!garageId || !mechanicId) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }

  // 1. Identité du poste — le garageId de CONFIANCE vient de la licence.
  const auth = await authenticateGarageLicense(body.garageLicense, garageId)
  if (!auth.ok) {
    logger.warn('[sync/mechanic-avatar] refus auth', { code: auth.code, garage: shortId(garageId) })
    return NextResponse.json({ ok: false, code: auth.code }, { status: FAILURE_STATUS[auth.code] ?? 403 })
  }

  // 2. Le garage de CONFIANCE est celui auquel la licence est rattachée — jamais
  //    celui annoncé dans le corps.
  //
  //    `authenticateGarageLicense` compare déjà les deux et rend
  //    `GARAGE_MISMATCH` en cas d'écart ; s'appuyer sur ce seul contrôle
  //    reviendrait pourtant à faire dépendre l'isolation d'un helper appelé
  //    ailleurs. La recherche ci-dessous part donc de l'identité prouvée, et
  //    l'écrit noir sur blanc. Une licence pas encore rattachée à un garage est
  //    refusée : envoyer une photo n'est pas une opération qui doit décider à
  //    quel garage un poste appartient.
  const garageDeConfiance = auth.garageId
  if (!garageDeConfiance) {
    return NextResponse.json({ ok: false, code: 'LICENSE_NOT_BOUND' }, { status: 409 })
  }

  // 3. Le mécanicien doit exister côté cloud ET appartenir à CE garage.
  //    Contrairement à l'attribution de clé, on ne crée PAS le miroir ici : une
  //    photo n'est pas une raison suffisante pour faire exister quelqu'un. Si le
  //    mécanicien n'a jamais été miroité (aucune clé attribuée), il n'a pas
  //    d'espace PWA, donc personne pour regarder cette photo.
  const miroir = await prisma.mechanic.findFirst({
    where: { id: mechanicId, garageId: garageDeConfiance },
    select: { id: true, avatarPath: true, avatarHash: true, avatarUpdatedAt: true },
  })
  if (!miroir) {
    return NextResponse.json({ ok: false, code: 'MECHANIC_NOT_MIRRORED' }, { status: 409 })
  }

  const recu = horodatage(body.updatedAt)

  // 4. Ordre d'arrivée : une propagation retardée ne doit pas écraser une photo
  //    plus récente. Sans ce garde, un rattrapage après reconnexion pouvait
  //    remettre l'avant-dernière photo — et l'y laisser.
  if (recu && miroir.avatarUpdatedAt && recu.getTime() < miroir.avatarUpdatedAt.getTime()) {
    return NextResponse.json({ ok: true, skipped: 'STALE', avatarUpdatedAt: miroir.avatarUpdatedAt })
  }

  const image = body.image
  const suppression = image === null

  // ── Suppression ────────────────────────────────────────────────────────────
  if (suppression) {
    if (!miroir.avatarPath) return NextResponse.json({ ok: true, skipped: 'ALREADY_EMPTY' })
    await prisma.mechanic.update({
      where: { id: miroir.id },
      data: { avatarPath: null, avatarMime: null, avatarHash: null, avatarUpdatedAt: recu ?? new Date() },
    })
    deletePhoto(miroir.avatarPath)
    logger.info('[sync/mechanic-avatar] photo retirée', { garage: shortId(garageDeConfiance), mecanicien: shortId(mechanicId) })
    return NextResponse.json({ ok: true, avatarUrl: null })
  }

  // ── Enregistrement ─────────────────────────────────────────────────────────
  const empreinteAnnoncee = str(body.hash, 64)
  // Rien à faire si le cloud a DÉJÀ exactement cette image : réécrire produirait
  // un nouveau nom de fichier, donc une nouvelle URL, et invaliderait pour rien
  // les caches de toutes les surfaces.
  if (empreinteAnnoncee && miroir.avatarHash === empreinteAnnoncee && miroir.avatarPath) {
    return NextResponse.json({ ok: true, skipped: 'UNCHANGED', avatarUrl: `/api/photos/${miroir.avatarPath}` })
  }

  if (!photosEnabled()) {
    return NextResponse.json({ ok: false, code: 'PHOTO_STORAGE_DISABLED' }, { status: 501 })
  }

  // Revalidation COMPLÈTE : le poste a déjà validé, mais rien ne prouve à ce
  // serveur que la requête vient bien du logiciel — seulement qu'elle porte une
  // licence garage valide.
  const valide = validerAvatar(image)
  if (!valide.ok) {
    logger.warn('[sync/mechanic-avatar] image refusée', { garage: shortId(garageDeConfiance), motif: valide.reason })
    return NextResponse.json({ ok: false, code: 'INVALID_IMAGE', reason: valide.reason }, { status: 400 })
  }

  const nettoyee = `data:${valide.mime};base64,${valide.bytes.toString('base64')}`
  const nouveauChemin = savePhoto(nettoyee, `mechanics/${miroir.id}`)
  if (!nouveauChemin) {
    return NextResponse.json({ ok: false, code: 'STORAGE_FAILED' }, { status: 500 })
  }

  const ancienChemin = miroir.avatarPath
  try {
    await prisma.mechanic.update({
      where: { id: miroir.id },
      data: {
        avatarPath:      nouveauChemin,
        avatarMime:      valide.mime,
        // Empreinte du contenu tel que CE serveur l'a nettoyé : c'est elle qui
        // sera comparée aux prochaines propagations.
        avatarHash:      valide.hash,
        avatarUpdatedAt: recu ?? new Date(),
      },
    })
  } catch (err) {
    deletePhoto(nouveauChemin)
    throw err
  }
  if (ancienChemin && ancienChemin !== nouveauChemin) deletePhoto(ancienChemin)

  logger.info('[sync/mechanic-avatar] photo reçue', {
    garage: shortId(garageDeConfiance), mecanicien: shortId(mechanicId), octets: valide.bytes.length,
  })

  return NextResponse.json({ ok: true, avatarUrl: `/api/photos/${nouveauChemin}` })
}
