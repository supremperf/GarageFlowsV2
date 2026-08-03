'use client'

import { useEffect, useState } from 'react'

/**
 * Réagit à une media-query CSS et renvoie son état courant.
 *
 * SSR-safe : renvoie `false` au premier rendu serveur puis se synchronise côté
 * client dès le montage (et à chaque changement de taille/orientation). On évite
 * ainsi de calculer la mise en page à la main en JS quand une simple media-query
 * suffit — le JS ne sert qu'à basculer une *logique* d'affichage (ex. planning
 * mono-mécanicien) qui ne peut pas être exprimée en pur CSS.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    // addEventListener('change') : API moderne ; fallback addListener pour Safari ancien.
    if (mql.addEventListener) mql.addEventListener('change', onChange)
    else mql.addListener(onChange)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange)
      else mql.removeListener(onChange)
    }
  }, [query])

  return matches
}

// Points de rupture alignés sur tailwind.config.ts (source unique de vérité).
export const BP = {
  xs: 480,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const

/** < md (768px) : téléphones portrait + petits paysages → nav mobile. */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${BP.md - 1}px)`)
}

/** < lg (1024px) : l'assistant IA n'est plus une colonne permanente. */
export function useIsBelowLg(): boolean {
  return useMediaQuery(`(max-width: ${BP.lg - 1}px)`)
}

/** Paysage court (téléphone à l'horizontale) : chrome densifié. */
export function useIsShortLandscape(): boolean {
  return useMediaQuery('(orientation: landscape) and (max-height: 500px)')
}
