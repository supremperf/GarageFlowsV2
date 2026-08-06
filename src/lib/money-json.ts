/**
 * JSON monétaires PERSISTANTS — format versionné en ENTIERS EXACTS (v2).
 *
 * Trois documents JSON persistés contiennent de l'argent :
 *   - WorkOrder.worksJson   (lignes de main-d'œuvre)
 *   - WorkOrder.partsJson   (lignes de pièces)
 *   - PurchaseOrder.linesJson (lignes de commande fournisseur)
 *
 * V1 (HISTORIQUE) : tableaux nus avec euros/quantités FLOTTANTS
 *   [{ "description": "Vidange", "durationMin": 30, "unitPrice": 49.9 }]
 *   [{ "name": "Filtre", "qty": 2, "unitPrice": 12.3456 }]
 *   [{ "partName": "Plaquettes", "qty": 8, "unitCost": 20 }]
 *
 * V2 (STOCKAGE ACTUEL) : objet versionné, ENTIERS mis à l'échelle, total par
 * ligne en centimes — AUCUN flottant monétaire persistant :
 *   { "schemaVersion": 2, "works": [{ "description": "Vidange", "durationMin": 30,
 *       "unitPriceTenThousandths": 499000, "lineTotalCents": 4990 }] }
 *
 * RÈGLES :
 *   - parsing STRICT (Zod) : NaN/Infinity/chaînes vides/objets incomplets/
 *     types inattendus/valeurs hors plage/décimales > 4 → REJET (jamais de
 *     JSON.parse « nu » suivi de Number()/parseFloat sur du persistant) ;
 *   - conversion v1→v2 DÉTERMINISTE : round(x × 10 000) demi-éloigné-de-zéro
 *     (les artefacts binaires historiques comme 12.345599999999999 sont
 *     normalisés à 4 décimales — politique documentée ; l'écart absorbé est
 *     < 0,5 dix-millième, tout écart de TOTAL au-delà de la tolérance BLOQUE) ;
 *   - ordres de réparation SIGNÉS : leur JSON est canonicalisé VERBATIM dans le
 *     document signé (lib/signature/document.ts) → il est GELÉ à vie ; la
 *     lecture v1 reste supportée pour EUX UNIQUEMENT (exception légale
 *     documentée, pas un fallback génétal) ; les non-signés sont migrés.
 */

import { z } from 'zod'
import {
  toScaled,
  fromScaled,
  MAX_SCALED,
  lineTotalCentsFromScaled,
  parseAmountToScaled,
} from './money'

export const MONEY_JSON_VERSION = 2 as const

// ─── Validation stricte des nombres ──────────────────────────────────────────

/** Euro/quantité V1 : fini, borné, ≤ 4 décimales significatives. */
const euroV1 = (min: number, max: number) =>
  z.number().finite().min(min).max(max)
    .refine((v) => parseAmountToScaled(v) !== null, { message: 'Maximum 4 décimales' })

/** Entier mis à l'échelle V2 : entier sûr borné Int32. */
const scaledInt = (min: number = -MAX_SCALED) =>
  z.number().int().gte(min).lte(MAX_SCALED)

const centsInt = z.number().int().gte(-2_147_483_647).lte(2_147_483_647)

// ─── WorkOrder.worksJson ─────────────────────────────────────────────────────

const WorkLineV1 = z.object({
  description: z.string().max(500).default(''),
  durationMin: z.number().int().min(0).max(100_000).default(0),
  unitPrice: euroV1(-999_999, 999_999).default(0),
  laborOpId: z.string().max(64).optional(),
}) // v1 historique : clés inconnues tolérées (strip), valeurs validées strictement

const WorkLineV2 = z.object({
  description: z.string().max(500),
  durationMin: z.number().int().min(0).max(100_000),
  unitPriceTenThousandths: scaledInt(),
  lineTotalCents: centsInt,
  laborOpId: z.string().max(64).optional(),
}).strict()

export const WorksJsonV1 = z.array(WorkLineV1)
export const WorksJsonV2 = z.object({
  schemaVersion: z.literal(2),
  works: z.array(WorkLineV2),
}).strict()

export interface WorkLineExact {
  description: string
  durationMin: number
  unitPriceTenThousandths: number
  lineTotalCents: number
  laborOpId?: string
}

// ─── WorkOrder.partsJson ─────────────────────────────────────────────────────

