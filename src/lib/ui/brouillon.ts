'use client'

/**
 * Brouillons de saisie conservés d'une page à l'autre (GF-DUR-053).
 *
 * ─── Le problème que ce module résout ────────────────────────────────────────
 *
 * L'application n'affiche plus qu'une seule PAGE à la fois : ouvrir « Clients »
 * remplace « Réception ». C'est ce que demande le comptoir — deux écrans
 * empilés, c'était deux fonds sombres superposés et des clics qui partaient au
 * mauvais endroit.
 *
 * Mais le remplacement DÉMONTE la page précédente, et React jette alors l'état
 * de ses composants. Sans ce module, une fiche client à moitié corrigée, une
 * réponse en cours de rédaction ou un scan OCR non encore appliqué partaient en
 * fumée au premier aller-retour vers le planning : exactement le genre de perte
 * silencieuse contre laquelle les règles de travail du projet mettent en garde.
 *
 * ─── Ce que c'est, et ce que ce n'est pas ────────────────────────────────────
 *
 * Une carte en mémoire, par clé, valable le temps de la session. RIEN n'est
 * écrit sur disque, rien n'est envoyé au serveur, rien n'est repris au
 * démarrage suivant : un brouillon n'est pas un enregistrement, et le faire
 * survivre à un redémarrage laisserait croire à un enregistrement qui n'a pas eu
 * lieu. Seule l'écriture explicite (le bouton Enregistrer) persiste quoi que ce
 * soit.
 *
 * ─── Abandon volontaire ──────────────────────────────────────────────────────
 *
 * Fermer une page par ✕ ou Échap est un ABANDON : l'appelant efface alors les
 * clés de la page (`viderBrouillons('clients:')`). Changer de page, au
 * contraire, ne touche à rien : le brouillon attend, intact, et revient à la
 * réouverture.
 */

import { useCallback, useEffect, useState } from 'react'

/** Clé → valeur saisie mais non enregistrée. */
const brouillons = new Map<string, unknown>()

/** Un brouillon « vide » ne mérite ni persistance ni signalement. */
export function brouillonVide(valeur: unknown): boolean {
  if (valeur === null || valeur === undefined) return true
  if (typeof valeur === 'string') return valeur.trim() === ''
  if (Array.isArray(valeur)) return valeur.length === 0
  if (typeof valeur === 'object') {
    const valeurs = Object.values(valeur as Record<string, unknown>)
    return valeurs.every(brouillonVide)
  }
  if (typeof valeur === 'number' || typeof valeur === 'boolean') return false
  return false
}

export function lireBrouillon<T>(cle: string): T | undefined {
  return brouillons.get(cle) as T | undefined
}

export function ecrireBrouillon(cle: string, valeur: unknown): void {
  if (brouillonVide(valeur)) brouillons.delete(cle)
  else brouillons.set(cle, valeur)
}

export function effacerBrouillon(cle: string): void {
  brouillons.delete(cle)
}

/** Efface tous les brouillons dont la clé commence par ce préfixe. */
export function viderBrouillons(prefixe: string): void {
  for (const cle of Array.from(brouillons.keys())) {
    if (cle.startsWith(prefixe)) brouillons.delete(cle)
  }
}

/** Clés des brouillons non vides — pour signaler au comptoir ce qui attend. */
export function clesBrouillons(): string[] {
  return Array.from(brouillons.keys())
}

/**
 * État de saisie conservé entre deux ouvertures de la même page.
 *
 * Se comporte exactement comme `useState`, avec deux différences voulues :
 *   • la valeur initiale est REMPLACÉE par le brouillon mémorisé s'il existe ;
 *   • chaque écriture est mémorisée, y compris après le démontage.
 *
 * `initial` doit être stable (constante de module ou objet littéral recréé à
 * l'identique) : comme pour `useState`, la valeur initiale n'est lue qu'au
 * premier rendu.
 */
export function useBrouillonPersistant<T>(
  cle: string,
  initial: T,
): readonly [T, (valeur: T | ((precedent: T) => T)) => void] {
  const [valeur, setValeur] = useState<T>(() => {
    const memorise = lireBrouillon<T>(cle)
    return memorise === undefined ? initial : memorise
  })

  const definir = useCallback((valeurSuivante: T | ((precedent: T) => T)) => {
    setValeur((precedent) => {
      const suivante = typeof valeurSuivante === 'function'
        ? (valeurSuivante as (precedent: T) => T)(precedent)
        : valeurSuivante
      ecrireBrouillon(cle, suivante)
      return suivante
    })
  }, [cle])

  // La clé peut changer sans démontage (ex. « fiche du client A » → « fiche du
  // client B ») : on reprend alors le brouillon DE CETTE CLÉ, jamais celui de la
  // précédente.
  useEffect(() => {
    const memorise = lireBrouillon<T>(cle)
    setValeur(memorise === undefined ? initial : memorise)
    // `initial` est volontairement hors dépendances : il change d'identité à
    // chaque rendu dans la plupart des appelants, ce qui relancerait l'effet en
    // boucle et écraserait la saisie en cours.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle])

  return [valeur, definir] as const
}
