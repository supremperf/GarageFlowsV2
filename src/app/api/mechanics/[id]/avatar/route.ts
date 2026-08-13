export const dynamic = 'force-dynamic'

/**
 * Photo de profil du mécanicien.
 *
 *   PUT    /api/mechanics/:id/avatar   { image: "data:image/…;base64,…" }
 *   DELETE /api/mechanics/:id/avatar
 *
 * ─── Ce qui est garanti ici ─────────────────────────────────────────────────
 *  - Le garage vient de la SESSION, jamais du corps de la requête. Un `garageId`
 *    envoyé par l'appelant est purement et simplement ignoré.
 *  - Le mécanicien doit appartenir à ce garage : `findFirst({ id, garageId })`,
 *    jamais `findUnique({ id })`. Le Garage A qui vise un mécanicien du Garage B
 *    reçoit un 404 — la même réponse que pour un identifiant inexistant, pour ne
 *    pas confirmer l'existence de la ressource.
 *  - Le contenu est validé côté serveur (octets magiques, structure, dimensions,
 *    taille) et ses métadonnées — EXIF, position GPS — sont retirées avant
 *    écriture. Voir `src/lib/mechanics/avatar-image.ts`.
 *  - Le nom du fichier est GÉNÉRÉ par le serveur (`savePhoto`) : aucun nom fourni
 *    par le client ne touche le système de fichiers.
 *
 * ─── Invalidation de cache ──────────────────────────────────────────────────
 * Chaque enregistrement produit un nom de fichier neuf et aléatoire, donc une
 * URL neuve. Remplacer une photo change l'URL : ni le navigateur, ni le service
 * worker, ni un cache intermédiaire ne peuvent servir l'ancienne. C'est ce qui
 * autorise `Cache-Control: immutable` sur la route de service.
 *
 * ─── Ordre des opérations ───────────────────────────────────────────────────
 * Écriture du fichier PUIS mise à jour de la base, et l'ancien fichier n'est
 * supprimé qu'APRÈS que la base pointe sur le nouveau. Si l'écriture du fichier
 * échoue, la base n'est pas touchée (pas de `avatarPath` pointant dans le vide) ;
 * si la mise à jour de la base échoue, le fichier neuf est retiré (pas de
 * fichier orphelin). Il n'existe donc aucun instant où la fiche annonce une
 * photo absente.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'
import { savePhoto, deletePhoto, photosEnabled } from '@/lib/photo-store'
import { validerAvatar } from '@/lib/mechanics/avatar-image'
import { pushMechanicAvatar } from '@/lib/sync/mechanic-avatar-sync'

/** Rôles autorisés à modifier la photo d'un mécanicien. */
const ROLES_GESTION = new Set(['OWNER', 'MANAGER'])

