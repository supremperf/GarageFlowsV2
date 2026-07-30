/**
 * Report engine — pure. Filter → (group + aggregate | select) → sort → limit.
 */
import type { Aggregation, Filter, ReportResult, ReportSpec, Row, SortSpec } from './types'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : NaN
}

function matches(row: Row, f: Filter): boolean {
  const v = row[f.field]
  switch (f.op) {
    case 'eq':
      return String(v) === String(f.value)
    case 'ne':
      return String(v) !== String(f.value)
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = num(v)
      const b = num(f.value)
      const cmp = !Number.isNaN(a) && !Number.isNaN(b) ? a - b : String(v ?? '').localeCompare(String(f.value ?? ''))
      if (f.op === 'gt') return cmp > 0
      if (f.op === 'gte') return cmp >= 0
      if (f.op === 'lt') return cmp < 0
      return cmp <= 0
    }
    case 'contains':
      return String(v ?? '').toLowerCase().includes(String(f.value ?? '').toLowerCase())
    case 'in':
      return Array.isArray(f.value) && f.value.map(String).includes(String(v))
    case 'between': {
      if (!Array.isArray(f.value) || f.value.length !== 2) return false
      const a = num(v)
      return !Number.isNaN(a) && a >= num(f.value[0]) && a <= num(f.value[1])
    }
    default:
      return true
  }
}

function aggregate(rows: Row[], agg: Aggregation): number {
  if (agg.fn === 'count') return rows.length
  const vals = rows.map((r) => num(r[agg.field])).filter((n) => !Number.isNaN(n))
  if (vals.length === 0) return 0
  switch (agg.fn) {
    case 'sum':
      return round2(vals.reduce((s, x) => s + x, 0))
    case 'avg':
      return round2(vals.reduce((s, x) => s + x, 0) / vals.length)
    case 'min':
      return Math.min(...vals)
    case 'max':
      return Math.max(...vals)
    default:
      return 0
  }
}

function aggAlias(agg: Aggregation): string {
  return agg.as ?? `${agg.fn}_${agg.field}`
}

function compareRows(a: Row, b: Row, sort: SortSpec[]): number {
  for (const s of sort) {
    const dir = s.dir === 'desc' ? -1 : 1
    const av = a[s.field]
    const bv = b[s.field]
    const an = num(av)
    const bn = num(bv)
    let cmp: number
    if (!Number.isNaN(an) && !Number.isNaN(bn)) cmp = an - bn
    else cmp = String(av ?? '').localeCompare(String(bv ?? ''))
    if (cmp !== 0) return cmp * dir
  }
  return 0
}

export function runReport(spec: ReportSpec, data: Row[]): ReportResult {
  // 1. Filter
  let rows = data
  if (spec.filters?.length) {
    rows = rows.filter((r) => spec.filters!.every((f) => matches(r, f)))
  }

  let outColumns: string[]
  let outRows: Row[]

  // 2. Group + aggregate, or select columns
  if (spec.groupBy?.length) {
    const groups = new Map<string, Row[]>()
    for (const r of rows) {
      const key = spec.groupBy.map((g) => String(r[g])).join('')
      const arr = groups.get(key) ?? []
      arr.push(r)
      groups.set(key, arr)
    }
    const aggs = spec.aggregations ?? []
    outRows = Array.from(groups.values()).map((groupRows) => {
      const out: Row = {}
      for (const g of spec.groupBy!) out[g] = groupRows[0][g]
      for (const agg of aggs) out[aggAlias(agg)] = aggregate(groupRows, agg)
      return out
    })
    outColumns = [...spec.groupBy, ...aggs.map(aggAlias)]
  } else {
    outColumns = spec.columns && spec.columns.length ? spec.columns : Object.keys(rows[0] ?? {})
    outRows = rows.map((r) => {
      const out: Row = {}
      for (const c of outColumns) out[c] = r[c]
      return out
    })
  }

  // 3. Sort
  if (spec.sort?.length) outRows.sort((a, b) => compareRows(a, b, spec.sort!))

  const total = outRows.length

  // 4. Limit
  if (spec.limit != null && spec.limit >= 0) outRows = outRows.slice(0, spec.limit)

  return { columns: outColumns, rows: outRows, total }
}
