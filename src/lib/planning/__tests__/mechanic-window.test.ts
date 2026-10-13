/**
 * GF-PLAN-001 — fenêtre de mécaniciens du planning.
 *
 * Le planning rendait TOUS les mécaniciens en colonnes `flex-1` : à 20 les
 * colonnes tombent sous 90 px, à 50 sous 40 px. Le produit était donc de fait
 * limité à quatre ou cinq mécaniciens, sans que rien ne le dise et sans qu'il
 * existe la moindre constante à corriger.
 *
 * Ces tests balaient les volumétries exigées (1, 4, 5, 6, 10, 20, 30, 50, 100)
 * et les largeurs d'écran réelles, plutôt que quelques cas choisis.
 */
import { describe, it, expect } from 'vitest'
import {
  LARGEUR_COLONNE_VISEE,
  MAX_COLONNES_VISIBLES,
  LARGEUR_REGLE_HEURES,
  nombreColonnesVisibles,
  bornerDebut,
  fenetre,
  deplacer,
  reconcilier,
  trancheVisible,
} from '@/lib/planning/mechanic-window'

/** Volumétries exigées par le cahier des charges. */
const VOLUMETRIES = [1, 4, 5, 6, 10, 20, 30, 50, 100]
/** Largeurs d'écran à couvrir. */
const LARGEURS = [320, 375, 390, 430, 768, 1024, 1366, 1440, 1920, 2560]

const mecaniciens = (n: number) => Array.from({ length: n }, (_, i) => `mec-${i + 1}`)

describe('nombre de colonnes visibles — calculé, jamais codé en dur', () => {
  it('suit la largeur disponible sur les écrans réels', () => {
    // Avec 100 mécaniciens disponibles, seule la largeur décide.
    const observe = LARGEURS.map((l) => [l, nombreColonnesVisibles(l, 100)] as const)
    expect(observe).toEqual([
      [320, 1],
      [375, 1],
      [390, 1],
      [430, 1],
      [768, 2],
      [1024, 3],
      [1366, 4],
      [1440, 4],
      [1920, 6],
      [2560, 6],
    ])
  })

  it('ne descend jamais sous une colonne, ne dépasse jamais le plafond', () => {
    for (const l of [1, 10, 100, 320, 5000, 100000]) {
      const n = nombreColonnesVisibles(l, 100)
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(MAX_COLONNES_VISIBLES)
    }
  })

  it('n\'affiche jamais plus de colonnes qu\'il n\'y a de mécaniciens', () => {
    // Quatre mécaniciens sur un écran large occupent quatre colonnes larges,
    // pas six dont deux vides.
    for (const total of VOLUMETRIES) {
      expect(nombreColonnesVisibles(2560, total)).toBe(Math.min(total, MAX_COLONNES_VISIBLES))
    }
  })

  it('les colonnes obtenues sont toujours au moins aussi larges que la cible', () => {
    // C'est la propriété qui garantit la lisibilité : l'arrondi se fait vers le
    // bas, donc jamais de colonne plus étroite que prévu.
    for (const largeur of LARGEURS) {
      const n = nombreColonnesVisibles(largeur, 100)
      const largeurColonne = (largeur - LARGEUR_REGLE_HEURES) / n
      if (n > 1) expect(largeurColonne, `${largeur}px → ${n} colonnes`).toBeGreaterThanOrEqual(LARGEUR_COLONNE_VISEE)
    }
  })

  it('une largeur inconnue ou absurde ne casse rien', () => {
    for (const l of [0, -100, NaN, Infinity]) {
      expect(nombreColonnesVisibles(l as number, 10)).toBeGreaterThanOrEqual(0)
    }
    expect(nombreColonnesVisibles(1920, 0)).toBe(0)
  })
})

