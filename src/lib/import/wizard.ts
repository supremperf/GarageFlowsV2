/**
 * Assistant d'import CSV — cœur PUR (planification/dry-run) + exécution Prisma.
 *
 * Garanties :
 *   - mapping colonnes → champs (auto par en-têtes, ou fourni) ;
 *   - protection anti-injection de formules sur CHAQUE cellule ;
 *   - validation par entité (schémas Zod du projet) ;
 *   - détection de DOUBLONS (dans le fichier ET vs l'existant) ;
 *   - EXÉCUTION À BLANC (dry-run) sans écriture ;
 *   - exécution TRANSACTIONNELLE, strictement scopée `garageId`.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { CreateClientSchema, CreatePartSchema } from '@/lib/schemas'
import { neutralizeFormula, isFormulaInjection } from './sanitize'

type Tx = Prisma.TransactionClient | PrismaClient

export type ImportEntity = 'clients' | 'parts'
export type ColumnMapping = Record<string, number> // champ cible → index de colonne

export interface RowError { row: number; error: string }
export interface ImportPlan {
  entity: ImportEntity
  totalRows: number
  toCreate: Record<string, unknown>[]
  duplicatesInFile: number
  duplicatesExisting: number
  sanitizedCells: number
  errors: RowError[]
}

interface ParseOk { ok: true; value: Record<string, unknown>; dedupeKey: string }
interface ParseErr { ok: false; error: string }

interface EntityConfig {
  aliases: Record<string, string[]>          // champ cible → en-têtes acceptés (normalisés)
  parse: (rec: Record<string, string>) => ParseOk | ParseErr
  existingKeys: (tx: Tx, garageId: string) => Promise<Set<string>>
  create: (tx: Tx, garageId: string, items: Record<string, unknown>[]) => Promise<number>
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
const numOrUndef = (v: string | undefined) => {
  if (v == null || v.trim() === '') return undefined
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : NaN // NaN → rejeté par Zod (message explicite)
}

const ENTITIES: Record<ImportEntity, EntityConfig> = {
  clients: {
    aliases: {
      name: ['name', 'nom', 'client', 'nom client', 'raison sociale'],
      phone: ['phone', 'tel', 'téléphone', 'telephone', 'mobile'],
      email: ['email', 'e-mail', 'courriel', 'mail'],
      address: ['address', 'adresse'],
    },
    parse: (rec) => {
      const parsed = CreateClientSchema.safeParse({
        name: rec.name ?? '',
        phone: rec.phone || null,
        email: rec.email || null,
        address: rec.address || null,
      })
      if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Ligne invalide' }
      const v = parsed.data
      const dedupeKey = v.email ? `email:${norm(v.email)}` : `np:${norm(v.name)}|${norm(v.phone ?? '')}`
      return { ok: true, value: v, dedupeKey }
    },
    existingKeys: async (tx, garageId) => {
      const rows = await tx.client.findMany({ where: { garageId }, select: { name: true, phone: true, email: true } })
      const set = new Set<string>()
      for (const r of rows) {
        if (r.email) set.add(`email:${norm(r.email)}`)
        set.add(`np:${norm(r.name)}|${norm(r.phone ?? '')}`)
      }
      return set
    },
    create: async (tx, garageId, items) => {
      const res = await tx.client.createMany({ data: items.map(i => ({ ...i, garageId })) as Prisma.ClientCreateManyInput[] })
      return res.count
    },
  },
  parts: {
    aliases: {
      reference: ['reference', 'référence', 'ref', 'sku'],
      name: ['name', 'nom', 'désignation', 'designation', 'libellé', 'libelle'],
      description: ['description', 'desc'],
      quantity: ['quantity', 'quantité', 'quantite', 'qté', 'qte', 'stock'],
      minQuantity: ['minquantity', 'min', 'seuil', 'stock min'],
      unitCost: ['unitcost', 'coût', 'cout', 'prix achat', 'achat'],
      unitPrice: ['unitprice', 'prix', 'prix vente', 'vente'],
      location: ['location', 'emplacement', 'rangement'],
    },
    parse: (rec) => {
      const parsed = CreatePartSchema.safeParse({
        reference: rec.reference || null,
        name: rec.name ?? '',
        description: rec.description || null,
        quantity: numOrUndef(rec.quantity),
        minQuantity: numOrUndef(rec.minQuantity),
        unitCost: numOrUndef(rec.unitCost),
        unitPrice: numOrUndef(rec.unitPrice),
        location: rec.location || null,
      })
      if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Ligne invalide' }
      const v = parsed.data
      const dedupeKey = v.reference ? `ref:${norm(v.reference)}` : `name:${norm(v.name)}`
      return { ok: true, value: v, dedupeKey }
    },
    existingKeys: async (tx, garageId) => {
      const rows = await tx.part.findMany({ where: { garageId }, select: { reference: true, name: true } })
      const set = new Set<string>()
      for (const r of rows) set.add(r.reference ? `ref:${norm(r.reference)}` : `name:${norm(r.name)}`)
      return set
    },
    create: async (tx, garageId, items) => {
      const res = await tx.part.createMany({ data: items.map(i => ({ ...i, garageId })) as Prisma.PartCreateManyInput[] })
      return res.count
    },
  },
}

/** Auto-mappe des en-têtes vers les champs d'une entité (par alias normalisés). */
export function autoMap(entity: ImportEntity, header: string[]): ColumnMapping {
  const cfg = ENTITIES[entity]
  const mapping: ColumnMapping = {}
  const normalized = header.map(norm)
  for (const [field, aliases] of Object.entries(cfg.aliases)) {
    const idx = normalized.findIndex(h => aliases.includes(h))
    if (idx >= 0) mapping[field] = idx
  }
  return mapping
}

