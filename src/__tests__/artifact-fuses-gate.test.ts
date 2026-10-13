/**
 * GF31-AUD-064 — les fuses étaient DEMANDÉS, jamais VÉRIFIÉS sur le binaire.
 *
 * `scripts/afterPack.js` appelle `flipFuses` et le build affiche
 * « ✓ Electron Fuses appliqués ». Mais lire le code qui demande n'est pas
 * vérifier le résultat : une montée de version d'`@electron/fuses`, un
 * `afterPack` qui échouerait sans faire échouer le build, ou un artefact
 * reconstruit à la main produiraient exactement le même message.
 *
 * §115 l'écrit sans ambiguïté : « Vérifier sur artefact réel que les fuses
 * attendus sont effectivement appliqués. Ne pas se contenter du code afterPack. »
 *
 * `check:artifact-fuses` relit donc le fil de fusibles DANS l'exécutable
 * empaqueté. Ces contrôles-ci verrouillent son existence, son câblage dans la
 * chaîne de build et le décodage qui l'a fait mentir une première fois.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const ROOT = path.resolve(__dirname, '../..')
const requis = createRequire(path.join(ROOT, 'package.json'))
const script = () => readFileSync(path.join(ROOT, 'scripts/check-artifact-fuses.mjs'), 'utf8')

describe('GF31-AUD-064 — contrôle des fuses sur l’artefact', () => {
  it('le contrôle est câblé dans `npm run dist`', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    expect(pkg.scripts['check:artifact-fuses']).toBe('node scripts/check-artifact-fuses.mjs')
    // …et il s'exécute APRÈS l'empaquetage, sur ce qui vient d'être produit.
    expect(pkg.scripts.dist).toContain('check:artifact-fuses')
    expect(pkg.scripts.dist.indexOf('electron-builder')).toBeLessThan(
      pkg.scripts.dist.indexOf('check:artifact-fuses'),
    )
  })

  it('il lit le binaire, il ne relit pas afterPack', () => {
    const s = script()
    expect(s).toContain('getCurrentFuseWire')
    expect(s).toMatch(/dist['"\s,)]|win-unpacked/)
  })

  it('il décode les CODES D’OCTET du fil (48/49), erreur qui l’a fait mentir', () => {
    const s = script()
    // Comparer `wire[i]` à un booléen sans décoder lit « désactivé » partout :
    // le contrôle passait alors pour un échec sur un binaire pourtant conforme.
    expect(s).toContain('String.fromCharCode')
    expect(s).toMatch(/'r'/)
  })

  it('il compare au plan RÉEL, pas à une liste recopiée', () => {
    const s = script()
    expect(s).toContain("'fuse-config.js'")
    // Une liste dupliquée finirait par diverger du plan réellement appliqué.
    expect(s).not.toMatch(/const ATTENDUS\s*=\s*\{/)
  })

  it('le plan durcit bien ce qui doit l’être', () => {
    const { fusePlan } = requis(path.join(ROOT, 'scripts/fuse-config.js')) as {
      fusePlan: Record<string, boolean | string>
    }
    // Indices @electron/fuses V1 : 0 RunAsNode, 1 CookieEncryption,
    // 2 NODE_OPTIONS, 3 --inspect, 5 OnlyLoadAppFromAsar, 7 file:// privileges.
    expect(fusePlan['0']).toBe(false)   // pas de mode Node.js caché
    expect(fusePlan['2']).toBe(false)   // NODE_OPTIONS ignoré
    expect(fusePlan['3']).toBe(false)   // débogage distant impossible
    expect(fusePlan['1']).toBe(true)    // cookies chiffrés au repos
    expect(fusePlan['5']).toBe(true)    // chargement depuis l'asar uniquement
    // DOIT rester vrai : sans lui, splash.html échoue en ERR_FILE_NOT_FOUND.
    expect(fusePlan['7']).toBe(true)
  })

  it('sans artefact, il s’annonce NON EXÉCUTÉ — jamais vert en silence', () => {
    const s = script()
    expect(s).toContain('NON EXÉCUTÉ')
    expect(s).toContain('process.exit(0)')
  })

  it('avec un binaire non conforme, il ÉCHOUE (sortie 1)', () => {
    const s = script()
    expect(s).toMatch(/process\.exit\(1\)/)
    expect(s).toContain('artefact non distribuable')
  })
})
