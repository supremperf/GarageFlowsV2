'use client'

/**
 * Bornes de la grille du planning, partagées par tous ses sous-composants.
 *
 * Elles étaient des CONSTANTES DE MODULE (`BOARD_START`, `BOARD_END`, calculées
 * au chargement depuis `WORKSHOP_START_HOUR` / `WORKSHOP_END_HOUR`) : la grille
 * ne pouvait donc pas dépendre du garage. Un contexte plutôt qu'une cascade de
 * propriétés — la colonne déposable, l'indicateur d'heure courante et l'échelle
 * horaire en ont tous besoin, à trois profondeurs différentes.
 */
import { createContext, useContext } from 'react'
import { DEBUT_PAR_DEFAUT, FIN_PAR_DEFAUT } from './horaires'

export interface BornesPlanning {
  /** Minutes depuis minuit — début de la grille. */
  debut: number
  /** Minutes depuis minuit — fin de la grille. */
  fin: number
}

const Contexte = createContext<BornesPlanning>({ debut: DEBUT_PAR_DEFAUT, fin: FIN_PAR_DEFAUT })

export const FournisseurBornes = Contexte.Provider

/** Bornes courantes ; repli 8 h – 18 h hors de tout fournisseur. */
export function useBornesPlanning(): BornesPlanning {
  return useContext(Contexte)
}
