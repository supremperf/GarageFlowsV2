/**
 * Étape 15 — le copilote va-t-il jusqu'au bout ? (§1, §15)
 *
 * Le moteur, ses résolveurs et le verrou de confirmation sont déjà couverts
 * (`copilot.test.ts`, `src/integration/copilot*.test.ts`). Ce qui ne l'était
 * pas, c'est le DERNIER maillon : une intention d'action reconnue, confirmée
 * par l'utilisateur, doit ouvrir un écran réel.
 *
 * Le copilote n'écrit jamais lui-même — il passe la main. Si l'intention n'a
 * pas de destination, le panneau se ferme et **rien ne se passe** : le
 * garagiste a confirmé une action qui n'existe pas. C'est exactement le genre
 * de chaîne rompue qui « compile, répond 200 et ne fait rien ».
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { INTENTS } from '@/lib/copilot/intents'
import { handleQuery } from '@/lib/copilot'

const RACINE = path.resolve(__dirname, '../../..')
const PAGE = fs.readFileSync(path.join(RACINE, 'app/page.tsx'), 'utf8')
const PANNEAU = fs.readFileSync(path.join(RACINE, 'components/CopilotPanel.tsx'), 'utf8')

/** L'ORDRE est imposé : lignes `//` d'abord, blocs ensuite (GF-DUR-046). */
const sansCommentaires = (src: string) =>
  src.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ' ')

const PAGE_CODE = sansCommentaires(PAGE)

/** Corps du `switch` d'aiguillage des intentions du copilote. */
const AIGUILLAGE = (() => {
  const debut = PAGE_CODE.indexOf('handleCopilotAction')
  expect(debut, 'le point d’atterrissage du copilote a disparu').toBeGreaterThan(-1)
  // La borne était `}, [openCreateModal])` avec repli SILENCIEUX sur 1500
  // caractères arbitraires : ajouter une dépendance au useCallback faisait
  // disparaître la borne sans que rien ne le signale, et le garde se mettait à
  // inspecter une fenêtre qui n'a plus de sens. On tolère donc n'importe quelle
  // liste de dépendances, mais on REFUSE de continuer si la fin est introuvable.
  const fin = PAGE_CODE.slice(debut).search(/\}\s*,\s*\[[^\]]*\]\s*\)/)
  expect(fin, 'la fin de handleCopilotAction est introuvable : ce garde inspecterait une fenêtre arbitraire')
    .toBeGreaterThan(-1)
  return PAGE_CODE.slice(debut, debut + fin)
})()

/**
 * Corps EXACT d'une branche : de son étiquette jusqu'à la branche suivante.
 *
 * Une fenêtre de longueur fixe ne convient pas : les cinq branches tiennent sur
 * une ligne d'une cinquantaine de caractères, si bien qu'une fenêtre de 120
 * débordait systématiquement sur le corps de la branche SUIVANTE. Vider
 * `case 'order_parts'` laissait donc le garde au vert — il lisait l'ouverture
 * d'écran de `send_reminder`. Seule la dernière branche était réellement
 * protégée.
 */
