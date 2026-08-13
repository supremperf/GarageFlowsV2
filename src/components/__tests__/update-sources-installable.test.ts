/**
 * GF31-AUD-042 — le manifeste signé n'existait que sur UNE des trois sources.
 *
 * `fetchLatestUpdate()` interroge, dans l'ordre : le serveur central, le fichier
 * publié localement par la « Zone Administrateur », puis les Releases GitHub.
 * Seule la première branche renvoyait un `manifest`. Or `app:install-update`
 * l'exige dès qu'une clé de vérification est embarquée : sur un poste hors
 * ligne ou mono-poste — précisément le cas d'usage de la publication locale —
 * chaque clic sur « Mettre à jour » se soldait par « Mise à jour non signée ».
 *
 * GF31-AUD-013 avait corrigé le TRANSPORT du manifeste dans les deux interfaces ;
 * il manquait sa PRODUCTION sur deux sources sur trois. Le test de l'époque ne
 * pouvait pas le voir : il vérifiait que les composants transmettent le champ,
 * jamais qu'un manifeste existe dans l'objet reçu.
 *
 * La correction a deux volets, tous deux contrôlés ici :
 *   1. la publication locale ACCEPTE et TRANSPORTE un manifeste signé ;
 *   2. quand aucune source n'en fournit, l'application le dit AVANT
 *      (`installable: false`) et propose le téléchargement manuel, au lieu de
 *      promettre une installation dont l'échec est certain.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../..')
const lire = (rel: string) => readFileSync(path.join(RACINE, rel), 'utf8')
const main = () => readFileSync(path.resolve(RACINE, '../electron/main.js'), 'utf8')

describe('GF31-AUD-042 — production du manifeste par les sources', () => {
  it('la publication LOCALE transporte le manifeste jusqu’à l’objet de mise à jour', () => {
    const src = main()
    const i = src.indexOf("source:        'local-admin'")
    expect(i, 'branche local-admin introuvable').toBeGreaterThan(-1)
    // Le manifeste doit figurer dans le MÊME objet que la source local-admin.
    const debutObjet = src.lastIndexOf('return {', i)
    const branche = src.slice(debutObjet, i)
    expect(branche).toMatch(/manifest:\s*localUpdate\.manifest/)
  })

  it('la route de publication accepte un manifeste et le persiste', () => {
    const route = lire('app/api/admin/updates/route.ts')
    expect(route).toContain('lireManifeste(')
    expect(route).toMatch(/manifest:\s*manifest\?\.value/)
  })

  it('la route REFUSE un fichier qui n’est pas un manifeste signé', () => {
    const route = lire('app/api/admin/updates/route.ts')
    expect(route).toContain("typeof o.signature !== 'string'")
    expect(route).toContain('status: 400')
  })

  it('publier SANS manifeste avertit à la publication, pas à l’installation', () => {
    const route = lire('app/api/admin/updates/route.ts')
    expect(route).toContain('warning')
    expect(route).toMatch(/ne pourront PAS installer/)
  })

  it('l’interface de publication propose de joindre le manifeste', () => {
    const tab = lire('components/settings/UpdatesTab.tsx')
    expect(tab).toContain('setManifestFile')
    expect(tab).toMatch(/fd\.append\('manifest', manifestFile\)/)
  })
})

describe('GF31-AUD-042 — une mise à jour non installable est annoncée comme telle', () => {
  it('le processus principal annote CHAQUE mise à jour', () => {
    const src = main()
    expect(src).toContain('function annoterInstallabilite')
    expect(src).toContain('updateVerify.signingConfigured()')
    // Toutes les sources passent par l'annotation : elle enveloppe l'unique
    // point de sortie de fetchLatestUpdate().
    expect(src).toMatch(/async function fetchLatestUpdate\(\) \{\s*\n\s*return annoterInstallabilite\(await fetchLatestUpdateBrut\(\)\)/)
  })

  it('l’installabilité vaut : aucune signature exigée OU manifeste présent', () => {
    const src = main()
    expect(src).toMatch(/const installable = !signatureExigee \|\| Boolean\(info\.manifest\)/)
  })

  it.each([
    ['fenêtre de mise à jour', 'components/UpdateModal.tsx'],
    ['onglet Réglages › Mises à jour', 'components/settings/UpdatesTab.tsx'],
  ])('%s : n’appelle pas installUpdate quand l’installation est impossible', (_l, rel) => {
    const src = lire(rel)
    expect(src).toContain('installable === false')
    // …et propose une porte de sortie utilisable plutôt qu'une impasse.
    const i = src.indexOf('installable === false')
    const bloc = src.slice(i, i + 400)
    expect(bloc).toContain("window.open")
    expect(bloc).toContain('unsignedReason')
  })

  it('la garde du processus principal reste en place (sinon tout ceci n’a plus d’objet)', () => {
    const src = main()
    expect(src).toContain('manifeste signé requis')
    expect(src).toContain('Mise à jour non signée')
  })
})
