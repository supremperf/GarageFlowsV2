/**
 * Tests for the copilote report CSV export (src/lib/analytics/report-export.ts).
 */
import { describe, it, expect } from 'vitest'
import { reportToCSV } from '../report-export'
import type { CopilotReport } from '../insights'

const report: CopilotReport = {
  generatedAt: '2026-07-27T10:00:00.000Z',
  periodDays: 30,
  summary: 'Score de santé 72/100 (good). 1 point(s) urgent(s).',
  healthScore: 72,
  healthGrade: 'good',
  insights: [
    { id: 'overdue-invoices', category: 'finance', severity: 'high', title: '2 facture(s) en retard', description: '360 € TTC, "gros" client', action: 'Relancer', impact: 360, evidence: {} },
  ],
  priorityActions: [
    { rank: 1, title: '2 facture(s) en retard', action: 'Relancer', severity: 'high', category: 'finance' },
  ],
  forecast: { weeklyMarginHT: 49, basis: 'extrapolation' },
  dataGaps: ['Rentabilité : aucune facture payée.'],
}

describe('reportToCSV', () => {
  const csv = reportToCSV(report)

  it('starts with a UTF-8 BOM for Excel', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })
  it('includes the health score and summary', () => {
    expect(csv).toContain('72/100 (good)')
    expect(csv).toContain('Score de santé')
  })
  it('includes the priority actions and insights sections (titles, not ids)', () => {
    expect(csv).toContain('Actions prioritaires')
    expect(csv).toContain('Constats détaillés')
    expect(csv).not.toContain('overdue-invoices') // internal ids are not exported
    expect(csv).toContain('2 facture(s) en retard')
  })
  it('quotes cells that contain commas or quotes (RFC 4180)', () => {
    // The description contains a comma and quotes → must be wrapped/escaped.
    expect(csv).toContain('"360 € TTC, ""gros"" client"')
  })
  it('lists data gaps', () => {
    expect(csv).toContain('Données insuffisantes')
    expect(csv).toContain('aucune facture payée')
  })
})
