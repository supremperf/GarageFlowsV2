'use client'

import { useRef, useCallback, useMemo, useState, useEffect } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from '@dnd-kit/core'
import { useScheduleStore } from '@/store/schedule-store'
import {
  WORKSHOP_START_HOUR,
  WORKSHOP_END_HOUR,
  SLOT_HEIGHT_PER_MINUTE,
  Job,
  REPAIR_TYPES,
  repairConfig,
  Mechanic,
} from '@/lib/types'
import { timeToMinutes, minutesToTime, cn, formatDuration, jobsOverlap } from '@/lib/utils'
import JobCard from './JobCard'
import VehicleModal from './VehicleModal'
import MechanicAvatar from './MechanicAvatar'
import { UserX, Plus, ChevronLeft, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { useIsMobile } from '@/hooks/useMediaQuery'
import {
  nombreColonnesVisibles,
  fenetre,
  deplacer,
  reconcilier,
  trancheVisible,
} from '@/lib/planning/mechanic-window'

const HOUR_HEIGHT = 60 * SLOT_HEIGHT_PER_MINUTE
const BOARD_START = WORKSHOP_START_HOUR * 60
const BOARD_END = WORKSHOP_END_HOUR * 60
const TOTAL_MINUTES = BOARD_END - BOARD_START
const BOARD_HEIGHT = TOTAL_MINUTES * SLOT_HEIGHT_PER_MINUTE

// ──────────────────────────────────────────────
// Droppable column component
// ──────────────────────────────────────────────
interface DroppableColumnProps {
  mechanic: Mechanic
  jobs: Job[]
  conflictJobIds: Set<string>
  onCellClick: (mechanicId: string, minutes: number) => void
  onResizeStart: (jobId: string, startY: number, startDuration: number) => void
  onOpenVehicle: (licensePlate: string) => void
}

function DroppableColumn({ mechanic, jobs, conflictJobIds, onCellClick, onResizeStart, onOpenVehicle }: DroppableColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${mechanic.id}` })
  const colRef = useRef<HTMLDivElement>(null)

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const el = colRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const relY = e.clientY - rect.top
      const rawMinutes = Math.round(relY / SLOT_HEIGHT_PER_MINUTE / 15) * 15 + BOARD_START
      const clamped = Math.min(Math.max(rawMinutes, BOARD_START), BOARD_END - 30)
      onCellClick(mechanic.id, clamped)
    },
    [mechanic.id, onCellClick]
  )

  return (
    <div
      ref={colRef}
      className={cn(
        'flex-1 min-w-0 relative border-r border-white/[0.05] last:border-r-0 cursor-cell',
        isOver && 'bg-blue-500/[0.07]',
        mechanic.isAbsent && 'bg-striped'
      )}
      style={{ height: `${BOARD_HEIGHT}px` }}
      onClick={handleClick}
    >
      {/* Set droppable area ref on inner div to cover full column */}
      <div ref={setNodeRef} className="absolute inset-0" />

      {/* Hour gridlines */}
      {Array.from({ length: WORKSHOP_END_HOUR - WORKSHOP_START_HOUR + 1 }, (_, i) => (
        <div
          key={`hour-${i}`}
          className="absolute left-0 right-0 border-t border-white/[0.05] pointer-events-none"
          style={{ top: `${i * HOUR_HEIGHT}px` }}
        />
      ))}
      {/* Half-hour gridlines */}
      {Array.from({ length: (WORKSHOP_END_HOUR - WORKSHOP_START_HOUR) * 2 }, (_, i) => (
        <div
          key={`half-${i}`}
          className="absolute left-0 right-0 border-t border-white/[0.025] pointer-events-none"
          style={{ top: `${i * (HOUR_HEIGHT / 2)}px` }}
        />
      ))}

      {/* Absent overlay */}
      {mechanic.isAbsent && (
        <div className="absolute inset-0 pointer-events-none z-10"
          style={{
            background: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(156,163,175,0.05) 10px, rgba(156,163,175,0.05) 20px)'
          }}
        />
      )}

      {/* Drop highlight */}
      {isOver && (
        <div className="absolute inset-0 border-2 border-blue-400 border-dashed rounded pointer-events-none z-20 opacity-60" />
      )}

      {/* Job cards */}
      {jobs.map(job => {
        const topPx = (timeToMinutes(job.startTime) - BOARD_START) * SLOT_HEIGHT_PER_MINUTE
        const heightPx = Math.max(job.estimatedDuration * SLOT_HEIGHT_PER_MINUTE, 22)
        return (
          <JobCard
            key={job.id}
            job={job}
            heightPx={heightPx}
            style={{ top: `${topPx}px` }}
            hasConflict={conflictJobIds.has(job.id)}
            onResizeStart={onResizeStart}
            onOpenVehicle={onOpenVehicle}
          />
        )
      })}
    </div>
  )
}

// ──────────────────────────────────────────────
// Current time indicator
// ──────────────────────────────────────────────
function CurrentTimeIndicator() {
  const now = new Date()
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  if (currentMinutes < BOARD_START || currentMinutes > BOARD_END) return null
  const topPx = (currentMinutes - BOARD_START) * SLOT_HEIGHT_PER_MINUTE

  return (
    <div
      className="absolute left-0 right-0 pointer-events-none z-30 flex items-center"
      style={{ top: `${topPx}px` }}
    >
      <div className="w-14 flex justify-end pr-1.5 flex-shrink-0">
        <div className="w-2.5 h-2.5 rounded-full bg-red-500 shadow shadow-red-200" />
      </div>
      <div className="flex-1 h-px bg-red-400 opacity-70" />
    </div>
  )
}

// ──────────────────────────────────────────────
// Mechanic header cell (partagé desktop / mobile)
// ──────────────────────────────────────────────
function MechanicHeaderCell({
  mechanic, count, onToggleAbsence, onAdd, touch = false,
}: {
  mechanic: Mechanic
  count: number
  onToggleAbsence: () => void
  onAdd: () => void
  touch?: boolean
}) {
  const btn = touch ? 'gf-touch p-2' : 'p-1'
  return (
    <div className="flex items-center gap-1.5">
      <MechanicAvatar mechanic={mechanic} size={touch ? 36 : 28} />
      <div className="flex-1 min-w-0">
        <p className={cn(
          'font-semibold text-xs truncate leading-tight',
          mechanic.isAbsent ? 'text-slate-500 line-through' : 'text-slate-200',
        )}>
          {mechanic.name}
        </p>
        {mechanic.isAbsent ? (
          <p className="text-[9px] text-red-400 font-semibold leading-tight">ABSENT</p>
        ) : (
          <p className="text-[9px] text-slate-500 leading-tight">{count} interv.</p>
        )}
      </div>
      <div className="flex gap-0.5">
        <button
          onClick={onToggleAbsence}
          className={cn(
            'rounded hover:bg-white/10 transition-colors flex items-center justify-center',
            btn,
            mechanic.isAbsent ? 'text-red-400 bg-red-500/15' : 'text-slate-500',
          )}
          title={mechanic.isAbsent ? 'Marquer présent' : 'Marquer absent'}
          aria-label={mechanic.isAbsent ? 'Marquer présent' : 'Marquer absent'}
        >
          <UserX className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onAdd}
          className={cn('rounded hover:bg-white/10 transition-colors text-slate-500 flex items-center justify-center', btn)}
          title="Ajouter une intervention"
          aria-label="Ajouter une intervention"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// Main Board
// ──────────────────────────────────────────────
export default function ScheduleBoard() {
  const {
    jobs,
    mechanics,
    selectedDate,
    moveJob,
    openCreateModal,
    toggleMechanicAbsence,
    updateJobDurationLocal,
    updateJob,
  } = useScheduleStore()

  const [activeJob, setActiveJob] = useState<Job | null>(null)
  const [vehiclePlate, setVehiclePlate] = useState<string | null>(null)

  // ── Resize state ────────────────────────────────────────────────────────
  const resizeRef = useRef<{ jobId: string; startY: number; startDuration: number } | null>(null)

  const handleResizeStart = useCallback((jobId: string, startY: number, startDuration: number) => {
    resizeRef.current = { jobId, startY, startDuration }
  }, [])

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!resizeRef.current) return
      const { jobId, startY, startDuration } = resizeRef.current
      const deltaY = e.clientY - startY
      const deltaMins = Math.round(deltaY / SLOT_HEIGHT_PER_MINUTE / 15) * 15
      const newDuration = Math.max(15, startDuration + deltaMins)
      updateJobDurationLocal(jobId, newDuration)
    }
    function handleMouseUp() {
      if (!resizeRef.current) return
      const { jobId } = resizeRef.current
      const job = jobs.find(j => j.id === jobId)
      if (job) {
        updateJob(jobId, { estimatedDuration: job.estimatedDuration })
        toast.success(`Durée modifiée : ${formatDuration(job.estimatedDuration)}`)
      }
      resizeRef.current = null
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [jobs, updateJobDurationLocal, updateJob])

  // ── Conflict detection ───────────────────────────────────────────────────
  const conflictJobIds = useMemo(() => {
    const ids = new Set<string>()
    const dayJobs = jobs.filter(j => j.date === selectedDate && j.status !== 'cancelled')
    for (let i = 0; i < dayJobs.length; i++) {
      for (let k = i + 1; k < dayJobs.length; k++) {
        if (jobsOverlap(dayJobs[i], dayJobs[k])) {
          ids.add(dayJobs[i].id)
          ids.add(dayJobs[k].id)
        }
      }
    }
    return ids
  }, [jobs, selectedDate])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const dayJobs = useMemo(
    () => jobs.filter(j => j.date === selectedDate && j.status !== 'cancelled'),
    [jobs, selectedDate]
  )

  const jobsByMechanic = useMemo(() => {
    const map: Record<string, Job[]> = {}
    mechanics.forEach(m => { map[m.id] = dayJobs.filter(j => j.mechanicId === m.id) })
    return map
  }, [dayJobs, mechanics])

  // ── Fenêtre de mécaniciens visibles ────────────────────────────────────────
  //
  // Le planning rendait TOUS les mécaniciens du garage, chacun en `flex-1` :
  // à 10 les colonnes tombent sous 180 px, à 20 sous 90 px, à 50 sous 40 px.
  // Il n'y avait donc aucune limite codée en dur à supprimer — c'était le
  // contraire, aucune limite du tout, et le produit était de fait plafonné à
  // quatre ou cinq mécaniciens sans que rien ne le dise.
  //
  // Le nombre de colonnes est désormais CALCULÉ à partir de la largeur réelle
  // (voir src/lib/planning/mechanic-window.ts) et l'on navigue par groupes.
  const isMobile = useIsMobile()
  const boardRef = useRef<HTMLDivElement>(null)
  const [largeurPlanning, setLargeurPlanning] = useState(0)

  // Largeur MESURÉE, pas devinée : un point de rupture CSS ne connaît pas la
  // place réellement disponible (barre latérale ouverte/fermée, fenêtre Electron
  // redimensionnée, écran secondaire).
  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    setLargeurPlanning(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setLargeurPlanning(e.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const colonnesVisibles = useMemo(
    () => nombreColonnesVisibles(largeurPlanning, mechanics.length),
    [largeurPlanning, mechanics.length],
  )

  const [debutFenetre, setDebutFenetre] = useState(0)

  // Ancres = identifiants de la fenêtre PRÉCÉDENTE. Elles permettent de suivre
  // les mêmes PERSONNES quand la liste change sous les pieds de l'utilisateur
  // (un collègue archive un mécanicien depuis un autre poste) au lieu de
  // conserver un index qui désignerait soudain quelqu'un d'autre.
  const ancresRef = useRef<string[]>([])

  useEffect(() => {
    setDebutFenetre(d => reconcilier(d, ancresRef.current, mechanics.map(m => m.id), colonnesVisibles))
  }, [mechanics, colonnesVisibles])

  const vue = fenetre(debutFenetre, colonnesVisibles, mechanics.length)
  const visibleMechanics = useMemo(
    () => trancheVisible(mechanics, debutFenetre, colonnesVisibles),
    [mechanics, debutFenetre, colonnesVisibles],
  )

  useEffect(() => { ancresRef.current = visibleMechanics.map(m => m.id) }, [visibleMechanics])

  // Navigation par GROUPE. Aucune écoute de la molette ni de geste horizontal :
  // changer de mécaniciens doit rester une action INTENTIONNELLE, jamais la
  // conséquence d'un défilement vertical ordinaire ou d'un trackpad un peu
  // oblique (§31-35).
  const naviguer = useCallback((dir: 1 | -1) => {
    setDebutFenetre(d => deplacer(d, colonnesVisibles, mechanics.length, dir))
  }, [colonnesVisibles, mechanics.length])

  // Sélection directe (bandeau mobile) : on recale la fenêtre sur la personne
  // choisie — l'index n'est qu'un moyen d'y arriver, jamais une identité.
  const cadrerSur = useCallback((mechanicId: string) => {
    const idx = mechanics.findIndex(m => m.id === mechanicId)
    if (idx !== -1) setDebutFenetre(idx)
  }, [mechanics])

  // Bascule d'absence + rappel de redistribution (logique partagée desktop/mobile).
  const handleToggleAbsence = useCallback((mechanic: Mechanic) => {
    toggleMechanicAbsence(mechanic.id)
    if (!mechanic.isAbsent) {
      const count = (jobsByMechanic[mechanic.id] || []).filter(j => j.status === 'scheduled').length
      if (count > 0) toast(`${mechanic.name} absent — ${count} intervention(s) à redistribuer`, { icon: '⚠️' })
    }
  }, [toggleMechanicAbsence, jobsByMechanic])

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveJob(e.active.data.current?.job ?? null)
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveJob(null)
      const { active, over, delta } = event
      if (!over) return

      const job = active.data.current?.job as Job | undefined
      if (!job) return

      const overId = String(over.id)
      const targetMechanicId = overId.startsWith('col-')
        ? overId.replace('col-', '')
        : job.mechanicId

      const originalTopPx = (timeToMinutes(job.startTime) - BOARD_START) * SLOT_HEIGHT_PER_MINUTE
      const newTopPx = originalTopPx + delta.y
      const rawMinutes = Math.round(newTopPx / SLOT_HEIGHT_PER_MINUTE / 15) * 15 + BOARD_START
      const clampedMinutes = Math.min(
        Math.max(rawMinutes, BOARD_START),
        BOARD_END - job.estimatedDuration
      )
      const newStartTime = minutesToTime(clampedMinutes)

      if (targetMechanicId !== job.mechanicId || newStartTime !== job.startTime) {
        const mechName = mechanics.find(m => m.id === targetMechanicId)?.name ?? ''
        moveJob(job.id, targetMechanicId, newStartTime)
        toast.success(`${job.customerName} → ${mechName} à ${newStartTime}`)
      }
    },
    [mechanics, moveJob]
  )

  const handleCellClick = useCallback(
    (mechanicId: string, minutes: number) => {
      openCreateModal({
        mechanicId,
        startTime: minutesToTime(minutes),
        date: selectedDate,
      })
    },
    [openCreateModal, selectedDate]
  )

  const hours = Array.from(
    { length: WORKSHOP_END_HOUR - WORKSHOP_START_HOUR + 1 },
    (_, i) => WORKSHOP_START_HOUR + i
  )

  return (
    <>
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div ref={boardRef} className="flex flex-col h-full bg-[#111827] rounded-xl shadow-sm border border-white/[0.07] overflow-hidden">

        {/* ── Barre de navigation des mécaniciens ──────────────────────────────
            Les flèches sont EN HAUT À GAUCHE et EN HAUT À DROITE du planning, et
            n'en bougent jamais — y compris quand on change de groupe, de date ou
            de taille de fenêtre. Elles occupent leur propre bande plutôt que de
            flotter au-dessus des colonnes : elles ne peuvent ainsi masquer ni un
            avatar, ni un nom, ni une carte d'intervention, et l'alignement
            en-tête ⇄ colonnes reste intact.

            La barre n'apparaît que si tout ne tient pas à l'écran : avec quatre
            mécaniciens sur un écran large, il n'y a rien à parcourir. */}
        {(vue.precedent || vue.suivant) && (
          <div className="flex items-center gap-2 px-1.5 py-1.5 border-b border-white/[0.07] bg-[#0f1629]/80">
            <button
              type="button"
              onClick={() => naviguer(-1)}
              disabled={!vue.precedent}
              aria-label="Mécaniciens précédents"
              title="Mécaniciens précédents"
              className={cn(
                'flex items-center justify-center rounded-md flex-shrink-0 transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0f1629]',
                isMobile ? 'gf-touch w-9 h-9' : 'w-7 h-7',
                vue.precedent
                  ? 'text-slate-400 hover:bg-white/10 hover:text-slate-200'
                  : 'text-slate-700 cursor-not-allowed',
              )}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {/* Bandeau de sélection directe (mobile) ou repère de groupe. */}
            {isMobile ? (
              <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto scrollbar-hide" role="tablist" aria-label="Mécaniciens">
                {mechanics.map(m => {
                  const visible = visibleMechanics.some(v => v.id === m.id)
                  return (
                    <button
                      key={m.id}
                      role="tab"
                      onClick={() => cadrerSur(m.id)}
                      aria-selected={visible}
                      className={cn(
                        'flex items-center gap-1.5 pl-1 pr-2.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-colors flex-shrink-0',
                        visible
                          ? 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                          : 'text-slate-400 border-white/10 hover:bg-white/5',
                      )}
                    >
                      <MechanicAvatar mechanic={m} size={20} />
                      <span className="max-w-[120px] truncate">{m.name}</span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="flex-1 text-center text-[11px] text-slate-500 font-medium select-none">
                Mécaniciens {vue.debut + 1}–{vue.fin} sur {mechanics.length}
              </p>
            )}

            <button
              type="button"
              onClick={() => naviguer(1)}
              disabled={!vue.suivant}
              aria-label="Mécaniciens suivants"
              title="Mécaniciens suivants"
              className={cn(
                'flex items-center justify-center rounded-md flex-shrink-0 transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0f1629]',
                isMobile ? 'gf-touch w-9 h-9' : 'w-7 h-7',
                vue.suivant
                  ? 'text-slate-400 hover:bg-white/10 hover:text-slate-200'
                  : 'text-slate-700 cursor-not-allowed',
              )}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Mechanic header row (colonnes visibles : toutes en desktop, une en mobile) ── */}
        <div className="flex border-b border-white/[0.07] bg-[#0f1629]/80 sticky top-0 z-30">
          <div className="w-14 flex-shrink-0 border-r border-white/[0.07]" />
          {visibleMechanics.map(mechanic => (
            <div
              key={mechanic.id}
              // Point d'ancrage STABLE pour les tests de navigateur : compter les
              // colonnes par une classe de style les ferait échouer au premier
              // ajustement visuel, ce qui pousse à relâcher les assertions.
              data-gf-mechanic-column={mechanic.id}
              className="flex-1 min-w-0 px-2 py-2.5 border-r border-white/[0.07] last:border-r-0"
            >
              <MechanicHeaderCell
                mechanic={mechanic}
                count={(jobsByMechanic[mechanic.id] || []).length}
                onToggleAbsence={() => handleToggleAbsence(mechanic)}
                onAdd={() => openCreateModal({ mechanicId: mechanic.id, date: selectedDate })}
                touch={isMobile}
              />
            </div>
          ))}
        </div>

        {/* ── Scrollable schedule grid ── */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden relative">
          <div className="flex relative" style={{ minHeight: `${BOARD_HEIGHT}px` }}>

            {/* Time ruler */}
            <div className="w-14 flex-shrink-0 border-r border-white/[0.07] sticky left-0 bg-[#111827] z-20">
              {hours.map(h => (
                <div
                  key={h}
                  className="absolute left-0 w-full flex items-start justify-end pr-2"
                  style={{
                    top: `${(h - WORKSHOP_START_HOUR) * HOUR_HEIGHT}px`,
                    height: `${HOUR_HEIGHT}px`,
                  }}
                >
                  <span className="text-[11px] text-slate-600 font-medium mt-0.5 leading-none">
                    {String(h).padStart(2, '0')}:00
                  </span>
                </div>
              ))}
            </div>

            {/* Droppable mechanic columns (toutes en desktop, une seule en mobile) */}
            {visibleMechanics.map(mechanic => (
              <DroppableColumn
                key={mechanic.id}
                mechanic={mechanic}
                jobs={jobsByMechanic[mechanic.id] || []}
                conflictJobIds={conflictJobIds}
                onCellClick={handleCellClick}
                onResizeStart={handleResizeStart}
                onOpenVehicle={plate => setVehiclePlate(plate)}
              />
            ))}

            {/* Current time indicator (absolute inside the scrollable grid) */}
            <CurrentTimeIndicator />
          </div>
        </div>
      </div>

      {/* Drag overlay — follows cursor */}
      <DragOverlay dropAnimation={null}>
        {activeJob ? (
          <div
            className="rounded-lg shadow-2xl px-3 py-2 pointer-events-none border border-white/20 opacity-90"
            style={{
              backgroundColor: repairConfig(activeJob.repairType).color + '25',
              borderLeftColor: repairConfig(activeJob.repairType).color,
              borderLeftWidth: '3px',
              width: '150px',
              backdropFilter: 'blur(8px)',
            }}
          >
            <p className="text-xs font-bold text-white truncate">{activeJob.customerName}</p>
            <p className="text-[10px] text-slate-300 truncate">{activeJob.vehicleModel}</p>
            <p className="text-[10px] text-slate-400">
              {repairConfig(activeJob.repairType).icon} {formatDuration(activeJob.estimatedDuration)}
            </p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>

    {vehiclePlate && (
      <VehicleModal
        licensePlate={vehiclePlate}
        onClose={() => setVehiclePlate(null)}
      />
    )}
    </>
  )
}
