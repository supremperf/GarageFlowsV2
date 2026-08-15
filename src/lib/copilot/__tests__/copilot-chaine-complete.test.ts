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
  const fin = PAGE_CODE.indexOf('}, [openCreateModal])', debut)
  return PAGE_CODE.slice(debut, fin > debut ? fin : debut + 1500)
})()

const ACTIONS = INTENTS.filter((i) => i.kind === 'action')

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
    // Un `case` vide serait aussi mort qu'un `case` absent.
    for (const { id } of ACTIONS) {
      const pos = AIGUILLAGE.indexOf(`case '${id}'`)
      const suite = AIGUILLAGE.slice(pos, pos + 120)
      expect(suite, `« ${id} » n’ouvre aucun écran`).toMatch(/set\w+\(true\)|openCreateModal\(/)
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
