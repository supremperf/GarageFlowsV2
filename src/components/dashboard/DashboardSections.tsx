'use client'

import { useState, useEffect, useMemo } from 'react'
import { useScheduleStore } from '@/store/schedule-store'
import { formatDuration, calculateUtilizationRate } from '@/lib/utils'
import { Euro, Package, Clock, TrendingUp, AlertTriangle, Wrench } from 'lucide-react'
import {
  StatsData, DailyStat,
  RevenueChart, RecentJobs, TopRepairs, MechanicBars, KpiCard,
} from './DashboardCharts'

// ─────────────────────────────────────────────────────────────
// Stock Section
// ─────────────────────────────────────────────────────────────

export function StockSection({ stats }: { stats: StatsData | null }) {
  const [parts, setParts] = useState<Array<{
    id: string; name: string; reference: string; quantity: number
    minQuantity: number; unitPrice: number; unitCost: number
  }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/parts')
      .then(r => r.ok ? r.json() : [])
      .then(setParts)
      .finally(() => setLoading(false))
  }, [])

  const lowStock = parts.filter(p => p.quantity <= p.minQuantity)
  const totalValue = parts.reduce((s, p) => s + p.quantity * p.unitCost, 0)

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {[
          { label: 'Références', value: parts.length, color: '#3b82f6', icon: <Package size={16} /> },
          { label: 'Valeur stock', value: `${totalValue.toFixed(0)} €`, color: '#8b5cf6', icon: <Euro size={16} /> },
          { label: 'Alertes', value: lowStock.length, color: lowStock.length > 0 ? '#f59e0b' : '#10b981', icon: <AlertTriangle size={16} /> },
        ].map(card => (
          <div key={card.label} style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14, padding: '18px 20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ color: card.color }}>{card.icon}</div>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>{card.label}</span>
            </div>
            <p style={{ color: 'white', fontSize: 26, fontWeight: 700 }}>{card.value}</p>
          </div>
        ))}
      </div>

      {lowStock.length > 0 && (
        <div style={{
          background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)',
          borderRadius: 14, padding: 16,
        }}>
          <p style={{ color: '#f59e0b', fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={14} /> {lowStock.length} article{lowStock.length > 1 ? 's' : ''} en alerte stock
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lowStock.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ color: '#cbd5e1', fontSize: 13 }}>{p.name}</span>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                  background: p.quantity === 0 ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)',
                  color: p.quantity === 0 ? '#ef4444' : '#f59e0b',
                }}>
                  {p.quantity === 0 ? 'ÉPUISÉ' : `${p.quantity} / ${p.minQuantity} min`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              {['Pièce', 'Stock', 'Prix vente', 'Valeur stock', 'Statut'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#475569', fontSize: 11, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: '#475569' }}>Chargement…</td></tr>
            ) : parts.slice(0, 10).map((p, i) => {
              const isLow = p.quantity <= p.minQuantity
              const isEmpty = p.quantity === 0
              return (
                <tr key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                  <td style={{ padding: '10px 14px' }}>
                    <p style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500 }}>{p.name}</p>
                    <p style={{ color: '#475569', fontSize: 10 }}>{p.reference}</p>
                  </td>
                  <td style={{ padding: '10px 14px', color: isLow ? '#f59e0b' : '#94a3b8', fontSize: 13, fontWeight: 600 }}>{p.quantity}</td>
                  <td style={{ padding: '10px 14px', color: '#94a3b8', fontSize: 13 }}>{p.unitPrice} €</td>
                  <td style={{ padding: '10px 14px', color: '#3b82f6', fontSize: 13, fontWeight: 600 }}>{(p.quantity * p.unitCost).toFixed(0)} €</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      background: isEmpty ? 'rgba(239,68,68,0.2)' : isLow ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.15)',
                      color: isEmpty ? '#ef4444' : isLow ? '#f59e0b' : '#10b981',
                    }}>
                      {isEmpty ? 'Épuisé' : isLow ? 'Faible' : 'OK'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Mechanics Section
// ─────────────────────────────────────────────────────────────

export function MechanicsSection({ stats }: { stats: StatsData | null }) {
  if (!stats) return <div style={{ padding: 24, color: '#475569' }}>Aucune donnée disponible pour cette période.</div>

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {[
          {
            label: 'Heures facturées',
            value: `${stats.totals.billedHours.toFixed(1)}h`,
            color: '#3b82f6', icon: <Clock size={16} />,
          },
          {
            label: 'CA main d\'œuvre',
            value: `${stats.totals.laborRevenue} €`,
            color: '#8b5cf6', icon: <Euro size={16} />,
          },
          {
            label: 'Taux occupation',
            value: `${Math.round(stats.totals.utilizationRate)}%`,
            color: stats.totals.utilizationRate >= 70 ? '#10b981' : '#f59e0b',
            icon: <TrendingUp size={16} />,
          },
        ].map(card => (
          <div key={card.label} style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14, padding: '18px 20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ color: card.color }}>{card.icon}</div>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>{card.label}</span>
            </div>
            <p style={{ color: 'white', fontSize: 26, fontWeight: 700 }}>{card.value}</p>
          </div>
        ))}
      </div>

      <div style={{
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14, overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              {['Mécanicien', 'Interventions', 'H. facturées', 'CA MO', 'Taux occup.', 'Efficacité', 'Moy. estimé', 'Moy. réel'].map(h => (
                <th key={h} style={{ padding: '12px 14px', textAlign: 'left', color: '#475569', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stats.mechanicStats.map((m, i) => {
              const effColor = m.efficiency === null ? '#64748b'
                : m.efficiency >= 100 ? '#10b981'
                : m.efficiency >= 85 ? '#f59e0b' : '#ef4444'
              return (
                <tr key={m.mechanicId} style={{
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                }}>
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%', background: m.mechanicColor,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, color: 'white', flexShrink: 0,
                      }}>{m.mechanicAvatar}</div>
                      <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{m.mechanicName}</span>
                    </div>
                  </td>
                  <td style={{ padding: '12px 14px', color: '#94a3b8', fontSize: 13 }}>{m.jobCount}</td>
                  <td style={{ padding: '12px 14px', color: '#94a3b8', fontSize: 13 }}>{m.billedHours.toFixed(1)}h</td>
                  <td style={{ padding: '12px 14px', color: '#3b82f6', fontSize: 13, fontWeight: 700 }}>{m.laborRevenue} €</td>
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 60, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 999, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${m.utilizationRate}%`, background: m.mechanicColor, borderRadius: 999 }} />
                      </div>
                      <span style={{ color: '#94a3b8', fontSize: 11 }}>{m.utilizationRate}%</span>
                    </div>
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    {m.efficiency !== null ? (
                      <span style={{
                        fontSize: 12, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
                        background: effColor + '22', color: effColor,
                      }}>{m.efficiency}%</span>
                    ) : (
                      <span style={{ color: '#475569', fontSize: 12 }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 14px', color: '#64748b', fontSize: 12 }}>
                    {m.avgEstimatedMins ? formatDuration(m.avgEstimatedMins) : '—'}
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: 12, color: m.avgActualMins && m.avgActualMins > m.avgEstimatedMins ? '#f87171' : '#4ade80' }}>
                    {m.avgActualMins ? formatDuration(m.avgActualMins) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p style={{ color: '#475569', fontSize: 11, paddingLeft: 4 }}>
        Efficacité = temps estimé ÷ temps réel × 100. &nbsp;
        <span style={{ color: '#10b981' }}>≥ 100%</span> = plus rapide que prévu ·&nbsp;
        <span style={{ color: '#f59e0b' }}>85–99%</span> = dans la norme ·&nbsp;
        <span style={{ color: '#ef4444' }}>&lt; 85%</span> = à surveiller
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Overview Section
// ─────────────────────────────────────────────────────────────

export function OverviewSection({ stats, period }: { stats: StatsData | null; period: number }) {
  const [chartSeries, setChartSeries] = useState({ mo: true, parts: true })
  const { jobs, mechanics, selectedDate } = useScheduleStore()

  const todayMetrics = useMemo(() => {
    const dayJobs = jobs.filter(j => j.date === selectedDate && j.status !== 'cancelled')
    return {
      count: dayJobs.length,
      completed: dayJobs.filter(j => j.status === 'completed').length,
      inProgress: dayJobs.filter(j => j.status === 'in_progress').length,
      delayed: dayJobs.filter(j => j.status === 'delayed').length,
      utilization: calculateUtilizationRate(dayJobs, mechanics, selectedDate),
    }
  }, [jobs, mechanics, selectedDate])

  const moSpark = stats?.dailyStats.map(d => d.laborRevenue) ?? []
  const hoursSpark = stats?.dailyStats.map(d => d.billedHours) ?? []
  const partsSpark = stats?.dailyStats.map(d => d.partsRevenue) ?? []
  const utilSpark = stats?.dailyStats.map(d => d.utilizationRate) ?? []

  const toggle = (k: 'mo' | 'parts') =>
    setChartSeries(prev => ({ ...prev, [k]: !prev[k] }))

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <KpiCard
          label="CA Total"
          value={stats ? `${stats.totals.totalRevenue.toLocaleString('fr-FR')} €` : '—'}
          delta={stats ? `MO ${stats.totals.laborRevenue} € + Pièces ${stats.totals.partsRevenue} €` : undefined}
          positive color="#3b82f6" sparkValues={moSpark} uid="ca" icon={<Euro size={16} />}
        />
        <KpiCard
          label="Heures facturées"
          value={stats ? `${stats.totals.billedHours.toFixed(1)}h` : '—'}
          delta={stats ? `${stats.totals.jobCount} interventions` : undefined}
          positive color="#8b5cf6" sparkValues={hoursSpark} uid="hrs" icon={<Clock size={16} />}
        />
        <KpiCard
          label="Pièces vendues"
          value={stats ? `${stats.totals.partsRevenue.toLocaleString('fr-FR')} €` : '—'}
          delta={stats && stats.totals.partsMargin > 0 ? `Marge ${stats.totals.partsMargin} €` : undefined}
          positive={stats ? stats.totals.partsMargin > 0 : true}
          color="#22d3ee" sparkValues={partsSpark} uid="parts" icon={<Package size={16} />}
        />
        <KpiCard
          label="Taux occupation"
          value={stats ? `${Math.round(stats.totals.utilizationRate)}%` : `${todayMetrics.utilization}%`}
          delta={`${todayMetrics.count} véhicules · ${todayMetrics.inProgress} en cours`}
          positive={todayMetrics.utilization >= 60}
          color={todayMetrics.utilization >= 80 ? '#10b981' : todayMetrics.utilization >= 60 ? '#f59e0b' : '#ef4444'}
          sparkValues={utilSpark} uid="occ" icon={<TrendingUp size={16} />}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>
        <div style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16, padding: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <p style={{ color: 'white', fontSize: 15, fontWeight: 700 }}>Évolution du CA</p>
            <span style={{ color: '#475569', fontSize: 12 }}>{period} derniers jours</span>
          </div>
          {stats && stats.dailyStats.length > 0 ? (
            <RevenueChart dailyStats={stats.dailyStats} activeSeries={chartSeries} onToggle={toggle} />
          ) : (
            <div style={{ height: 170, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569' }}>
              Aucune donnée pour cette période
            </div>
          )}
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16, padding: 20, overflow: 'hidden',
        }}>
          <p style={{ color: 'white', fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Activité récente</p>
          <RecentJobs />
        </div>
      </div>

      {todayMetrics.delayed > 0 && (
        <div style={{
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
          borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <AlertTriangle size={16} style={{ color: '#f59e0b', flexShrink: 0 }} />
          <span style={{ color: '#fbbf24', fontSize: 13 }}>
            {todayMetrics.delayed} retard{todayMetrics.delayed > 1 ? 's' : ''} détecté{todayMetrics.delayed > 1 ? 's' : ''} aujourd&apos;hui — vérifiez les suggestions IA
          </span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16, padding: 20,
        }}>
          <p style={{ color: 'white', fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Top Réparations</p>
          <TopRepairs dailyStats={stats?.dailyStats ?? []} />
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16, padding: 20,
        }}>
          <p style={{ color: 'white', fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Performance Mécaniciens</p>
          {stats ? (
            <MechanicBars mechanicStats={stats.mechanicStats} />
          ) : (
            <p style={{ color: '#475569', fontSize: 13 }}>Chargement…</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Revenue Section
// ─────────────────────────────────────────────────────────────

export function RevenueSection({ stats }: { stats: StatsData | null }) {
  const [chartSeries, setChartSeries] = useState({ mo: true, parts: true })

  if (!stats) return <div style={{ padding: 24, color: '#475569' }}>Aucune donnée disponible pour cette période.</div>

  const { totals, dailyStats } = stats
  const partsMarginPct = totals.partsRevenue > 0
    ? Math.round((totals.partsMargin / totals.partsRevenue) * 100) : 0
  const netProfit = Math.round(totals.totalRevenue - totals.partsCost)
  const netMarginPct = totals.totalRevenue > 0
    ? Math.round((netProfit / totals.totalRevenue) * 100) : 0

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{
        background: 'linear-gradient(135deg, rgba(16,185,129,0.15) 0%, rgba(59,130,246,0.1) 100%)',
        border: '1px solid rgba(16,185,129,0.3)',
        borderRadius: 16, padding: '16px 20px',
        display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap',
      }}>
        <div>
          <p style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>BÉNÉFICE NET (période)</p>
          <p style={{ color: netProfit >= 0 ? '#10b981' : '#ef4444', fontSize: 28, fontWeight: 800 }}>
            {netProfit >= 0 ? '+' : ''}{netProfit.toLocaleString('fr-FR')} €
          </p>
        </div>
        <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.08)' }} />
        <div>
          <p style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>MARGE NETTE</p>
          <p style={{ color: netMarginPct >= 20 ? '#10b981' : netMarginPct >= 10 ? '#f59e0b' : '#ef4444', fontSize: 22, fontWeight: 700 }}>
            {netMarginPct}%
          </p>
        </div>
        <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.08)' }} />
        <div>
          <p style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>COÛT PIÈCES</p>
          <p style={{ color: '#f87171', fontSize: 22, fontWeight: 700 }}>-{totals.partsCost.toLocaleString('fr-FR')} €</p>
        </div>
        <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.08)' }} />
        <div>
          <p style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>MARGE PIÈCES</p>
          <p style={{ color: partsMarginPct >= 30 ? '#10b981' : '#f59e0b', fontSize: 22, fontWeight: 700 }}>{partsMarginPct}%</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        {[
          { label: 'CA Total', value: `${totals.totalRevenue.toLocaleString('fr-FR')} €`, color: '#3b82f6', icon: <Euro size={14} /> },
          { label: 'CA Main d\'œuvre', value: `${totals.laborRevenue} €`, color: '#8b5cf6', icon: <Wrench size={14} /> },
          { label: 'CA Pièces', value: `${totals.partsRevenue} €`, color: '#22d3ee', icon: <Package size={14} /> },
          { label: 'Bénéfice net', value: `${netProfit >= 0 ? '+' : ''}${netProfit} €`, color: netProfit >= 0 ? '#10b981' : '#ef4444', icon: <TrendingUp size={14} /> },
        ].map(card => (
          <div key={card.label} style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14, padding: '18px 20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
              <div style={{ color: card.color }}>{card.icon}</div>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>{card.label}</span>
            </div>
            <p style={{ color: 'white', fontSize: 24, fontWeight: 700 }}>{card.value}</p>
          </div>
        ))}
      </div>

      <div style={{
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16, padding: 20,
      }}>
        <p style={{ color: 'white', fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Évolution du chiffre d&apos;affaires</p>
        {dailyStats.length > 0 ? (
          <RevenueChart dailyStats={dailyStats} activeSeries={chartSeries} onToggle={k => setChartSeries(p => ({ ...p, [k]: !p[k] }))} />
        ) : (
          <div style={{ height: 170, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569' }}>
            Aucune donnée
          </div>
        )}
      </div>

      {/* ── Top clients + top repair types ─────────────────────────────────── */}
      {stats && (stats.topClients.length > 0 || stats.topRepairTypes.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Top clients */}
          <div style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14, padding: '18px 20px',
          }}>
            <p style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600, marginBottom: 14, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Top clients — {stats.period}j
            </p>
            {stats.topClients.length === 0 ? (
              <p style={{ color: '#475569', fontSize: 13 }}>Aucune donnée</p>
            ) : stats.topClients.map((c, i) => {
              const maxCount = stats.topClients[0].count
              return (
                <div key={c.name} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: '#e2e8f0', fontSize: 13, maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {i + 1}. {c.name}
                    </span>
                    <span style={{ color: '#60a5fa', fontSize: 12, fontWeight: 700 }}>{c.count} interv.</span>
                  </div>
                  <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 999 }}>
                    <div style={{ height: '100%', width: `${(c.count / maxCount) * 100}%`, background: 'linear-gradient(90deg, #3b82f6, #6366f1)', borderRadius: 999, transition: 'width 0.4s' }} />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Top repair types */}
          <div style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14, padding: '18px 20px',
          }}>
            <p style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600, marginBottom: 14, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Top interventions — {stats.period}j
            </p>
            {stats.topRepairTypes.length === 0 ? (
              <p style={{ color: '#475569', fontSize: 13 }}>Aucune donnée</p>
            ) : stats.topRepairTypes.map((r, i) => {
              const maxCount = stats.topRepairTypes[0].count
              return (
                <div key={r.type} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: '#e2e8f0', fontSize: 13, maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {i + 1}. {r.type}
                    </span>
                    <span style={{ color: '#a78bfa', fontSize: 12, fontWeight: 700 }}>{r.count}×</span>
                  </div>
                  <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 999 }}>
                    <div style={{ height: '100%', width: `${(r.count / maxCount) * 100}%`, background: 'linear-gradient(90deg, #8b5cf6, #a78bfa)', borderRadius: 999, transition: 'width 0.4s' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style={{
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14, overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              {['Date', 'Interv.', 'Terminées', 'H. fact.', 'CA MO', 'CA Pièces', 'CA Total', 'Bénéfice', 'Occupation'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#475569', fontSize: 11, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...dailyStats].reverse().slice(0, 14).map((d, i) => {
              const dt = new Date(d.date + 'T12:00:00')
              const isToday = d.date === new Date().toISOString().split('T')[0]
              return (
                <tr key={d.date} style={{
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  background: isToday ? 'rgba(59,130,246,0.06)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                }}>
                  <td style={{ padding: '10px 14px', color: isToday ? '#60a5fa' : '#94a3b8', fontSize: 13, fontWeight: isToday ? 700 : 400 }}>
                    {dt.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' })}
                    {isToday && <span style={{ marginLeft: 6, fontSize: 10, background: 'rgba(59,130,246,0.2)', color: '#60a5fa', padding: '1px 5px', borderRadius: 4 }}>Auj.</span>}
                  </td>
                  <td style={{ padding: '10px 14px', color: '#94a3b8', fontSize: 13 }}>{d.jobCount}</td>
                  <td style={{ padding: '10px 14px', color: '#10b981', fontSize: 13 }}>{d.completedCount}</td>
                  <td style={{ padding: '10px 14px', color: '#94a3b8', fontSize: 13 }}>{d.billedHours}h</td>
                  <td style={{ padding: '10px 14px', color: '#8b5cf6', fontSize: 13, fontWeight: 600 }}>{d.laborRevenue} €</td>
                  <td style={{ padding: '10px 14px', color: '#22d3ee', fontSize: 13, fontWeight: 600 }}>{d.partsRevenue} €</td>
                  <td style={{ padding: '10px 14px', color: '#3b82f6', fontSize: 13, fontWeight: 700 }}>{d.totalRevenue} €</td>
                  <td style={{ padding: '10px 14px', color: (d.totalRevenue - d.partsCost) >= 0 ? '#10b981' : '#ef4444', fontSize: 13, fontWeight: 600 }}>
                    {(d.totalRevenue - d.partsCost) >= 0 ? '+' : ''}{Math.round(d.totalRevenue - d.partsCost)} €
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 50, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 999, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${d.utilizationRate}%`, background: d.utilizationRate >= 80 ? '#10b981' : d.utilizationRate >= 60 ? '#f59e0b' : '#ef4444', borderRadius: 999 }} />
                      </div>
                      <span style={{ color: '#64748b', fontSize: 11 }}>{d.utilizationRate}%</span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
