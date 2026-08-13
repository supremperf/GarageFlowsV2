/**
 * GF31-AUD-024 — l'amorçage des suites d'intégration ne doit plus dépendre de
 * la charge de la machine.
 *
 * Vingt-cinq suites lançaient chacune le CLI Prisma dans leur `beforeAll`. Le
 * `hookTimeout` avait déjà été relevé de 10 à 30 s pour ce motif ; il a de
 * nouveau été dépassé le 2026-08-13 sur `suppliers.test.ts`, qui passe pourtant
 * SEUL en 11,3 s. Relever un délai déplace le seuil, il ne corrige rien (§151).
 *
 * Le schéma est désormais construit UNE fois par empreinte de `schema.prisma`,
 * puis copié. Ces contrôles verrouillent les trois propriétés qui comptent.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { prepareTestDb } from '../prepare-test-db'

const ROOT = path.resolve(__dirname, '../../..')
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'gf-test-db')
const empreinte = () =>
  createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'prisma', 'schema.prisma'))).digest('hex').slice(0, 16)

describe('GF31-AUD-024 — modèle de base de test partagé', () => {
  it('produit une base exploitable, et le modèle porte l’empreinte du schéma', () => {
    const cible = path.join(ROOT, '.tmp-itest-prepare-a.db')
    try {
      prepareTestDb(cible)
      expect(fs.existsSync(cible)).toBe(true)
      expect(fs.statSync(cible).size).toBeGreaterThan(0)

      const modele = path.join(CACHE, `${empreinte()}.db`)
      expect(fs.existsSync(modele)).toBe(true)
      // La base rendue est bien une COPIE du modèle, à l'octet près.
      expect(fs.readFileSync(cible).equals(fs.readFileSync(modele))).toBe(true)
    } finally {
      fs.rmSync(cible, { force: true })
    }
  })

  it('le second appel réutilise le modèle au lieu de reconstruire', () => {
    const modele = path.join(CACHE, `${empreinte()}.db`)
    const a = path.join(ROOT, '.tmp-itest-prepare-b.db')
    const b = path.join(ROOT, '.tmp-itest-prepare-c.db')
    try {
      prepareTestDb(a)
      const empreinteAvant = fs.statSync(modele).mtimeMs
      const debut = Date.now()
      prepareTestDb(b)
      const duree = Date.now() - debut

      // Le modèle n'a pas été réécrit…
      expect(fs.statSync(modele).mtimeMs).toBe(empreinteAvant)
      // …et une copie de fichier est sans commune mesure avec un démarrage du
      // CLI Prisma (~8 s à vide sur la machine de référence).
      expect(duree).toBeLessThan(2_000)
      expect(fs.existsSync(b)).toBe(true)
    } finally {
      fs.rmSync(a, { force: true })
      fs.rmSync(b, { force: true })
    }
  })

  it('une base déjà présente est REMPLACÉE, jamais réutilisée telle quelle', () => {
    const cible = path.join(ROOT, '.tmp-itest-prepare-d.db')
    try {
      fs.writeFileSync(cible, 'contenu périmé qui n’est pas une base SQLite')
      prepareTestDb(cible)
      expect(fs.readFileSync(cible, 'utf8')).not.toContain('périmé')
      expect(fs.readFileSync(cible).subarray(0, 15).toString()).toContain('SQLite format')
    } finally {
      fs.rmSync(cible, { force: true })
    }
  })

  it('plus aucune suite ne lance le CLI Prisma dans son amorçage', () => {
    const restants: string[] = []
    const parcourir = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { parcourir(p); continue }
        if (!e.name.endsWith('.test.ts')) continue
        // Les suites PostgreSQL amorcent une AUTRE base, hors périmètre.
        if (e.name.includes('postgres.int')) continue
        // Ce fichier-ci cite le motif qu'il traque.
        if (p === __filename) continue
        if (fs.readFileSync(p, 'utf8').includes('npx prisma db push')) restants.push(p)
      }
    }
    parcourir(path.join(ROOT, 'src'))
    expect(restants).toEqual([])
  })
})