function corpsDeLaBranche(id: string): string | null {
  const etiquette = `case '${id}'`
  const debut = AIGUILLAGE.indexOf(etiquette)
  if (debut === -1) return null
  const apres = AIGUILLAGE.slice(debut + etiquette.length)
  const fin = apres.search(/case\s+'|default\s*:|\}/)
  return fin === -1 ? apres : apres.slice(0, fin)
}

const ACTIONS = INTENTS.filter((i) => i.kind === 'action')

/**
 * Ce qu'ouvrir un écran veut dire, en 2026-10 : `ouvrirPage('…')` (règle « une
 * seule page à l'écran ») OU l'ouverture directe du formulaire d'intervention.
 *
 * Les anciennes formes (`setIsBillingOpen(true)`…) ont disparu avec les seize
 * booléens de page : le garde doit suivre le mécanisme RÉEL, sinon il passerait
 * au vert sur un aiguillage devenu vide — exactement ce qu'il est là pour
 * empêcher.
 */
const OUVRE_UN_ECRAN = /ouvrirPage\('[a-z]+'\)|openCreateModal\(/g

describe('étape 15 — toute intention d’ACTION mène à un écran réel', () => {
  it('le catalogue déclare bien des intentions d’action', () => {
    expect(ACTIONS.length, 'sans action, ce garde ne protège rien').toBeGreaterThan(0)
  })

  it.each(ACTIONS.map((i) => i.id))('« %s » a une destination', (id) => {
    expect(
      AIGUILLAGE.includes(`case '${id}'`),
      `Confirmer « ${id} » fermerait le panneau sans rien ouvrir : `
      + 'le garagiste valide une action qui n’existe pas.',
    ).toBe(true)
  })

  it('chaque destination ouvre RÉELLEMENT quelque chose', () => {
    // Un `case` vide serait aussi mort qu'un `case` absent. Chaque branche est
    // lue SEULE : sinon, une branche vide emprunte l'ouverture d'écran de sa
    // voisine et le garde ne protège plus que la dernière.
    for (const { id } of ACTIONS) {
      const corps = corpsDeLaBranche(id)
      expect(corps, `« ${id} » n’a aucune branche d’aiguillage`).not.toBeNull()
      expect(corps as string, `« ${id} » n’ouvre aucun écran : le garagiste confirmerait dans le vide`)
        .toMatch(OUVRE_UN_ECRAN)
    }
  })

  it('le découpage isole bien chaque branche — sinon ce garde ne prouverait rien', () => {
    // Épreuve du garde par lui-même : le corps d'une branche ne doit jamais
    // contenir l'ouverture d'écran d'une AUTRE. C'est exactement ce que la
    // fenêtre de 120 caractères laissait passer.
    const ouvertures = ACTIONS
      .map(({ id }) => [id, (corpsDeLaBranche(id) ?? '').match(OUVRE_UN_ECRAN) ?? []] as const)
    for (const [id, trouvees] of ouvertures) {
      expect(trouvees.length, `la branche « ${id} » déborde sur sa voisine`).toBe(1)
    }
  })

  it('le panneau ne se contente pas d’afficher : il passe la main', () => {
    expect(PANNEAU).toContain('onAction')
    expect(PANNEAU, 'la confirmation doit déclencher le relais').toMatch(/if \(onAction && intent\) onAction\(intent\)/)
  })

  it('le panneau est monté ET relié à l’aiguillage', () => {
    // `[^>]*` ne convient pas : la balise contient `() =>`, dont le `>` coupe
    // la classe négative. On borne sur la balise elle-même.
    const balise = PAGE_CODE.slice(PAGE_CODE.indexOf('<CopilotPanel'))
    expect(balise.slice(0, 200)).toContain('onAction={handleCopilotAction}')
  })
})

describe('étape 15 — le copilote n’écrit jamais de lui-même', () => {
  it.each(ACTIONS.map((i) => i.keywords[0]))('« %s » exige une confirmation', (phrase) => {
    const r = handleQuery(phrase)
    expect(r.type, `« ${phrase} » doit produire une proposition, pas une réponse`).toBe('action_proposal')
    expect(r.action?.confirmationRequired, 'aucune action sans confirmation explicite').toBe(true)
  })

  it('aucune écriture directe depuis le panneau', () => {
    // Le panneau n'appelle QUE /api/copilot ; toute autre méthode d'écriture
    // court-circuiterait le verrou de confirmation.
    const appels = Array.from(sansCommentaires(PANNEAU).matchAll(/fetch\(\s*['"`]([^'"`]+)/g))
      .map((m) => m[1])
    expect(appels, 'le panneau ne parle qu’au copilote').toEqual(
      appels.filter((u) => u.startsWith('/api/copilot')),
    )
    expect(sansCommentaires(PANNEAU)).not.toMatch(/method:\s*['"](POST|PATCH|PUT|DELETE)['"][\s\S]{0,200}\/api\/(?!copilot)/)
  })
})
