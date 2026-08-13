/**
 * Contrat du planning — invariants verrouillés sur la source.
 *
 * `ScheduleBoard` est un composant client à état (ResizeObserver, dnd-kit) et
 * l'environnement de test est `node`, sans DOM ni bibliothèque de rendu : on
 * verrouille donc la SOURCE, comme le font déjà les tests `electron-*` pour
 * `main.js`. La logique de fenêtrage, elle, est éprouvée pour de vrai dans
 * `mechanic-window.test.ts` — c'est là que vit le comportement.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../../..')
const SRC = readFileSync(path.join(RACINE, 'src/components/ScheduleBoard.tsx'), 'utf8')

/** Retire les commentaires : on analyse le CODE, pas la prose qui l'explique. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('fenêtre de mécaniciens — plus aucune colonne compressée', () => {
  it('les colonnes affichées viennent de la fenêtre calculée', () => {
    expect(CODE).toMatch(/trancheVisible\(mechanics,\s*debutFenetre,\s*colonnesVisibles\)/)
  })

  it('le nombre de colonnes est CALCULÉ sur la largeur mesurée', () => {
    expect(CODE).toMatch(/nombreColonnesVisibles\(largeurPlanning,\s*mechanics\.length\)/)
    // Mesure réelle et non point de rupture CSS : la place disponible dépend de
    // la barre latérale et de la taille de fenêtre, pas seulement de l'écran.
    expect(CODE).toContain('ResizeObserver')
  })

  it('plus aucun rendu inconditionnel de TOUS les mécaniciens', () => {
    // L'ancienne ligne : `isMobile && selectedMechanic ? [selectedMechanic] : mechanics`
    expect(CODE).not.toMatch(/visibleMechanics\s*=\s*isMobile[^\n]*:\s*mechanics\b/)
  })
})

describe('flèches — en haut à gauche et en haut à droite (exigence ferme)', () => {
  /**
   * Barre de navigation : du test d'affichage jusqu'au rendu de l'en-tête.
   *
   * Le repère de fin est `<MechanicHeaderCell`, qui n'apparaît QUE dans la ligne
   * d'en-tête. Un repère sur `visibleMechanics.map` aurait été faux : cette
   * expression apparaît d'abord, plus haut, dans l'effet qui mémorise les ancres.
   */
  const posBarre = CODE.indexOf('vue.precedent || vue.suivant')
  const posEntete = CODE.indexOf('<MechanicHeaderCell')
  const barre = CODE.slice(posBarre, posEntete)

  it('la barre précède la ligne d\'en-tête des mécaniciens', () => {
    // « En haut du planning » : au-dessus des avatars et des noms, donc avant
    // eux dans le document.
    expect(posBarre).toBeGreaterThan(-1)
    expect(posEntete).toBeGreaterThan(-1)
    expect(posBarre).toBeLessThan(posEntete)
  })

  it('la flèche gauche vient AVANT la flèche droite dans la barre', () => {
    const gauche = barre.indexOf('naviguer(-1)')
    const droite = barre.indexOf('naviguer(1)')
    expect(gauche).toBeGreaterThan(-1)
    expect(droite).toBeGreaterThan(gauche)
  })

  it('les deux boutons portent un libellé accessible et un intitulé', () => {
    expect(barre).toContain('aria-label="Mécaniciens précédents"')
    expect(barre).toContain('aria-label="Mécaniciens suivants"')
    expect(barre).toContain('title="Mécaniciens précédents"')
    expect(barre).toContain('title="Mécaniciens suivants"')
  })

  it('les boutons sont désactivés aux bornes plutôt que de disparaître', () => {
    // La position reste ainsi STABLE d'un groupe à l'autre (§27) : rien ne
    // saute sous le curseur au moment où l'on clique.
    expect(barre).toMatch(/disabled=\{!vue\.precedent\}/)
    expect(barre).toMatch(/disabled=\{!vue\.suivant\}/)
  })

  it('ce sont de vrais boutons, focusables au clavier avec un focus visible', () => {
    expect(barre).toMatch(/type="button"/)
    expect(barre).toContain('focus-visible:ring')
  })
})

describe('aucune navigation accidentelle (§31-35)', () => {
  it('rien n\'écoute la molette ni un geste horizontal', () => {
    // Le défilement vertical du planning doit rester un défilement vertical.
    for (const piege of ['onWheel', 'wheel', 'onTouchMove', 'touchmove', 'deltaX', 'onScroll']) {
      expect(CODE, `« ${piege} » ne doit pas piloter la navigation`).not.toContain(piege)
    }
  })

  it('le planning ne défile jamais horizontalement', () => {
    expect(CODE).toContain('overflow-x-hidden')
  })

  it('le changement de groupe passe UNIQUEMENT par les boutons', () => {
    // `naviguer` n'est appelé que depuis les deux boutons.
    const appels = CODE.match(/naviguer\((?:1|-1)\)/g) ?? []
    expect(appels).toHaveLength(2)
  })
})

describe('identités stables — aucune donnée métier déduite du visuel (§43-46, §151)', () => {
  it('la zone de dépôt porte l\'identifiant du mécanicien, pas sa position', () => {
    expect(CODE).toMatch(/useDroppable\(\{\s*id:\s*`col-\$\{mechanic\.id\}`/)
    expect(CODE).toMatch(/overId\.replace\('col-',\s*''\)/)
  })

  it('les clés React des colonnes sont des identifiants, jamais des index', () => {
    expect(CODE).toMatch(/key=\{mechanic\.id\}/)
    expect(CODE).not.toMatch(/key=\{(index|i|idx)\}/)
  })

  it('la sélection directe passe par un identifiant', () => {
    expect(CODE).toMatch(/cadrerSur\(m\.id\)/)
  })

  it('la fenêtre se recale sur les PERSONNES quand la liste change', () => {
    // Conserver l'index ferait glisser la fenêtre vers d'autres mécaniciens
    // quand un collègue en archive un depuis un autre poste.
    expect(CODE).toMatch(/reconcilier\(d,\s*ancresRef\.current/)
  })
})

describe('avatar', () => {
  it('l\'en-tête de colonne rend le composant d\'avatar, plus une chaîne brute', () => {
    expect(CODE).toContain('<MechanicAvatar mechanic={mechanic}')
    expect(CODE).not.toMatch(/\{mechanic\.avatar\}/)
    expect(CODE).not.toMatch(/\{m\.avatar\}/)
  })
})
