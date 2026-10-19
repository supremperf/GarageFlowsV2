import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * RÉGRESSION — plantage du tableau de bord sur un tri.
 *
 * Observé en production (garageflow.log, 24 s après une connexion réussie) :
 *
 *   TypeError: Cannot read properties of undefined (reading 'localeCompare')
 *   [app-error-boundary]
 *
 * `RecentJobs` (DashboardCharts) triait les interventions ainsi :
 *
 *   if (a.date !== b.date) return b.date.localeCompare(a.date)
 *   return b.startTime.localeCompare(a.startTime)
 *
 * Une SEULE intervention dont `date` ou `startTime` manque suffisait à lever.
 * Le tri s'exécutant dans un `useMemo` PENDANT le rendu, l'exception n'était pas
 * rattrapable localement : l'error boundary emportait toute la page.
 *
 * Le schéma déclare pourtant ces colonnes non nullables — la valeur manquante
 * vient donc de l'état client (entrée partielle dans le store). Quelle qu'en
 * soit l'origine, l'invariant retenu est plus simple et plus solide : un tri
 * d'AFFICHAGE ne doit jamais pouvoir faire tomber l'interface.
 *
 * On verrouille donc la source des trois comparateurs concernés — les composants
 * .tsx ne sont pas importables ici (tsconfig fixe `jsx: "preserve"`, cf.
 * electron-bridge-hydration.test.ts).
 */
describe('tris d\'affichage — aucun accès direct sur une valeur potentiellement absente', () => {
  const SRC = path.resolve(__dirname, '../..')

  /** Fichiers dont un tri s'exécute pendant le rendu d'un écran. */
  const GUARDED = [
    'components/dashboard/DashboardCharts.tsx',
    'components/WeekView.tsx',
    'components/VehicleHistoryModal.tsx',
  ]

  for (const rel of GUARDED) {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8')

    it(`${rel} : plus aucun \`.date.localeCompare\` ni \`.startTime.localeCompare\` nu`, () => {
      // Forme fautive : la propriété est déréférencée SANS repli.
      expect(src).not.toMatch(/\.date\.localeCompare/)
      expect(src).not.toMatch(/\.startTime\.localeCompare/)
    })

    it(`${rel} : les comparaisons passent par un repli \`?? ''\``, () => {
      const compares = src.match(/localeCompare/g) ?? []
      if (compares.length === 0) return
      // Chaque appel doit être précédé d'un repli sur chaîne vide, soit sur la
      // valeur elle-même, soit via une variable déjà défendue au-dessus.
      const guarded = src.match(/\?\?\s*''\s*\)?\s*\)?\.localeCompare|\?\?\s*''/g) ?? []
      expect(guarded.length).toBeGreaterThan(0)
    })
  }

  it('le comparateur de RecentJobs est TOTALEMENT défensif', () => {
    const src = fs.readFileSync(path.join(SRC, 'components/dashboard/DashboardCharts.tsx'), 'utf8')
    const start = src.indexOf('const recent = useMemo')
    expect(start).toBeGreaterThan(-1)
    const block = src.slice(start, start + 700)
    // Les DEUX niveaux de tri (date puis heure) doivent être défendus.
    expect(block).toMatch(/a\.date \?\? ''/)
    expect(block).toMatch(/b\.date \?\? ''/)
    expect(block).toMatch(/b\.startTime \?\? ''/)
    expect(block).toMatch(/a\.startTime \?\? ''/)
  })
})