describe('bornes de la fenêtre', () => {
  it('la fenêtre ne dépasse jamais la fin de la liste', () => {
    for (const total of VOLUMETRIES) {
      for (const visibles of [1, 2, 3, 4, 5, 6]) {
        for (const debut of [-5, 0, 1, total - 1, total, total + 50, 1e9]) {
          const f = fenetre(debut, visibles, total)
          expect(f.debut).toBeGreaterThanOrEqual(0)
          expect(f.fin).toBeLessThanOrEqual(total)
          // Une fenêtre PLEINE tant que la liste le permet : jamais de colonnes
          // vides à droite parce qu'on s'est arrêté trop loin.
          expect(f.fin - f.debut).toBe(Math.min(visibles, total))
        }
      }
    }
  })

  it('un index non fini retombe au début', () => {
    expect(bornerDebut(NaN, 5, 20)).toBe(0)
  })

  it('liste vide : fenêtre vide, aucune flèche', () => {
    const f = fenetre(0, 5, 0)
    expect(f).toMatchObject({ debut: 0, fin: 0, precedent: false, suivant: false, groupes: 0 })
  })
})

describe('flèches — présence et bornes', () => {
  it('tout tient à l\'écran : aucune flèche active', () => {
    // 4 mécaniciens sur un écran large — exigence du test E2E 1.
    const visibles = nombreColonnesVisibles(1920, 4)
    const f = fenetre(0, visibles, 4)
    expect(f.precedent).toBe(false)
    expect(f.suivant).toBe(false)
  })

  it('au premier groupe : pas de précédent, un suivant', () => {
    const f = fenetre(0, 5, 10)
    expect(f.precedent).toBe(false)
    expect(f.suivant).toBe(true)
  })

  it('au dernier groupe : un précédent, pas de suivant', () => {
    const f = fenetre(deplacer(0, 5, 10, 1), 5, 10)
    expect(f.precedent).toBe(true)
    expect(f.suivant).toBe(false)
  })

  it('les compteurs de groupe restent cohérents', () => {
    expect(fenetre(0, 5, 10)).toMatchObject({ groupe: 1, groupes: 2 })
    expect(fenetre(5, 5, 10)).toMatchObject({ groupe: 2, groupes: 2 })
    expect(fenetre(0, 6, 30)).toMatchObject({ groupe: 1, groupes: 5 })
  })
})

describe('navigation par groupe — aller au bout et revenir', () => {
  it.each(VOLUMETRIES)('%i mécaniciens : parcours complet aller-retour sans erreur', (total) => {
    const visibles = nombreColonnesVisibles(1920, total)
    const ids = mecaniciens(total)

    // Aller jusqu'au dernier groupe.
    let debut = 0
    const vus = new Set<string>()
    let gardeFou = 0
    for (;;) {
      trancheVisible(ids, debut, visibles).forEach((id) => vus.add(id))
      if (!fenetre(debut, visibles, total).suivant) break
      debut = deplacer(debut, visibles, total, 1)
      if (++gardeFou > 1000) throw new Error('la navigation ne converge pas')
    }

    // TOUS les mécaniciens ont été atteignables — c'est la garantie de
    // scalabilité : aucun n'est enfermé hors d'atteinte.
    expect(vus.size).toBe(total)
    expect(fenetre(debut, visibles, total).suivant).toBe(false)

    // Retour au début.
    gardeFou = 0
    while (fenetre(debut, visibles, total).precedent) {
      debut = deplacer(debut, visibles, total, -1)
      if (++gardeFou > 1000) throw new Error('le retour ne converge pas')
    }
    expect(debut).toBe(0)
  })

  it('clics rapides répétés ne dépassent jamais les bornes', () => {
    // Test E2E 10 : marteler la flèche droite.
    const total = 30
    const visibles = 6
    let debut = 0
    for (let i = 0; i < 200; i++) debut = deplacer(debut, visibles, total, 1)
    expect(debut).toBe(total - visibles)
    expect(trancheVisible(mecaniciens(total), debut, visibles)).toHaveLength(visibles)

    for (let i = 0; i < 200; i++) debut = deplacer(debut, visibles, total, -1)
    expect(debut).toBe(0)
  })

  it('le dernier groupe est BORNÉ, pas partiel', () => {
    // 10 mécaniciens, 6 colonnes → le second groupe montre les mécaniciens
    // 5 à 10, et non 7 à 10 avec deux colonnes vides.
    const ids = mecaniciens(10)
    const debut = deplacer(0, 6, 10, 1)
    expect(debut).toBe(4)
    expect(trancheVisible(ids, debut, 6)).toEqual(['mec-5', 'mec-6', 'mec-7', 'mec-8', 'mec-9', 'mec-10'])
  })

  it('un seul mécanicien : aucune navigation possible', () => {
    expect(deplacer(0, 1, 1, 1)).toBe(0)
    expect(deplacer(0, 1, 1, -1)).toBe(0)
    expect(fenetre(0, 1, 1)).toMatchObject({ precedent: false, suivant: false })
  })
})

