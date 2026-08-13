/**
 * Fenêtre de mécaniciens visibles dans le planning — pure et testable.
 *
 * ─── Le défaut corrigé (GF-PLAN-001, P0) ────────────────────────────────────
 * `ScheduleBoard` rendait TOUS les mécaniciens du garage, chacun dans une
 * colonne `flex-1 min-w-0` :
 *
 *     const visibleMechanics = isMobile && selectedMechanic ? [selectedMechanic] : mechanics
 *
 * Il n'y avait donc pas de limite codée en dur à supprimer — c'était le
 * contraire : aucune limite du tout. À 10 mécaniciens les colonnes tombent sous
 * 180 px, à 20 sous 90 px, à 50 sous 40 px : ni le nom, ni l'heure, ni une carte
 * d'intervention n'y tiennent, et le planning devient inutilisable bien avant
 * d'atteindre une limite technique. Le produit était donc de fait limité à
 * quatre ou cinq mécaniciens, sans que rien ne le dise.
 *
 * Le mobile avait déjà une fenêtre (un mécanicien à la fois) avec ses flèches ;
 * le desktop n'en avait aucune.
 *
 * ─── Ce que ce module décide ────────────────────────────────────────────────
 * Combien de colonnes tiennent LISIBLEMENT dans la largeur disponible, quelle
 * tranche de la liste afficher, et comment cette tranche se déplace — y compris
 * quand la liste change sous les pieds de l'utilisateur (§78-80).
 *
 * Tout est ici, et rien n'est ici que du calcul : aucune dépendance à React, au
 * DOM ou au réseau. C'est ce qui permet de l'éprouver sur 1, 4, 5, 6, 10, 20,
 * 30, 50 et 100 mécaniciens sans monter d'interface.
 */

/**
 * Largeur de colonne VISÉE, en pixels.
 *
 * Ce n'est pas un minimum absolu mais une cible de confort : en dessous, le nom
 * du mécanicien se tronque et les cartes d'intervention deviennent des bandes
 * illisibles. Le calcul arrondit vers le bas, donc les colonnes réelles sont
 * toujours PLUS larges que cette valeur.
 */
export const LARGEUR_COLONNE_VISEE = 300

/**
 * Plafond de colonnes simultanées.
 *
 * Sur un écran très large, la place permettrait d'en afficher huit ou dix. On
 * s'arrête à six : au-delà, l'œil ne compare plus rien utilement et le planning
 * redevient une grille dense. Ce plafond ne limite PAS le nombre de mécaniciens
 * du garage — seulement le nombre affiché à la fois.
 */
export const MAX_COLONNES_VISIBLES = 6

/** Largeur de la règle des heures (colonne `w-14` à gauche du planning). */
export const LARGEUR_REGLE_HEURES = 56

/**
 * Nombre de colonnes affichables dans `largeurPlanning` pixels.
 *
 * Toujours au moins 1 : même sur un écran étroit, on montre un mécanicien
 * plutôt qu'un planning vide. Jamais plus que le nombre réel de mécaniciens :
 * quatre mécaniciens sur un écran large occupent quatre colonnes larges, pas
 * six dont deux vides.
 */
export function nombreColonnesVisibles(largeurPlanning: number, total: number): number {
  if (!Number.isFinite(largeurPlanning) || largeurPlanning <= 0) return Math.min(1, Math.max(0, total))
  if (total <= 0) return 0
  const disponible = largeurPlanning - LARGEUR_REGLE_HEURES
  const tiennent = Math.floor(disponible / LARGEUR_COLONNE_VISEE)
  return Math.max(1, Math.min(tiennent, MAX_COLONNES_VISIBLES, total))
}

/**
 * Borne un index de départ pour que la fenêtre ne dépasse jamais la fin de la
 * liste. Sans cela, se trouver sur le dernier groupe puis rétrécir la fenêtre
 * (ou archiver un mécanicien) laissait des colonnes vides à droite.
 */
export function bornerDebut(debut: number, visibles: number, total: number): number {
  if (total <= 0 || visibles <= 0) return 0
  const dernierDebutPossible = Math.max(0, total - visibles)
  if (!Number.isFinite(debut)) return 0
  return Math.min(Math.max(Math.trunc(debut), 0), dernierDebutPossible)
}

