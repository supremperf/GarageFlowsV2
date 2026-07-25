'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, RefreshCw, Clock, CheckCircle2, AlertTriangle, Timer, Play, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

interface Job {
  id: string
  customerName: string
  vehicleModel: string
  licensePlate?: string
  repairType: string
  estimatedDuration: number
  actualDuration?: number
  startTime: string
  date: string
  status: string
  isUrgent: boolean
  timerStartedAt?: string | null
  mechanic?: { name: string; color: string; avatar: string }
}

interface Props {
  onClose: () => void
}

const STATUS_CONFIG = {
  scheduled:  { label: 'En attente',   color: '#3b82f6', bg: '#eff6ff', icon: Clock },
  in_progress:{ label: 'En cours',     color: '#f59e0b', bg: '#fffbeb', icon: Timer },
  completed:  { label: 'Terminés',     color: '#10b981', bg: '#ecfdf5', icon: CheckCircle2 },
  delayed:    { label: 'En retard',    color: '#ef4444', bg: '#fef2f2', icon: AlertTriangle },
  cancelled:  { label: 'Annulés',      color: '#6b7280', bg: '#f9fafb', icon: X },
}

const REPAIR_ICONS: Record<string, string> = {
  oil_change: '🛢️', brake_repair: '🔧', tire_change: '🔄', diagnostics: '🔬',
  engine_repair: '⚙️', suspension: '🔩', electrical: '⚡', bodywork: '🚗',
  transmission: '🔄', ac_repair: '❄️', exhaust: '💨', inspection: '📋',
  windshield: '🪟', battery: '🔋',
}

