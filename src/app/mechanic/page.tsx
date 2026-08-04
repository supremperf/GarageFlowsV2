'use client'

/**
 * Espace MÉCANICIEN — planning personnel.
 *
 * Le mécanicien voit UNIQUEMENT ses interventions attribuées (l'API filtre côté
 * serveur sur garageId + mechanicId de la session signée ; aucun paramètre
 * client ne peut élargir le périmètre). Responsive mobile portrait/paysage,
 * tablette et desktop.
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Loader2, LogOut, ChevronLeft, ChevronRight, Clock, AlertTriangle, Wrench, Car, User,
} from 'lucide-react'
import { mechFetch, mechanicLogout } from '@/lib/mechanic-client'

interface Job {
  id: string
  date: string
  startTime: string
  estimatedDuration: number
  actualDuration: number | null
  status: string
  repairType: string
  isUrgent: boolean
  vehicleModel: string
  licensePlate: string | null
  customerName: string
  notes: string | null
  timerStartedAt: string | null
  delayMinutes: number | null
}

interface Me {
  mechanic: { id: string; name: string; avatar: string; color: string } | null
  garage: { name: string } | null
  license: { expiryAt: string } | null
}

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Prévu',
  in_progress: 'En cours',
  completed: 'Terminé',
  cancelled: 'Annulé',
}
const STATUS_STYLE: Record<string, string> = {
  scheduled: 'bg-slate-500/15 text-slate-300',
  in_progress: 'bg-blue-500/15 text-blue-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  cancelled: 'bg-red-500/15 text-red-300',
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

export default function MechanicPlanningPage() {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [date, setDate] = useState(todayIso())
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    mechFetch<Me>('/api/mechanic/me').then(setMe).catch(() => {})
  }, [])

  const load = useCallback((d: string) => {
    setLoading(true)
    setError('')
    mechFetch<{ data: Job[] }>(`/api/mechanic/schedule?date=${encodeURIComponent(d)}`)
      .then((r) => setJobs(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load(date) }, [date, load])

  return (
    <div className="mx-auto max-w-2xl px-4 pt-safe pb-safe-3">
      {/* En-tête */}
      <header className="flex items-center justify-between py-4 sticky top-0 bg-[#0a0f1e]/95 backdrop-blur z-10">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white shrink-0"
            style={{ backgroundColor: me?.mechanic?.color ?? '#3b82f6' }}
          >
            {me?.mechanic?.avatar ?? '🔧'}
          </div>
          <div className="min-w-0">
            <p className="font-bold text-white truncate">{me?.mechanic?.name ?? 'Mécanicien'}</p>
            <p className="text-xs text-slate-500 truncate">{me?.garage?.name ?? ''}</p>
          </div>
        </div>
        <button
          onClick={() => mechanicLogout()}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-red-400 px-3 py-2 rounded-lg hover:bg-white/5 transition"
        >
          <LogOut className="w-4 h-4" /> Quitter
        </button>
      </header>

      {/* Navigation date */}
      <div className="flex items-center justify-between gap-2 mb-4 bg-[#111827] rounded-xl p-2 border border-white/[0.06]">
        <button onClick={() => setDate(shiftDate(date, -1))} className="p-2 rounded-lg hover:bg-white/5 text-slate-300" aria-label="Jour précédent">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold text-white capitalize">{prettyDate(date)}</p>
          {date !== todayIso() && (
            <button onClick={() => setDate(todayIso())} className="text-[11px] text-blue-400 hover:text-blue-300">Aujourd&apos;hui</button>
          )}
        </div>
        <button onClick={() => setDate(shiftDate(date, 1))} className="p-2 rounded-lg hover:bg-white/5 text-slate-300" aria-label="Jour suivant">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Liste */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>
      ) : error ? (
        <div className="text-center py-16 text-red-400 text-sm">{error}</div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-16 text-slate-500 text-sm">
          <Wrench className="w-8 h-8 mx-auto mb-3 opacity-40" />
          Aucune intervention prévue ce jour.
        </div>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li key={job.id}>
              <button
                onClick={() => router.push(`/mechanic/jobs/${job.id}`)}
                className="w-full text-left bg-[#111827] hover:bg-[#161f33] border border-white/[0.06] rounded-xl p-4 transition active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 text-white font-semibold">
                    <Clock className="w-4 h-4 text-blue-400" />
                    {job.startTime}
                    <span className="text-slate-500 font-normal text-sm">· {job.estimatedDuration} min</span>
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[job.status] ?? 'bg-slate-500/15 text-slate-300'}`}>
                    {STATUS_LABEL[job.status] ?? job.status}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm text-slate-200">
                  <Wrench className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="font-medium">{job.repairType}</span>
                  {job.isUrgent && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                      <AlertTriangle className="w-3 h-3" /> Urgent
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                  <span className="inline-flex items-center gap-1"><Car className="w-3.5 h-3.5" />{job.vehicleModel}{job.licensePlate ? ` · ${job.licensePlate}` : ''}</span>
                  <span className="inline-flex items-center gap-1"><User className="w-3.5 h-3.5" />{job.customerName}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
