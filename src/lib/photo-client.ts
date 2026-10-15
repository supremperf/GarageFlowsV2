/**
 * Réduction d'une photo AVANT envoi — côté navigateur (GF-038).
 *
 * ─── Pourquoi un seul endroit ───────────────────────────────────────────────
 * Trois écrans réduisaient déjà la photo choisie, chacun avec sa propre copie
 * du même passage par un `<canvas>` (800 px / JPEG 0,82 ; 600 px / JPEG 0,8).
 * Le quatrième — la PWA du mécanicien, celle qui prend le plus de photos — ne
 * réduisait rien : `readAsDataURL` envoyait le fichier de l'appareil tel quel.
 *
 * Trois conséquences, toutes réelles :
 *   · un cliché de smartphone récent dépasse la borne de dépôt et se fait
 *     refuser « Photo trop volumineuse », sans que rien n'indique quoi faire ;
 *   · celles qui passent partent ENTIÈRES vers le cloud, puis sont recopiées
 *     entières sur le poste, puis gonflent l'instantané portail au point de le
 *     faire refuser en bloc (GF-034) ;
 *   · le HEIC des sélecteurs Android traversait la validation (qui le
 *     reconnaît) mais pas le stockage fichier (dont la liste blanche l'ignore),
 *     et finissait en vignette cassée hors Safari.
 *
 * Le ré-encodage en JPEG règle les trois d'un coup : ce que le navigateur sait
 * décoder, il sait le ré-encoder — HEIC compris quand la plateforme le décode.
 */

/** Côté le plus long, en pixels. Au-delà, rien de visible ne se gagne. */
export const COTE_MAX_PAR_DEFAUT = 1200

/** Qualité JPEG : au-dessus, le poids double sans gain perceptible. */
export const QUALITE_PAR_DEFAUT = 0.8

export interface OptionsReduction {
  coteMax?: number
  qualite?: number
}

/**
 * Rend une data-URL JPEG réduite.
 *
 * En cas d'échec du décodage — format que le navigateur ne sait pas ouvrir,
 * fichier corrompu — on REJETTE plutôt que de renvoyer l'original : laisser
 * passer l'original reproduirait exactement le défaut que cette fonction
 * existe pour corriger, et l'appelant doit pouvoir le dire à l'utilisateur.
 */
export function reduirePhoto(fichier: File, options: OptionsReduction = {}): Promise<string> {
  const coteMax = options.coteMax ?? COTE_MAX_PAR_DEFAUT
  const qualite = options.qualite ?? QUALITE_PAR_DEFAUT

  return new Promise<string>((resolve, reject) => {
    const lecteur = new FileReader()
    lecteur.onerror = () => reject(new Error('Lecture du fichier impossible'))
    lecteur.onload = (ev) => {
      const image = new Image()
      image.onerror = () => reject(new Error('Format d’image non pris en charge par ce navigateur'))
      image.onload = () => {
        let { width, height } = image
        if (width > coteMax || height > coteMax) {
          if (width > height) { height = Math.round((height * coteMax) / width); width = coteMax }
          else { width = Math.round((width * coteMax) / height); height = coteMax }
        }
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, width)
        canvas.height = Math.max(1, height)
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('Rendu image indisponible')); return }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', qualite))
      }
      image.src = ev.target?.result as string
    }
    lecteur.readAsDataURL(fichier)
  })
}

/** Poids DÉCODÉ d'une data-URL, en octets — ce que borne le serveur. */
export function octetsDecodes(dataUrl: string): number {
  const virgule = dataUrl.indexOf(',')
  const corps = virgule >= 0 ? dataUrl.slice(virgule + 1) : dataUrl
  const remplissage = corps.endsWith('==') ? 2 : corps.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((corps.length * 3) / 4) - remplissage)
}
