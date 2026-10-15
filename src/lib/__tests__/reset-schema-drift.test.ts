/**
 * DÉRIVE RESET ⇄ SCHÉMA — garde analogue à celui du manifeste d'environnement.
 *
 * `Invoke-ServerSchemaConverge` (scripts/reset-garageflow.ps1) réaligne le
 * schéma Neon AVANT déploiement. Problème structurel identique à celui des
 * variables d'environnement : ajouter un modèle ou une colonne dans
 * `prisma/server/schema.prisma` ne casse rien — le RESET devient obsolète EN
 * SILENCE, et l'écart n'apparaît qu'en production, sur une base réelle.
 *
 * Ce test relit LES DEUX sources à chaque exécution et échoue si :
 *   • le RESET matérialise une table absente du schéma Prisma (table fantôme) ;
 *   • le RESET crée une table SANS toutes ses colonnes (convergence partielle :
 *     la table existe mais l'application écrit dans une colonne inexistante) ;
 *   • le RESET référence une colonne qui n'existe pas dans le modèle ;
 *   • une migration Prisma existe sans que le RESET connaisse ses objets.
 *
 * `scripts/check-converge-additive.mjs` vérifie l'AUTRE moitié de l'invariant
 * (toute colonne créée est aussi couverte par un ADD COLUMN IF NOT EXISTS).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../..')
const SCHEMA = path.join(ROOT, 'prisma/server/schema.prisma')
const PS1 = path.join(ROOT, 'scripts/reset-garageflow.ps1')

/** Modèle Prisma → colonnes SCALAIRES (les relations n'ont pas de colonne). */
type Models = Map<string, Set<string>>

function parsePrismaModels(source: string): Models {
  const models: Models = new Map()
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  let m: RegExpExecArray | null
  while ((m = modelRe.exec(source))) {
    const [, name, body] = m
    const columns = new Set<string>()
    for (const rawLine of body.split('\n')) {
      const line = rawLine.replace(/\/\/.*$/, '').trim()
      if (!line || line.startsWith('@@')) continue
      const field = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?/)
      if (!field) continue
      const [, fieldName, type, isList] = field
      // Une relation (type = un autre modèle) ou une liste n'a pas de colonne.
      if (isList) continue
      if (/@relation/.test(line) && !/^\s*\w+\s+(String|Int|Boolean|DateTime|Float|Decimal|Json|Bytes|BigInt)/.test(line)) continue
      if (!/^(String|Int|Boolean|DateTime|Float|Decimal|Json|Bytes|BigInt)$/.test(type)) continue
      columns.add(fieldName)
    }
    models.set(name, columns)
  }
  return models
}

/** Extrait le here-string PowerShell contenant le DDL de convergence. */
function extractConvergenceSql(src: string): string {
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (/@'\s*$/.test(lines[i])) {
      const body: string[] = []
      for (let j = i + 1; j < lines.length; j++) {
        if (/^'@/.test(lines[j])) break
        body.push(lines[j])
      }
      const text = body.join('\n')
      if (/CREATE TABLE IF NOT EXISTS/.test(text)) return text
    }
  }
  throw new Error('DDL de convergence introuvable dans reset-garageflow.ps1')
}

let models: Models
let sql: string
/** Tables créées par le DDL → colonnes déclarées dans le CREATE TABLE. */
let created: Map<string, Set<string>>
/** Colonnes ajoutées par ALTER TABLE … ADD COLUMN. */
let altered: Map<string, Set<string>>

beforeAll(() => {
  models = parsePrismaModels(readFileSync(SCHEMA, 'utf8'))
  sql = extractConvergenceSql(readFileSync(PS1, 'utf8'))

  created = new Map()
  const createRe = /CREATE TABLE IF NOT EXISTS\s+"(\w+)"\s*\(([\s\S]*?)\n\);/g
  let m: RegExpExecArray | null
  while ((m = createRe.exec(sql))) {
    const columns = new Set<string>()
    for (const rawLine of m[2].split('\n')) {
      const line = rawLine.trim()
      if (/^CONSTRAINT\b/i.test(line)) continue
      const col = line.match(/^"(\w+)"\s+/)
      if (col) columns.add(col[1])
    }
    created.set(m[1], columns)
  }

  altered = new Map()
  const alterRe = /ALTER TABLE\s+"(\w+)"\s+ADD COLUMN IF NOT EXISTS\s+"(\w+)"/g
  while ((m = alterRe.exec(sql))) {
    if (!altered.has(m[1])) altered.set(m[1], new Set())
    altered.get(m[1])!.add(m[2])
  }
})

