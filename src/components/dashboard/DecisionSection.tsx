'use client'

/**
 * Decision-dashboard section — renders the /api/dashboard output (KPIs with
 * trend + status, a composite health score, and prioritised insights). Self-
 * fetching, styled to match the Dashboard overlay's dark aesthetic.
 */
import { useEffect, useState } from 'react'
import { useScheduleStore } from '@/store/schedule-store'

type KpiStatus = 'good' | 'warning' | 'critical' | 'neutral'
type Trend = 'up' | 'down' | 'flat'
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

interface Kpi {
  key: string; label: string; value: number; unit: string
  previous: number | null; deltaPct: number | null; trend: Trend
  direction: 'higher_better' | 'lower_better'; status: KpiStatus
}
interface Insight { id: string; severity: Severity; title: string; message: string; source: string }
interface DashboardData {
  kpis: Kpi[]; healthScore: number; healthLabel: string
  insights: Insight[]; period: { label: string }
  summary: { criticalKpis: number; warningKpis: number; criticalInsights: number }
}

const STATUS = {
  good: { fg: '#4ade80', bg: 'rgba(74,222,128,0.12)', icon: '✓', label: 'Bon' },
  warning: { fg: '#fbbf24', bg: 'rgba(251,191,36,0.12)', icon: '⚠', label: 'À surveiller' },
  critical: { fg: '#f87171', bg: 'rgba(248,113,113,0.12)', icon: '⛔', label: 'Critique' },
  neutral: { fg: '#94a3b8', bg: 'rgba(148,163,184,0.10)', icon: '·', label: '—' },
} as const
const SEV = {
  critical: { fg: '#f87171', bg: 'rgba(248,113,113,0.14)', label: 'Critique' },
  high: { fg: '#fbbf24', bg: 'rgba(251,191,36,0.14)', label: 'Élevé' },
  medium: { fg: '#60a5fa', bg: 'rgba(96,165,250,0.14)', label: 'Moyen' },
  low: { fg: '#94a3b8', bg: 'rgba(148,163,184,0.12)', label: 'Info' },
  info: { fg: '#60a5fa', bg: 'rgba(96,165,250,0.14)', label: 'Info' },
} as const

function healthColor(score: number): string {
  return score >= 60 ? '#4ade80' : score >= 40 ? '#fbbf24' : '#f87171'
}

function HealthGauge({ score, label, sub }: { score: number; label: string; sub: string }) {
  const r = 58, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(100, score)) / 100)
  const col = healthColor(score)
  return (
    <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <p style={{ color: '#475569', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Santé de l&apos;atelier</p>
      <svg width="150" height="150" viewBox="0 0 150 150">
        <circle cx="75" cy="75" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="12" />
        <circle cx="75" cy="75" r={r} fill="none" stroke={col} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 75 75)" />
        <text x="75" y="72" textAnchor="middle" fontSize="38" fontWeight="800" fill="#fff">{score}</text>
        <text x="75" y="93" textAnchor="middle" fontSize="11" fontWeight="600" fill="#475569">/ 100</text>
      </svg>
      <p style={{ color: col, fontSize: 15, fontWeight: 700, marginTop: 6 }}>{label}</p>
      <p style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>{sub}</p>
    </div>
  )
}

function KpiCard({ k }: { k: Kpi }) {
  const arrow = k.trend === 'up' ? '▲' : k.trend === 'down' ? '▼' : '▬'
  const goodChange = k.trend !== 'flat' && (k.direction === 'higher_better') === (k.trend === 'up')
  const tcol = k.trend === 'flat' ? '#475569' : goodChange ? '#4ade80' : '#f87171'
  const s = STATUS[k.status]
  return (
    <div style={{ ...cardStyle, padding: '15px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9, minHeight: 22 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#94a3b8' }}>{k.label}</span>
        {k.status !== 'neutral' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 7, color: s.fg, background: s.bg }}>
            {s.icon} {s.label}
          </span>
        )}
      </div>
      <div style={{ lineHeight: 1 }}>
        <span style={{ fontSize: 26, fontWeight: 750, letterSpacing: '-0.02em', color: '#fff' }}>{k.value.toLocaleString('fr-FR')}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#475569', marginLeft: 3 }}>{k.unit}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12.5, fontWeight: 700, color: tcol }}>
          {arrow} {k.deltaPct == null ? '—' : `${k.deltaPct > 0 ? '+' : ''}${k.deltaPct}%`}
        </span>
        <span style={{ fontSize: 11.5, color: '#475569' }}>vs période préc.</span>
      </div>
    </div>
  )
}

