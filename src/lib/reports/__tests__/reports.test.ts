import { describe, it, expect } from 'vitest'
import { runReport, rowsToCsv, type Row } from '../index'

const data: Row[] = [
  { client: 'A', category: 'x', amount: 100, status: 'paid' },
  { client: 'A', category: 'y', amount: 50, status: 'pending' },
  { client: 'B', category: 'x', amount: 30, status: 'paid' },
]

describe('runReport — filters', () => {
  it('eq / gt / contains / in / between', () => {
    expect(runReport({ filters: [{ field: 'status', op: 'eq', value: 'paid' }] }, data).total).toBe(2)
    expect(runReport({ filters: [{ field: 'amount', op: 'gt', value: 40 }] }, data).total).toBe(2)
    expect(runReport({ filters: [{ field: 'client', op: 'contains', value: 'a' }] }, data).total).toBe(2)
    expect(runReport({ filters: [{ field: 'status', op: 'in', value: ['paid'] }] }, data).total).toBe(2)
    expect(runReport({ filters: [{ field: 'amount', op: 'between', value: [40, 120] }] }, data).total).toBe(2)
  })
})

describe('runReport — columns & sort', () => {
  it('selects columns', () => {
    const r = runReport({ columns: ['client', 'amount'] }, data)
    expect(r.columns).toEqual(['client', 'amount'])
    expect(Object.keys(r.rows[0])).toEqual(['client', 'amount'])
  })
  it('sorts (desc) and limits', () => {
    const r = runReport({ columns: ['amount'], sort: [{ field: 'amount', dir: 'desc' }], limit: 2 }, data)
    expect(r.rows.map((x) => x.amount)).toEqual([100, 50])
    expect(r.total).toBe(3) // total counts pre-limit
  })
})

describe('runReport — group & aggregate', () => {
  it('sums by client', () => {
    const r = runReport({ groupBy: ['client'], aggregations: [{ field: 'amount', fn: 'sum' }] }, data)
    expect(r.columns).toEqual(['client', 'sum_amount'])
    expect(r.rows.find((x) => x.client === 'A')!.sum_amount).toBe(150)
    expect(r.rows.find((x) => x.client === 'B')!.sum_amount).toBe(30)
  })
  it('supports count and avg with aliases', () => {
    const r = runReport(
      { groupBy: ['client'], aggregations: [{ field: 'amount', fn: 'count', as: 'n' }, { field: 'amount', fn: 'avg', as: 'moy' }] },
      data,
    )
    const a = r.rows.find((x) => x.client === 'A')!
    expect(a.n).toBe(2)
    expect(a.moy).toBe(75)
  })
})

describe('rowsToCsv', () => {
  it('escapes delimiters, quotes and newlines (RFC 4180)', () => {
    const csv = rowsToCsv(['a', 'b'], [{ a: 'x,y', b: 'he said "hi"' }, { a: 'line1\nline2', b: 1 }])
    expect(csv).toBe('a,b\r\n"x,y","he said ""hi"""\r\n"line1\nline2",1')
  })
  it('supports a semicolon delimiter (FR Excel)', () => {
    const csv = rowsToCsv(['a', 'b'], [{ a: 1, b: 2 }], { delimiter: ';' })
    expect(csv).toBe('a;b\r\n1;2')
  })
  it('handles null/undefined as empty', () => {
    const csv = rowsToCsv(['a', 'b'], [{ a: null, b: undefined }], { header: false })
    expect(csv).toBe(',')
  })
  it("neutralise l'injection de formule sans casser les nombres (A50)", () => {
    const csv = rowsToCsv(
      ['a'],
      [{ a: '=1+1' }, { a: '@SUM(A1)' }, { a: '-50' }, { a: '=HYPERLINK("http://x")' }],
      { header: false },
    )
    // Formules préfixées d'une apostrophe ; le nombre « -50 » (avoir) reste intact.
    expect(csv).toBe("'=1+1\r\n'@SUM(A1)\r\n-50\r\n\"'=HYPERLINK(\"\"http://x\"\")\"")
  })
})