describe('mutation de la liste pendant l\'affichage (§78-80)', () => {
  it('un mécanicien archivé AVANT la fenêtre ne déplace pas ce qu\'on regarde', () => {
    // L'utilisateur regarde 11→15 ; un collègue archive le mécanicien 1.
    const avant = mecaniciens(20)
    const visibles = 5
    const debut = 10
    const ancres = trancheVisible(avant, debut, visibles) // mec-11 … mec-15
    expect(ancres[0]).toBe('mec-11')

    const apres = avant.filter((id) => id !== 'mec-1')
    const nouveauDebut = reconcilier(debut, ancres, apres, visibles)

    // La fenêtre suit les MÊMES personnes, pas le même index.
    expect(trancheVisible(apres, nouveauDebut, visibles)).toEqual(ancres)
  })

  it('si l\'ancre elle-même disparaît, on retombe sur la suivante encore présente', () => {
    const avant = mecaniciens(20)
    const visibles = 5
    const ancres = trancheVisible(avant, 10, visibles) // mec-11 … mec-15
    const apres = avant.filter((id) => id !== 'mec-11')
    const nouveauDebut = reconcilier(10, ancres, apres, visibles)
    expect(trancheVisible(apres, nouveauDebut, visibles)[0]).toBe('mec-12')
  })

  it('si toute la fenêtre disparaît, l\'index est simplement borné', () => {
    const avant = mecaniciens(20)
    const ancres = trancheVisible(avant, 15, 5) // mec-16 … mec-20
    const apres = mecaniciens(6) // ne contient aucune ancre
    const nouveauDebut = reconcilier(15, ancres, apres, 5)
    expect(nouveauDebut).toBe(1) // borné : 6 − 5
    expect(trancheVisible(apres, nouveauDebut, 5)).toHaveLength(5)
  })

  it('la liste devient vide : aucun index hors limites, aucun plantage', () => {
    expect(reconcilier(15, ['mec-16'], [], 5)).toBe(0)
    expect(trancheVisible([], 0, 5)).toEqual([])
  })

  it('un mécanicien AJOUTÉ pendant l\'affichage ne déplace rien', () => {
    const avant = mecaniciens(10)
    const ancres = trancheVisible(avant, 5, 5)
    const apres = [...avant, 'mec-11']
    const nouveauDebut = reconcilier(5, ancres, apres, 5)
    expect(trancheVisible(apres, nouveauDebut, 5)).toEqual(ancres)
  })
})

describe('identités — jamais un index comme identité métier (§43-45, §151)', () => {
  it('la tranche rend les ÉLÉMENTS, pas des positions', () => {
    const ids = mecaniciens(30)
    const t = trancheVisible(ids, 12, 6)
    expect(t).toEqual(['mec-13', 'mec-14', 'mec-15', 'mec-16', 'mec-17', 'mec-18'])
  })

  it('la colonne n° 3 désigne des personnes DIFFÉRENTES avant et après navigation', () => {
    // C'est précisément pourquoi une identité ne doit jamais se déduire d'un
    // index de colonne : ici la troisième colonne passe de mec-3 à mec-9.
    const ids = mecaniciens(30)
    const avant = trancheVisible(ids, 0, 6)[2]
    const apres = trancheVisible(ids, deplacer(0, 6, 30, 1), 6)[2]
    expect(avant).toBe('mec-3')
    expect(apres).toBe('mec-9')
    expect(avant).not.toBe(apres)
  })
})
