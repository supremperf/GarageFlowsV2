'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { texteAvatar, texteAlternatifAvatar } from '@/lib/planning/avatar'

/**
 * Avatar d'un mécanicien : sa photo si elle existe, ses initiales sinon.
 *
 * Trois exigences tiennent ensemble ici :
 *  - une photo cassée ne doit JAMAIS produire l'icône d'image brisée du
 *    navigateur : `onError` bascule sur le repli, immédiatement (§57) ;
 *  - le repli doit rester lisible — deux caractères au plus, jamais un ancien
 *    libellé de position (`M1`, `M2`), qui n'a jamais été une identité ;
 *  - l'image porte un texte alternatif qui nomme la PERSONNE, pas « avatar ».
 */
export interface MechanicAvatarProps {
  mechanic: {
    name?: string | null
    avatar?: string | null
    color?: string | null
    photoUrl?: string | null
    isAbsent?: boolean
  }
  /** Diamètre en pixels. Le planning utilise 28–36 px. */
  size?: number
  className?: string
}

export default function MechanicAvatar({ mechanic, size = 28, className }: MechanicAvatarProps) {
  const [echecImage, setEchecImage] = useState(false)

  // Une nouvelle photo doit pouvoir réussir après l'échec de la précédente :
  // sans cette remise à zéro, remplacer une image cassée laissait le repli
  // affiché jusqu'au prochain montage du composant.
  useEffect(() => { setEchecImage(false) }, [mechanic.photoUrl])

  const photo = mechanic.photoUrl && !echecImage ? mechanic.photoUrl : null
  const initiales = texteAvatar(mechanic)

  return (
    <span
      className={cn(
        'rounded-full flex items-center justify-center text-white font-bold flex-shrink-0 overflow-hidden transition-all',
        mechanic.isAbsent && 'opacity-40 grayscale',
        className,
      )}
      style={{
        width: size,
        height: size,
        // La couleur reste visible derrière une photo au chargement : pas de
        // trou blanc pendant le premier rendu.
        backgroundColor: mechanic.color ?? '#475569',
        fontSize: Math.max(9, Math.round(size * 0.38)),
      }}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt={texteAlternatifAvatar(mechanic.name)}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setEchecImage(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <span aria-hidden="true">{initiales}</span>
      )}
    </span>
  )
}
