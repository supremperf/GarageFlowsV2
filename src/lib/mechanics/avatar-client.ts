/**
 * Préparation de la photo de profil côté NAVIGATEUR.
 *
 * ─── Pourquoi ce traitement a lieu ici ──────────────────────────────────────
 * `sharp` n'est qu'une dépendance de développement du projet ; l'employer dans
 * le chemin d'exécution du serveur ajouterait un binaire natif au bundle
 * Electron comme au déploiement cloud. Le redimensionnement se fait donc sur un
 * canvas, dans le navigateur — ce qui a trois effets utiles :
 *
 *  1. l'orientation EXIF est APPLIQUÉE au décodage (`imageOrientation:
 *     'from-image'`), donc une photo prise en portrait au téléphone n'arrive
 *     plus couchée ;
 *  2. le ré-encodage fait disparaître TOUTES les métadonnées par construction —
 *     y compris la position GPS — puisqu'on ré-écrit des pixels, pas un fichier ;
 *  3. ce qui part sur le réseau est une vignette de quelques kilo-octets et non
 *     une photo de douze mégapixels.
 *
 * ─── Ce que cela ne remplace PAS ────────────────────────────────────────────
 * Rien de ceci n'est une garantie de SÉCURITÉ : tout se passe chez l'appelant,
 * qui peut poster ce qu'il veut directement à l'API. Le serveur revalide donc
 * intégralement — type réel, structure, dimensions, taille — et re-nettoie le
 * JPEG (voir `avatar-image.ts`). Le client optimise ; le serveur décide.
 */

import { AVATAR_MAX_BYTES, AVATAR_THUMBNAIL_SIZE } from './avatar-image'

/** Types que l'utilisateur peut choisir dans le sélecteur de fichier. */
export const AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp'

/** Plafond du fichier CHOISI, avant optimisation. */
export const AVATAR_SOURCE_MAX_BYTES = 20 * 1024 * 1024

export interface CadreCarre {
  /** Origine du carré découpé dans l'image source. */
  sx: number
  sy: number
  /** Côté du carré découpé, en pixels sources. */
  taille: number
  /** Côté de la vignette produite. */
  cible: number
}

/**
 * Calcule le carré CENTRÉ à découper dans une image quelconque — c'est la
 * sémantique de `object-fit: cover`, appliquée une fois pour toutes à
 * l'enregistrement plutôt qu'à chaque affichage.
 *
 * La vignette n'est jamais AGRANDIE : une photo de 100 × 100 donne une vignette
 * de 100 × 100, pas une bouillie interpolée de 256 × 256.
 *
 * Fonction pure, donc éprouvable sans navigateur.
 */
export function cadreCarre(largeur: number, hauteur: number, cible = AVATAR_THUMBNAIL_SIZE): CadreCarre {
  const taille = Math.max(1, Math.min(largeur, hauteur))
  return {
    sx: Math.max(0, Math.round((largeur - taille) / 2)),
    sy: Math.max(0, Math.round((hauteur - taille) / 2)),
    taille,
    cible: Math.max(1, Math.min(cible, taille)),
  }
}

export type PreparationAvatar =
  | { ok: true; dataUrl: string; largeur: number; hauteur: number; octets: number }
  | { ok: false; reason: string }

/** Décode le fichier en appliquant l'orientation EXIF quand le navigateur le sait. */
async function decoder(fichier: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(fichier, { imageOrientation: 'from-image' })
    } catch {
      // Certains navigateurs refusent l'option : on retombe sur <img>, qui
      // applique aussi l'orientation depuis quelques années.
    }
  }
  const url = URL.createObjectURL(fichier)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('decode'))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Prépare un fichier choisi par l'utilisateur : décodage, recadrage carré
 * centré, réduction, ré-encodage.
 *
 * Le format de sortie est JPEG : universellement lisible, et bien plus compact
 * que PNG pour une photographie. Une photo de profil n'a pas besoin de
 * transparence.
 */
export async function preparerAvatar(fichier: File): Promise<PreparationAvatar> {
  if (!fichier) return { ok: false, reason: 'Aucun fichier sélectionné.' }

  // Contrôles IMMÉDIATS : inutile de décoder 40 Mo pour dire non. Le serveur
  // refera les siens de toute façon.
  if (!AVATAR_ACCEPT.split(',').includes(fichier.type)) {
    return { ok: false, reason: 'Format non pris en charge : choisissez une image JPEG, PNG ou WebP.' }
  }
  if (fichier.size > AVATAR_SOURCE_MAX_BYTES) {
    return { ok: false, reason: `Fichier trop volumineux (maximum ${Math.round(AVATAR_SOURCE_MAX_BYTES / 1024 / 1024)} Mo).` }
  }
  if (fichier.size === 0) return { ok: false, reason: 'Fichier vide.' }

  let source: ImageBitmap | HTMLImageElement
  try {
    source = await decoder(fichier)
  } catch {
    // Le fichier porte peut-être la bonne extension, mais il n'est pas décodable.
    return { ok: false, reason: 'Image illisible ou corrompue.' }
  }

  const largeur = 'width' in source ? source.width : 0
  const hauteur = 'height' in source ? source.height : 0
  if (!largeur || !hauteur) return { ok: false, reason: 'Image illisible ou corrompue.' }

  const cadre = cadreCarre(largeur, hauteur)
  const canvas = document.createElement('canvas')
  canvas.width = cadre.cible
  canvas.height = cadre.cible
  const ctx = canvas.getContext('2d')
  if (!ctx) return { ok: false, reason: 'Traitement de l’image impossible sur cet appareil.' }

  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    source as CanvasImageSource,
    cadre.sx, cadre.sy, cadre.taille, cadre.taille,
    0, 0, cadre.cible, cadre.cible,
  )
  if ('close' in source && typeof source.close === 'function') source.close()

  const dataUrl = canvas.toDataURL('image/jpeg', 0.86)
  // Longueur du base64 → octets réels.
  const octets = Math.floor((dataUrl.length - (dataUrl.indexOf(',') + 1)) * 0.75)
  if (octets > AVATAR_MAX_BYTES) {
    return { ok: false, reason: 'Image trop volumineuse même après optimisation.' }
  }

  return { ok: true, dataUrl, largeur: cadre.cible, hauteur: cadre.cible, octets }
}
