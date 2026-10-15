/**
 * GF31-AUD-013 — le manifeste signé doit atteindre le processus principal.
 *
 * `electron/main.js` (`app:install-update`) refuse toute installation quand une
 * clé de vérification est embarquée et que le manifeste signé est absent :
 *
 *     if (updateVerify.signingConfigured()) {
 *       if (!manifest) return { ok:false, reason:'Mise à jour non signée — …' }
 *
 * Le manifeste est bien produit par `fetchLatestUpdate()` et diffusé avec
 * l'événement `app:update-available`. Mais les DEUX interfaces d'installation —
 * la fenêtre `UpdateModal` et l'onglet « Mises à jour » des réglages — le
 * laissaient tomber : leur type `UpdateInfo` ne le déclarait pas et leur appel à
 * `installUpdate({...})` ne le transmettait pas.
 *
 * Conséquence : dans la configuration SÛRE — celle où une clé est embarquée —
 * **aucune mise à jour ne pouvait être installée depuis l'application**, à
 * chaque tentative, avec un message accusant à tort une mise à jour non signée.
 *
 * Ce contrôle porte sur la SOURCE : un test qui simulerait `installUpdate`
 * vérifierait le simulacre, pas le chemin réel jusqu'à Electron.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../..')

function source(rel: string): string {
  return readFileSync(path.join(RACINE, rel), 'utf8')
}

/** Corps de l'appel `installUpdate({ … })` d'un fichier. */
function appelInstallUpdate(src: string): string {
  const i = src.indexOf('installUpdate({')
  expect(i, 'appel installUpdate({ … }) introuvable').toBeGreaterThan(-1)
  const fin = src.indexOf('})', i)
  return src.slice(i, fin)
}

const INTERFACES = [
  ['fenêtre de mise à jour', 'components/UpdateModal.tsx'],
  ['onglet Réglages › Mises à jour', 'components/settings/UpdatesTab.tsx'],
] as const

describe('GF31-AUD-013 — transmission du manifeste signé', () => {
  it.each(INTERFACES)('%s : déclare `manifest` dans son type UpdateInfo', (_libelle, rel) => {
    expect(source(rel)).toMatch(/manifest\?:/)
  })

  it.each(INTERFACES)('%s : transmet `manifest` à installUpdate()', (_libelle, rel) => {
    expect(appelInstallUpdate(source(rel))).toMatch(/manifest:/)
  })

  it('le processus principal exige bien le manifeste (la garde existe toujours)', () => {
    const main = readFileSync(path.resolve(RACINE, '../electron/main.js'), 'utf8')
    // Si cette garde disparaissait, le correctif ci-dessus perdrait son objet et
    // l'updater accepterait un binaire non signé — bien plus grave.
    expect(main).toContain('updateVerify.signingConfigured()')
    expect(main).toContain('manifeste signé requis')
  })
})
