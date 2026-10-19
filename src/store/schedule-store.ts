'use client'

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { Job, Mechanic, Suggestion } from '@/lib/types'
import { runAIEngine } from '@/lib/ai-engine'
import { getTodayString } from '@/lib/utils'
import { bornesAtelier } from '@/lib/planning/horaires'
import toast from 'react-hot-toast'

/**
 * Réglages du garage nécessaires au PLANNING.
 *
 * Les horaires d'atelier étaient enregistrés et jamais lus : la grille du
 * planning naissait des constantes `WORKSHOP_START_HOUR` / `WORKSHOP_END_HOUR`,
 * évaluées au chargement du module. Un garage ouvrant à 7 h voyait donc
 * toujours 8 h – 18 h, et ses interventions matinales tombaient hors grille
 * (GF-021).
 */
export interface HorairesAtelier {
  workshopStartHour: number
  workshopEndHour: number
  workshopStartMinute: number
  workshopEndMinute: number
}

interface ScheduleState {
  jobs:          Job[]
  mechanics:     Mechanic[]
  /** `null` tant que les réglages ne sont pas chargés (repli 8 h – 18 h). */
  horaires:      HorairesAtelier | null
  /** Module « véhicules de prêt » activé par le garage (`loanerEnabled`). */
  loanerActif:   boolean
  suggestions:   Suggestion[]
  selectedDate:  string
  selectedJobId: string | null
  isJobModalOpen: boolean
  isDashboardOpen: boolean
  jobModalMode:  'create' | 'edit'
  jobModalPreset: Partial<Job> | null
  isLoading:     boolean
  error:         string | null

  /**
   * Incremented every time billing data changes (invoice paid, quote converted…).
   * Dashboard and any stats consumer watches this to know when to re-fetch.
   */
  statsVersion: number

  // Data fetching
  fetchData:      (date?: string) => Promise<void>
  fetchMechanics: () => Promise<void>
  /** Charge les horaires d'atelier ; sans effet en cas d'échec (repli). */
  fetchHoraires:  () => Promise<void>
  /** Full hard reload: mechanics + jobs for current date + AI */
  refreshAll:     () => Promise<void>
  /** Notify all stat consumers that billing data changed */
  invalidateStats: () => void

  // Job mutations (optimistic + API)
  // `updateJob` et `moveJob` rendent le VERDICT du serveur : l'écran ne doit
  // pas annoncer un déplacement ou une modification que la base a refusés.
  addJob:                (job: Omit<Job, 'id' | 'createdAt'>) => Promise<void>
  updateJob:             (id: string, updates: Partial<Job>)  => Promise<boolean>
  deleteJob:             (id: string)                         => Promise<void>
  updateJobDurationLocal:(id: string, duration: number)       => void
  moveJob:               (jobId: string, mechanicId: string, startTime: string) => Promise<boolean>

  // Mechanic mutations
  toggleMechanicAbsence:      (mechanicId: string) => Promise<void>
  redistributeAbsentMechanic: (mechanicId: string) => void

  // Suggestions
  dismissSuggestion: (id: string) => void
  acceptSuggestion:  (id: string) => void
  runAI: () => void

  // UI
  isStockPanelOpen: boolean
  toggleStockPanel: () => void
  openCreateModal:  (preset?: Partial<Job>) => void
  openEditModal:    (jobId: string) => void
  closeModal:       () => void
  setSelectedDate:  (date: string) => void
  toggleDashboard:  () => void
}

// ── API helper ─────────────────────────────────────────────────────────────
async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  return res.json()
}

