/**
 * CONTRAT D'ENVIRONNEMENT — une configuration, UN nom canonique.
 *
 * Deux niveaux sont verrouillés ici :
 *
 *   • le REGISTRE (scripts/garageflow-env-manifest.json) doit rester cohérent :
 *     pas d'alias interdit qui serait aussi déclaré comme variable, pas de nom à
 *     la fois « canonique » et « fourni par la plateforme », chaque alias
 *     pointant vers un canonique qui existe réellement ;
 *
 *   • le RUNTIME (validateEnv) ne doit JAMAIS accepter un alias à la place du
 *     nom canonique. C'est le cœur de l'incident du 15/08/2026 :
 *     `PWA_DATABASE_URL` portait la valeur, un patch de déploiement la recopiait
 *     vers `DATABASE_URL`, et la production dépendait d'un code absent du dépôt.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { validateEnv, assertEnv } from '@/lib/env'

const MANIFESTE = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../scripts/garageflow-env-manifest.json'), 'utf8'),
) as {
  variables: { name: string; classification?: string }[]
  platformProvided: string[]
  forbiddenAliases: Record<string, { canonical: string; reason: string }>
}

const OLD = { ...process.env }
afterEach(() => {
  process.env = { ...OLD }
  vi.unstubAllEnvs()
})

/** Configuration PWA production minimale et VALIDE, hors base de données. */
function pwaProductionValide() {
  vi.stubEnv('NODE_ENV', 'production')
  delete process.env.ELECTRON
  process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
  process.env.DEVICE_TOKEN_PEPPER = 'p'.repeat(40)
  process.env.UPSTASH_REDIS_REST_URL = 'https://exemple.upstash.io'
  process.env.UPSTASH_REDIS_REST_TOKEN = 't'.repeat(32)
  process.env.TRUST_PROXY_HEADERS = '1'
}

const problemeDe = (nom: string) =>
  validateEnv().issues.find((i) => i.name === nom)?.problem ?? ''

describe('Registre canonique — invariants du manifeste', () => {
  it('déclare des alias interdits et une liste plateforme', () => {
    expect(Object.keys(MANIFESTE.forbiddenAliases).length).toBeGreaterThan(0)
    expect(MANIFESTE.platformProvided.length).toBeGreaterThan(20)
    expect(MANIFESTE.variables.length).toBeGreaterThan(50)
  })

  it('aucun alias interdit n’est simultanément déclaré comme variable', () => {
    const canoniques = new Set(MANIFESTE.variables.map((v) => v.name))
    const contradictions = Object.keys(MANIFESTE.forbiddenAliases).filter((a) => canoniques.has(a))
    expect(contradictions, 'un nom ne peut pas être à la fois banni et officiel').toEqual([])
  })

  it('chaque alias pointe vers un nom canonique qui EXISTE', () => {
    const canoniques = new Set(MANIFESTE.variables.map((v) => v.name))
    const orphelins = Object.entries(MANIFESTE.forbiddenAliases)
      .filter(([, spec]) => !canoniques.has(spec.canonical))
      .map(([alias, spec]) => `${alias} → ${spec.canonical}`)
    expect(orphelins, 'rediriger vers un nom inexistant ne guide personne').toEqual([])
  })

  // `platformProvided` est une liste d'EXEMPTION pour le balayage (« ce nom peut
  // apparaître sans être déclaré »), pas une liste concurrente. Un nom peut donc
  // légitimement figurer dans les deux : exempté ET documenté. Ce qui serait
  // grave, c'est qu'une variable de PRODUCTION s'y glisse — elle échapperait
  // alors au contrôle de déclaration tout en étant réellement à provisionner.
  it('seules les variables système ou de test peuvent être exemptées du balayage', () => {
    const plateforme = new Set(MANIFESTE.platformProvided)
    const suspectes = MANIFESTE.variables
      .filter((v) => plateforme.has(v.name))
      .filter((v) => !['runtime-system', 'test-external'].includes(String(v.classification)))
      .map((v) => `${v.name} (${v.classification})`)
    expect(suspectes, 'une variable à provisionner ne doit pas être exemptée').toEqual([])
  })

  it('chaque alias interdit est JUSTIFIÉ par écrit', () => {
    const sansRaison = Object.entries(MANIFESTE.forbiddenAliases)
      .filter(([, spec]) => !spec.reason || spec.reason.length < 30)
      .map(([alias]) => alias)
    expect(sansRaison, 'un bannissement sans motif sera un jour annulé à tort').toEqual([])
  })

  it('PWA_DATABASE_URL et PWA_DIRECT_URL sont bannies vers les noms Prisma', () => {
    expect(MANIFESTE.forbiddenAliases.PWA_DATABASE_URL?.canonical).toBe('DATABASE_URL')
    expect(MANIFESTE.forbiddenAliases.PWA_DIRECT_URL?.canonical).toBe('DIRECT_URL')
  })
})

describe('Runtime — aucun alias ne remplace un nom canonique', () => {
  // TEST A du contrat : la configuration canonique complète est acceptée.
  it('A — les noms canoniques présents suffisent', () => {
    pwaProductionValide()
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db'
    expect(validateEnv().ok).toBe(true)
    expect(() => assertEnv()).not.toThrow()
  })

  // TEST B : l'alias SEUL ne doit rien débloquer. Si ce test devenait vert avec
  // DATABASE_URL absente, c'est qu'un repli silencieux serait réapparu.
  it('B — l’alias PWA_DATABASE_URL seul ne remplace pas DATABASE_URL', () => {
    pwaProductionValide()
    delete process.env.DATABASE_URL
    process.env.PWA_DATABASE_URL = 'postgresql://u:p@h:5432/db'
    expect(validateEnv().ok).toBe(false)
    expect(problemeDe('DATABASE_URL')).toMatch(/absent/i)
    expect(() => assertEnv()).toThrow(/Démarrage refusé/)
  })

  // TEST C : une typo n'est pas « presque bon » — le nom canonique est absent.
  it('C — une typo (DATABSE_URL) laisse DATABASE_URL absente', () => {
    pwaProductionValide()
    delete process.env.DATABASE_URL
    process.env.DATABSE_URL = 'postgresql://u:p@h:5432/db'
    expect(validateEnv().ok).toBe(false)
    expect(problemeDe('DATABASE_URL')).toMatch(/absent/i)
  })

  // TEST F : une espace en tête n'est pas « rattrapée » en silence. Normaliser
  // ici masquerait une erreur de déploiement qu'il vaut mieux voir échouer.
  it('F — une espace parasite en tête est REFUSÉE, pas rognée', () => {
    pwaProductionValide()
    process.env.DATABASE_URL = ' postgresql://u:p@h:5432/db'
    expect(validateEnv().ok).toBe(false)
    expect(problemeDe('DATABASE_URL')).toMatch(/schéma non reconnu/)
  })
})
