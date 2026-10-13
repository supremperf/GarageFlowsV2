/**
 * GF31-AUD-068 — la porte de release n'était pas idempotente.
 *
 * Deux exécutions consécutives de `npm run release:gate` sur le même arbre
 * donnaient vert puis ROUGE, avec le message le plus alarmant du dépôt :
 *
 *     ❌ Artefact NON conforme :
 *       • Fuite de secrets : .next\standalone\.env présent dans l'artefact.
 *
 * Sans la moindre fuite. Mécanisme : Next (`output: 'standalone'`) trace le
 * `.env` du dépôt dans sa sortie ; `build.extraFiles` recopie **tout**
 * `.next/standalone` dans l'application empaquetée — c'est par ce chemin qu'un
 * `.env` de production s'est déjà retrouvé en clair dans un installateur. Le
 * vrai pipeline s'en protège : `npm run dist` enchaîne `build` PUIS
 * `post-build.js`, qui purge. La porte, elle, ne construisait qu'à moitié :
 * elle laissait le `.env` en place, et son propre `verify-artifact` — qui
 * s'exécute AVANT le build — le trouvait au passage suivant.
 *
 * Les deux moitiés du défaut comptent :
 *   · sur un arbre neuf, `verify-artifact` ne voit rien et passe à VIDE ;
 *   · sur un arbre déjà construit, il refuse un état que le vrai pipeline
 *     nettoie.
 *
 * Ni l'un ni l'autre n'est le contrôle voulu. La correction fait exécuter à la
 * porte la MÊME purge que `post-build`, via une implémentation unique.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const require_ = createRequire(__filename)
const { purgerEnvStandalone } = require_('../../scripts/lib/purge-standalone-env.cjs')

const ROOT = join(__dirname, '../..')
const lire = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const racines: string[] = []
afterEach(() => { for (const r of racines.splice(0)) rmSync(r, { recursive: true, force: true }) })

function standaloneFactice(fichiers: string[]): string {
  const racine = mkdtempSync(join(tmpdir(), 'gf-standalone-'))
  racines.push(racine)
  const dir = join(racine, '.next', 'standalone')
  mkdirSync(dir, { recursive: true })
  for (const f of fichiers) writeFileSync(join(dir, f), 'CONTENU')
  return dir
}

describe('GF31-AUD-068 — la purge du standalone', () => {
  it('retire tous les .env, y compris les variantes', () => {
    const dir = standaloneFactice(['.env', '.env.local', '.env.production', 'server.js'])

    const retires = purgerEnvStandalone(dir)

    expect(retires.sort()).toEqual(['.env', '.env.local', '.env.production'])
    expect(existsSync(join(dir, '.env'))).toBe(false)
    expect(existsSync(join(dir, '.env.production'))).toBe(false)
    // Et rien d'autre : purger n'est pas vider.
    expect(existsSync(join(dir, 'server.js'))).toBe(true)
  })

  it('ne confond pas un fichier qui commence par « env »', () => {
    // `environment.js` n'est pas un `.env`. Une correspondance trop large
    // supprimerait du code de l'application empaquetée.
    const dir = standaloneFactice(['environment.js', 'env.json', '.envrc-ish.txt'])

    expect(purgerEnvStandalone(dir)).toEqual([])
    expect(existsSync(join(dir, 'environment.js'))).toBe(true)
    expect(existsSync(join(dir, 'env.json'))).toBe(true)
  })

  it('sur un arbre jamais construit, ne dit rien et ne lève rien', () => {
    // La porte l'appelle sans savoir si un build a eu lieu : l'absence de
    // répertoire est un cas NORMAL, pas une anomalie à signaler.
    expect(purgerEnvStandalone(join(tmpdir(), 'gf-inexistant-' + process.pid))).toEqual([])
  })
})

describe('GF31-AUD-068 — une seule implémentation, deux appelants', () => {
  it('post-build délègue au module partagé', () => {
    const s = lire('scripts/post-build.js')
    expect(s).toContain("require('./lib/purge-standalone-env.cjs')")
    // La boucle recopiée a disparu : deux copies d'un nettoyage lié aux secrets
    // finissent toujours par diverger.
    expect(s).not.toMatch(/name\.startsWith\('\.env\.'\)/)
  })

  it('la porte de release exécute la même purge après son build', () => {
    const s = lire('scripts/final-release-gate.mjs')
    expect(s).toContain('purgerEnvStandalone')
    // Après le build, pas avant : avant, il n'y a rien à purger.
    const iBuild = s.indexOf("run('Build de production")
    const iPurge = s.indexOf('purgerEnvStandalone(\'.next/standalone\')')
    expect(iBuild).toBeGreaterThan(0)
    expect(iPurge).toBeGreaterThan(iBuild)
  })

  it('le contrôle qui refuse un .env empaqueté reste intact', () => {
    // La correction rend la porte idempotente ; elle n'assouplit RIEN. Un `.env`
    // dans un standalone reste une fuite, et `verify-artifact` doit continuer de
    // le dire — c'est par là qu'une clé est déjà partie dans un installateur.
    const v = lire('scripts/verify-artifact.mjs')
    expect(v).toContain("path.join(ROOT, '.next', 'standalone')")
    expect(v).toMatch(/Fuite de secrets/)
  })
})
