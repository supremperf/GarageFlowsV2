'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useScheduleStore } from '@/store/schedule-store'
import {
  Job,
  RepairType,
  REPAIR_TYPES,
  Part,
} from '@/lib/types'
import {
  findBestSlot,
  formatDuration,
  cn,
  getTodayString,
} from '@/lib/utils'
import { X, Zap, Car, User, Wrench, Camera } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from '@/lib/i18n'
import { repairTypeLabel } from '@/lib/i18n/labels'
import QuoteInvoiceModal from '@/components/QuoteInvoiceModal'
import VehicleHistoryModal from '@/components/VehicleHistoryModal'
import JobPhotos from '@/components/JobPhotos'
import InspectionModal from '@/components/InspectionModal'
import { PlateSearchField, VehicleSuggestion } from '@/components/job-modal/PlateSearchField'
import { VehicleHistoryCard, VehicleHistorySummary } from '@/components/job-modal/VehicleHistoryCard'
import { AIEstimationCard, EstimateResult } from '@/components/job-modal/AIEstimationCard'
import { JobModalFooter } from '@/components/job-modal/JobModalFooter'
import { JobDefaultPartsSuggestion } from '@/components/job-modal/JobDefaultPartsSuggestion'
import { JobScheduleSection } from '@/components/job-modal/JobScheduleSection'
import { VehicleAutocompleteField } from '@/components/job-modal/VehicleAutocompleteField'
import { upsertClient, searchClients, findClientByPlate, ClientRecord } from '@/lib/client-memory'

interface DefaultPart {
  part: Part
  defaultQuantity: number
}