function elapsed(timerStartedAt: string) {
  const mins = Math.round((Date.now() - new Date(timerStartedAt).getTime()) / 60000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`
}

function JobStatusCard({ job, onTimerToggle }: { job: Job; onTimerToggle: (id: string, running: boolean) => void }) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!job.timerStartedAt) return
    const id = setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(id)
  }, [job.timerStartedAt])

  const running = !!job.timerStartedAt
  const cfg = STATUS_CONFIG[job.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.scheduled

  return (
    <div
      className="rounded-xl border p-3"
      style={{
        background: 'var(--card-bg, #111827)',
        borderColor: 'var(--border-color, rgba(255,255,255,0.08))',
        borderLeftColor: cfg.color, borderLeftWidth: '3px',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-sm">{REPAIR_ICONS[job.repairType] ?? '🔧'}</span>
            <span className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary, #f1f5f9)' }}>{job.customerName}</span>
            {job.isUrgent && (
              <span className="text-[9px] bg-orange-500/20 text-orange-400 font-bold px-1 rounded border border-orange-500/30">URGENT</span>
            )}
          </div>
          <p className="text-xs truncate" style={{ color: 'var(--text-secondary, #94a3b8)' }}>{job.vehicleModel}
            {job.licensePlate && <span className="ml-1 font-mono text-blue-400">{job.licensePlate}</span>}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>{job.startTime}</span>
            <span className="text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>·</span>
            <span className="text-xs" style={{ color: 'var(--text-secondary, #94a3b8)' }}>{Math.round(job.estimatedDuration / 60 * 10) / 10}h estimée</span>
            {running && (
              <span className="text-xs font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded animate-pulse border border-amber-500/20">
                ⏱ {elapsed(job.timerStartedAt!)}
              </span>
            )}
          </div>
          {job.mechanic && (
            <div className="flex items-center gap-1 mt-1.5">
              <div className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0"
                style={{ backgroundColor: job.mechanic.color }}>
                {job.mechanic.avatar}
              </div>
              <span className="text-xs" style={{ color: 'var(--text-secondary, #94a3b8)' }}>{job.mechanic.name}</span>
            </div>
          )}
        </div>
        {job.status !== 'completed' && job.status !== 'cancelled' && (
          <button
            onClick={() => onTimerToggle(job.id, running)}
            className={cn('flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
              running ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25' : 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25'
            )}
            title={running ? 'Arrêter' : 'Démarrer le chronomètre'}
          >
            {running ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>
        )}
        {job.status === 'completed' && (
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
        )}
      </div>
    </div>
  )
}

export default function ReceptionBoard({ onClose }: Props) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const today = format(new Date(), 'yyyy-MM-dd')

  const fetchJobs = useCallback(async () => {
    try {
      const [jobsRes, mechanicsRes] = await Promise.all([
        fetch(`/api/jobs?date=${today}`),
        fetch('/api/mechanics'),
      ])
      const jobsRaw = jobsRes.ok ? await jobsRes.json() : []
      const jobsData = jobsRaw?.data ?? jobsRaw ?? []
      const mechanicsData = mechanicsRes.ok ? await mechanicsRes.json() : []
      const mechMap = Object.fromEntries(mechanicsData.map((m: { id: string }) => [m.id, m]))
      setJobs(jobsData.map((j: Job & { mechanicId: string }) => ({ ...j, mechanic: mechMap[j.mechanicId] })))
    } finally {
      setLoading(false)
    }
  }, [today])

  useEffect(() => {
    fetchJobs()
    const interval = setInterval(fetchJobs, 30000) // refresh every 30s
    return () => clearInterval(interval)
  }, [fetchJobs])

  async function handleTimerToggle(jobId: string, running: boolean) {
    const res = await fetch(`/api/jobs/${jobId}/timer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: running ? 'stop' : 'start' }),
    })
    if (res.ok) fetchJobs()
  }

  const grouped = {
    in_progress: jobs.filter(j => j.status === 'in_progress'),
    delayed: jobs.filter(j => j.status === 'delayed'),
    scheduled: jobs.filter(j => j.status === 'scheduled'),
    completed: jobs.filter(j => j.status === 'completed'),
  }

  const totalJobs = jobs.filter(j => j.status !== 'cancelled').length
  const doneCount = grouped.completed.length
  const progressPct = totalJobs > 0 ? Math.round((doneCount / totalJobs) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'var(--app-bg, #0b1120)', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div className="px-6 py-4 flex items-center justify-between shadow-sm border-b" style={{ background: 'var(--card-bg, #111827)', borderColor: 'var(--border-color, rgba(255,255,255,0.08))' }}>
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary, #f1f5f9)' }}>
            📋 Tableau de réception
          </h1>
          <span className="text-sm" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
            {format(new Date(), 'EEEE d MMMM', { locale: fr })}
          </span>
          {/* Progress bar */}
          <div className="flex items-center gap-2">
            <div className="w-32 h-2 rounded-full overflow-hidden" style={{ background: 'var(--border-color, rgba(255,255,255,0.1))' }}>
              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
            </div>
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary, #f1f5f9)' }}>{doneCount}/{totalJobs}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchJobs} className="p-2 rounded-lg transition-colors" style={{ color: 'var(--text-secondary, #94a3b8)' }} title="Actualiser">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={onClose} className="gf-close p-2 rounded-lg" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* KPI pills */}
      <div className="px-6 py-3 flex items-center gap-3 flex-wrap border-b" style={{ borderColor: 'var(--border-color, rgba(255,255,255,0.07))' }}>
        {Object.entries(grouped).map(([status, statusJobs]) => {
          const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]
          if (!cfg) return null
          const Icon = cfg.icon
          return (
            <div key={status}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium"
              style={{ backgroundColor: cfg.color + '22', color: cfg.color, border: `1px solid ${cfg.color}44` }}
            >
              <Icon className="w-4 h-4" />
              {statusJobs.length} {cfg.label}
            </div>
          )
        })}
      </div>

      {/* Board */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-secondary, #94a3b8)' }}>Chargement…</div>
      ) : (
        <div className="flex-1 grid grid-cols-4 gap-0 overflow-hidden min-h-0">
          {(['in_progress', 'delayed', 'scheduled', 'completed'] as const).map(status => {
            const cfg = STATUS_CONFIG[status]
            const statusJobs = grouped[status]
            const Icon = cfg.icon
            return (
              <div key={status} className="flex flex-col overflow-hidden border-r last:border-r-0" style={{ borderColor: 'var(--border-color, rgba(255,255,255,0.07))' }}>
                {/* Column header */}
                <div className="px-4 py-3 flex items-center gap-2 font-semibold text-sm flex-shrink-0"
                  style={{ backgroundColor: cfg.color + '18', color: cfg.color, borderBottom: `2px solid ${cfg.color}` }}>
                  <Icon className="w-4 h-4" />
                  {cfg.label}
                  <span className="ml-auto w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                    style={{ backgroundColor: cfg.color }}>
                    {statusJobs.length}
                  </span>
                </div>
                {/* Jobs list */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {statusJobs.length === 0 ? (
                    <div className="text-center text-xs mt-8" style={{ color: 'var(--text-muted, #475569)' }}>Aucun job</div>
                  ) : (
                    statusJobs.map(job => (
                      <JobStatusCard key={job.id} job={job} onTimerToggle={handleTimerToggle} />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
