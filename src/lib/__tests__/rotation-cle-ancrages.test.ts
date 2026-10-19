/**
 * GF-001 — une rotation de clé doit déplacer les QUATRE ancrages, pas deux.
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * `Set-LicensePublicKeyInProject` (scripts/reset-garageflow.ps1) ne réécrivait
 * que les deux littéraux de clé publique — `_LINES` de public-key.ts et `_PK`
 * d'electron/main.js. Les deux autres ancrages restaient sur la clé PRÉCÉDENTE :
 *
 *   - `REFERENCE_FP` de public-key-consistency.test.ts ;
 *   - `RETIRED_FINGERPRINTS` de scripts/check-critical-files.js.
 *
 * Constaté après la rotation du 14/08/2026 17:23:57 : la clé embarquée était la
 * bonne (`e6605999…`, qui valide 4/4 licences réelles), mais `keys:check`,
 * `check:critical-files` et deux tests passaient au rouge. Or ce sont
 * précisément les gardes censées signaler une clé MORTE. Une garde qui crie à
 * chaque rotation légitime cesse d'être lue le jour où elle a raison — et ce
 * jour-là, c'est le parc entier qui refuse silencieusement les licences.
 *
 * Le même run laissait ses sauvegardes `.before-*` DANS l'arbre de build.
 * `npm run keys:sync` savait réparer les ancrages, mais rien ne l'appelait :
 * la réparation reposait sur un opérateur qui pense à la lancer.
 *
 * ─── Ce que ce garde vérifie ────────────────────────────────────────────────
 * La forme du script, faute de pouvoir l'exécuter : un run réel effectue une
 * rotation cryptographique de PRODUCTION (Vercel + Neon + licences purgées).
 * On vérifie donc que le code de propagation est toujours là, et que l'arbre
 * est effectivement cohérent ici et maintenant.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const RACINE = path.resolve(__dirname, '../../..')
const lire = (rel: string) => fs.readFileSync(path.join(RACINE, rel), 'utf8')

const SCRIPT = 'scripts/reset-garageflow.ps1'

/** Corps de la fonction PowerShell qui applique la nouvelle clé au projet. */
function corpsSetLicensePublicKey(): string {
  const src = lire(SCRIPT)
  const debut = src.indexOf('function Set-LicensePublicKeyInProject')
  expect(debut, `fonction Set-LicensePublicKeyInProject introuvable dans ${SCRIPT}`).toBeGreaterThan(-1)
  const suite = src.indexOf('\nfunction ', debut + 1)
  return src.slice(debut, suite === -1 ? undefined : suite)
}

/** Empreinte canonique SPKI-DER SHA-256 d'une clé publique PEM. */
function empreinte(pem: string): string {
  return crypto.createHash('sha256')
    .update(crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' }))
    .digest('hex')
}

/** Reconstruit le PEM porté par un littéral `const <nom> = [ '…', … ]`. */
function pemDuLitteral(rel: string, nom: string): string {
  const bloc = lire(rel).match(new RegExp(`const\\s+${nom}\\s*=\\s*\\[([\\s\\S]*?)\\]`))
  expect(bloc, `littéral ${nom} introuvable dans ${rel}`).toBeTruthy()
  return Array.from(bloc![1].matchAll(/'([^']*)'/g), (m) => m[1]).join('\n')
}

describe('rotation de clé — propagation des quatre ancrages (GF-001)', () => {
  it('le script de rotation réécrit aussi REFERENCE_FP', () => {
    const corps = corpsSetLicensePublicKey()
    expect(corps, 'la fonction doit viser le fichier de l’ancre d’empreinte')
      .toContain('public-key-consistency.test.ts')
    expect(corps, 'la fonction doit réécrire la constante REFERENCE_FP')
      .toMatch(/REFERENCE_FP/)
  })

  it('le script de rotation inscrit la clé sortante parmi les empreintes retirées', () => {
    const corps = corpsSetLicensePublicKey()
    expect(corps, 'la fonction doit viser scripts/check-critical-files.js')
      .toContain('check-critical-files.js')
    expect(corps, 'la fonction doit alimenter RETIRED_FINGERPRINTS')
      .toContain('RETIRED_FINGERPRINTS')
  })

  it('l’empreinte SORTANTE est lue AVANT le patch des littéraux', () => {
    // Après le patch, la clé précédente n'existe plus nulle part dans l'arbre :
    // la lire ensuite renverrait la NOUVELLE et inscrirait la bonne clé parmi
    // les retirées — exactement l'inverse du but.
    const corps = corpsSetLicensePublicKey()
    const lecture = corps.indexOf('$outgoingFp')
    const patch = corps.indexOf('$writePatched $path $patched')
    expect(lecture, 'lecture de l’empreinte sortante introuvable').toBeGreaterThan(-1)
    expect(patch, 'écriture des littéraux introuvable').toBeGreaterThan(-1)
    expect(lecture, 'l’empreinte sortante doit être lue avant toute écriture').toBeLessThan(patch)
  })

  it('un run réussi sort les sauvegardes `.before-*` de l’arbre de build', () => {
    // Sans ça : `electron/**/*` les embarque dans app.asar (GF-DUR-034) et la
    // garde de packaging reste rouge après chaque rotation.
    const src = lire(SCRIPT)
    const succes = src.indexOf('$success = $true')
    const echec = src.indexOf('} catch {', succes)
    expect(succes, 'branche de succès introuvable').toBeGreaterThan(-1)
    const branche = src.slice(succes, echec === -1 ? undefined : echec)
    expect(branche, 'le chemin de succès doit déplacer PatchedSourceBackups')
      .toContain('PatchedSourceBackups')
    expect(branche, 'les sauvegardes doivent être DÉPLACÉES, pas supprimées')
      .toContain('Move-Item')
    expect(branche, 'aucune suppression de sauvegarde sur le chemin de succès')
      .not.toMatch(/Remove-Item[^\r\n]*(Backup|before-)/)
  })

  it('les quatre ancrages de l’arbre désignent la MÊME clé', () => {
    const fpTs = empreinte(pemDuLitteral('src/lib/license/public-key.ts', '_LINES'))
    const fpPk = empreinte(pemDuLitteral('electron/main.js', '_PK'))
    const ref = lire('src/lib/license/__tests__/public-key-consistency.test.ts')
      .match(/const\s+REFERENCE_FP\s*=\s*'([0-9a-f]{64})'/)
    expect(ref, 'REFERENCE_FP introuvable').toBeTruthy()
    expect(fpPk, 'electron/main.js et public-key.ts divergent').toBe(fpTs)
    expect(ref![1], 'REFERENCE_FP ne suit pas la clé embarquée').toBe(fpTs)
  })

  it('la clé embarquée n’est pas une empreinte RETIRÉE', () => {
    // Une rotation « à l'envers » (retour sur une clé morte) rend le logiciel
    // inutilisable sans le moindre message : verify() renvoie false, c'est tout.
    const fp = empreinte(pemDuLitteral('src/lib/license/public-key.ts', '_LINES'))
    const retirees = Array.from(
      lire('scripts/check-critical-files.js').matchAll(/\{\s*fp:\s*'([0-9a-f]{64})'/g),
      (m) => m[1],
    )
    expect(retirees.length, 'liste RETIRED_FINGERPRINTS vide ou illisible').toBeGreaterThan(0)
    expect(retirees, `la clé embarquée ${fp.slice(0, 16)}… est marquée retirée`).not.toContain(fp)
  })
})
