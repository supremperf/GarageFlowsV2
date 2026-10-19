'use client'

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Job, REPAIR_TYPES, repairConfig as repairConfigFor } from '@/lib/types'
import { cn, formatDuration, getStatusColor, getStatusLabel, getJobEndTime } from '@/lib/utils'
import { AlertTriangle, Clock, Zap, GripHorizontal, Play, Square } from 'lucide-react'
import { useScheduleStore } from '@/store/schedule-store'
import { useState, useEffect } from 'react'

interface JobCardProps {
  job: Job
  heightPx: number
  style?: React.CSSProperties
  hasConflict?: boolean
  onResizeStart?: (jobId: string, startY: number, startDuration: number) => void
  onOpenVehicle?: (licensePlate: string) => void
}

export default function JobCard({
  job,
  heightPx,
  style,
  hasConflict = false,
  onResizeStart,
  onOpenVehicle,
}: JobCardProps) {
  const openEditModal = useScheduleStore(s => s.openEditModal)
  const updateJob = useScheduleStore(s => s.updateJob)
  const [timerRunning, setTimerRunning] = useState(!!job.timerStartedAt)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    setTimerRunning(!!job.timerStartedAt)
  }, [job.timerStartedAt])

  useEffect(() => {
    if (!timerRunning || !job.timerStartedAt) { setElapsed(0); return }
    const update = () => setElapsed(Math.round((Date.now() - new Date(job.timerStartedAt!).getTime()) / 60000))
    update()
    const id = setInterval(update, 15000)
    return () => clearInterval(id)
  }, [timerRunning, job.timerStartedAt])

  async function handleTimer(e: React.MouseEvent) {
    e.stopPropagation()
    const action = timerRunning ? 'stop' : 'start'
    try {
      const res = await fetch(`/api/jobs/${job.id}/timer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (res.ok) {
        const updated = await res.json()
        updateJob(job.id, { status: updated.status, timerStartedAt: updated.timerStartedAt, actualDuration: updated.actualDuration })
        setTimerRunning(action === 'start')
      }
    } catch {}
  }

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: job.id,
    data: { job },
    disabled: job.status === 'completed' || job.status === 'cancelled',
  })

  // Type inconnu toléré (voir repairConfig dans lib/types) — jamais de crash.
  const repairConfig = repairConfigFor(job.repairType)
  const isSmall = heightPx < 50
  const isTiny = heightPx < 35
  const canResize = job.status !== 'completed' && job.status !== 'cancelled'

  // Delay overrun: timer running and elapsed > estimatedDuration
  const isOverrun = timerRunning && elapsed > 0 && elapsed > job.estimatedDuration

  const cardStyle: React.CSSProperties = {
    ...style,
    height: `${heightPx}px`,
    transform: CSS.Translate.toString(transform),
    backgroundColor: repairConfig.color + '2b',
    borderColor: repairConfig.color + '55',
    borderLeftColor: hasConflict ? '#ef4444' : repairConfig.color,
    borderLeftWidth: hasConflict ? '4px' : '3px',
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 999 : 1,
  }

  return (
    <div
      style={cardStyle}
      className={cn(
        'absolute left-0.5 right-0.5 rounded border select-none overflow-hidden group',
        'transition-shadow hover:shadow-lg hover:z-10',
        isDragging && 'shadow-2xl ring-2 ring-blue-400',
        job.status === 'completed' && 'opacity-60',
        job.status === 'cancelled' && 'opacity-30',
        hasConflict && 'ring-1 ring-red-300',
        isOverrun && 'ring-2 ring-red-500 animate-pulse',
      )}
    >
      {/* Drag handle area (whole card except resize grip) */}
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        onClick={(e) => {
          e.stopPropagation()
          if (!isDragging) openEditModal(job.id)
        }}
        className={cn(
          'absolute inset-0 cursor-grab active:cursor-grabbing',
          canResize && 'bottom-2', // leave space for resize handle
        )}
        style={{ bottom: canResize ? '8px' : '0' }}
      />

      {/* Status strip */}
      <div
        className="absolute top-0 right-0 w-1.5 h-full rounded-r"
        style={{ backgroundColor: getStatusColor(job.status) }}
      />

      {/* Timer button — visible on hover or when running */}
      {!isTiny && job.status !== 'completed' && job.status !== 'cancelled' && (
        <button
          onClick={handleTimer}
          title={timerRunning ? 'Arrêter le chronomètre' : 'Démarrer le chronomètre'}
          className={cn(
            'absolute top-0.5 right-2.5 z-20 rounded flex items-center gap-0.5 px-1 py-0.5 transition-all',
            timerRunning
              ? 'bg-red-500 text-white opacity-100'
              : 'bg-black/50 text-white opacity-0 group-hover:opacity-100'
          )}
          style={{ fontSize: '7px' }}
        >
          {timerRunning ? <Square className="w-2 h-2" /> : <Play className="w-2 h-2" />}
          {timerRunning && elapsed > 0 && <span>{elapsed}m</span>}
        </button>
      )}

      {/* Conflict indicator */}
      {hasConflict && (
        <div className="absolute top-0.5 right-2 z-10">
          <AlertTriangle className="w-2.5 h-2.5 text-red-500" />
        </div>
      )}

      {/* Overrun indicator */}
      {isOverrun && !hasConflict && (
        <div className="absolute top-0.5 right-2 z-10" title={`Dépassement : ${elapsed - job.estimatedDuration} min`}>
          <AlertTriangle className="w-2.5 h-2.5 text-red-500" />
        </div>
      )}

      {/* Content */}
      <div className="px-1.5 pt-1 pb-2.5 h-full flex flex-col justify-start overflow-hidden pointer-events-none">
        {!isTiny && (
          <div className="flex items-start gap-1">
            <span className="text-[9px] leading-tight flex-shrink-0">{repairConfig.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-0.5 flex-wrap">
                {job.isUrgent && <Zap className="w-2.5 h-2.5 text-orange-500 flex-shrink-0" />}
                {job.status === 'delayed' && <AlertTriangle className="w-2.5 h-2.5 text-amber-500 flex-shrink-0" />}
                <span
                  className="font-semibold truncate text-white"
                  style={{ fontSize: isSmall ? '9px' : '10px', lineHeight: '1.2' }}
                >
                  {job.customerName}
                </span>
              </div>
              {!isSmall && (
                <p className="text-slate-300 truncate" style={{ fontSize: '9px', lineHeight: '1.2' }}>
                  {job.vehicleModel}
                  {job.licensePlate && (
                    <span className="ml-1 font-mono text-blue-300">{job.licensePlate}</span>
                  )}
                </p>
              )}
            </div>
          </div>
        )}

        {!isSmall && (
          <div className="mt-0.5">
            <p className="text-slate-300 font-medium truncate" style={{ fontSize: '9px', lineHeight: '1.2' }}>
              {repairConfig.label}
            </p>
            <div className="flex items-center gap-1 text-slate-400 mt-0.5" style={{ fontSize: '8px' }}>
              <Clock className="w-2 h-2" />
              <span>{job.startTime}→{getJobEndTime(job)}</span>
              <span>({formatDuration(job.estimatedDuration)})</span>
            </div>
          </div>
        )}

        {isTiny && (
          <div className="flex items-center gap-1 h-full">
            <span className="text-[8px] truncate text-slate-300 font-medium">
              {job.customerName} · {repairConfig.label}
            </span>
          </div>
        )}
      </div>

      {/* Resize handle — bottom grip */}
      {canResize && !isTiny && (
        <div
          className={cn(
            'absolute bottom-0 left-0 right-0 h-2.5 flex items-center justify-center',
            'cursor-row-resize opacity-0 group-hover:opacity-100 transition-opacity',
            'hover:bg-white/10 rounded-b'
          )}
          onMouseDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onResizeStart?.(job.id, e.clientY, job.estimatedDuration)
          }}
          title="Faire glisser pour modifier la durée"
        >
          <GripHorizontal className="w-3 h-3 text-gray-400" />
        </div>
      )}
    </div>
  )
}
