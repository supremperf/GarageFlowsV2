/**
 * Copilote report export (Phase 4/6). Pure, tested serialisation of a
 * {@link CopilotReport} to CSV (Excel-compatible). PDF is rendered client-side
 * from the same report object.
 */

import type { CopilotReport } from './insights'

/** Escape a value for a CSV cell (RFC 4180) + neutralisation d'injection de formule. */
function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value)
  // Anti-injection de formule : une cellule débutant par = + - @ (ou TAB/CR) est
  // interprétée comme formule par Excel/LibreOffice → préfixe apostrophe (texte).
  // Exception : un nombre fini est laissé intact (reste numérique dans le tableur).
  if (/^[=+\-@\t\r]/.test(s) && !Number.isFinite(Number(s))) s = "'" + s
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function row(...cells: unknown[]): string {
  return cells.map(csvCell).join(',')
}

/**
 * Render the report as a sectioned CSV (summary, health sub-scores are not part
 * of the report object, so this covers priority actions, insights, forecast and
 * data gaps — the actionable content). Prefixed with a UTF-8 BOM so Excel opens
 * accents correctly.
 */
export function reportToCSV(report: CopilotReport): string {
  const lines: string[] = []

  lines.push(row('Rapport GarageFlows', `Généré le ${report.generatedAt}`))
  lines.push(row('Période (jours)', report.periodDays))
  lines.push(row('Score de santé', `${report.healthScore}/100 (${report.healthGrade})`))
  lines.push(row('Résumé', report.summary))
  lines.push(row('Bénéfice hebdo prévisionnel (HT)', report.forecast.weeklyMarginHT ?? 'N/D'))
  lines.push('')

  lines.push(row('Actions prioritaires'))
  lines.push(row('Rang', 'Catégorie', 'Sévérité', 'Titre', 'Action'))
  for (const a of report.priorityActions) {
    lines.push(row(a.rank, a.category, a.severity, a.title, a.action))
  }
  lines.push('')

  lines.push(row('Constats détaillés'))
  lines.push(row('Catégorie', 'Sévérité', 'Titre', 'Description', 'Action', 'Impact'))
  for (const i of report.insights) {
    lines.push(row(i.category, i.severity, i.title, i.description, i.action, i.impact))
  }
  lines.push('')

  if (report.dataGaps.length > 0) {
    lines.push(row('Données insuffisantes'))
    for (const g of report.dataGaps) lines.push(row(g))
  }

  return '﻿' + lines.join('\r\n')
}
