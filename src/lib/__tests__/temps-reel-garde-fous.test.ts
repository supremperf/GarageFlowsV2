/**
 * Temps réel — les garde-fous ajoutés le 16/08/2026.
 *
 * Ces tests portent sur des propriétés que le dépôt peut réellement éprouver :
 * le comportement de l'invalidation, et la présence des gardes dans les
 * surfaces que l'outillage ne sait pas monter (l'environnement de test est
 * `node`, sans testing-library — c'est dit, c'est la limite de ce fichier).
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const lire = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8')

describe('rien n’est demandé quand personne ne regarde', () => {
  it('l’overlay de licence ne sonde pas en arrière-plan', () => {
    // Il sondait toutes les 3 s en permanence : à lui seul un tiers du quota
    // partagé par tout le poste, écran masqué compris.
    const src = lire('components/LicenseRevokedOverlay.tsx')
    expect(src).toMatch(/setInterval\(\(\) => \{ if \(!document\.hidden\) poll\(\) \}/)
    // …et le retour au premier plan garde son contrôle immédiat.
    expect(src).toContain("document.addEventListener('visibilitychange', onVisible)")
  })
})

describe('le battement ne parcourt plus tout l’historique', () => {
  it('les flux du mécanicien sont bornés dans le temps', () => {
    // `jobMechanicNote` et `jobPhoto` n'étaient bornés ni par une date ni par un
    // index : chaque battement relisait tout l'historique du garage.
    const src = lire('app/api/jobs/pulse/route.ts')
    expect(src).toMatch(/jobMechanicNote\.aggregate\(\{\s*where: \{ garageId, createdAt: \{ gte: depuis \} \}/)
    expect(src).toMatch(/jobPhoto\.aggregate\(\{\s*where: \{ garageId, createdAt: \{ gte: depuis \} \}/)
  })

  it('l’horizon est large — un poste éteint plusieurs jours ne rate rien', () => {
    const src = lire('app/api/jobs/pulse/route.ts')
    const m = src.match(/const depuis = new Date\(Date\.now\(\) - (\d+) \* 24 \* 60 \* 60 \* 1000\)/)
    expect(m, 'l’horizon doit rester lisible dans le code').not.toBeNull()
    expect(Number(m?.[1]), 'trop court, un arriéré passerait inaperçu').toBeGreaterThanOrEqual(30)
  })
})

describe('une action du comptoir atteint le mécanicien', () => {
  it('démarrer ou arrêter le chrono déclenche une synchronisation', () => {
    // C'était la seule écriture d'intervention à ne pas la déclencher : le
    // mécanicien voyait « Prévu » alors que le comptoir avait lancé le travail.
    const src = lire('app/api/jobs/[id]/timer/route.ts')
    const appels = src.match(/scheduleJobSync\(session\.user\.garageId\)/g) ?? []
    expect(appels.length, 'les DEUX branches (start et stop) doivent la déclencher').toBe(2)
  })
})

describe('le rattrapage ne prive pas le garage de son quota', () => {
  it('les enchaînements sont plus espacés que le regroupement d’écritures', () => {
    // Vingt enchaînements à 400 ms émettaient une centaine de requêtes en huit
    // secondes — de quoi faire refuser une action HUMAINE pendant l'écoulement.
    const src = lire('lib/sync/job-sync.ts')
    const debounce = Number(src.match(/const DEBOUNCE_MS = (\d+)/)?.[1])
    const enchainement = Number(src.match(/const ENCHAINEMENT_MS = ([\d_]+)/)?.[1]?.replace(/_/g, ''))
    expect(debounce).toBeGreaterThan(0)
    expect(enchainement).toBeGreaterThan(debounce)
    expect(src).toContain('runNow(garageId, enchainement + 1) }, ENCHAINEMENT_MS)')
  })
})

describe('une lecture en vol ne peut plus défaire une action', () => {
  it('le hook expose de quoi l’invalider, et l’écran s’en sert', () => {
    const hook = lire('lib/use-mechanic-live.ts')
    expect(hook).toContain('invalider')
    // L'invalidation doit AUSSI avoir lieu quand l'URL change, sinon la réponse
    // de la date précédente s'applique à la nouvelle.
    expect(hook).toMatch(/seq\.current\+\+\s*\n\s*inFlight\.current = false/)

    const page = lire('app/mechanic/jobs/[id]/page.tsx')
    expect(page).toContain('const avantAction = useCallback(')
    // Les quatre mutations doivent l'appeler : chrono, commentaire, photo, checklist.
    expect((page.match(/avantAction\(\)/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })

  it('l’erreur d’action est effacée à chaque nouvelle tentative', () => {
    // Elle n'était jamais effacée : un échec passager masquait ensuite l'état
    // réel de l'écran, indéfiniment.
    const page = lire('app/mechanic/jobs/[id]/page.tsx')
    expect(page).toMatch(/const avantAction = useCallback\(\(\) => \{\s*\n\s*setActionError\(''\)/)
  })
})

describe('l’écran dit quand il n’est plus à jour', () => {
  it('la liste affiche un signal de péremption', () => {
    const page = lire('app/mechanic/page.tsx')
    expect(page).toContain('echecsConsecutifs')
    expect(page).toMatch(/echecsConsecutifs > 0 &&/)
  })

  it('une photo qui n’a pas pu partir est CONSERVÉE', () => {
    // Elle était détruite : le champ fichier est vidé dès la sélection, et
    // l'échec ne laissait rien. Le mécanicien devait reprendre le cliché.
    const page = lire('app/mechanic/jobs/[id]/page.tsx')
    expect(page).toContain('setPhotoEnAttente(base64)')
    expect(page).toContain('renvoyerPhoto')
  })
})
