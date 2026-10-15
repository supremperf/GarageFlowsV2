'use client'

import { useMemo } from 'react'
import { useScheduleStore } from '@/store/schedule-store'
import { REPAIR_TYPES } from '@/lib/types'

// ─────────────────────────────────────────────────────────────
// Shared Types
// ─────────────────────────────────────────────────────────────

export interface DailyStat {
  date: string
  jobCount: number
  completedCount: number
  billedHours: number
  laborRevenue: number
  partsRevenue: number
  partsCost: number
  totalRevenue: number
  utilizationRate: number
}

export interface MechanicStat {
  mechanicId: string
  mechanicName: string
  mechanicColor: string
  mechanicAvatar: string
  jobCount: number
  completedCount: number
  billedHours: number
  laborRevenue: number
  utilizationRate: number
  efficiency: number | null
  avgEstimatedMins: number
  avgActualMins: number
}

export interface StatsData {
  period: number
  totals: {
    billedHours: number
    laborRevenue: number
    partsRevenue: number
    partsCost: number
    totalRevenue: number
    partsMargin: number
    utilizationRate: number
    jobCount: number
    invoiceRevenue: number
    invoiceHT: number
    invoiceCount: number
    confirmedRevenue: number
  }
  dailyStats: DailyStat[]
  mechanicStats: MechanicStat[]
  stockAlerts: Array<{ id: string; name: string; quantity: number; minQuantity: number }>
  topClients: Array<{ name: string; count: number; revenue: number }>
  topRepairTypes: Array<{ type: string; count: number }>
  hourlyRate: number
}

// ─────────────────────────────────────────────────────────────
// SVG Helpers
// ─────────────────────────────────────────────────────────────

export function toPoints(
  values: number[], w: number, h: number, pad = 4
): { x: number; y: number }[] {
  if (!values.length) return []
  const mn = Math.min(...values)
  const mx = Math.max(...values)
  const rng = mx - mn || 1
  return values.map((v, i) => ({
    x: values.length === 1 ? w / 2 : pad + (i / (values.length - 1)) * (w - pad * 2),
    y: (h - pad) - ((v - mn) / rng) * (h - pad * 2),
  }))
}

export function smoothLine(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return ''
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const cx = (pts[i].x + pts[i + 1].x) / 2
    d += ` C${cx.toFixed(1)},${pts[i].y.toFixed(1)} ${cx.toFixed(1)},${pts[i + 1].y.toFixed(1)} ${pts[i + 1].x.toFixed(1)},${pts[i + 1].y.toFixed(1)}`
  }
  return d
}

export function smoothArea(pts: { x: number; y: number }[], h: number): string {
  if (pts.length < 2) return ''
  const line = smoothLine(pts)
  return `${line} L${pts[pts.length - 1].x.toFixed(1)},${h} L${pts[0].x.toFixed(1)},${h} Z`
}

// ─────────────────────────────────────────────────────────────
// Sparkline
// ─────────────────────────────────────────────────────────────

export function Sparkline({ values, color, uid }: { values: number[]; color: string; uid: string }) {
  const W = 100, H = 38
  const pts = toPoints(values, W, H - 4, 3)
  if (pts.length < 2) return <div style={{ height: H }} />
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H, display: 'block' }}>
      <defs>
        <linearGradient id={`sg-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={smoothArea(pts, H)} fill={`url(#sg-${uid})`} />
      <path d={smoothLine(pts)} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────
// KPI Card
// ─────────────────────────────────────────────────────────────

export function KpiCard({
  label, value, delta, positive, color, sparkValues, uid, icon,
}: {
  label: string; value: string; delta?: string; positive?: boolean
  color: string; sparkValues: number[]; uid: string; icon: React.ReactNode
}) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 16,
      overflow: 'hidden',
      transition: 'border-color 0.2s',
    }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = color + '55')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
    >
      <div style={{ padding: '20px 20px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <p style={{ color: '#94a3b8', fontSize: 13, fontWeight: 500 }}>{label}</p>
          <div style={{
            width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: color + '22',
          }}>
            <span style={{ color }}>{icon}</span>
          </div>
        </div>
        <p style={{ color: 'white', fontSize: 30, fontWeight: 700, lineHeight: 1, marginBottom: 6 }}>{value}</p>
        {delta && (
          <p style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, color: positive ? '#4ade80' : '#f87171' }}>
            <span>{positive ? '↑' : '↓'}</span>
            <span>{delta}</span>
          </p>
        )}
      </div>
      <Sparkline values={sparkValues} color={color} uid={uid} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Revenue Chart (SVG)
// ─────────────────────────────────────────────────────────────