const PartLineV1 = z.object({
  name: z.string().max(300).default(''),
  reference: z.string().max(120).optional().nullable(),
  qty: euroV1(-99_999, 99_999).default(0),
  unitPrice: euroV1(-999_999, 999_999).default(0),
}) // v1 historique : strip

const PartLineV2 = z.object({
  name: z.string().max(300),
  reference: z.string().max(120).optional().nullable(),
  qtyTenThousandths: scaledInt(),
  unitPriceTenThousandths: scaledInt(),
  lineTotalCents: centsInt,
}).strict()

export const PartsJsonV1 = z.array(PartLineV1)
export const PartsJsonV2 = z.object({
  schemaVersion: z.literal(2),
  parts: z.array(PartLineV2),
}).strict()

export interface PartLineExact {
  name: string
  reference?: string | null
  qtyTenThousandths: number
  unitPriceTenThousandths: number
  lineTotalCents: number
}

// ─── PurchaseOrder.linesJson ─────────────────────────────────────────────────

const PoLineV1 = z.object({
  partId: z.string().max(64).optional().nullable(),
  partName: z.string().max(300).default(''),
  reference: z.string().max(120).optional().nullable(),
  qty: euroV1(0, 99_999).default(0),
  unitCost: euroV1(-999_999, 999_999).default(0),
}) // v1 historique : strip

const PoLineV2 = z.object({
  partId: z.string().max(64).optional().nullable(),
  partName: z.string().max(300),
  reference: z.string().max(120).optional().nullable(),
  qtyTenThousandths: scaledInt(0),
  unitCostTenThousandths: scaledInt(),
  lineTotalCents: centsInt,
}).strict()

export const PoLinesJsonV1 = z.array(PoLineV1)
export const PoLinesJsonV2 = z.object({
  schemaVersion: z.literal(2),
  lines: z.array(PoLineV2),
}).strict()

export interface PoLineExact {
  partId?: string | null
  partName: string
  reference?: string | null
  qtyTenThousandths: number
  unitCostTenThousandths: number
  lineTotalCents: number
}

// ─── Parsing générique versionné ─────────────────────────────────────────────

export class MoneyJsonError extends Error {
  constructor(public code: 'INVALID_JSON' | 'INVALID_SHAPE', message: string) {
    super(message)
  }
}

function parseRaw(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw new MoneyJsonError('INVALID_JSON', 'JSON illisible')
  }
}

/** Conversion v1→v2 d'une ligne de MO (euros → entiers exacts + total centimes). */
function workLineToExact(l: z.infer<typeof WorkLineV1>): WorkLineExact {
  const unitPriceTenThousandths = toScaled(l.unitPrice)
  return {
    description: l.description,
    durationMin: l.durationMin,
    unitPriceTenThousandths,
    // Une ligne de MO = quantité 1 (forfait par opération).
    lineTotalCents: lineTotalCentsFromScaled(unitPriceTenThousandths, 10_000),
    ...(l.laborOpId ? { laborOpId: l.laborOpId } : {}),
  }
}

function partLineToExact(l: z.infer<typeof PartLineV1>): PartLineExact {
  const qtyTenThousandths = toScaled(l.qty)
  const unitPriceTenThousandths = toScaled(l.unitPrice)
  return {
    name: l.name,
    ...(l.reference !== undefined ? { reference: l.reference } : {}),
    qtyTenThousandths,
    unitPriceTenThousandths,
    lineTotalCents: lineTotalCentsFromScaled(unitPriceTenThousandths, qtyTenThousandths),
  }
}

function poLineToExact(l: z.infer<typeof PoLineV1>): PoLineExact {
  const qtyTenThousandths = toScaled(l.qty)
  const unitCostTenThousandths = toScaled(l.unitCost)
  return {
    ...(l.partId !== undefined ? { partId: l.partId } : {}),
    partName: l.partName,
    ...(l.reference !== undefined ? { reference: l.reference } : {}),
    qtyTenThousandths,
    unitCostTenThousandths,
    lineTotalCents: lineTotalCentsFromScaled(unitCostTenThousandths, qtyTenThousandths),
  }
}

export interface ParsedMoneyJson<T> {
  version: 1 | 2
  lines: T[]
}

