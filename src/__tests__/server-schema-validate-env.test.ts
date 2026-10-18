/**
 * GF31-AUD-025 — `npm run db:server:validate` échouait sur tout poste propre.
 *
 * `prisma/server/schema.prisma` déclare `directUrl = env("DIRECT_URL")`. Prisma
 * exige la variable même pour une validation purement statique : sans elle, la
 * commande documentée au programme (§143) répondait
 * « P1012 Environment variable not found: DIRECT_URL » alors qu'aucun défaut de
 * schéma n'existait. Et `.env.example` annonçait un repli (« sinon = DATABASE_URL »)
 * que Prisma n'applique nulle part — documentation contredite par le code (§165).
 *
 * Ces tests verrouillent les deux moitiés de la correction : la règle de
 * substitution, et le fait que le script npm passe bien par elle.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  resolveValidationEnv,
  SUBSTITUT_VALIDATION,
} from '../../scripts/lib/server-schema-env.mjs'

const ROOT = path.resolve(__dirname, '../..')

describe('GF31-AUD-025 — environnement de validation du schéma serveur', () => {
  it('DIRECT_URL fournie : rien n’est substitué', () => {
    const vraie = 'postgresql://user:mdp@host-direct:5432/garageflow'
    const r = resolveValidationEnv({ DIRECT_URL: vraie, DATABASE_URL: 'postgresql://pooler/x' })
    expect(r.substituted).toBe(false)
    expect(r.source).toBe('fourni')
    expect(r.env.DIRECT_URL).toBe(vraie)
  })

  it('DIRECT_URL absente mais DATABASE_URL présente : on reste au plus près du poste', () => {
    const r = resolveValidationEnv({ DATABASE_URL: 'file:./dev.db' })
    expect(r.substituted).toBe(true)
    expect(r.source).toBe('DATABASE_URL')
    expect(r.env.DIRECT_URL).toBe('file:./dev.db')
  })

  it('les deux absentes : substitut explicite, jamais une chaîne vide', () => {
    const r = resolveValidationEnv({})
    expect(r.substituted).toBe(true)
    expect(r.source).toBe('substitut')
    expect(r.env.DIRECT_URL).toBe(SUBSTITUT_VALIDATION)
    expect(r.env.DIRECT_URL).toMatch(/^postgresql:\/\//)
  })

  it('n’écrase aucune autre variable de l’environnement', () => {
    const r = resolveValidationEnv({ NEXTAUTH_SECRET: 'abc', PATH: '/usr/bin' })
    expect(r.env.NEXTAUTH_SECRET).toBe('abc')
    expect(r.env.PATH).toBe('/usr/bin')
  })

  it('le script npm passe par l’enrobage — sinon la correction serait contournée', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    expect(pkg.scripts['db:server:validate']).toBe('node scripts/validate-server-schema.mjs')
  })

  it('l’enrobage lance le Prisma DU PROJET, pas `npx` (EINVAL silencieux sous Windows)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/validate-server-schema.mjs'), 'utf8')
    // On raisonne sur le CODE seul : le fichier EXPLIQUE en commentaire pourquoi
    // `npx` a été abandonné, et cette prose ne doit pas faire échouer l'assertion.
    const code = src
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')
    // Sous Windows, spawnSync sur un `.cmd` sans shell échoue en EINVAL : le
    // script rendait alors 1 SANS aucune sortie — un échec de lancement
    // indiscernable d'un vrai défaut de schéma.
    expect(code).toContain('process.execPath')
    expect(code).not.toMatch(/spawnSync\([^)]*npx/)
    expect(code).toContain('r.error')
  })

  it('le repli n’est PAS étendu aux migrations : elles exigent une vraie URL directe', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    // Substituer l'URL POOLÉE à l'URL directe produirait des migrations
    // instables (PgBouncer) — précisément ce que la séparation url/directUrl
    // existe pour éviter. Ces deux scripts doivent rester des appels Prisma nus.
    expect(pkg.scripts['db:server:deploy']).not.toContain('validate-server-schema')
    expect(pkg.scripts['db:server:migrate']).not.toContain('validate-server-schema')
  })
})