export function RevenueChart({ dailyStats, activeSeries, onToggle }: {
  dailyStats: DailyStat[]
  activeSeries: { mo: boolean; parts: boolean }
  onToggle: (k: 'mo' | 'parts') => void
}) {
  const W = 540, H = 170
  const PAD = { top: 15, right: 16, bottom: 32, left: 48 }
  const CW = W - PAD.left - PAD.right
  const CH = H - PAD.top - PAD.bottom

  const moVals = dailyStats.map(d => d.laborRevenue)
  const partsVals = dailyStats.map(d => d.partsRevenue)
  const allVals = [...moVals, ...partsVals]
  const maxVal = Math.max(...allVals, 1)

  function toPts(values: number[]) {
    return values.map((v, i) => ({
      x: PAD.left + (values.length === 1 ? CW / 2 : (i / (values.length - 1)) * CW),
      y: PAD.top + CH - (v / maxVal) * CH,
    }))
  }

  const moPts = toPts(moVals)
  const partsPts = toPts(partsVals)

  const ySteps = 4
  const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => ({
    value: Math.round((maxVal / ySteps) * i),
    y: PAD.top + CH - (i / ySteps) * CH,
  }))

  const xStep = Math.max(1, Math.ceil(dailyStats.length / 6))
  const xLabels = dailyStats.filter((_, i) => i % xStep === 0 || i === dailyStats.length - 1)

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <defs>
          <linearGradient id="cg-mo" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="cg-parts" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
          <filter id="glow-blue" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="glow-cyan" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {yLabels.map((yl, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={yl.y} x2={W - PAD.right} y2={yl.y}
              stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={PAD.left - 8} y={yl.y + 4} textAnchor="end" fill="#475569" fontSize="10">
              {yl.value >= 1000 ? `${(yl.value / 1000).toFixed(0)}k` : yl.value}
            </text>
          </g>
        ))}

        {activeSeries.mo && moPts.length >= 2 && (
          <>
            <path d={smoothArea(moPts, PAD.top + CH)} fill="url(#cg-mo)" />
            <path d={smoothLine(moPts)} fill="none" stroke="#3b82f6" strokeWidth="2.5"
              strokeLinecap="round" filter="url(#glow-blue)" />
          </>
        )}

        {activeSeries.parts && partsPts.length >= 2 && (
          <>
            <path d={smoothArea(partsPts, PAD.top + CH)} fill="url(#cg-parts)" />
            <path d={smoothLine(partsPts)} fill="none" stroke="#22d3ee" strokeWidth="2"
              strokeLinecap="round" filter="url(#glow-cyan)" />
          </>
        )}

        {xLabels.map((d) => {
          const idx = dailyStats.indexOf(d)
          const x = PAD.left + (dailyStats.length === 1 ? CW / 2 : (idx / (dailyStats.length - 1)) * CW)
          const dt = new Date(d.date + 'T12:00:00')
          return (
            <text key={d.date} x={x} y={H - 4} textAnchor="middle" fill="#475569" fontSize="10">
              {dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
            </text>
          )
        })}
      </svg>

      <div style={{ display: 'flex', gap: 12, marginTop: 12, justifyContent: 'center' }}>
        {([
          { key: 'mo' as const, label: 'Main d\'œuvre', color: '#3b82f6' },
          { key: 'parts' as const, label: 'Pièces', color: '#22d3ee' },
        ] as const).map(s => (
          <button
            key={s.key}
            onClick={() => onToggle(s.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px',
              borderRadius: 999, border: `1px solid ${activeSeries[s.key] ? s.color + '60' : 'rgba(255,255,255,0.1)'}`,
              background: activeSeries[s.key] ? s.color + '18' : 'transparent',
              color: activeSeries[s.key] ? s.color : '#64748b',
              fontSize: 12, fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s',
            }}
          >
            <span style={{ width: 24, height: 2, background: s.color, borderRadius: 999, display: 'inline-block' }} />
            + {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Recent Jobs
// ─────────────────────────────────────────────────────────────

export function RecentJobs() {
  const { jobs, mechanics } = useScheduleStore()

  const recent = useMemo(() => {
    return [...jobs]
      // Comparateur DÉFENSIF : un tri d'affichage ne doit jamais faire tomber
      // le tableau de bord. Une seule intervention dont `date` ou `startTime`
      // manque suffisait à lever « Cannot read properties of undefined (reading
      // 'localeCompare') » — et, ce tri s'exécutant dans un useMemo pendant le
      // rendu, l'error boundary emportait TOUTE la page (observé en production).
      .sort((a, b) => {
        const da = a.date ?? '', db = b.date ?? ''
        if (da !== db) return db.localeCompare(da)
        return (b.startTime ?? '').localeCompare(a.startTime ?? '')
      })
      .slice(0, 6)
  }, [jobs])

  const STATUS_COLOR: Record<string, string> = {
    completed: '#10b981', in_progress: '#3b82f6',
    scheduled: '#94a3b8', delayed: '#f59e0b', cancelled: '#ef4444',
  }
  const STATUS_LABEL: Record<string, string> = {
    completed: 'Terminé', in_progress: 'En cours',
    scheduled: 'Planifié', delayed: 'Retard', cancelled: 'Annulé',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {recent.map(job => {
        const mech = mechanics.find(m => m.id === job.mechanicId)
        const repairCfg = REPAIR_TYPES[job.repairType as keyof typeof REPAIR_TYPES]
        return (
          <div key={job.id} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
            borderRadius: 10, background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8, flexShrink: 0,
              background: 'rgba(59,130,246,0.15)',
              border: '1px solid rgba(59,130,246,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16,
            }}>
              {repairCfg?.icon ?? '🔧'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {job.customerName}
              </p>
              <p style={{ color: '#64748b', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {repairCfg?.label ?? job.repairType} · {job.vehicleModel}
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {mech && (
                  <div style={{
                    width: 18, height: 18, borderRadius: '50%',
                    background: mech.color, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: 8, fontWeight: 700, color: 'white',
                  }}>
                    {mech.avatar}
                  </div>
                )}
                <div style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: STATUS_COLOR[job.status] ?? '#94a3b8',
                }} />
              </div>
              <span style={{ fontSize: 10, color: STATUS_COLOR[job.status] ?? '#94a3b8' }}>
                {STATUS_LABEL[job.status] ?? job.status}
              </span>
            </div>
          </div>
        )
      })}
      {recent.length === 0 && (
        <p style={{ color: '#475569', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
          Aucune intervention
        </p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Top Repairs
// ─────────────────────────────────────────────────────────────

export function TopRepairs({ dailyStats }: { dailyStats: DailyStat[] }) {
  const { jobs } = useScheduleStore()

  const breakdown = useMemo(() => {
    const counts: Record<string, { count: number; revenue: number }> = {}
    jobs.forEach(j => {
      if (j.status === 'cancelled') return
      if (!counts[j.repairType]) counts[j.repairType] = { count: 0, revenue: 0 }
      counts[j.repairType].count++
      counts[j.repairType].revenue += (j.estimatedDuration / 60) * 60
    })
    return Object.entries(counts)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
  }, [jobs])

  const maxCount = Math.max(...breakdown.map(([, d]) => d.count), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {breakdown.map(([type, data]) => {
        const cfg = REPAIR_TYPES[type as keyof typeof REPAIR_TYPES]
        const pct = Math.round((data.count / maxCount) * 100)
        return (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8, flexShrink: 0,
              background: (cfg?.color ?? '#3b82f6') + '22',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
            }}>
              {cfg?.icon ?? '🔧'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#cbd5e1', fontSize: 12, fontWeight: 500 }}>{cfg?.label ?? type}</span>
                <span style={{ color: '#3b82f6', fontSize: 12, fontWeight: 700 }}>{data.count}</span>
              </div>
              <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 999, width: `${pct}%`,
                  background: `linear-gradient(90deg, ${cfg?.color ?? '#3b82f6'}, ${cfg?.color ?? '#3b82f6'}88)`,
                  transition: 'width 0.5s ease',
                }} />
              </div>
            </div>
          </div>
        )
      })}
      {breakdown.length === 0 && (
        <p style={{ color: '#475569', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
          Aucune donnée
        </p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Mechanic Bars
// ─────────────────────────────────────────────────────────────

export function MechanicBars({ mechanicStats }: { mechanicStats: MechanicStat[] }) {
  const maxRevenue = Math.max(...mechanicStats.map(m => m.laborRevenue), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {mechanicStats.map(m => {
        const pct = Math.round((m.laborRevenue / maxRevenue) * 100)
        const effColor = m.efficiency === null ? '#64748b'
          : m.efficiency >= 100 ? '#10b981'
          : m.efficiency >= 85 ? '#f59e0b' : '#ef4444'
        return (
          <div key={m.mechanicId}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%', background: m.mechanicColor,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, color: 'white', flexShrink: 0,
                }}>
                  {m.mechanicAvatar}
                </div>
                <span style={{ color: '#cbd5e1', fontSize: 12, fontWeight: 600 }}>{m.mechanicName}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#94a3b8', fontSize: 11 }}>{m.billedHours.toFixed(1)}h</span>
                {m.efficiency !== null && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: effColor,
                    background: effColor + '22', padding: '1px 6px', borderRadius: 999,
                  }}>
                    {m.efficiency}%
                  </span>
                )}
                <span style={{ color: '#3b82f6', fontSize: 12, fontWeight: 700 }}>{m.laborRevenue} €</span>
              </div>
            </div>
            <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 999, width: `${pct}%`,
                background: `linear-gradient(90deg, ${m.mechanicColor}, ${m.mechanicColor}88)`,
                boxShadow: `0 0 8px ${m.mechanicColor}66`,
                transition: 'width 0.5s ease',
              }} />
            </div>
          </div>
        )
      })}
      {mechanicStats.length === 0 && (
        <p style={{ color: '#475569', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>Aucune donnée</p>
      )}
    </div>
  )
}