/** Champs cibles connus d'une entité (pour l'UI de mapping). */
export function entityFields(entity: ImportEntity): string[] {
  return Object.keys(ENTITIES[entity].aliases)
}

/**
 * Construit un plan d'import (DRY-RUN) : aucune écriture. Chaque cellule est
 * neutralisée (anti-injection), chaque ligne validée, les doublons (fichier +
 * existant) détectés. `existingKeys` provient de la base (scopé garageId).
 */
export function planImport(opts: {
  entity: ImportEntity
  rows: string[][]
  mapping: ColumnMapping
  existingKeys: Set<string>
  maxRows?: number
}): ImportPlan {
  const { entity, rows, mapping, existingKeys } = opts
  const cfg = ENTITIES[entity]
  const plan: ImportPlan = {
    entity, totalRows: rows.length, toCreate: [], duplicatesInFile: 0, duplicatesExisting: 0, sanitizedCells: 0, errors: [],
  }
  const seen = new Set<string>()
  const limit = opts.maxRows ?? rows.length

  for (let r = 0; r < rows.length; r++) {
    if (plan.toCreate.length >= limit) { plan.errors.push({ row: r + 2, error: `Limite de ${limit} lignes atteinte` }); break }
    const raw = rows[r]
    // Construit l'enregistrement à partir du mapping, en neutralisant chaque cellule.
    const rec: Record<string, string> = {}
    for (const [field, idx] of Object.entries(mapping)) {
      const cell = raw[idx] ?? ''
      if (isFormulaInjection(cell)) plan.sanitizedCells++
      rec[field] = neutralizeFormula(cell).trim()
    }
    const parsed = cfg.parse(rec)
    if (!parsed.ok) { plan.errors.push({ row: r + 2, error: parsed.error }); continue } // +2 : en-tête + base 1
    if (existingKeys.has(parsed.dedupeKey)) { plan.duplicatesExisting++; continue }
    if (seen.has(parsed.dedupeKey)) { plan.duplicatesInFile++; continue }
    seen.add(parsed.dedupeKey)
    plan.toCreate.push(parsed.value)
  }
  return plan
}

/** Charge les clés de dédoublonnage existantes pour un garage (scopé). */
export function loadExistingKeys(tx: Tx, entity: ImportEntity, garageId: string): Promise<Set<string>> {
  return ENTITIES[entity].existingKeys(tx, garageId)
}

/**
 * Exécute l'import de façon TRANSACTIONNELLE et strictement scopée `garageId` :
 * recharge les clés existantes DANS la transaction (anti-course), replanifie,
 * puis crée. Renvoie le plan appliqué + le nombre réellement créé.
 */
export async function executeImport(
  prisma: PrismaClient,
  opts: { entity: ImportEntity; rows: string[][]; mapping: ColumnMapping; garageId: string; maxRows?: number },
): Promise<{ plan: ImportPlan; created: number }> {
  const cfg = ENTITIES[opts.entity]
  return prisma.$transaction(async (tx) => {
    const existingKeys = await cfg.existingKeys(tx, opts.garageId)
    const plan = planImport({ entity: opts.entity, rows: opts.rows, mapping: opts.mapping, existingKeys, maxRows: opts.maxRows })
    const created = plan.toCreate.length > 0 ? await cfg.create(tx, opts.garageId, plan.toCreate) : 0
    return { plan, created }
  })
}