export default function JobModal() {
  const { t } = useTranslation()
  const {
    isJobModalOpen,
    jobModalMode,
    selectedJobId,
    jobModalPreset,
    jobs,
    mechanics,
    selectedDate,
    closeModal,
    addJob,
    updateJob,
    deleteJob,
  } = useScheduleStore()

  const editingJob = jobModalMode === 'edit' ? jobs.find(j => j.id === selectedJobId) : null

  const [form, setForm] = useState<Partial<Job>>({})

  // Vehicle search
  const [plateSearch, setPlateSearch] = useState('')
  const [vehicleSuggestions, setVehicleSuggestions] = useState<VehicleSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [vehicleHistory, setVehicleHistory] = useState<VehicleHistorySummary | null>(null)
  const plateDebounceRef = useRef<NodeJS.Timeout | null>(null)

  // AI estimation
  const [estimate, setEstimate] = useState<EstimateResult | null>(null)
  const [loadingEstimate, setLoadingEstimate] = useState(false)
  const [durationOverridden, setDurationOverridden] = useState(false)
  const [showMechanicComparison, setShowMechanicComparison] = useState(false)
  const estimateDebounceRef = useRef<NodeJS.Timeout | null>(null)

  // Default parts
  const [defaultParts, setDefaultParts] = useState<DefaultPart[]>([])

  // Invoice / quote
  const [invoiceMode, setInvoiceMode] = useState<'invoice' | 'quote' | null>(null)

  // Inspection
  const [isInspectionOpen, setIsInspectionOpen] = useState(false)

  // Vehicle history modal
  const [showVehicleHistory, setShowVehicleHistory] = useState(false)

  // Photos tab
  const [activeTab, setActiveTab] = useState<'details' | 'photos'>('details')

  // Plate lookup (AI)
  const [lookingUpPlate, setLookingUpPlate] = useState(false)

  // Client memory (autocomplete from localStorage)
  const [clientSuggestions, setClientSuggestions] = useState<ClientRecord[]>([])
  const [showClientSuggestions, setShowClientSuggestions] = useState(false)

  // Job profitability (edit mode only)
  interface JobProfit { laborRevenue: number; partsRevenue: number; partsCost: number; profit: number }
  const [jobProfit, setJobProfit] = useState<JobProfit | null>(null)

  // Fetch profitability when editing
  useEffect(() => {
    if (jobModalMode !== 'edit' || !editingJob || !isJobModalOpen) { setJobProfit(null); return }
    Promise.all([
      fetch('/api/garages').then(r => r.ok ? r.json() : null),
      fetch(`/api/jobs/${editingJob.id}/parts`).then(r => r.ok ? r.json() : []),
    ]).then(([garage, parts]) => {
      if (!garage) return
      const duration = editingJob.actualDuration ?? editingJob.estimatedDuration
      const laborRevenue = Math.round((duration / 60) * (garage.hourlyRate ?? 60) * 100) / 100
      const partsRevenue = parts.reduce((s: number, p: { unitPrice: number; quantity: number }) => s + p.unitPrice * p.quantity, 0)
      const partsCost = parts.reduce((s: number, p: { unitCost: number; quantity: number }) => s + p.unitCost * p.quantity, 0)
      const profit = Math.round((laborRevenue + partsRevenue - partsCost) * 100) / 100
      setJobProfit({ laborRevenue, partsRevenue, partsCost, profit })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobModalMode, editingJob?.id, isJobModalOpen])

  // Initialize form
  useEffect(() => {
    if (!isJobModalOpen) return
    if (jobModalMode === 'edit' && editingJob) {
      setForm(editingJob)
      setPlateSearch(editingJob.licensePlate || '')
      setDurationOverridden(true)
    } else {
      setForm({
        repairType: 'oil_change',
        estimatedDuration: REPAIR_TYPES.oil_change.defaultDuration,
        status: 'scheduled',
        isUrgent: false,
        date: jobModalPreset?.date || selectedDate,
        mechanicId: jobModalPreset?.mechanicId || mechanics.find(m => !m.isAbsent)?.id || '',
        startTime: jobModalPreset?.startTime || '08:00',
        ...jobModalPreset,
      })
      setPlateSearch(jobModalPreset?.licensePlate || '')
      setDurationOverridden(false)
    }
    setEstimate(null)
    setVehicleHistory(null)
    setDefaultParts([])
    setVehicleSuggestions([])
    setActiveTab('details')
    setShowVehicleHistory(false)
  }, [isJobModalOpen, jobModalMode, editingJob, jobModalPreset, selectedDate, mechanics])

  const setField = useCallback(<K extends keyof Job>(key: K, value: Job[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }, [])

  // Fetch AI estimate when repairType, vehicleModel, or mechanicId changes
  useEffect(() => {
    if (jobModalMode === 'edit' || durationOverridden) return
    if (!form.repairType) return

    if (estimateDebounceRef.current) clearTimeout(estimateDebounceRef.current)
    setLoadingEstimate(true)

    estimateDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/estimate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repairType: form.repairType,
            vehicleModel: form.vehicleModel || '',
            mechanicId: form.mechanicId || null,
          }),
        })
        if (!res.ok) return
        const data: EstimateResult = await res.json()
        setEstimate(data)
        setForm(prev => ({ ...prev, estimatedDuration: data.recommended }))
      } catch {
        // ignore
      } finally {
        setLoadingEstimate(false)
      }
    }, 500)
  }, [form.repairType, form.vehicleModel, form.mechanicId, jobModalMode, durationOverridden])

  // Fetch default parts when repair type changes
  useEffect(() => {
    if (!form.repairType || jobModalMode === 'edit') return
    fetch(`/api/parts?repairType=${form.repairType}`)
      .then(r => r.ok ? r.json() : [])
      .then((parts: DefaultPart[]) => setDefaultParts(parts))
      .catch(() => setDefaultParts([]))
  }, [form.repairType, jobModalMode])

  const handlePlateChange = useCallback((value: string) => {
    const upper = value.toUpperCase()
    setPlateSearch(upper)
    setField('licensePlate', upper)
    setVehicleHistory(null)

    // Client memory: auto-fill from known plate
    if (upper.length >= 4) {
      const known = findClientByPlate(upper)
      if (known) {
        if (known.customerName) setField('customerName', known.customerName)
        if (known.vehicleModel) setField('vehicleModel', known.vehicleModel)
      }
    }

    if (plateDebounceRef.current) clearTimeout(plateDebounceRef.current)
    if (upper.length < 2) {
      setVehicleSuggestions([])
      setShowSuggestions(false)
      return
    }

    plateDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/vehicles?query=${encodeURIComponent(upper)}`)
        if (!res.ok) return
        const raw = await res.json()
        const data = raw?.data ?? raw ?? []
        setVehicleSuggestions(data.slice(0, 5))
        setShowSuggestions(data.length > 0)
      } catch {
        // ignore
      }
    }, 300)
  }, [setField])

  const selectVehicle = useCallback(async (v: VehicleSuggestion) => {
    setPlateSearch(v.licensePlate)
    setForm(prev => ({
      ...prev,
      licensePlate: v.licensePlate,
      vehicleModel: v.model,
      customerName: v.clientName || prev.customerName,
      vehicleId: v.id,
    }))
    setShowSuggestions(false)

    try {
      const res = await fetch(`/api/vehicles/${v.id}`)
      if (!res.ok) return
      const data = await res.json()
      const vehicleJobs = data.jobs ?? []
      const lastJob = vehicleJobs[0]
      setVehicleHistory({
        id: v.id,
        licensePlate: v.licensePlate,
        model: v.model,
        clientName: data.client?.name,
        lastVisitDate: lastJob?.date,
        lastRepairType: lastJob?.repairType,
        totalVisits: vehicleJobs.length,
      })
    } catch {
      // ignore
    }
  }, [])

  const handlePlateLookup = useCallback(async () => {
    if (!plateSearch || plateSearch.length < 4) return
    setLookingUpPlate(true)
    try {
      const r = await fetch(`/api/plate-lookup?plate=${encodeURIComponent(plateSearch)}`)
      if (!r.ok) return
      const data = await r.json()
      if (data.make || data.model) {
        const model = [data.make, data.model].filter(Boolean).join(' ')
        if (model) setField('vehicleModel', model)
        toast.success(`${t.jmVehicleDetected} ${model || t.jmUnknown}${data.year ? ` (${data.year})` : ''}`)
      } else {
        toast.error(t.jmVehicleNotFound)
      }
    } catch {
      toast.error(t.jmPlateLookupError)
    } finally {
      setLookingUpPlate(false)
    }
  }, [plateSearch, setField, t])

  const handleAutoSlot = useCallback(() => {
    if (!form.repairType || !form.estimatedDuration) return
    const slot = findBestSlot(jobs, mechanics, form.date || selectedDate, form.estimatedDuration)
    if (slot) {
      setForm(prev => ({ ...prev, mechanicId: slot.mechanicId, startTime: slot.startTime }))
      toast.success(t.jmSlotFound)
    } else {
      toast.error(t.jmNoSlot)
    }
  }, [form, jobs, mechanics, selectedDate, t])

  const isValid =
    form.customerName &&
    form.vehicleModel &&
    form.repairType &&
    form.mechanicId &&
    form.startTime &&
    form.estimatedDuration &&
    form.date

  const handleSubmit = useCallback(() => {
    if (!isValid) {
      toast.error(t.jmFillRequired)
      return
    }
    // Save to client memory for future autocomplete
    if (form.customerName) {
      upsertClient({
        customerName: form.customerName,
        licensePlate: form.licensePlate,
        vehicleModel: form.vehicleModel,
      })
    }
    if (jobModalMode === 'edit' && editingJob) {
      updateJob(editingJob.id, form)
      toast.success(t.jmUpdated)
    } else {
      addJob(form as Omit<Job, 'id' | 'createdAt'>)
    }
    closeModal()
  }, [isValid, jobModalMode, editingJob, form, updateJob, addJob, closeModal, t])

  const handleDelete = useCallback(() => {
    if (!editingJob) return
    if (confirm(t.jmDeleteConfirm)) {
      deleteJob(editingJob.id)
      closeModal()
    }
  }, [editingJob, deleteJob, closeModal, t])

  if (!isJobModalOpen) return null

  const activeMechanics = mechanics.filter(m => !m.isAbsent)
  const repairConfig = form.repairType ? REPAIR_TYPES[form.repairType as RepairType] : null
  const repairLabel = (type: string) => repairTypeLabel(t, type, REPAIR_TYPES[type as RepairType]?.label)

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={closeModal} />

      <div className="relative bg-[#111827] rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-in border border-white/[0.07]">
        {/* Header */}
        <div className="sticky top-0 bg-[#111827] border-b border-white/[0.07] px-6 py-4 rounded-t-2xl flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">
              {jobModalMode === 'edit' ? t.jmEditTitle : t.jmNewTitle}
            </h2>
            {repairConfig && (
              <p className="text-sm text-slate-400 flex items-center gap-1 mt-0.5">
                <span>{repairConfig.icon}</span>
                <span>{repairLabel(form.repairType as string)}</span>
                {form.estimatedDuration && (
                  <span className="text-blue-400 font-medium">
                    · {formatDuration(form.estimatedDuration)}
                  </span>
                )}
              </p>
            )}
          </div>
          <button onClick={closeModal} className="gf-close p-2 rounded-lg hover:bg-white/[0.07] text-slate-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs (edit mode) */}
        {jobModalMode === 'edit' && (
          <div className="flex gap-1 px-6 pt-2 border-b border-white/[0.07]">
            {(['details', 'photos'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
                  activeTab === tab ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500 hover:text-slate-300'
                )}
              >
                {tab === 'details' ? <><Wrench className="w-3.5 h-3.5" /> {t.jmTabDetails}</> : <><Camera className="w-3.5 h-3.5" /> {t.jmTabPhotos}</>}
              </button>
            ))}
          </div>
        )}

        {activeTab === 'photos' && jobModalMode === 'edit' && editingJob ? (
          <div className="p-6">
            <JobPhotos jobId={editingJob.id} />
          </div>
        ) : (
        <div className="p-6 space-y-5">
          {/* License plate search */}
          <PlateSearchField
            plateSearch={plateSearch}
            suggestions={vehicleSuggestions}
            showSuggestions={showSuggestions}
            lookingUp={lookingUpPlate}
            onChange={handlePlateChange}
            onFocus={() => setShowSuggestions(true)}
            onSelectVehicle={selectVehicle}
            onLookup={handlePlateLookup}
            onPlateDetected={plate => {
              setPlateSearch(plate)
              setField('licensePlate', plate)
              handlePlateLookup()
            }}
          />

          {/* Vehicle history card */}
          {vehicleHistory && (
            <VehicleHistoryCard
              history={vehicleHistory}
              repairTypeLabel={repairLabel}
              onShowHistory={() => setShowVehicleHistory(true)}
            />
          )}

          {/* Customer name with memory autocomplete */}
          <div className="relative">
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              <User className="w-3.5 h-3.5 inline mr-1" />
              {t.jmClientName} *
            </label>
            <input
              type="text"
              value={form.customerName || ''}
              onChange={e => {
                setField('customerName', e.target.value)
                setClientSuggestions(searchClients(e.target.value))
                setShowClientSuggestions(true)
              }}
              onFocus={() => {
                setClientSuggestions(searchClients(form.customerName || ''))
                setShowClientSuggestions(true)
              }}
              onBlur={() => setTimeout(() => setShowClientSuggestions(false), 150)}
              placeholder={t.jmClientPh}
              className="w-full rounded-lg border border-white/15 bg-white/[0.05] text-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
            />
            {showClientSuggestions && clientSuggestions.length > 0 && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl bg-[#1a2235] border border-white/10 shadow-2xl overflow-hidden">
                {clientSuggestions.map(c => (
                  <button
                    key={c.customerName}
                    type="button"
                    onMouseDown={e => {
                      e.preventDefault()
                      setField('customerName', c.customerName)
                      if (c.licensePlate) { setPlateSearch(c.licensePlate); setField('licensePlate', c.licensePlate) }
                      if (c.vehicleModel) setField('vehicleModel', c.vehicleModel)
                      setShowClientSuggestions(false)
                    }}
                    className="w-full flex items-start gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.07] text-left transition-colors"
                  >
                    <User className="w-3.5 h-3.5 text-slate-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">{c.customerName}</p>
                      {(c.licensePlate || c.vehicleModel) && (
                        <p className="text-xs text-slate-500">{[c.licensePlate, c.vehicleModel].filter(Boolean).join(' · ')}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Vehicle model with car database autocomplete */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              <Car className="w-3.5 h-3.5 inline mr-1" />
              {t.jmVehicle} *
            </label>
            <VehicleAutocompleteField
              value={form.vehicleModel || ''}
              onChange={v => setField('vehicleModel', v)}
              placeholder={t.jmVehiclePh}
            />
          </div>

          {/* Repair type */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              <Wrench className="w-3.5 h-3.5 inline mr-1" />
              {t.jmRepairType} *
            </label>
            <div className="grid grid-cols-2 gap-1.5 max-h-52 overflow-y-auto pr-1">
              {Object.entries(REPAIR_TYPES).map(([key, config]) => (
                <button
                  key={key}
                  onClick={() => {
                    setField('repairType', key as RepairType)
                    setDurationOverridden(false)
                  }}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-sm transition-all',
                    form.repairType === key
                      ? 'border-blue-500 bg-blue-500/20 text-blue-300 font-medium'
                      : 'border-white/10 hover:border-white/20 hover:bg-white/[0.05] text-slate-300'
                  )}
                >
                  <span>{config.icon}</span>
                  <div className="flex-1 min-w-0">
                    <span className="truncate block text-xs">{repairTypeLabel(t, key, config.label)}</span>
                    <span className="text-[10px] text-slate-500">{formatDuration(config.defaultDuration)}</span>
                  </div>
                  {config.isQuick && <Zap className="w-3 h-3 text-amber-500 flex-shrink-0" />}
                </button>
              ))}
            </div>
          </div>

          {/* Default parts suggestion */}
          {jobModalMode === 'create' && (
            <JobDefaultPartsSuggestion parts={defaultParts} />
          )}

          {/* Mechanic selection */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              {t.jmMechanic} *
            </label>
            <div className="grid grid-cols-2 gap-2">
              {activeMechanics.map(mechanic => (
                <button
                  key={mechanic.id}
                  onClick={() => {
                    setField('mechanicId', mechanic.id)
                    setDurationOverridden(false)
                  }}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all',
                    form.mechanicId === mechanic.id ? 'border-2 font-medium' : 'border-white/10 hover:border-white/20 text-slate-300'
                  )}
                  style={
                    form.mechanicId === mechanic.id
                      ? { borderColor: mechanic.color, backgroundColor: mechanic.color + '15', color: mechanic.color }
                      : {}
                  }
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                    style={{ backgroundColor: mechanic.color }}
                  >
                    {mechanic.avatar}
                  </div>
                  <span className="truncate">{mechanic.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* AI Estimation card */}
          {jobModalMode === 'create' && (estimate || loadingEstimate) && (
            <AIEstimationCard
              estimate={estimate}
              loading={loadingEstimate}
              showComparison={showMechanicComparison}
              onToggleComparison={() => setShowMechanicComparison(v => !v)}
            />
          )}

          <JobScheduleSection
            estimatedDuration={form.estimatedDuration || 30}
            date={form.date || getTodayString()}
            startTime={form.startTime || '08:00'}
            status={form.status as Job['status']}
            isUrgent={!!form.isUrgent}
            notes={form.notes || ''}
            durationOverridden={durationOverridden}
            isEditMode={jobModalMode === 'edit'}
            onDurationChange={v => { setDurationOverridden(true); setField('estimatedDuration', v) }}
            onDateChange={v => setField('date', v)}
            onTimeChange={v => setField('startTime', v)}
            onStatusChange={v => setField('status', v)}
            onUrgentChange={v => setField('isUrgent', v)}
            onNotesChange={v => setField('notes', v)}
            onAutoSlot={handleAutoSlot}
            onResetDuration={() => setDurationOverridden(false)}
          />
        </div>
        )}

        {/* Footer with profitability card + action buttons */}
        <JobModalFooter
          mode={jobModalMode}
          editingJob={editingJob}
          isValid={!!isValid}
          jobProfit={jobProfit}
          onDelete={handleDelete}
          onInspection={() => setIsInspectionOpen(true)}
          onQuote={() => setInvoiceMode('quote')}
          onInvoice={() => setInvoiceMode('invoice')}
          onCancel={closeModal}
          onSubmit={handleSubmit}
        />
      </div>
    </div>

    {invoiceMode && editingJob && (
      <QuoteInvoiceModal
        mode={invoiceMode}
        jobId={editingJob.id}
        prefill={{
          clientName: editingJob.customerName,
          vehicleModel: editingJob.vehicleModel,
          licensePlate: editingJob.licensePlate ?? undefined,
          notes: editingJob.notes ?? undefined,
        }}
        onClose={() => setInvoiceMode(null)}
      />
    )}

    {showVehicleHistory && vehicleHistory && (
      <VehicleHistoryModal
        vehicleId={vehicleHistory.id}
        onClose={() => setShowVehicleHistory(false)}
      />
    )}

    {isInspectionOpen && editingJob && (
      <InspectionModal
        jobId={editingJob.id}
        prefill={{
          clientName: editingJob.customerName,
          vehicleModel: editingJob.vehicleModel,
          licensePlate: editingJob.licensePlate ?? undefined,
          mileage: editingJob.mileageAtVisit ?? undefined,
        }}
        onClose={() => setIsInspectionOpen(false)}
      />
    )}
    </>
  )
}
