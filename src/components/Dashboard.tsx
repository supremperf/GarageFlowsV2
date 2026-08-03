'use client'

import { useState, useEffect } from 'react'
import { useScheduleStore } from '@/store/schedule-store'
import { useSession } from 'next-auth/react'
import { useTranslation } from '@/lib/i18n'
import { X, BarChart3, Euro, Package, Users, Wrench, ChevronRight, Gauge } from 'lucide-react'
import { StatsData } from './dashboard/DashboardCharts'
import {
  OverviewSection,
  RevenueSection,
  MechanicsSection,
  StockSection,
} from './dashboard/DashboardSections'
import DecisionSection from './dashboard/DecisionSection'

type Section = 'overview' | 'revenue' | 'mechanics' | 'stock' | 'decision'

export default function Dashboard() {
  const { toggleDashboard, statsVersion } = useScheduleStore()
  const { data: session } = useSession()
  const { t, lang } = useTranslation()

  const NAV = [
    { id: 'overview' as const, label: t.overview,     icon: <BarChart3 size={16} /> },
    { id: 'revenue'  as const, label: t.revenueSec,   icon: <Euro size={16} /> },
    { id: 'mechanics'as const, label: t.mechanics,    icon: <Users size={16} /> },
    { id: 'stock'    as const, label: t.stock,        icon: <Package size={16} /> },
    { id: 'decision' as const, label: t.navDecision, icon: <Gauge size={16} /> },
  ]

  const [section, setSection] = useState<Section>('overview')
  const [period, setPeriod] = useState(30)
  const [stats, setStats] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [statsError, setStatsError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setStats(null)
    setStatsError(false)
    fetch(`/api/stats?period=${period}`)
      .then(async r => {
        const data = await r.json().catch(() => null)
        if (!r.ok || !data) { setStatsError(true); return }
        if (data.error) console.warn('[Dashboard] stats warning:', data.error)
        setStats(data)
      })
      .catch(() => setStatsError(true))
      .finally(() => setLoading(false))
  }, [period, statsVersion])

  const garageName = session?.user?.garageName ?? 'Garage'
  const today = new Date().toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex', flexDirection: 'column',
      background: '#070d1b',
      fontFamily: 'inherit',
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {/* Decorative background glows */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '-10%', left: '15%', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(59,130,246,0.07) 0%, transparent 65%)' }} />
        <div style={{ position: 'absolute', bottom: '-10%', right: '5%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(139,92,246,0.06) 0%, transparent 65%)' }} />
        <div style={{ position: 'absolute', top: '40%', right: '30%', width: 300, height: 300, borderRadius: '50%', background: 'radial-gradient(circle, rgba(34,211,238,0.04) 0%, transparent 65%)' }} />
      </div>

      {/* Top Header */}
      <div style={{
        position: 'relative', zIndex: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 24px',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        background: 'rgba(255,255,255,0.02)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Wrench size={16} style={{ color: 'white' }} />
          </div>
          <div>
            <p style={{ color: 'white', fontSize: 14, fontWeight: 700, lineHeight: 1 }}>GarageFlow</p>
            <p style={{ color: '#475569', fontSize: 11 }}>{t.dashboard}</p>
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'white', fontSize: 16, fontWeight: 600 }}>
            {t.welcome}, {garageName}
          </p>
          <p style={{ color: '#475569', fontSize: 12 }}>{today}</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            display: 'flex', gap: 2, background: 'rgba(255,255,255,0.06)',
            borderRadius: 10, padding: 3,
          }}>
            {[7, 30, 90].map(p => (
              <button key={p} onClick={() => setPeriod(p)} style={{
                padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 600, transition: 'all 0.2s',
                background: period === p ? 'rgba(59,130,246,0.35)' : 'transparent',
                color: period === p ? '#93c5fd' : '#64748b',
              }}>
                {p}j
              </button>
            ))}
          </div>
          <button onClick={toggleDashboard} style={{
            width: 34, height: 34, borderRadius: 9, border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.05)', cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center', color: '#94a3b8',
            transition: 'all 0.2s',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; e.currentTarget.style.color = '#f87171' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#94a3b8' }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Body: Sidebar + Content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative', zIndex: 1 }}>
        {/* Sidebar */}
        <div style={{
          width: 210, flexShrink: 0,
          background: 'rgba(255,255,255,0.02)',
          borderRight: '1px solid rgba(255,255,255,0.07)',
          padding: '20px 12px',
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          {NAV.map(item => {
            const active = section === item.id
            return (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '11px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  textAlign: 'left', width: '100%', transition: 'all 0.2s',
                  background: active ? 'rgba(59,130,246,0.18)' : 'transparent',
                  color: active ? '#93c5fd' : '#64748b',
                  fontWeight: active ? 600 : 400, fontSize: 14,
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#94a3b8' }}
                onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#64748b' } }}
              >
                {item.icon}
                {item.label}
                {active && <ChevronRight size={12} style={{ marginLeft: 'auto' }} />}
              </button>
            )
          })}

          {stats && (
            <div style={{ marginTop: 'auto', paddingTop: 20 }}>
              <div style={{
                background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
                borderRadius: 12, padding: '14px 16px',
              }}>
                <p style={{ color: '#60a5fa', fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
                  {t.summary} {period}j
                </p>
                {[
                  { label: 'CA', value: `${(stats.totals.totalRevenue / 1000).toFixed(1)}k €` },
                  { label: t.interventions, value: stats.totals.jobCount },
                  { label: t.occupancy, value: `${Math.round(stats.totals.utilizationRate)}%` },
                ].map(s => (
                  <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ color: '#475569', fontSize: 11 }}>{s.label}</span>
                    <span style={{ color: '#93c5fd', fontSize: 11, fontWeight: 700 }}>{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Main content */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading && section !== 'stock' && section !== 'decision' ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  border: '3px solid rgba(59,130,246,0.3)',
                  borderTopColor: '#3b82f6',
                  animation: 'spin 1s linear infinite',
                  margin: '0 auto 12px',
                }} />
                <p style={{ color: '#475569', fontSize: 13 }}>Chargement des données…</p>
              </div>
            </div>
          ) : statsError && section !== 'stock' && section !== 'decision' ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <div style={{ textAlign: 'center' }}>
                <p style={{ color: '#ef4444', fontSize: 14, marginBottom: 12 }}>Impossible de charger les statistiques.</p>
                <button
                  onClick={() => { setStatsError(false); setLoading(true); fetch(`/api/stats?period=${period}`).then(r => r.ok ? r.json() : Promise.reject()).then(d => setStats(d)).catch(() => setStatsError(true)).finally(() => setLoading(false)) }}
                  style={{ padding: '8px 18px', borderRadius: 8, background: '#3b82f6', color: 'white', border: 'none', cursor: 'pointer', fontSize: 13 }}
                >
                  Réessayer
                </button>
              </div>
            </div>
          ) : (
            <>
              {section === 'overview' && <OverviewSection stats={stats} period={period} />}
              {section === 'revenue' && <RevenueSection stats={stats} />}
              {section === 'mechanics' && <MechanicsSection stats={stats} />}
              {section === 'stock' && <StockSection stats={stats} />}
              {section === 'decision' && <DecisionSection />}
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
