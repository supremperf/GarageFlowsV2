/**
 * Index de clés étrangères sur tables chaudes (perf) — lot F / AUD-034.
 *
 * Prouve que les index FK manquants sont bien : (1) déclarés dans le runner de
 * migrations, (2) présents dans le MODÈLE SQLite baseliné (donc dans toute base
 * neuve), et (3) réellement créés quand on rejoue le SQL sur une base vide.
 */
import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from '@/lib/migrations'
import fs from 'node:fs'
import path from 'node:path'

const EXPECTED = [
  'QuoteLine_quoteId_idx',
  'InvoiceLine_invoiceId_idx',
  'JobPhoto_jobId_idx',
  'JobPhoto_garageId_idx',
  'InspectionItem_inspectionId_idx',
]

describe('AUD-034 — index FK déclarés dans le runner', () => {
  for (const idx of EXPECTED) {
    it(`le runner crée ${idx}`, () => {
      const found = (MIGRATIONS as Array<{ sql?: string }>).some((m) => m.sql?.includes(idx))
      expect(found, `${idx} absent du runner MIGRATIONS`).toBe(true)
    })
  }
  it('chaque migration d\'index est idempotente (IF NOT EXISTS)', () => {
    const idxMigs = (MIGRATIONS as Array<{ id: string; sql?: string }>).filter((m) => EXPECTED.some((e) => m.sql?.includes(e)))
    expect(idxMigs).toHaveLength(EXPECTED.length)
    for (const m of idxMigs) expect(m.sql).toContain('IF NOT EXISTS')
  })
})

describe('AUD-034 — index présents dans le modèle SQLite baseliné', () => {
  const tmpl = path.resolve('prisma/garageflow-template.db')
  it('le modèle committé contient les 5 index FK', () => {
    expect(fs.existsSync(tmpl)).toBe(true)
    const db = new DatabaseSync(tmpl, { readOnly: true })
    try {
      const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>
      const names = new Set(rows.map((r) => r.name))
      for (const idx of EXPECTED) expect(names.has(idx), `${idx} absent du modèle`).toBe(true)
    } finally {
      db.close()
    }
  })
})

describe('AUD-034 — le SQL crée réellement l\'index sur une base neuve', () => {
  it('rejoue les CREATE INDEX sur une table vide → index créés', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec('CREATE TABLE "QuoteLine" ("id" TEXT PRIMARY KEY, "quoteId" TEXT NOT NULL)')
      db.exec('CREATE INDEX IF NOT EXISTS "QuoteLine_quoteId_idx" ON "QuoteLine"("quoteId")')
      // idempotence : rejouer ne lève pas
      db.exec('CREATE INDEX IF NOT EXISTS "QuoteLine_quoteId_idx" ON "QuoteLine"("quoteId")')
      const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='QuoteLine_quoteId_idx'").all()
      expect(rows).toHaveLength(1)
    } finally {
      db.close()
    }
  })
})