export const PUT = withAuth(async (req: Request, { params }: { params: { id: string } }) => {
  const session = await requireSession()

  if (!ROLES_GESTION.has(session.user.role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  if (!photosEnabled()) {
    // Refus EXPLICITE plutôt qu'un faux succès : sans stockage configuré, la
    // photo n'irait nulle part et la fiche annoncerait une image inexistante.
    return NextResponse.json(
      { error: 'Le stockage des photos n’est pas configuré sur ce poste.', code: 'PHOTO_STORAGE_DISABLED' },
      { status: 501 },
    )
  }

  // Appartenance AVANT tout traitement : inutile de valider une image pour un
  // mécanicien qui n'est pas celui du garage de la session.
  const mecanicien = await prisma.mechanic.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    select: { id: true, avatarPath: true, archivedAt: true },
  })
  if (!mecanicien) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  let corps: { image?: unknown }
  try {
    corps = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
  }

  const valide = validerAvatar(corps.image)
  if (!valide.ok) {
    return NextResponse.json({ error: valide.reason, code: 'INVALID_IMAGE' }, { status: 400 })
  }

  // Réécriture en data URL à partir des octets NETTOYÉS : ce sont eux qui sont
  // écrits sur disque, jamais l'entrée brute reçue du client.
  const nettoyee = `data:${valide.mime};base64,${valide.bytes.toString('base64')}`
  const nouveauChemin = savePhoto(nettoyee, `mechanics/${mecanicien.id}`)
  if (!nouveauChemin) {
    return NextResponse.json({ error: 'Enregistrement de la photo impossible.' }, { status: 500 })
  }

  const ancienChemin = mecanicien.avatarPath
  let miseAJour
  try {
    miseAJour = await prisma.mechanic.update({
      where: { id: mecanicien.id },
      data: {
        avatarPath:      nouveauChemin,
        avatarMime:      valide.mime,
        avatarHash:      valide.hash,
        avatarUpdatedAt: new Date(),
      },
    })
  } catch (err) {
    // La base n'a pas pris la nouvelle photo : on retire le fichier qu'on vient
    // d'écrire, sinon il resterait orphelin sur le disque pour toujours.
    deletePhoto(nouveauChemin)
    throw err
  }

  // L'ancien fichier n'est retiré qu'une fois la base sur le nouveau : aucun
  // instant pendant lequel la fiche pointerait vers un fichier déjà supprimé.
  if (ancienChemin && ancienChemin !== nouveauChemin) deletePhoto(ancienChemin)

  await logAudit({
    action: 'update', entityType: 'Mechanic', entityId: mecanicien.id, session, req,
    details: { extra: { avatar: 'set', mime: valide.mime, width: valide.width, height: valide.height } },
  })

  // Propagation vers le cloud : sans elle, la photo resterait sur le disque de
  // CE poste et le mécanicien continuerait de voir ses initiales sur
  // app.garageflows.fr comme dans sa PWA. Best-effort — une panne réseau ne doit
  // pas défaire un enregistrement local réussi — mais l'issue est RENDUE pour
  // que l'interface puisse dire la vérité au lieu d'annoncer un succès global.
  const sync = await pushMechanicAvatar(mecanicien.id)

  return NextResponse.json({
    id:              miseAJour.id,
    avatarUrl:       `/api/photos/${nouveauChemin}`,
    avatarUpdatedAt: miseAJour.avatarUpdatedAt,
    cloudSynced:     sync.synced,
    ...(sync.synced ? {} : { cloudSyncCode: sync.code ?? 'UNKNOWN' }),
  })
})

export const DELETE = withAuth(async (req: Request, { params }: { params: { id: string } }) => {
  const session = await requireSession()

  if (!ROLES_GESTION.has(session.user.role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const mecanicien = await prisma.mechanic.findFirst({
    where: { id: params.id, garageId: session.user.garageId },
    select: { id: true, avatarPath: true },
  })
  if (!mecanicien) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  // Idempotent : supprimer une photo déjà absente n'est pas une erreur.
  if (!mecanicien.avatarPath) return NextResponse.json({ id: mecanicien.id, avatarUrl: null })

  // La base d'abord : si le retrait du fichier échoue, la fiche est déjà revenue
  // aux initiales — l'inverse laisserait une fiche pointant vers un fichier
  // effacé, donc un avatar cassé.
  await prisma.mechanic.update({
    where: { id: mecanicien.id },
    data: { avatarPath: null, avatarMime: null, avatarHash: null, avatarUpdatedAt: new Date() },
  })
  deletePhoto(mecanicien.avatarPath)

  await logAudit({
    action: 'update', entityType: 'Mechanic', entityId: mecanicien.id, session, req,
    details: { extra: { avatar: 'removed' } },
  })

  // Le RETRAIT se propage aussi : synchroniser l'ajout sans synchroniser la
  // suppression laisserait l'ancienne photo visible sur les autres surfaces —
  // exactement le défaut que `pushMechanicStatus` corrige pour les licences.
  const sync = await pushMechanicAvatar(mecanicien.id, true)

  return NextResponse.json({
    id: mecanicien.id,
    avatarUrl: null,
    cloudSynced: sync.synced,
    ...(sync.synced ? {} : { cloudSyncCode: sync.code ?? 'UNKNOWN' }),
  })
})
