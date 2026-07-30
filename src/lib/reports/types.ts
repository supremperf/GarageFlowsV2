/**
 * Customizable reports — shared types.
 *
 * A generic report engine over an array of flat records: filter → group +
 * aggregate (or select columns) → sort → limit, plus CSV export. The API maps a
 * data source (invoices, parts, …) into rows and runs the spec.
 */

export type FilterOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in' | 'between'

export interface Filter {
  field: string
  op: FilterOp
  value: unknown
}

export type AggFn = 'sum' | 'avg' | 'min' | 'max' | 'count'

export interface Aggregation {
  field: string
  fn: AggFn
  as?: string
}

export interface SortSpec {
  field: string
  dir?: 'asc' | 'desc'
}

export interface ReportSpec {
  columns?: string[]
  filters?: Filter[]
  groupBy?: string[]
  aggregations?: Aggregation[]
  sort?: SortSpec[]
  limit?: number
}

export type Row = Record<string, unknown>

export interface ReportResult {
  columns: string[]
  rows: Row[]
  total: number
}
