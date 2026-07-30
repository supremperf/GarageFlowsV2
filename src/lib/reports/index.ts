/**
 * Customizable reports — public entry point.
 *
 *   import { runReport, reportToCsv } from '@/lib/reports'
 *   const result = runReport({ columns: ['clientName','totalTTC'], filters: [...], sort: [...] }, rows)
 *   const csv = reportToCsv(result, { delimiter: ';' })
 *
 * Generic engine (filter/group/aggregate/sort/limit) + RFC 4180 CSV export.
 */
export * from './types'
export { runReport } from './builder'
export { rowsToCsv, reportToCsv, type CsvOptions } from './csv'
export { REPORT_SOURCES, isValidSource, type ReportSourceDef, type ReportField } from './sources'
