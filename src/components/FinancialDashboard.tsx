'use client'

import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, Euro, FileText, BarChart2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MonthStat {
  label: string
  caHT: number
  caTTC: number
  tva: number
  invoiceCount: number
  partsCost: number
  margin: number | null
  quotesCreated: number
  quotesAccepted: number
  conversionRate: number | null
}

interface FinanceData {
  months: MonthStat[]
  totals: {
    caHT: number
    caTTC: number
    tva: number
    avgMargin: number
    globalConversion: number | null
    invoiceCount: number
  }
  currency: string
}

interface Props {
  onClose: () => void
}

function fmt(n: number) {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €'
}

function KpiCard({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <div className="bg-white/[0.04] rounded-xl border border-white/[0.07] p-4">
      <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={cn('text-2xl font-bold', positive === undefined ? 'text-white' : positive ? 'text-emerald-400' : 'text-red-400')}>
        {value}
      </p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function FinancialDashboard({ onClose }: Props) {
  const [data, setData] = useState<FinanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [months, setMonths] = useState(6)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/finance?months=${months}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d) })
      .finally(() => setLoading(false))
  }, [months])

  const maxCA = data ? Math.max(...data.months.map(m => m.caTTC), 1) : 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0f1629] rounded-2xl shadow-2xl border border-white/[0.07] w-full max-w-4xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="sticky top-0 bg-[#0f1629] border-b border-white/[0.07] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BarChart2 className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-bold text-white">Tableau de bord financier</h2>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={months}
              onChange={e => setMonths(Number(e.target.value))}
              className="rounded-lg border border-white/10 bg-white/[0.05] text-white text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {[3, 6, 12, 24].map(m => (
                <option key={m} value={m} className="bg-[#111827]">{m} mois</option>
              ))}
            </select>
            <button onClick={onClose} className="gf-close p-1.5 rounded-lg hover:bg-white/[0.07] text-slate-400 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : !data ? (
            <p className="text-slate-500 text-center py-12">Aucune donnée disponible</p>
          ) : (
            <>
              {/* KPI row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard label="CA TTC total" value={fmt(data.totals.caTTC)} sub={`HT: ${fmt(data.totals.caHT)}`} />
                <KpiCard label="TVA collectée" value={fmt(data.totals.tva)} />
                <KpiCard
                  label="Marge pièces moy."
                  value={data.totals.avgMargin != null ? `${data.totals.avgMargin}%` : '—'}
                  sub="hors coût main-d'œuvre"
                  positive={data.totals.avgMargin != null ? data.totals.avgMargin >= 50 : undefined}
                />
                <KpiCard
                  label="Taux devis→facture"
                  value={data.totals.globalConversion != null ? `${data.totals.globalConversion}%` : '—'}
                  sub={`${data.totals.invoiceCount} factures`}
                  positive={data.totals.globalConversion != null ? data.totals.globalConversion >= 60 : undefined}
                />
              </div>

              {/* Bar chart (CA TTC per month) */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Euro className="w-3.5 h-3.5 text-blue-400" />
                  Chiffre d&apos;affaires TTC mensuel
                </p>
                <div className="flex items-end gap-1.5 h-32">
                  {data.months.map(m => (
                    <div key={m.label} className="flex-1 flex flex-col items-center gap-1 group">
                      <div className="relative w-full flex justify-center">
                        <div
                          className="w-full rounded-t-sm bg-blue-600/70 group-hover:bg-blue-500/90 transition-all cursor-default"
                          style={{ height: `${Math.max(4, (m.caTTC / maxCA) * 112)}px` }}
                          title={`${m.label}: ${fmt(m.caTTC)}`}
                        />
                      </div>
                      <p className="text-[9px] text-slate-500 text-center leading-tight">{m.label.split(' ')[0]}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Monthly table */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-slate-400" />
                  Détail mensuel
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.07]">
                        {['Mois', 'CA HT', 'TVA', 'CA TTC', 'Factures', 'Marge pièces', 'Devis', 'Taux conv.'].map(h => (
                          <th key={h} className="text-left text-xs text-slate-500 py-2 pr-4 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.months.map((m, i) => (
                        <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                          <td className="py-2 pr-4 text-slate-300 font-medium whitespace-nowrap">{m.label}</td>
                          <td className="py-2 pr-4 text-slate-300 whitespace-nowrap">{fmt(m.caHT)}</td>
                          <td className="py-2 pr-4 text-slate-500 whitespace-nowrap">{fmt(m.tva)}</td>
                          <td className="py-2 pr-4 text-white font-semibold whitespace-nowrap">{fmt(m.caTTC)}</td>
                          <td className="py-2 pr-4 text-slate-400">{m.invoiceCount}</td>
                          <td className={cn('py-2 pr-4 font-medium whitespace-nowrap',
                            m.margin === null ? 'text-slate-600' :
                            m.margin >= 50 ? 'text-emerald-400' : m.margin >= 30 ? 'text-amber-400' : 'text-red-400'
                          )}>
                            {m.margin !== null ? `${m.margin}%` : '—'}
                          </td>
                          <td className="py-2 pr-4 text-slate-400">
                            {m.quotesCreated > 0 ? `${m.quotesAccepted}/${m.quotesCreated}` : '—'}
                          </td>
                          <td className={cn('py-2 font-medium',
                            m.conversionRate === null ? 'text-slate-600' :
                            m.conversionRate >= 60 ? 'text-emerald-400' : m.conversionRate >= 40 ? 'text-amber-400' : 'text-red-400'
                          )}>
                            {m.conversionRate !== null ? `${m.conversionRate}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Trend indicator */}
              {data.months.length >= 2 && (() => {
                const last  = data.months[data.months.length - 1].caTTC
                const prev  = data.months[data.months.length - 2].caTTC
                const delta = prev > 0 ? Math.round(((last - prev) / prev) * 100) : null
                if (delta === null) return null
                const up = delta >= 0
                return (
                  <div className={cn('flex items-center gap-2 p-3 rounded-xl border text-sm',
                    up ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                       : 'bg-red-500/10 border-red-500/20 text-red-400'
                  )}>
                    {up ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    <span>
                      CA du dernier mois&nbsp;: <strong>{fmt(last)}</strong>
                      {' '}({up ? '+' : ''}{delta}% vs mois précédent)
                    </span>
                  </div>
                )
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