// ── Store ──────────────────────────────────────────────────────────────────
export const useScheduleStore = create<ScheduleState>()(
  immer((set, get) => ({
    jobs:           [],
    mechanics:      [],
    horaires:       null,
    loanerActif:    true,
    suggestions:    [],
    selectedDate:   getTodayString(),
    selectedJobId:  null,
    isJobModalOpen: false,
    isDashboardOpen:false,
    isStockPanelOpen: false,
    jobModalMode:   'create',
    jobModalPreset: null,
    isLoading:      false,
    error:          null,
    statsVersion:   0,   // ← billing sync counter

    // ── Stat invalidation ──────────────────────────────────────────────────
    invalidateStats: () => {
      set(s => { s.statsVersion += 1 })
    },

    // ── Full refresh ───────────────────────────────────────────────────────
    refreshAll: async () => {
      const { selectedDate } = get()
      set(s => { s.isLoading = true; s.error = null })
      try {
        const [mechanics, jobsResult] = await Promise.all([
          // ── Les ARCHIVÉS sont chargés eux aussi (GF-040) ──────────────────
          // Le planning répartit les interventions par mécanicien connu :
          // celles d'un mécanicien absent de la liste ne trouvaient plus de
          // colonne et disparaissaient purement de l'écran. Archiver quelqu'un
          // effaçait donc visuellement son travail. Les colonnes des archivés
          // n'apparaissent que s'il leur reste des interventions — la
          // pagination des colonnes s'en charge.
          apiFetch('/api/mechanics?includeArchived=1'),
          apiFetch(`/api/jobs?date=${selectedDate}`),
          // Les horaires bornent la GRILLE : les recharger avec le reste évite
          // qu'un changement de réglage ne prenne effet qu'au prochain démarrage.
          get().fetchHoraires(),
        ])
        const jobs = jobsResult?.data ?? jobsResult ?? []
        set(s => {
          s.mechanics = mechanics
          s.jobs      = jobs
          s.isLoading = false
          s.statsVersion += 1   // also refresh dashboard
        })
        get().runAI()
        toast.success('Données actualisées ✓', { duration: 1500 })
      } catch (e: any) {
        set(s => { s.isLoading = false; s.error = e.message })
        toast.error('Erreur de chargement')
      }
    },

    // ── Fetch jobs for a given date ────────────────────────────────────────
    fetchData: async (date) => {
      const d = date ?? get().selectedDate
      set(s => { s.isLoading = true; s.error = null })
      try {
        const jobsResult = await apiFetch(`/api/jobs?date=${d}`)
        const jobs = jobsResult?.data ?? jobsResult ?? []
        set(s => {
          s.jobs        = jobs
          s.isLoading   = false
          s.selectedDate = d
        })
        get().runAI()
      } catch (e: any) {
        set(s => { s.isLoading = false; s.error = e.message })
      }
    },

    fetchMechanics: async () => {
      try {
        const mechanics = await apiFetch('/api/mechanics?includeArchived=1')
        set(s => { s.mechanics = mechanics })
      } catch (e: any) {
        set(s => { s.error = e.message })
      }
    },

    fetchHoraires: async () => {
      // Échec silencieux ASSUMÉ : le planning doit s'afficher même si les
      // réglages sont indisponibles. Il retombe alors sur 8 h – 18 h, ce qu'il
      // faisait de toute façon avant — mais cette fois par défaut, pas par
      // construction.
      try {
        const g = await apiFetch('/api/garages')
        if (!g) return
        set(s => {
          s.horaires = {
            workshopStartHour:   Number(g.workshopStartHour ?? 8),
            workshopEndHour:     Number(g.workshopEndHour ?? 18),
            workshopStartMinute: Number(g.workshopStartMinute ?? 0),
            workshopEndMinute:   Number(g.workshopEndMinute ?? 0),
          }
          // `loanerEnabled` était validé, persisté… et n'avait aucun lecteur :
          // l'entrée « Véhicules de prêt » s'affichait quoi qu'ait décidé le
          // garage (GF-039). Le repli est `true` — un réglage indisponible ne
          // doit pas faire disparaître un module en cours d'utilisation.
          s.loanerActif = g.loanerEnabled !== false
        })
      } catch { /* repli sur les bornes par défaut */ }
    },

    // ── Job mutations ──────────────────────────────────────────────────────
    addJob: async (jobData) => {
      try {
        const job = await apiFetch('/api/jobs', {
          method: 'POST',
          body: JSON.stringify(jobData),
        })
        set(s => { s.jobs.push(job) })
        get().runAI()
        toast.success('Intervention planifiée !')
      } catch (e: any) {
        toast.error(e.message)
        throw e
      }
    },

    updateJob: async (id, updates) => {
      set(s => {
        const idx = s.jobs.findIndex(j => j.id === id)
        if (idx !== -1) Object.assign(s.jobs[idx], updates)
      })
      try {
        const updated = await apiFetch(`/api/jobs/${id}`, {
          method: 'PUT',
          body: JSON.stringify(updates),
        })
        set(s => {
          const idx = s.jobs.findIndex(j => j.id === id)
          if (idx !== -1) s.jobs[idx] = updated
        })
        get().runAI()
        // If status changed to completed → refresh stats
        if (updates.status === 'completed') get().invalidateStats()
        return true
      } catch (e: any) {
        get().fetchData()
        toast.error(e.message)
        // Verdict RENDU à l'appelant (GF-024) : sans lui, l'écran annonçait
        // « Intervention mise à jour » alors que le serveur avait refusé, et
        // l'utilisateur voyait la ligne revenir à sa place sans explication.
        // Un booléen plutôt qu'une exception : aucun appelant existant ne casse.
        return false
      }
    },

    deleteJob: async (id) => {
      set(s => {
        const idx = s.jobs.findIndex(j => j.id === id)
        if (idx !== -1) s.jobs[idx].status = 'cancelled'
      })
      try {
        await apiFetch(`/api/jobs/${id}`, { method: 'DELETE' })
        set(s => { s.jobs = s.jobs.filter(j => j.id !== id) })
        get().runAI()
        get().invalidateStats()
        toast.success('Intervention supprimée.')
      } catch (e: any) {
        get().fetchData()
        toast.error(e.message)
      }
    },

    updateJobDurationLocal: (id, duration) => {
      set(s => {
        const idx = s.jobs.findIndex(j => j.id === id)
        if (idx !== -1) s.jobs[idx].estimatedDuration = duration
      })
    },

    moveJob: async (jobId, mechanicId, startTime) => {
      set(s => {
        const idx = s.jobs.findIndex(j => j.id === jobId)
        if (idx !== -1) {
          s.jobs[idx].mechanicId = mechanicId
          s.jobs[idx].startTime  = startTime
        }
      })
      try {
        await apiFetch(`/api/jobs/${jobId}`, {
          method: 'PATCH',
          body: JSON.stringify({ mechanicId, startTime }),
        })
        get().runAI()
        return true
      } catch (e: any) {
        get().fetchData()
        toast.error(e.message)
        return false
      }
    },

    // ── Mechanic mutations ─────────────────────────────────────────────────
    toggleMechanicAbsence: async (mechanicId) => {
      const mechanic = get().mechanics.find(m => m.id === mechanicId)
      if (!mechanic) return
      const newValue = !mechanic.isAbsent
      set(s => {
        const idx = s.mechanics.findIndex(m => m.id === mechanicId)
        if (idx !== -1) s.mechanics[idx].isAbsent = newValue
      })
      try {
        await apiFetch(`/api/mechanics/${mechanicId}`, {
          method: 'PATCH',
          body: JSON.stringify({ isAbsent: newValue }),
        })
        get().runAI()
      } catch (e: any) {
        set(s => {
          const idx = s.mechanics.findIndex(m => m.id === mechanicId)
          if (idx !== -1) s.mechanics[idx].isAbsent = !newValue
        })
        toast.error(e.message)
      }
    },

    redistributeAbsentMechanic: (mechanicId) => {
      import('@/lib/ai-engine').then(async ({ redistributeAfterAbsence }) => {
        const { jobs, mechanics, horaires, selectedDate } = get()
        // La redistribution replace les interventions DANS les horaires du
        // garage : sans bornes, elle les repoussait dans une journée 8 h – 18 h
        // imaginaire, hors de la grille affichée.
        const updatedJobs = redistributeAfterAbsence(
          mechanicId, jobs, mechanics, selectedDate, bornesAtelier(horaires),
        )
        set(s => { s.jobs = updatedJobs })

        const aDeplacer = updatedJobs.filter(j => {
          const orig = jobs.find(o => o.id === j.id)
          return orig && (orig.mechanicId !== j.mechanicId || orig.startTime !== j.startTime)
        })

        // ── Les écritures ne partent plus à l'aveugle (GF-024) ───────────────
        // Le `forEach` d'origine lançait les PATCH sans les attendre et écrasait
        // chaque échec par `.catch(() => null)`. Le toast partait donc AVANT la
        // première réponse, et — contrairement à `moveJob` et `updateJob` — rien
        // ne rechargeait l'état : l'écran restait durablement faux, montrant une
        // redistribution qui n'avait pas eu lieu en base.
        const resultats = await Promise.allSettled(aDeplacer.map(j => apiFetch(`/api/jobs/${j.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ mechanicId: j.mechanicId, startTime: j.startTime }),
        })))

        if (resultats.some(r => r.status === 'rejected')) {
          await get().fetchData()
          toast.error('Certaines interventions n’ont pas pu être déplacées — la liste a été rechargée.')
          return
        }
        get().runAI()
        toast.success('Interventions redistribuées !')
      })
    },

    // ── Suggestions ────────────────────────────────────────────────────────
    dismissSuggestion: (id) => {
      set(s => {
        const idx = s.suggestions.findIndex(s => s.id === id)
        if (idx !== -1) s.suggestions[idx].dismissed = true
      })
    },

    acceptSuggestion: (id) => {
      const { suggestions } = get()
      const suggestion = suggestions.find(s => s.id === id)
      if (!suggestion) return

      if (suggestion.type === 'absence_impact' && suggestion.action?.targetMechanicId) {
        get().redistributeAbsentMechanic(suggestion.action.targetMechanicId)
      }
      if (suggestion.type === 'fill_slot' && suggestion.action?.targetMechanicId && suggestion.action?.targetTime) {
        get().openCreateModal({
          mechanicId: suggestion.action.targetMechanicId,
          startTime:  suggestion.action.targetTime,
          date:       get().selectedDate,
        })
      }
      if (suggestion.type === 'delay_warning' && suggestion.action?.jobId) {
        get().updateJob(suggestion.action.jobId, { status: 'delayed', delayMinutes: 30 })
      }
      set(s => {
        const idx = s.suggestions.findIndex(s => s.id === id)
        if (idx !== -1) s.suggestions[idx].dismissed = true
      })
    },

    runAI: () => {
      const { jobs, mechanics, horaires, selectedDate, suggestions } = get()
      const dismissed = new Set(suggestions.filter(s => s.dismissed).map(s => s.id))
      // Les suggestions parlent de créneaux libres et de surcharge : mesurées
      // sur une journée de 8 h à 18 h, elles annonçaient des trous inexistants
      // et manquaient la surcharge d'un atelier à l'amplitude plus courte.
      const next = runAIEngine({ jobs, mechanics, date: selectedDate, bornes: bornesAtelier(horaires) })
      set(s => { s.suggestions = next.filter(s => !dismissed.has(s.id)) })
    },

    // ── UI ─────────────────────────────────────────────────────────────────
    openCreateModal: (preset) => {
      set(s => {
        s.isJobModalOpen  = true
        s.jobModalMode    = 'create'
        s.jobModalPreset  = preset ?? null
        s.selectedJobId   = null
      })
    },

    openEditModal: (jobId) => {
      set(s => {
        s.isJobModalOpen  = true
        s.jobModalMode    = 'edit'
        s.selectedJobId   = jobId
        s.jobModalPreset  = null
      })
    },

    closeModal: () => {
      set(s => {
        s.isJobModalOpen  = false
        s.selectedJobId   = null
        s.jobModalPreset  = null
      })
    },

    setSelectedDate: (date) => {
      set(s => { s.selectedDate = date })
      get().fetchData(date)
    },

    toggleDashboard: () => {
      set(s => { s.isDashboardOpen = !s.isDashboardOpen })
    },

    toggleStockPanel: () => {
      set(s => { s.isStockPanelOpen = !s.isStockPanelOpen })
    },
  }))
)
