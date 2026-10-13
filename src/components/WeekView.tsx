'use client'

import { useState, useMemo, useEffect } from 'react'
import { addDays, startOfWeek, format, isSameDay } from 'date-fns'
import { fr } from 'date-fns/locale'
import { useScheduleStore } from '@/store/schedule-store'
import { REPAIR_TYPES, Job } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export default function WeekView() {
  const { mechanics, openEditModal, setSelectedDate } = useScheduleStore()

  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  )

  // Jobs fetched for the current week, keyed by date string
  const [weekJobs, setWeekJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(false)

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  )

  // Fetch all 7 days in parallel whenever the week changes
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const fetches = days.map(day =>
      fetch(`/api/jobs?date=${format(day, 'yyyy-MM-dd')}&limit=100`)
        .then(r => (r.ok ? r.json() : { data: [] }))
        .then((res): Job[] => res?.data ?? res ?? [])
        .catch((): Job[] => [])
    )

    Promise.all(fetches).then(results => {
      if (cancelled) return
      setWeekJobs(results.flat())
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [weekStart]) // eslint-disable-line react-hooks/exhaustive-deps
  // Note: `days` is derived from `weekStart`; listing `days` would cause a loop

  return (
    <div className="flex-1 overflow-auto flex flex-col min-h-0">
      {/* ── Week navigation ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.07] flex-shrink-0">
        <button
          onClick={() => setWeekStart(d => addDays(d, -7))}
          className="p-1.5 rounded-lg hover:bg-white/[0.07] text-slate-400 hover:text-slate-200 transition-colors"
          title="Semaine précédente"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <span className="text-sm font-semibold text-white">
          {format(weekStart, 'd MMM', { locale: fr })}
          {' — '}
          {format(addDays(weekStart, 6), 'd MMM yyyy', { locale: fr })}
        </span>

        <button
          onClick={() => setWeekStart(d => addDays(d, 7))}
          className="p-1.5 rounded-lg hover:bg-white/[0.07] text-slate-400 hover:text-slate-200 transition-colors"
          title="Semaine suivante"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <button
          onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
          className="ml-1 text-xs px-2.5 py-1 rounded-md bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors border border-blue-500/20"
        >
          Aujourd&apos;hui
        </button>

        {loading && (
          <span className="text-xs text-slate-600 ml-1">Chargement…</span>
        )}
      </div>

      {/* ── 7-column grid ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-7 min-w-[700px] h-full">

          {/* Day header row */}
          {days.map(day => {
            const isToday = isSameDay(day, new Date())
            return (
              <div
                key={day.toISOString()}
                className={cn(
                  'px-2 py-2 text-center border-b border-r border-white/[0.07] last:border-r-0 sticky top-0 z-10 bg-[#111827]',
                  isToday && 'bg-blue-500/10'
                )}
              >
                <p className={cn(
                  'text-[10px] font-semibold uppercase tracking-wide',
                  isToday ? 'text-blue-400' : 'text-slate-500'
                )}>
                  {format(day, 'EEE', { locale: fr })}
                </p>
                <p className={cn(
                  'text-xl font-bold leading-tight',
                  isToday ? 'text-blue-300' : 'text-white'
                )}>
                  {format(day, 'd')}
                </p>
                <p className={cn(
                  'text-[9px]',
                  isToday ? 'text-blue-500' : 'text-slate-700'
                )}>
                  {format(day, 'MMM', { locale: fr })}
                </p>
              </div>
            )
          })}

          {/* Job cells — one cell per day */}
          {days.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd')
            const dayJobs = weekJobs
              .filter(j => j.date === dateStr && j.status !== 'cancelled')
              // Défensif : un `startTime` manquant ne doit pas faire tomber la
              // vue semaine (voir DashboardCharts — même classe de défaut).
              .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))
            const isToday = isSameDay(day, new Date())

            return (
              <div
                key={dateStr}
                className={cn(
                  'min-h-[120px] p-1 border-r border-white/[0.05] last:border-r-0 space-y-1',
                  'cursor-pointer hover:bg-white/[0.02] transition-colors',
                  isToday && 'bg-blue-500/[0.04]'
                )}
                onClick={() => setSelectedDate(dateStr)}
                title={`Aller au ${format(day, 'EEEE d MMM', { locale: fr })}`}
              >
                {dayJobs.map(job => {
                  const mech = mechanics.find(m => m.id === job.mechanicId)
                  const repairConf = REPAIR_TYPES[job.repairType as keyof typeof REPAIR_TYPES]
                  const mechColor = mech?.color ?? '#3b82f6'

                  return (
                    <div
                      key={job.id}
                      onClick={e => {
                        e.stopPropagation()
                        openEditModal(job.id)
                      }}
                      className="rounded px-1.5 py-1 text-[10px] font-medium cursor-pointer hover:opacity-80 transition-opacity leading-tight"
                      style={{
                        backgroundColor: mechColor + '33',
                        borderLeft: `2px solid ${mechColor}`,
                      }}
                      title={`${job.customerName} — ${job.vehicleModel}`}
                    >
                      <span className="text-slate-400">{job.startTime} </span>
                      <span className="text-white">
                        {repairConf?.icon}{' '}
                        {job.customerName.split(' ')[0]}
                      </span>
                    </div>
                  )
                })}

                {dayJobs.length === 0 && !loading && (
                  <p className="text-[10px] text-slate-800 text-center pt-3 select-none">
                    —
                  </p>
                )}
              </div>
            )
          })}

        </div>
      </div>
    </div>
  )
}
