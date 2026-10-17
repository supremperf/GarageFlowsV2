/**
 * GF-008 / GF-009 — « Changer de licence » mentait des deux côtés.
 *
 * ─── GF-008, côté navigateur / PWA ──────────────────────────────────────────
 * `LicenseChangeModal` envoyait `{ token }` alors que `/api/license/activate`
 * lit `body.license` : le serveur recevait une licence VIDE et refusait TOUTE
 * clé, même parfaitement valide. Deux défauts s'y ajoutaient — aucun
 * `installId` (que la route exige hors Electron pour toute licence non-admin),
 * et un message d'erreur lu dans `data.error`, champ que cette route n'émet
 * jamais : le motif réel du refus était systématiquement remplacé par un
 * « Licence invalide » générique. Le garage concluait que sa clé achetée était
 * cassée. La branche Electron fonctionnant, le défaut ne se voyait pas en
 * recette sur poste.
 *
 * ─── GF-009, côté poste ─────────────────────────────────────────────────────
 * `ipcMain.handle('app:update-license')` appelait `activateOnServer()` SANS
 * lire sa valeur, puis renvoyait inconditionnellement `{ ok: true }`. Or cette
 * fonction renvoie `null` sur refus EXPLICITE de l'autorité distante — siège
 * déjà consommé, licence révoquée, empreinte matérielle d'une autre machine.
 * Le poste affichait donc « Licence activée (premium) » et se rechargeait,
 * alors que la clé avait déjà été écrite sur le disque et ses cookies posés.
 *
 * La correction devait distinguer deux `null` très différents : autorité
 * INJOIGNABLE (hors ligne — le produit doit continuer de fonctionner) et REFUS
 * EXPLICITE (réponse définitive). C'est `lastActivationRefusal.authority` qui
 * les sépare.
 *
 * Ces deux chemins ne sont pas exécutables ici (l'un est un composant React
 * sans environnement DOM, l'autre vit dans le processus principal d'Electron) :
 * le garde porte donc sur la FORME, et sur la correspondance des noms de champs
 * entre les deux moitiés — c'est précisément ce qui avait divergé.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(__dirname, '../../..')
const lire = (rel: string) => fs.readFileSync(path.join(RACINE, rel), 'utf8')

/** ORDRE IMPOSÉ (GF-DUR-046) : lignes `//` d'abord, blocs ensuite. */
function sansCommentaires(src: string): string {
  return src
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
}

describe('changement de licence — navigateur et PWA (GF-008)', () => {
  const modale = () => sansCommentaires(lire('src/components/LicenseChangeModal.tsx'))
  const route = () => sansCommentaires(lire('src/app/api/license/activate/route.ts'))

  it('le corps envoyé porte le champ que la route lit', () => {
    const champsLus = Array.from(route().matchAll(/body\.([A-Za-z_][A-Za-z0-9_]*)/g), (m) => m[1])
    expect(champsLus, 'la route doit lire `license`').toContain('license')
    expect(champsLus, 'la route ne lit pas `token`').not.toContain('token')

    const corps = modale().match(/JSON\.stringify\(\{([^}]*)\}/)
    expect(corps, 'corps de la requête d’activation introuvable').toBeTruthy()
    expect(corps![1], 'le corps doit porter `license`').toMatch(/\blicense\s*:/)
    expect(corps![1], 'le corps ne doit plus porter `token`').not.toMatch(/\btoken\s*:/)
  })

  it('l’identifiant d’installation est transmis (sinon DEVICE_REQUIRED)', () => {
    expect(modale()).toContain('getOrCreateInstallId')
    expect(modale()).toMatch(/installId/)
  })

  it('le motif du refus affiché est celui que la route émet', () => {
    // La route répond `{ ok:false, code, reason }` — jamais `error`.
    expect(route(), 'la route émet `reason`').toMatch(/reason\s*:/)
    expect(modale(), 'message partagé distinguant infra/métier').toContain('activationErrorMessage(data, res.status)')
  })

  it('le succès est décidé par `data.ok`, pas par le seul statut HTTP', () => {
    // Cette route répond 200 avec `ok:false` sur certains refus : se fier à
    // `res.ok` ferait passer un refus pour une activation.
    expect(modale()).toMatch(/data\.ok/)
  })
})

describe('changement de licence — poste Electron (GF-009)', () => {
  const main = () => sansCommentaires(lire('electron/main.js'))

  /** Corps du gestionnaire IPC de changement de licence. */
  function gestionnaire(): string {
    const src = main()
    const debut = src.indexOf("ipcMain.handle('app:update-license'")
    expect(debut, 'gestionnaire app:update-license introuvable').toBeGreaterThan(-1)
    const suite = src.indexOf('ipcMain.handle(', debut + 10)
    return src.slice(debut, suite === -1 ? debut + 6000 : suite)
  }

  it('le verdict de `activateOnServer()` est LU', () => {
    const g = gestionnaire()
    expect(g, 'la valeur de retour doit être capturée').toMatch(/=\s*await\s+activateOnServer\(\)/)
    expect(g, 'appel dont le résultat est jeté').not.toMatch(/^\s*await\s+activateOnServer\(\)\s*$/m)
  })

  it('tout échec de l’autorité distante renvoie ok:false', () => {
    const g = gestionnaire()
    expect(g, 'seul un succès distant permet la bascule').toContain("autorite !== 'remote'")
    expect(g, 'un refus doit produire une réponse négative').toMatch(/ok:\s*false/)
  })

  it('une nouvelle activation hors ligne est refusée, sans fallback silencieux', () => {
    expect(gestionnaire()).toContain("if (autorite !== 'remote')")
  })

  it('l’état précédent est restauré au lieu de laisser la clé refusée sur le disque', () => {
    const g = gestionnaire()
    expect(g).toMatch(/licencePrecedente/)
    expect(g, 'la licence précédente doit être ré-enregistrée').toMatch(/saveLicense\(\s*licencePrecedente/)
  })
})
