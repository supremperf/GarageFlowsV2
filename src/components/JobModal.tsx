'use client'
import { lineCents, fromCents, toCents } from '@/lib/money'

import { useState, useEffect, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
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
import { bornesAtelier } from '@/lib/planning/horaires'
import { X, Zap, Car, User, Wrench, Camera } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from '@/lib/i18n'
import { repairTypeLabel } from '@/lib/i18n/labels'
import QuoteInvoiceModal from '@/components/QuoteInvoiceModal'
// ── Chargé à la DEMANDE (budget de performance) ─────────────────────────────
// L'ordre de réparation embarque son propre document imprimable, le canevas de
// signature et l'autocomplétion de pièces. Importé statiquement, tout cela
// entrait dans le paquet de la page d'accueil — payé par chaque garagiste à
// chaque ouverture, pour un écran que beaucoup n'ouvriront jamais. Il n'est
// monté qu'après un clic : le chargement différé est invisible.
const WorkOrderModal = dynamic(() => import('@/components/WorkOrderModal'), { ssr: false })
import VehicleHistoryModal from '@/components/VehicleHistoryModal'
import JobPhotos from '@/components/JobPhotos'
import InspectionModal from '@/components/InspectionModal'
import { PlateSearchField, VehicleSuggestion } from '@/components/job-modal/PlateSearchField'
import { VehicleHistoryCard, VehicleHistorySummary } from '@/components/job-modal/VehicleHistoryCard'
import { AIEstimationCard, EstimateResult } from '@/components/job-modal/AIEstimationCard'
import { JobModalFooter } from '@/components/job-modal/JobModalFooter'
import { JobPartsSection } from '@/components/job-modal/JobPartsSection'
import { JobScheduleSection } from '@/components/job-modal/JobScheduleSection'
import { VehicleAutocompleteField } from '@/components/job-modal/VehicleAutocompleteField'
import { useRechercheClient } from '@/lib/clients/use-recherche-client'
import { normaliserPlaque } from '@/lib/recherche/normalisation'


export default function JobModal() {
  const { t } = useTranslation()
  const {
    isJobModalOpen,
    jobModalMode,
    selectedJobId,
    jobModalPreset,
    jobs,
    mechanics,
    horaires,
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

  // Invoice / quote
  const [invoiceMode, setInvoiceMode] = useState<'invoice' | 'quote' | null>(null)

  // Inspection
  const [isInspectionOpen, setIsInspectionOpen] = useState(false)

  // Ordre de réparation (GF-040)
  const [isWorkOrderOpen, setIsWorkOrderOpen] = useState(false)

  // Vehicle history modal
  const [showVehicleHistory, setShowVehicleHistory] = useState(false)

  // Photos tab
  const [activeTab, setActiveTab] = useState<'details' | 'photos'>('details')

  // Plate lookup (AI)
  const [lookingUpPlate, setLookingUpPlate] = useState(false)

  // Client memory (autocomplete from localStorage)
  // Les suggestions viennent de la BASE (GET /api/clients), plus du localStorage
  // du poste : un téléphone corrigé dans l'écran Clients devait ressortir ici,
  // et les clients réellement enregistrés devaient être proposés (GF-016).
  const { suggestions: clientSuggestions, chercher: chercherClient, vider: viderClients } = useRechercheClient()
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
      // `?? 60` affichait une rentabilité calculée sur un tarif que le garage
      // n'avait pas choisi. Sans tarif lisible, la main-d'œuvre ne vaut rien de
      // connu : elle vaut zéro à l'écran, et cela se voit.
      const laborRevenue = fromCents(lineCents(garage.hourlyRate ?? 0, duration / 60))
      const partsRevenue = parts.reduce((s: number, p: { unitPrice: number; quantity: number }) => s + fromCents(lineCents(p.unitPrice, p.quantity)), 0)
      const partsCost = parts.reduce((s: number, p: { unitCost: number; quantity: number }) => s + fromCents(lineCents(p.unitCost, p.quantity)), 0)
      const profit = fromCents(toCents(laborRevenue) + toCents(partsRevenue) - toCents(partsCost))
      setJobProfit({ laborRevenue, partsRevenue, partsCost, profit })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobModalMode, editingJob?.id, isJobModalOpen])

  /**
   * Ce pour quoi le formulaire a DÉJÀ été initialisé.
   *
   * Sans ce repère, l'effet ci-dessous se rejouait à chaque changement de
   * référence de `editingJob` — or `editingJob` vient d'un `jobs.find(...)` non
   * mémoïsé, donc c'est un objet NEUF à chaque rendu du parent. Le battement de
   * 10 s recharge le planning, le parent se rend, l'effet se rejoue et
   * `setForm(editingJob)` REMPLAÇAIT ce que le garagiste était en train de
   * taper. Même chose en création à chaque rafraîchissement des mécaniciens.
   *
   * L'initialisation doit avoir lieu une fois par ouverture et par intervention
   * éditée — pas à chaque fois que le serveur répond.
   */
  const initialisePour = useRef<string | null>(null)

  // Initialize form
  useEffect(() => {
    if (!isJobModalOpen) { initialisePour.current = null; return }
    const cle = jobModalMode === 'edit' ? `edit:${editingJob?.id ?? ''}` : 'create'
    if (initialisePour.current === cle) return
    initialisePour.current = cle
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
    setVehicleSuggestions([])
    setActiveTab('details')
    setShowVehicleHistory(false)
  }, [isJobModalOpen, jobModalMode, editingJob, jobModalPreset, selectedDate, mechanics])

  /**
   * Mécanicien par défaut arrivé APRÈS l'ouverture.
   *
   * L'initialisation ci-dessus ne se rejoue plus quand la liste des mécaniciens
   * se rafraîchit — c'était précisément la cause de l'écrasement de saisie. Mais
   * en création, si la liste n'était pas encore chargée à l'ouverture, le champ
   * serait resté vide. On complète donc CE SEUL champ, et seulement s'il est
   * encore vide : aucune autre saisie n'est touchée.
   */
  useEffect(() => {
    if (!isJobModalOpen || jobModalMode === 'edit') return
    if (form.mechanicId) return
    const defaut = mechanics.find(m => !m.isAbsent)?.id
    if (defaut) setForm(prev => (prev.mechanicId ? prev : { ...prev, mechanicId: defaut }))
  }, [isJobModalOpen, jobModalMode, mechanics, form.mechanicId])

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

  const handlePlateChange = useCallback((value: string) => {
    const upper = value.toUpperCase()
    setPlateSearch(upper)
    setField('licensePlate', upper)
    setVehicleHistory(null)

    if (plateDebounceRef.current) clearTimeout(plateDebounceRef.current)
    if (upper.length < 2) {
      setVehicleSuggestions([])
      setShowSuggestions(false)
      return
    }

    plateDebounceRef.current = setTimeout(async () => {
      try {
        // `q` — le nom que la route lit RÉELLEMENT (src/app/api/vehicles/route.ts:14,
        // qui compose un OR sur plaque / marque / modèle / nom du client).
        // Ce paramètre s'appelait ici `query`, que la route ignore : la requête
        // partait donc SANS aucun critère et renvoyait les quinze véhicules les
        // plus récemment touchés du garage. La liste proposée n'avait aucun
        // rapport avec la saisie, et choisir une suggestion écrasait d'un coup
        // plaque, modèle, `vehicleId` ET nom du client — l'intervention était
        // enregistrée sur le véhicule et le client de quelqu'un d'autre, sans
        // le moindre signe à l'écran.
        const res = await fetch(`/api/vehicles?q=${encodeURIComponent(upper)}`)
        if (!res.ok) return
        const raw = await res.json()

        // ── Conversion explicite vers la forme attendue (GF-017) ─────────────
        // La route renvoie `{ make, model, client: { name, phone } }` ; le
        // composant de suggestion lit `model` et `clientName`. Les objets bruts
        // étaient passés tels quels : le NOM DU CLIENT n'apparaissait donc
        // jamais dans la liste — précisément l'information qui permet de ne pas
        // se tromper de voiture — et `selectVehicle` ne le reprenait pas non
        // plus. La marque était perdue de la même façon (« Clio » au lieu de
        // « Renault Clio »).
        interface VehiculeApi {
          id: string; licensePlate: string; make?: string | null; model?: string | null
          client?: { name?: string | null; phone?: string | null } | null
        }
        const brut: VehiculeApi[] = raw?.data ?? raw ?? []
        const data: VehicleSuggestion[] = brut.map((v) => ({
          id: v.id,
          licensePlate: v.licensePlate,
          model: [v.make, v.model].filter(Boolean).join(' ').trim(),
          clientName: v.client?.name ?? undefined,
          clientPhone: v.client?.phone ?? undefined,
        }))
        setVehicleSuggestions(data.slice(0, 5))
        setShowSuggestions(data.length > 0)

        // Pré-remplissage sur une plaque EXACTEMENT reconnue — depuis la base,
        // et non depuis l'annuaire local du poste, qui pouvait ressortir un nom
        // ou un modèle périmés (GF-016). Aucune requête de plus : on se sert de
        // la réponse déjà reçue. Les séparateurs sont ignorés des deux côtés :
        // « ab123cd » reconnaît « AB-123-CD ».
        const cible = normaliserPlaque(upper)
        const exact = cible.length >= 4
          ? data.find((v) => normaliserPlaque(v.licensePlate) === cible)
          : undefined
        if (exact) {
          if (exact.clientName) setField('customerName', exact.clientName)
          if (exact.model) setField('vehicleModel', exact.model)
          setField('vehicleId', exact.id)
        }
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
    // ── Le créneau proposé suit les horaires du GARAGE (§14-15) ──────────────
    // `findBestSlot` était appelé sans bornes : il retombait donc sur 8 h – 18 h
    // quoi qu'ait enregistré le garage. Un atelier ouvrant à 7 h se voyait
    // proposer 8 h et perdait une heure chaque matin ; un atelier fermant à 16 h
    // se voyait proposer un créneau APRÈS la fermeture, que la grille du
    // planning refusait ensuite d'afficher.
    const slot = findBestSlot(
      jobs, mechanics, form.date || selectedDate, form.estimatedDuration,
      bornesAtelier(horaires),
    )
    if (slot) {
      setForm(prev => ({ ...prev, mechanicId: slot.mechanicId, startTime: slot.startTime }))
      toast.success(t.jmSlotFound)
    } else {
      toast.error(t.jmNoSlot)
    }
  }, [form, jobs, mechanics, horaires, selectedDate, t])

  const isValid =
    form.customerName &&
    form.vehicleModel &&
    form.repairType &&
    form.mechanicId &&
    form.startTime &&
    form.estimatedDuration &&
    form.date

  const handleSubmit = useCallback(async () => {
    if (!isValid) {
      toast.error(t.jmFillRequired)
      return
    }
    // L'annuaire d'autocomplétion n'est plus tenu ici : le SERVEUR matérialise
    // le client et le véhicule à l'écriture de l'intervention (GF-015), et la
    // recherche lit la base (GF-016). Écrire en plus dans le `localStorage`
    // recréait la seconde vérité qu'on vient de supprimer.
    // ── Le succès n'est plus annoncé avant la réponse du serveur (GF-024) ────
    // `handleSubmit` était SYNCHRONE : `updateJob` (asynchrone) n'était ni
    // attendu ni surveillé, le toast « Intervention mise à jour » partait tout
    // de suite et la modale se fermait. Un refus — mécanicien introuvable, 404 —
    // arrivait ensuite : la ligne revenait à sa place, sans que rien ne relie
    // ce retour au message de succès déjà affiché.
    //
    // Le `try/catch` est indispensable : `addJob` RELANCE son erreur, et une
    // promesse rejetée non gérée est transformée par le processus principal en
    // surimpression plein écran indélébile.
    try {
      if (jobModalMode === 'edit' && editingJob) {
        const ok = await updateJob(editingJob.id, form)
        if (!ok) return   // le magasin a déjà affiché le motif du refus
        toast.success(t.jmUpdated)
      } else {
        await addJob(form as Omit<Job, 'id' | 'createdAt'>)
      }
      closeModal()
    } catch {
      // Le magasin a déjà affiché l'erreur ; la modale reste ouverte pour que
      // la saisie ne soit pas perdue.
    }
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

      <div className="relative bg-[#111827] rounded-2xl shadow-2xl w-full max-w-lg max-h-modal overflow-y-auto animate-slide-in border border-white/[0.07]">
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
          <button aria-label="Fermer" title="Fermer" onClick={closeModal} className="gf-close p-2 rounded-lg hover:bg-white/[0.07] text-slate-400 transition-colors">
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
                chercherClient(e.target.value)
                setShowClientSuggestions(true)
              }}
              onFocus={() => {
                chercherClient(form.customerName || '')
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
                    key={c.cle}
                    type="button"
                    onMouseDown={e => {
                      e.preventDefault()
                      setField('customerName', c.customerName)
                      if (c.licensePlate) { setPlateSearch(c.licensePlate); setField('licensePlate', c.licensePlate) }
                      if (c.vehicleModel) setField('vehicleModel', c.vehicleModel)
                      // Le véhicule CHOISI est propagé : sans lui, l'intervention
                      // repartait en texte libre et perdait le rattachement.
                      if (c.vehicleId) setField('vehicleId', c.vehicleId)
                      setShowClientSuggestions(false)
                      viderClients()
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

          {/* ── Bloc « pièces habituelles » RETIRÉ (GF-040) ────────────────────
              Il lisait `RepairTypePart`, une table qu'AUCUN code n'écrit : ni
              route, ni écran, ni jeu de démonstration, ni sauvegarde. Le bloc
              était donc structurellement vide sur toute installation, et
              relançait une requête à chaque changement de type d'intervention
              pour un résultat toujours nul. La route reste en place et sa
              lecture est correcte : c'est le côté ÉCRITURE qui n'existe pas.
              Rétablir la fonction demande un écran de paramétrage, pas ce
              bloc. */}

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

          {/* Pièces posées — seule voie de saisie de `JobPart`, dont dépendent la
              rentabilité, la prévision de stock et l'historique du véhicule.
              L'intervention doit exister : le stock est engagé sur SON identité. */}
          {jobModalMode === 'edit' && editingJob && (
            <JobPartsSection jobId={editingJob.id} />
          )}
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
          onWorkOrder={() => setIsWorkOrderOpen(true)}
          onQuote={() => setInvoiceMode('quote')}
          onInvoice={() => setInvoiceMode('invoice')}
          onCancel={closeModal}
          onSubmit={handleSubmit}
        />
      </div>
    </div>

    {/* ── L'ORDRE DE RÉPARATION redevient atteignable (GF-040) ────────────────
        Le module était complet — routes, signature du client, impression,
        préfixe de numérotation réglable dans les paramètres — mais
        `WorkOrderModal` n'était importé nulle part : aucun écran ne pouvait
        l'ouvrir. Le catalogue de main-d'œuvre, dont il est le seul
        consommateur, était par ricochet une saisie sans débouché. */}
    {isWorkOrderOpen && editingJob && (
      <WorkOrderModal
        jobId={editingJob.id}
        prefill={{
          clientName: editingJob.customerName,
          vehicleModel: editingJob.vehicleModel,
          licensePlate: editingJob.licensePlate ?? undefined,
          mechanicId: editingJob.mechanicId ?? undefined,
        }}
        onClose={() => setIsWorkOrderOpen(false)}
      />
    )}

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
        vehicleId={editingJob.vehicleId ?? undefined}
        // Affichage IMMÉDIAT depuis l'intervention ; la modale complète ensuite
        // avec les relations réelles (fiche véhicule, kilométrage) résolues par
        // /api/inspections/prefill.
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
