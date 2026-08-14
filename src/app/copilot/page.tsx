'use client'

/**
 * Phase 6 — Copilote « Analyser mon garage » (tableau de bord dirigeant).
 *
 * A one-click analysis of the garage backed entirely by the real
 * /api/copilot/report endpoint (health score, prioritised findings, forecast,
 * data gaps). Every figure comes from the API — no client-side fabrication.
 * Export to PDF (jsPDF) / CSV (shared formatter) and historise the report.
 */

import { useState, type ReactNode } from 'react'
import {
  Sparkles, Loader2, Download, FileSpreadsheet, Save, AlertTriangle,
  TrendingUp, TrendingDown, Minus, Activity, ClipboardList,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import type { CopilotReport, Insight, InsightSeverity } from '@/lib/analytics/insights'
import { reportToCSV } from '@/lib/analytics/report-export'
import { HistoriqueRapports } from '@/components/copilot/HistoriqueRapports'

interface ReportResponse {
  period: number
  report: CopilotReport
}

const SEVERITY_STYLE: Record<InsightSeverity, string> = {
  critical: 'bg-red-500/10 border-red-500/30 text-red-300',
  high: 'bg-orange-500/10 border-orange-500/30 text-orange-300',
  medium: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
  low: 'bg-slate-500/10 border-slate-500/25 text-slate-300',
  info: 'bg-blue-500/10 border-blue-500/25 text-blue-300',
}

const GRADE_COLOR: Record<string, string> = {
  excellent: 'text-emerald-400',
  good: 'text-green-400',
  fair: 'text-amber-400',
  poor: 'text-orange-400',
  critical: 'text-red-400',
}

const PERIODS = [7, 30, 90] as const

export default function CopilotPage() {
  const [period, setPeriod] = useState<number>(30)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  /** Incrémenté à chaque historisation — force la liste à se recharger. */
  const [versionHistorique, setVersionHistorique] = useState(0)
  const [data, setData] = useState<ReportResponse | null>(null)

  async function analyze() {
    setLoading(true)
    try {
      const res = await fetch(`/api/copilot/report?period=${period}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      setData((await res.json()) as ReportResponse)
    } catch {
      toast.error('Échec de l’analyse. Réessayez.')
    } finally {
      setLoading(false)
    }
  }

  function downloadCSV() {
    if (!data) return
    const blob = new Blob([reportToCSV(data.report)], { type: 'text/csv;charset=utf-8' })
    triggerDownload(blob, `garageflow-rapport-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  async function downloadPDF() {
    if (!data) return
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const r = data.report
    let y = 48
    const line = (text: string, size = 11, bold = false): void => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(size)
      for (const chunk of doc.splitTextToSize(text, 500) as string[]) {
        if (y > 780) { doc.addPage(); y = 48 }
        doc.text(chunk, 48, y)
        y += size + 6
      }
    }
    line('GarageFlows — Rapport « Analyser mon garage »', 16, true)
    line(`Généré le ${new Date(r.generatedAt).toLocaleString('fr-FR')} · Période ${r.periodDays} j`, 9)
    y += 6
    line(`Score de santé : ${r.healthScore}/100 (${r.healthGrade})`, 13, true)
    line(r.summary, 11)
    line(`Bénéfice hebdomadaire prévisionnel (HT) : ${r.forecast.weeklyMarginHT ?? 'N/D'} €`, 11)
    y += 6
    line('Actions prioritaires', 13, true)
    r.priorityActions.forEach(a => line(`${a.rank}. [${a.severity}] ${a.title} — ${a.action}`, 10))
    y += 6
    line('Constats détaillés', 13, true)
    r.insights.forEach(i => line(`• [${i.severity}] ${i.title} : ${i.description}`, 10))
    if (r.dataGaps.length) {
      y += 6
      line('Données insuffisantes', 13, true)
      r.dataGaps.forEach(g => line(`• ${g}`, 10))
    }
    doc.save(`garageflow-rapport-${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/copilot/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period }),
      })
      if (!res.ok) throw new Error()
      toast.success('Rapport historisé')
      // Fait remonter la liste : sans cela le rapport que l'on vient
      // d'enregistrer n'apparaîtrait qu'au prochain chargement de la page, et
      // l'exploitant douterait de l'avoir enregistré.
      setVersionHistorique(v => v + 1)
    } catch {
      toast.error('Échec de l’enregistrement')
    } finally {
      setSaving(false)
    }
  }

  const report = data?.report

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-slate-200 px-4 py-8 md:px-8">
      <div className="mx-auto w-full max-w-5xl">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black text-white">
              <Sparkles className="h-6 w-6 text-blue-400" /> Copilote GarageFlows
            </h1>
            <p className="mt-1 text-sm text-slate-500">Analyse intelligente de votre garage, justifiée par vos données réelles.</p>
          </div>
          <div className="flex items-center gap-2">
            <div role="group" aria-label="Période d’analyse" className="flex rounded-xl border border-white/10 bg-white/[0.04] p-0.5">
              {PERIODS.map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={cn('rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors', period === p ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white')}
                  aria-pressed={period === p}
                >
                  {p} j
                </button>
              ))}
            </div>
            <button
              onClick={analyze}
              disabled={loading}
              className={cn('flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all', loading ? 'cursor-not-allowed bg-blue-600/20 text-blue-300/50' : 'bg-blue-600 text-white shadow-lg shadow-blue-600/25 hover:bg-blue-500 active:scale-[0.98]')}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Analyser mon garage
            </button>
          </div>
        </div>

        {!report && !loading && (
          <div className="mt-16 flex flex-col items-center text-center text-slate-600">
            <Activity className="h-12 w-12" />
            <p className="mt-3 text-sm">Lancez une analyse pour générer votre rapport.</p>
          </div>
        )}

        {report && (
          <div className="mt-6 space-y-6">
            {/* Health + actions bar */}
            <div className="flex flex-col gap-4 rounded-2xl border border-white/[0.08] bg-[#111827]/95 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-5">
                <div className="text-center">
                  <div className={cn('text-5xl font-black', GRADE_COLOR[report.healthGrade] ?? 'text-white')}>{report.healthScore}</div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">sur 100</div>
                </div>
                <div>
                  <div className={cn('text-sm font-bold capitalize', GRADE_COLOR[report.healthGrade])}>{report.healthGrade}</div>
                  <p className="mt-1 max-w-md text-sm text-slate-400">{report.summary}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <ExportBtn onClick={downloadPDF} icon={<Download className="h-4 w-4" />} label="PDF" />
                <ExportBtn onClick={downloadCSV} icon={<FileSpreadsheet className="h-4 w-4" />} label="CSV" />
                <ExportBtn onClick={save} icon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} label="Historiser" />
              </div>
            </div>

            {/* Forecast */}
            <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-[#111827]/95 p-4">
              <TrendIcon value={report.forecast.weeklyMarginHT} />
              <div>
                <div className="text-sm font-semibold text-white">
                  Bénéfice hebdomadaire prévisionnel : {report.forecast.weeklyMarginHT != null ? `${report.forecast.weeklyMarginHT} € HT` : 'Données insuffisantes'}
                </div>
                <div className="text-xs text-slate-500">{report.forecast.basis}</div>
              </div>
            </div>

            {/* Priority actions */}
            {report.priorityActions.length > 0 && (
              <section className="rounded-2xl border border-white/[0.08] bg-[#111827]/95 p-6">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-white"><ClipboardList className="h-4 w-4 text-blue-400" /> Actions prioritaires</h2>
                <ol className="space-y-2">
                  {report.priorityActions.map(a => (
                    <li key={a.rank} className={cn('flex items-start gap-3 rounded-xl border p-3 text-sm', SEVERITY_STYLE[a.severity])}>
                      <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold">{a.rank}</span>
                      <div>
                        <div className="font-semibold">{a.title}</div>
                        <div className="text-xs opacity-80">{a.action}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {/* All insights */}
            <section className="rounded-2xl border border-white/[0.08] bg-[#111827]/95 p-6">
              <h2 className="mb-4 text-sm font-bold text-white">Constats détaillés ({report.insights.length})</h2>
              <div className="space-y-2">
                {report.insights.map((i: Insight) => (
                  <div key={i.id} className={cn('rounded-xl border p-3', SEVERITY_STYLE[i.severity])}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{i.title}</span>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase">{i.severity}</span>
                    </div>
                    <p className="mt-1 text-xs opacity-90">{i.description}</p>
                    <p className="mt-1 text-xs opacity-70">→ {i.action}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Data gaps — honesty */}
            {report.dataGaps.length > 0 && (
              <section className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-5">
                <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-amber-300"><AlertTriangle className="h-4 w-4" /> Données insuffisantes</h2>
                <ul className="list-inside list-disc space-y-1 text-xs text-amber-200/80">
                  {report.dataGaps.map((g, idx) => <li key={idx}>{g}</li>)}
                </ul>
              </section>
            )}
          </div>
        )}

        {/* Historique. « Historiser » écrivait dans un tiroir sans poignée : ni
            la liste ni l'export n'avaient d'appelant, et l'exploitant accumulait
            des instantanés qu'il ne reverrait jamais (GF-DUR-032). */}
        <div className="mt-6">
          <HistoriqueRapports version={versionHistorique} />
        </div>
      </div>
    </div>
  )
}

function ExportBtn({ onClick, icon, label }: { onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:bg-white/[0.08]">
      {icon} {label}
    </button>
  )
}

function TrendIcon({ value }: { value: number | null }) {
  if (value == null) return <Minus className="h-5 w-5 text-slate-500" />
  if (value > 0) return <TrendingUp className="h-5 w-5 text-emerald-400" />
  if (value < 0) return <TrendingDown className="h-5 w-5 text-red-400" />
  return <Minus className="h-5 w-5 text-slate-500" />
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
