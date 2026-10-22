/**
 * Cohérence de la version de Node entre TOUS les environnements d'exécution.
 *
 * POURQUOI CE TEST EXISTE
 * La PWA de production tournait sur Node 24.x alors que la CI, la baseline de
 * vérification et la documentation verrouillent Node 22 — et que Next.js 15.5,
 * la version embarquée, est antérieure à ce majeur. Autrement dit : le seul
 * environnement qui sert de vrais clients était le seul que rien ne testait.
 * C'est la définition même du « ça marche chez moi », déplacée d'un cran.
 *
 * `engines.node` est la déclaration qui fait autorité : Vercel s'en sert pour
 * choisir le runtime de build et d'exécution. Ce test interdit qu'elle dérive
 * de la version réellement éprouvée par la CI.
 *
 * NOTE OPÉRATEUR : `engines.node` pilote les DÉPLOIEMENTS À VENIR. Un
 * déploiement déjà en ligne conserve le runtime avec lequel il a été construit —
 * seul un redéploiement applique ce changement.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../../..')

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

/** Majeur exigé par `engines.node` (« 22.x », « >=22 », « 22.5.0 »…). */
function enginesMajor(): number {
  const pkg = JSON.parse(read('package.json'))
  const range = pkg.engines?.node
  expect(range, 'package.json doit déclarer engines.node — sans quoi Vercel choisit seul le runtime de production').toBeTruthy()
  const m = String(range).match(/(\d+)/)
  expect(m, `engines.node ("${range}") doit mentionner un majeur`).toBeTruthy()
  return Number(m![1])
}

describe('chaîne d\'outils — version de Node cohérente partout', () => {
  it('engines.node fixe le même majeur que toutes les étapes de la CI', () => {
    const ci = read('.github/workflows/ci.yml')
    const versions = Array.from(ci.matchAll(/node-version:\s*'?"?(\d+)/g), (m) => Number(m[1]))

    expect(versions.length, 'aucune étape `node-version:` trouvée dans ci.yml').toBeGreaterThan(0)
    expect(new Set(versions).size, `les étapes CI n'utilisent pas toutes le même Node : ${versions.join(', ')}`).toBe(1)
    expect(versions[0]).toBe(enginesMajor())
  })

  it('le Node qui exécute cette suite satisfait engines.node', () => {
    // Sans quoi la baseline de vérification atteste d'une chaîne d'outils que la
    // déclaration du paquet ne reconnaît pas.
    expect(Number(process.versions.node.split('.')[0])).toBe(enginesMajor())
  })

  it('node:sqlite reste disponible — les tests de migration en dépendent', () => {
    // La CI documente « Node ≥ 22.5 OBLIGATOIRE » pour cette raison : un retour
    // en arrière sous 22.5 rendrait ces tests non exécutables, pas rouges.
    const [major, minor] = process.versions.node.split('.').map(Number)
    expect(major > 22 || (major === 22 && minor >= 5)).toBe(true)
  })
})