export interface Fenetre {
  debut: number
  fin: number // exclu
  /** Y a-t-il des mécaniciens AVANT la fenêtre ? */
  precedent: boolean
  /** Y a-t-il des mécaniciens APRÈS la fenêtre ? */
  suivant: boolean
  /** Numéro de groupe (1-based) et nombre total de groupes — pour l'affichage. */
  groupe: number
  groupes: number
}

/** Décrit la fenêtre courante, bornes comprises. */
export function fenetre(debut: number, visibles: number, total: number): Fenetre {
  const d = bornerDebut(debut, visibles, total)
  const f = Math.min(d + visibles, total)
  const groupes = visibles > 0 && total > 0 ? Math.ceil(total / visibles) : 0
  return {
    debut: d,
    fin: f,
    precedent: d > 0,
    suivant: f < total,
    groupe: visibles > 0 ? Math.floor(d / visibles) + 1 : 0,
    groupes,
  }
}

/**
 * Déplace la fenêtre d'un GROUPE complet.
 *
 * Avancer d'une seule colonne à chaque clic obligerait à cliquer dix fois pour
 * traverser vingt mécaniciens, et la position deviendrait difficile à suivre :
 * la moitié des visages resterait la même à chaque pas. Un groupe entier donne
 * une progression lisible — on sait toujours où l'on se trouve (§30).
 *
 * Le dernier groupe est BORNÉ, pas partiel : avec 10 mécaniciens et 6 colonnes,
 * le second groupe affiche les mécaniciens 5 à 10 (et non 7 à 10 avec deux
 * colonnes vides).
 */
export function deplacer(debut: number, visibles: number, total: number, sens: 1 | -1): number {
  if (total <= 0 || visibles <= 0) return 0
  return bornerDebut(bornerDebut(debut, visibles, total) + sens * visibles, visibles, total)
}

/**
 * Recalcule la fenêtre après une MUTATION de la liste (§78-80).
 *
 * Scénario visé : l'utilisateur regarde les mécaniciens 11 à 15 ; un collègue
 * archive le mécanicien 1 depuis un autre poste. Conserver `debut = 10` ferait
 * glisser toute la fenêtre d'un cran et l'utilisateur verrait soudain d'autres
 * personnes, sans avoir rien fait. Pire, avec plusieurs suppressions, la fenêtre
 * pouvait pointer au-delà de la fin et n'afficher aucune colonne.
 *
 * On raisonne donc sur une ANCRE : l'identifiant du premier mécanicien
 * actuellement visible. S'il est encore là, la fenêtre se recale sur lui. Sinon,
 * on retient la première ancre de secours encore présente (les mécaniciens qui
 * suivaient dans l'ancienne fenêtre) — l'utilisateur reste ainsi au même endroit
 * de la liste. En dernier recours seulement, on borne l'ancien index.
 *
 * @param ancres identifiants des mécaniciens de l'ancienne fenêtre, dans l'ordre
 */
export function reconcilier(
  ancienDebut: number,
  ancres: readonly string[],
  identifiants: readonly string[],
  visibles: number,
): number {
  const total = identifiants.length
  if (total <= 0 || visibles <= 0) return 0

  for (const ancre of ancres) {
    const idx = identifiants.indexOf(ancre)
    if (idx !== -1) return bornerDebut(idx, visibles, total)
  }
  return bornerDebut(ancienDebut, visibles, total)
}

/**
 * Tranche visible de la liste.
 *
 * Renvoie les ÉLÉMENTS eux-mêmes : le reste de l'application ne doit jamais
 * manipuler d'index de colonne comme s'il s'agissait d'une identité métier —
 * c'est exactement le défaut que ce module doit rendre impossible (§43-45,
 * §151). Un `mechanicId` ne se déduit pas d'une position.
 */
export function trancheVisible<T>(elements: readonly T[], debut: number, visibles: number): T[] {
  const { debut: d, fin } = fenetre(debut, visibles, elements.length)
  return elements.slice(d, fin)
}
