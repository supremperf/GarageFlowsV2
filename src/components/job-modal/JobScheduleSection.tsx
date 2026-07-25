'use client'

import { Clock, CalendarDays, Wand2, Zap } from 'lucide-react'
import { formatDuration, getTodayString, getStatusColor, getStatusLabel, cn } from '@/lib/utils'
import { Job } from '@/lib/types'
import { DateField } from '@/components/DateField'
import { useTranslation } from '@/lib/i18n'
import { jobStatusLabel } from '@/lib/i18n/labels'

type JobStatus = Job['status']
const STATUS_OPTIONS: JobStatus[] = ['scheduled', 'in_progress', 'completed', 'delayed', 'cancelled']

interface Props {
  estimatedDuration: number
  date: string
  startTime: string
  status: JobStatus
  isUrgent: boolean
  notes: string
  durationOverridden: boolean
  isEditMode: boolean
  onDurationChange: (v: number) => void
  onDateChange: (v: string) => void
  onTimeChange: (v: string) => void
  onStatusChange: (v: JobStatus) => void
  onUrgentChange: (v: boolean) => void
  onNotesChange: (v: string) => void
  onAutoSlot: () => void
  onResetDuration: () => void
}

export function JobScheduleSection({
  estimatedDuration, date, startTime, status, isUrgent, notes,
  durationOverridden, isEditMode,
  onDurationChange, onDateChange, onTimeChange, onStatusChange,
  onUrgentChange, onNotesChange, onAutoSlot, onResetDuration,
}: Props) {
  const { t } = useTranslation()
  return (
    <>
      {/* Duration */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm font-medium text-slate-300">
            <Clock className="w-3.5 h-3.5 inline mr-1" />
            {t.jmDuration} *
          </label>
          {durationOverridden && !isEditMode && (
            <button onClick={onResetDuration} className="text-xs text-blue-600 hover:underline">
              ↩ {t.jmReuseAI}
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={10}
            max={480}
            step={5}
            value={estimatedDuration}
            onChange={e => onDurationChange(Number(e.target.value))}
            className="flex-1 accent-blue-500"
          />
          <span className="text-sm font-bold text-blue-600 w-16 text-right">
            {formatDuration(estimatedDuration)}
          </span>
        </div>
      </div>

      {/* Date + Time */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            <CalendarDays className="w-3.5 h-3.5 inline mr-1" />
            {t.jmDate} *
          </label>
          <DateField
            value={date || getTodayString()}
            onChange={onDateChange}
            wrapperClassName="w-full"
            className="w-full rounded-lg border border-white/15 bg-white/[0.05] text-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            <Clock className="w-3.5 h-3.5 inline mr-1" />
            {t.jmStartTime} *
          </label>
          <input
            type="time"
            value={startTime || '08:00'}
            step={900}
            onChange={e => onTimeChange(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-white/[0.05] text-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
          />
        </div>
      </div>

      {/* Auto-slot */}
      <button
        onClick={onAutoSlot}
        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border-2 border-dashed border-blue-500/40 text-blue-400 hover:bg-blue-500/10 transition-colors text-sm font-medium"
      >
        <Wand2 className="w-4 h-4" />
        {t.jmFindBestSlot}
      </button>

      {/* Status (edit only) */}
      {isEditMode && (
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">{t.jmStatus}</label>
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map(s => (
              <button
                key={s}
                onClick={() => onStatusChange(s)}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-medium border transition-all',
                  status === s ? 'border-transparent text-white' : 'border-white/15 text-slate-400'
                )}
                style={status === s ? { backgroundColor: getStatusColor(s) } : {}}
              >
                {jobStatusLabel(t, s, getStatusLabel(s))}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Urgent toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <div className="relative">
          <input
            type="checkbox"
            className="sr-only"
            checked={isUrgent}
            onChange={e => onUrgentChange(e.target.checked)}
          />
          <div className={cn('w-10 h-6 rounded-full transition-colors', isUrgent ? 'bg-orange-500' : 'bg-white/15')} />
          <div className={cn('absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform', isUrgent && 'translate-x-4')} />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-300 flex items-center gap-1">
            <Zap className="w-3.5 h-3.5 text-orange-400" />
            {t.jmUrgent}
          </p>
          <p className="text-xs text-slate-500">{t.jmUrgentHint}</p>
        </div>
      </label>

      {/* Notes */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">{t.jmNotesOptional}</label>
        <textarea
          value={notes}
          onChange={e => onNotesChange(e.target.value)}
          placeholder={t.jmNotesPh}
          rows={2}
          className="w-full rounded-lg border border-white/15 bg-white/[0.05] text-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none placeholder-slate-500"
        />
      </div>
    </>
  )
}
