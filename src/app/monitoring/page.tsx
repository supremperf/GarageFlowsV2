'use client'

/**
 * Phase 1 — Infrastructure monitoring dashboard. Polls the real
 * /api/admin/monitoring endpoint (owner/manager) and renders graded CPU / RAM /
 * disk / database status. Dark aesthetic, responsive, auto-refresh.
 */

import { useEffect, useState, useCallback, type ReactNode } from 'react'
import { Cpu, MemoryStick, HardDrive, Database, Activity, RefreshCw, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Status = 'ok' | 'warning' | 'critical'

interface MonitoringData {
  overall: Status
  statuses: Record<string, Status>
  system: {
    platform: string
    uptimeSec: number
    cpu: { cores: number; loadPct: number; loadAvg: number[] }
    memory: { totalMB: number; usedMB: number; usedPct: number }
    disk: { totalMB: number; usedMB: number; usedPct: number } | null
  }
  process: { uptimeSec: number; rssMB: number; heapUsedMB: number; nodeVersion: string }
  database: { latencyMs: number | null; error: string | null }
  ts: string
}

const STATUS_COLOR: Record<Status, string> = {
  ok: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/[0.06]',
  warning: 'text-amber-400 border-amber-500/30 bg-amber-500/[0.06]',
  critical: 'text-red-400 border-red-500/30 bg-red-500/[0.06]',
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return d > 0 ? `${d}j ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

export default function MonitoringPage() {
  const [data, setData] = useState<MonitoringData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/monitoring', { cache: 'no-store' })
      if (res.status === 403) { setError('Accès réservé au propriétaire / responsable.'); return }
      if (!res.ok) throw new Error()
      setData((await res.json()) as MonitoringData)
      setError('')
    } catch {
      setError('Impossible de charger les métriques.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [load])

  return (
    <div className="min-h-screen bg-[#0a0f1e] px-4 py-8 text-slate-200 md:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-2xl font-black text-white"><Activity className="h-6 w-6 text-blue-400" /> Supervision</h1>
          <button onClick={load} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/[0.08]">
            <RefreshCw className="h-3.5 w-3.5" /> Rafraîchir
          </button>
        </div>

        {loading && !data && <div className="mt-16 flex justify-center text-slate-600"><Loader2 className="h-8 w-8 animate-spin" /></div>}
        {error && <div className="mt-6 rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-400">{error}</div>}

        {data && (
          <div className="mt-6 space-y-6">
            <div className={cn('flex items-center justify-between rounded-2xl border p-5', STATUS_COLOR[data.overall])}>
              <div>
                <div className="text-xs uppercase tracking-widest opacity-70">État global</div>
                <div className="text-2xl font-black capitalize">{data.overall}</div>
              </div>
              <div className="text-right text-xs text-slate-500">
                <div>{data.system.platform}</div>
                <div>Uptime hôte {fmtUptime(data.system.uptimeSec)}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <MetricCard icon={<Cpu className="h-5 w-5" />} title="CPU" status={data.statuses.cpu}
                value={`${data.system.cpu.loadPct}%`} sub={`${data.system.cpu.cores} cœurs · charge ${data.system.cpu.loadAvg.join(' / ')}`} />
              <MetricCard icon={<MemoryStick className="h-5 w-5" />} title="Mémoire" status={data.statuses.memory}
                value={`${data.system.memory.usedPct}%`} sub={`${data.system.memory.usedMB} / ${data.system.memory.totalMB} Mo`} />
              {data.system.disk && (
                <MetricCard icon={<HardDrive className="h-5 w-5" />} title="Disque" status={data.statuses.disk ?? 'ok'}
                  value={`${data.system.disk.usedPct}%`} sub={`${data.system.disk.usedMB} / ${data.system.disk.totalMB} Mo`} />
              )}
              <MetricCard icon={<Database className="h-5 w-5" />} title="Base de données" status={data.statuses.database}
                value={data.database.latencyMs != null ? `${data.database.latencyMs} ms` : 'HS'} sub={data.database.error ?? 'connectée'} />
            </div>

            <div className="rounded-2xl border border-white/[0.08] bg-[#111827]/95 p-5 text-xs text-slate-500">
              Process Node {data.process.nodeVersion} · RSS {data.process.rssMB} Mo · heap {data.process.heapUsedMB} Mo · uptime {fmtUptime(data.process.uptimeSec)}
              <span className="ml-2 opacity-60">— maj {new Date(data.ts).toLocaleTimeString('fr-FR')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MetricCard({ icon, title, status, value, sub }: { icon: ReactNode; title: string; status: Status; value: string; sub: string }) {
  return (
    <div className={cn('rounded-2xl border p-5', STATUS_COLOR[status])}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">{icon} {title}</div>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase">{status}</span>
      </div>
      <div className="mt-3 text-3xl font-black text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </div>
  )
}