/** Parse worksJson (v1 OU v2) → lignes EXACTES normalisées. Rejette l'invalide. */
export function parseWorksJson(raw: string): ParsedMoneyJson<WorkLineExact> {
  const data = parseRaw(raw || '[]')
  if (Array.isArray(data)) {
    const v1 = WorksJsonV1.safeParse(data)
    if (!v1.success) throw new MoneyJsonError('INVALID_SHAPE', `worksJson v1 invalide: ${v1.error.issues[0]?.message}`)
    return { version: 1, lines: v1.data.map(workLineToExact) }
  }
  const v2 = WorksJsonV2.safeParse(data)
  if (!v2.success) throw new MoneyJsonError('INVALID_SHAPE', `worksJson v2 invalide: ${v2.error.issues[0]?.message}`)
  return { version: 2, lines: v2.data.works }
}

export function parsePartsJson(raw: string): ParsedMoneyJson<PartLineExact> {
  const data = parseRaw(raw || '[]')
  if (Array.isArray(data)) {
    const v1 = PartsJsonV1.safeParse(data)
    if (!v1.success) throw new MoneyJsonError('INVALID_SHAPE', `partsJson v1 invalide: ${v1.error.issues[0]?.message}`)
    return { version: 1, lines: v1.data.map(partLineToExact) }
  }
  const v2 = PartsJsonV2.safeParse(data)
  if (!v2.success) throw new MoneyJsonError('INVALID_SHAPE', `partsJson v2 invalide: ${v2.error.issues[0]?.message}`)
  return { version: 2, lines: v2.data.parts }
}

export function parsePoLinesJson(raw: string): ParsedMoneyJson<PoLineExact> {
  const data = parseRaw(raw || '[]')
  if (Array.isArray(data)) {
    const v1 = PoLinesJsonV1.safeParse(data)
    if (!v1.success) throw new MoneyJsonError('INVALID_SHAPE', `linesJson v1 invalide: ${v1.error.issues[0]?.message}`)
    return { version: 1, lines: v1.data.map(poLineToExact) }
  }
  const v2 = PoLinesJsonV2.safeParse(data)
  if (!v2.success) throw new MoneyJsonError('INVALID_SHAPE', `linesJson v2 invalide: ${v2.error.issues[0]?.message}`)
  return { version: 2, lines: v2.data.lines }
}

// ─── Sérialisation v2 (SEULE écriture autorisée) ─────────────────────────────

export function serializeWorksJsonV2(works: WorkLineExact[]): string {
  return JSON.stringify(WorksJsonV2.parse({ schemaVersion: 2, works }))
}
export function serializePartsJsonV2(parts: PartLineExact[]): string {
  return JSON.stringify(PartsJsonV2.parse({ schemaVersion: 2, parts }))
}
export function serializePoLinesJsonV2(lines: PoLineExact[]): string {
  return JSON.stringify(PoLinesJsonV2.parse({ schemaVersion: 2, lines }))
}

// ─── Vues euros (affichage / compat UI) ──────────────────────────────────────

export function workLinesToEuros(lines: WorkLineExact[]) {
  return lines.map((l) => ({
    description: l.description,
    durationMin: l.durationMin,
    unitPrice: fromScaled(l.unitPriceTenThousandths),
    ...(l.laborOpId ? { laborOpId: l.laborOpId } : {}),
  }))
}
export function partLinesToEuros(lines: PartLineExact[]) {
  return lines.map((l) => ({
    name: l.name,
    reference: l.reference ?? '',
    qty: fromScaled(l.qtyTenThousandths),
    unitPrice: fromScaled(l.unitPriceTenThousandths),
  }))
}
export function poLinesToEuros(lines: PoLineExact[]) {
  return lines.map((l) => ({
    partId: l.partId ?? undefined,
    partName: l.partName,
    reference: l.reference ?? undefined,
    qty: fromScaled(l.qtyTenThousandths),
    unitCost: fromScaled(l.unitCostTenThousandths),
  }))
}

// ─── Totaux exacts depuis les lignes normalisées ─────────────────────────────

export function workOrderTotalHtCents(works: WorkLineExact[], parts: PartLineExact[]): number {
  return (
    works.reduce((s, w) => s + w.lineTotalCents, 0) +
    parts.reduce((s, p) => s + p.lineTotalCents, 0)
  )
}
export function poTotalHtCents(lines: PoLineExact[]): number {
  return lines.reduce((s, l) => s + l.lineTotalCents, 0)
}