function InsightRow({ i }: { i: Insight }) {
  const sv = SEV[i.severity] ?? SEV.info
  return (
    <div style={{ ...cardStyle, display: 'flex', gap: 12, padding: '13px 15px', marginBottom: 9 }}>
      <div style={{ width: 4, borderRadius: 4, background: sv.fg, flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 3 }}>
          <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 6, textTransform: 'uppercase', letterSpacing: '0.03em', color: sv.fg, background: sv.bg }}>{sv.label}</span>
          <span style={{ fontSize: 14, fontWeight: 650, color: '#e8edf4' }}>{i.title}</span>
          <span style={{ marginLeft: 'auto', flex: 'none', paddingLeft: 10, fontSize: 10.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{i.source}</span>
        </div>
        <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.45 }}>{i.message}</div>
      </div>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 14,
}

export default function DecisionSection() {
  const { statsVersion } = useScheduleStore()
  const [data, setData] = useState<DashboardData | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ok'>('loading')

  useEffect(() => {
    let alive = true
    setState('loading')
    fetch('/api/dashboard')
      .then(async (r) => {
        const d = await r.json().catch(() => null)
        if (!alive) return
        if (!r.ok || !d) { setState('error'); return }
        setData(d); setState('ok')
      })
      .catch(() => { if (alive) setState('error') })
    return () => { alive = false }
  }, [statsVersion])

  if (state === 'loading') {
    return <Centered><div style={spinner} /><p style={{ color: '#475569', fontSize: 13, marginTop: 12 }}>Analyse en cours…</p></Centered>
  }
  if (state === 'error' || !data) {
    return <Centered><p style={{ color: '#ef4444', fontSize: 14 }}>Impossible de charger le tableau de bord décisionnel.</p></Centered>
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ color: '#fff', fontSize: 20, fontWeight: 700 }}>Tableau de bord décisionnel</h2>
          <p style={{ color: '#475569', fontSize: 12.5, marginTop: 2 }}>Chiffres calculés par le moteur déterministe — chaque action reste confirmée.</p>
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#93c5fd', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)', padding: '6px 12px', borderRadius: 999 }}>{data.period.label}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 14, marginBottom: 16 }}>
        <HealthGauge score={data.healthScore} label={data.healthLabel} sub={`${data.summary.criticalKpis} KPI critique · ${data.summary.warningKpis} à surveiller`} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {data.kpis.map((k) => <KpiCard key={k.key} k={k} />)}
        </div>
      </div>

      <h3 style={{ color: '#94a3b8', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '4px 0 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        Alertes priorisées
        {data.summary.criticalInsights > 0 && (
          <span style={{ fontSize: 11, background: 'rgba(248,113,113,0.14)', color: '#f87171', padding: '1px 7px', borderRadius: 999, fontWeight: 700 }}>{data.summary.criticalInsights} critique</span>
        )}
      </h3>
      {data.insights.length === 0
        ? <div style={{ ...cardStyle, padding: 20, textAlign: 'center', color: '#64748b', fontSize: 13 }}>Aucune alerte — tout est sous contrôle.</div>
        : data.insights.map((i) => <InsightRow key={i.id} i={i} />)}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column' }}>{children}</div>
}
const spinner: React.CSSProperties = {
  width: 40, height: 40, borderRadius: '50%',
  border: '3px solid rgba(59,130,246,0.3)', borderTopColor: '#3b82f6',
  animation: 'spin 1s linear infinite',
}