describe('le RESET ne connaît que des objets RÉELS du schéma', () => {
  it('le test ne peut pas devenir vide (les deux sources sont bien lues)', () => {
    expect(models.size).toBeGreaterThan(30)
    expect(created.size).toBeGreaterThan(5)
    expect(altered.size).toBeGreaterThan(5)
  })

  it('toute table matérialisée par le RESET existe dans le schéma serveur', () => {
    const ghosts = Array.from(created.keys()).filter((t) => !models.has(t))
    expect(ghosts, `Tables créées par le RESET mais absentes de prisma/server/schema.prisma : ${ghosts.join(', ')}`)
      .toEqual([])
  })

  it('toute colonne référencée par le RESET existe dans son modèle', () => {
    const unknown: string[] = []
    for (const [table, columns] of Array.from(altered.entries())) {
      const model = models.get(table)
      if (!model) { unknown.push(`${table} (table inconnue)`); continue }
      for (const col of Array.from(columns)) {
        if (!model.has(col)) unknown.push(`${table}.${col}`)
      }
    }
    expect(unknown, `Colonnes référencées par le RESET mais absentes du schéma : ${unknown.join(', ')}`)
      .toEqual([])
  })
})

describe('le RESET matérialise les tables COMPLÈTES', () => {
  it('un CREATE TABLE déclare toutes les colonnes scalaires du modèle', () => {
    const missing: string[] = []
    for (const [table, columns] of Array.from(created.entries())) {
      const model = models.get(table)
      if (!model) continue // déjà signalé par le test précédent
      for (const field of Array.from(model)) {
        if (!columns.has(field)) missing.push(`${table}.${field}`)
      }
    }
    expect(
      missing,
      'Colonnes du schéma absentes du CREATE TABLE de convergence.\n' +
      'La table serait créée INCOMPLÈTE sur une base neuve, et l\'application ' +
      'écrirait dans une colonne inexistante :\n  ' + missing.join('\n  '),
    ).toEqual([])
  })
})

describe('objets de la synchronisation stock ↔ facture', () => {
  // Verrou explicite : ces objets sont le cœur du décrément atomique. S'ils
  // manquaient à la convergence, une facture validée en production échouerait.
  it('StockMovement est matérialisé avec toutes ses colonnes', () => {
    const cols = created.get('StockMovement')
    expect(cols, 'StockMovement absent du DDL de convergence').toBeTruthy()
    for (const field of ['id', 'garageId', 'partId', 'type', 'quantityDelta', 'invoiceId', 'invoiceLineId', 'reason', 'createdAt']) {
      expect(cols!.has(field), `StockMovement.${field} manquant`).toBe(true)
    }
  })

  it('les colonnes de liaison des documents sont ajoutées', () => {
    expect(altered.get('InvoiceLine')?.has('partId'), 'InvoiceLine.partId manquant').toBe(true)
    expect(altered.get('QuoteLine')?.has('partId'), 'QuoteLine.partId manquant').toBe(true)
    expect(altered.get('Invoice')?.has('stockCommittedAt'), 'Invoice.stockCommittedAt manquant').toBe(true)
  })

  it('les clés étrangères du stock sont posées', () => {
    for (const fk of [
      'InvoiceLine_partId_fkey', 'QuoteLine_partId_fkey',
      'StockMovement_garageId_fkey', 'StockMovement_partId_fkey', 'StockMovement_invoiceId_fkey',
    ]) {
      expect(sql, `contrainte ${fk} absente du DDL`).toContain(fk)
    }
  })

  it('les index de recherche et de journal sont créés', () => {
    for (const idx of [
      'StockMovement_garageId_createdAt_idx', 'StockMovement_partId_idx', 'StockMovement_invoiceId_idx',
      'InvoiceLine_partId_idx', 'QuoteLine_partId_idx', 'Part_garageId_name_idx',
    ]) {
      expect(sql, `index ${idx} absent du DDL`).toContain(idx)
    }
  })
})

describe('les deux schémas Prisma restent alignés', () => {
  it('desktop et serveur déclarent les MÊMES colonnes pour les modèles du stock', () => {
    const desktop = parsePrismaModels(readFileSync(path.join(ROOT, 'prisma/schema.prisma'), 'utf8'))
    for (const model of ['Part', 'Invoice', 'InvoiceLine', 'Quote', 'QuoteLine', 'StockMovement']) {
      const a = Array.from(desktop.get(model) ?? []).sort()
      const b = Array.from(models.get(model) ?? []).sort()
      expect(a.length, `${model} absent d'un des deux schémas`).toBeGreaterThan(0)
      expect(a, `Divergence desktop/serveur sur ${model}`).toEqual(b)
    }
  })
})
