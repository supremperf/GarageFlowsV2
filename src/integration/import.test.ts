/**
 * Import CSV — test d'intégration SQLite : exécution TRANSACTIONNELLE, dry-run
 * sans écriture, dédoublonnage vs existant, neutralisation d'injection stockée,
 * et ISOLATION multi-tenant (l'import n'écrit que dans le garage cible).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { parseCsv, splitHeader } from '@/lib/import/csv'
import { autoMap, executeImport, planImport, loadExistingKeys } from '@/lib/import/wizard'

const DB_PATH = path.resolve(__dirname, '../../.tmp-itest-import.db')
process.env.DATABASE_URL = `file:${DB_PATH}`

let prisma: any
let garageA: string
let garageB: string

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` }, stdio: 'ignore',
  })
  ;({ prisma } = await import('@/lib/db'))
  garageA = (await prisma.garage.create({ data: { name: 'A', slug: 'a' } })).id
  garageB = (await prisma.garage.create({ data: { name: 'B', slug: 'b' } })).id
}, 40_000)

afterAll(() => { try { fs.rmSync(DB_PATH) } catch { /* ignore */ } })

function prep(csv: string) {
  const { header, rows } = splitHeader(parseCsv(csv))
  return { rows, mapping: autoMap('clients', header) }
}

describe('import clients — exécution transactionnelle & isolation', () => {
  it('dry-run n\'écrit rien', async () => {
    const { rows, mapping } = prep('nom,email\nAlice,alice@a.fr')
    const existing = await loadExistingKeys(prisma, 'clients', garageA)
    const plan = planImport({ entity: 'clients', rows, mapping, existingKeys: existing })
    expect(plan.toCreate).toHaveLength(1)
    expect(await prisma.client.count({ where: { garageId: garageA } })).toBe(0)
  })

  it('exécute l\'import dans le garage cible uniquement', async () => {
    const { rows, mapping } = prep('nom,email\nAlice,alice@a.fr\nBob,bob@a.fr')
    const { created } = await executeImport(prisma, { entity: 'clients', rows, mapping, garageId: garageA })
    expect(created).toBe(2)
    expect(await prisma.client.count({ where: { garageId: garageA } })).toBe(2)
    // Isolation : rien n'a été écrit dans le garage B.
    expect(await prisma.client.count({ where: { garageId: garageB } })).toBe(0)
  })

  it('ne recrée pas un doublon déjà importé', async () => {
    const { rows, mapping } = prep('nom,email\nAlice,alice@a.fr\nCharlie,charlie@a.fr')
    const { created, plan } = await executeImport(prisma, { entity: 'clients', rows, mapping, garageId: garageA })
    expect(created).toBe(1)               // Alice existe déjà
    expect(plan.duplicatesExisting).toBe(1)
    expect(await prisma.client.count({ where: { garageId: garageA } })).toBe(3)
  })

  it('stocke une valeur neutralisée (anti-injection) plutôt que la formule brute', async () => {
    const { rows, mapping } = prep('nom,email\n=cmd|calc,evil@a.fr')
    await executeImport(prisma, { entity: 'clients', rows, mapping, garageId: garageA })
    const evil = await prisma.client.findFirst({ where: { garageId: garageA, email: 'evil@a.fr' } })
    expect(evil.name.startsWith("'=")).toBe(true) // neutralisé
  })

  it('le même email peut coexister dans deux garages différents (isolation)', async () => {
    const { rows, mapping } = prep('nom,email\nAlice,alice@a.fr')
    const { created } = await executeImport(prisma, { entity: 'clients', rows, mapping, garageId: garageB })
    expect(created).toBe(1) // pas un doublon dans B
    expect(await prisma.client.count({ where: { garageId: garageB } })).toBe(1)
  })
})
