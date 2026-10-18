/**
 * DÉRIVE SCHÉMA POSTE ⇄ MIGRATIONS SQLITE — la garde qui manquait.
 *
 * ─── Le défaut réel qu'elle attrape ─────────────────────────────────────────
 * La synchronisation stock ↔ facture a livré sa migration PostgreSQL
 * (`prisma/server/migrations/20260811000000_invoice_stock_sync`) mais AUCUNE
 * contrepartie SQLite. Les deux schémas Prisma déclaraient pourtant déjà
 * `Invoice.stockCommittedAt`, `InvoiceLine.partId`, `QuoteLine.partId` et le
 * modèle `StockMovement`.
 *
 * Rien n'échouait : ni `tsc`, ni ESLint, ni `prisma validate`, ni les tests.
 * Le poste, lui, tombait à la première requête sur une base réelle :
 *
 *     The column `main.Invoice.stockCommittedAt` does not exist
 *       → HTTP 500 sur /api/invoices ET /api/quotes
 *       → module « Devis & Factures » entièrement hors service,
 *         l'interface affichant paisiblement « Aucune facture ».
 *
 * ─── L'invariant vérifié ────────────────────────────────────────────────────
 * `prisma/garageflow-template.db` est le modèle livré aux NOUVELLES
 * installations et il est baseliné avec la TOTALITÉ de `src/lib/migrations.ts`
 * (garanti par scripts/check-sqlite-template.mjs). Une colonne présente dans le
 * modèle est donc exactement une colonne qu'une base poste — neuve ou migrée —
 * possédera. Toute colonne du schéma Prisma absente du modèle est une colonne
 * que l'application VA interroger et que la base N'A PAS.
 *
 * On vérifie aussi que les deux schémas Prisma restent structurellement
 * identiques : c'est l'hypothèse explicite de src/lib/db.ts, qui fait passer les
 * deux clients pour un seul type. Une colonne ajoutée d'un seul côté produit un
 * poste et une PWA aux contrats divergents — précisément le défaut ci-dessus.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../..')
const DESKTOP_SCHEMA = path.join(ROOT, 'prisma/schema.prisma')
const SERVER_SCHEMA = path.join(ROOT, 'prisma/server/schema.prisma')
const TEMPLATE = path.join(ROOT, 'prisma/garageflow-template.db')

/** Modèle Prisma → colonnes SCALAIRES (une relation n'a pas de colonne). */
type Models = Map<string, Set<string>>

const SCALARS = /^(String|Int|Boolean|DateTime|Float|Decimal|Json|Bytes|BigInt)$/

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
      if (isList) continue
      if (!SCALARS.test(type)) continue
      columns.add(fieldName)
    }
    models.set(name, columns)
  }
  return models
}

let desktop: Models
let server: Models
/** Tables réellement présentes dans le modèle livré → colonnes réelles. */
let template: Map<string, Set<string>>

beforeAll(() => {
  desktop = parsePrismaModels(readFileSync(DESKTOP_SCHEMA, 'utf8'))
  server = parsePrismaModels(readFileSync(SERVER_SCHEMA, 'utf8'))

  template = new Map()
  if (!existsSync(TEMPLATE)) return
  const db = new DatabaseSync(TEMPLATE)
  try {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .all() as Array<{ name: string }>
    for (const { name } of tables) {
      const cols = db.prepare(`PRAGMA table_info("${name.replace(/"/g, '""')}")`).all() as Array<{ name: string }>
      template.set(name, new Set(cols.map((c) => c.name)))
    }
  } finally {
    db.close()
  }
})

describe('schéma poste ⇄ modèle SQLite livré', () => {
  it('le modèle de base existe (sinon toute installation neuve est aveugle)', () => {
    expect(existsSync(TEMPLATE)).toBe(true)
    expect(template.size).toBeGreaterThan(10)
  })

  it('chaque modèle Prisma du poste a sa table dans le modèle livré', () => {
    const missing = Array.from(desktop.keys()).filter((model) => !template.has(model))
    expect(
      missing,
      `Modèle(s) déclaré(s) dans prisma/schema.prisma sans table côté poste : ${missing.join(', ')}.\n` +
        'Ajoutez la migration correspondante dans src/lib/migrations.ts puis rebaselinez le modèle ' +
        '(node scripts/baseline-template.mjs).',
    ).toEqual([])
  })

  it('chaque colonne scalaire du schéma poste existe dans le modèle livré', () => {
    const missing: string[] = []
    for (const [model, columns] of Array.from(desktop.entries())) {
      const actual = template.get(model)
      if (!actual) continue // signalé par le test précédent
      Array.from(columns).forEach((column) => {
        if (!actual.has(column)) missing.push(`${model}.${column}`)
      })
    }
    expect(
      missing,
      `Colonne(s) interrogée(s) par l'application mais ABSENTE(S) de toute base poste : ${missing.join(', ')}.\n` +
        'C’est exactement le défaut qui a mis /api/invoices et /api/quotes en HTTP 500. ' +
        'Ajoutez un ALTER TABLE … ADD COLUMN dans src/lib/migrations.ts (avec onlyIfColumnMissing) ' +
        'puis rebaselinez le modèle (node scripts/baseline-template.mjs).',
    ).toEqual([])
  })
})

/**
 * Modèles VOLONTAIREMENT absents du poste : la facturation électronique (Phase
 * 2/3, PDP) est une fonction de la plateforme cloud, jamais exécutée sur un
 * poste hors ligne. Aucun code applicatif partagé ne les interroge — seul le
 * client Prisma généré les expose. Toute AUTRE divergence est un défaut : la
 * liste est donc explicite et fermée.
 */
const SERVER_ONLY_MODELS = new Set([
  'GarageEInvoiceConnection',
  'EInvoiceTransmission',
  'EInvoiceEvent',
  'EInvoiceAuditEvent',
])

describe('parité des deux schémas Prisma', () => {
  it('les mêmes modèles sont déclarés des deux côtés', () => {
    const onlyDesktop = Array.from(desktop.keys()).filter((k) => !server.has(k))
    const onlyServer = Array.from(server.keys()).filter((k) => !desktop.has(k) && !SERVER_ONLY_MODELS.has(k))
    expect(
      { onlyDesktop, onlyServer },
      'src/lib/db.ts fait passer les deux clients Prisma pour un seul type : les schémas doivent déclarer les mêmes modèles.',
    ).toEqual({ onlyDesktop: [], onlyServer: [] })
  })

  it('la dérogation e-facturation reste juste (aucun modèle listé à tort)', () => {
    const stale = Array.from(SERVER_ONLY_MODELS).filter((m) => !server.has(m) || desktop.has(m))
    expect(stale, 'Dérogation obsolète : ces modèles ne sont plus « serveur uniquement ».').toEqual([])
  })

  it('les mêmes colonnes sont déclarées des deux côtés', () => {
    const divergences: string[] = []
    for (const [model, columns] of Array.from(desktop.entries())) {
      if (SERVER_ONLY_MODELS.has(model)) continue
      const other = server.get(model)
      if (!other) continue // signalé par le test précédent
      Array.from(columns).forEach((c) => { if (!other.has(c)) divergences.push(`${model}.${c} : poste seulement`) })
      Array.from(other).forEach((c) => { if (!columns.has(c)) divergences.push(`${model}.${c} : serveur seulement`) })
    }
    expect(
      divergences,
      `Divergence de contrat entre le poste et la PWA : ${divergences.join(', ')}`,
    ).toEqual([])
  })
})
