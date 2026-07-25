'use client'

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { Job, Mechanic, Suggestion } from '@/lib/types'
import { runAIEngine } from '@/lib/ai-engine'
import { getTodayString } from '@/lib/utils'
import toast from 'react-hot-toast'

interface ScheduleState {
  jobs:          Job[]
  mechanics:     Mechanic[]
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
  /** Full hard reload: mechanics + jobs for current date + AI */
  refreshAll:     () => Promise<void>
  /** Notify all stat consumers that billing data changed */
  invalidateStats: () => void

  // Job mutations (optimistic + API)
  addJob:                (job: Omit<Job, 'id' | 'createdAt'>) => Promise<void>
  updateJob:             (id: string, updates: Partial<Job>)  => Promise<void>
  deleteJob:             (id: string)                         => Promise<void>
  updateJobDurationLocal:(id: string, duration: number)       => void
  moveJob:               (jobId: string, mechanicId: string, startTime: string) => Promise<void>

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
          apiFetch('/api/mechanics'),
          apiFetch(`/api/jobs?date=${selectedDate}`),
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
        const mechanics = await apiFetch('/api/mechanics')
        set(s => { s.mechanics = mechanics })
      } catch (e: any) {
        set(s => { s.error = e.message })
      }
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
      } catch (e: any) {
        get().fetchData()
        toast.error(e.message)
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
      } catch (e: any) {
        get().fetchData()
        toast.error(e.message)
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
      import('@/lib/ai-engine').then(({ redistributeAfterAbsence }) => {
        const { jobs, mechanics, selectedDate } = get()
        const updatedJobs = redistributeAfterAbsence(mechanicId, jobs, mechanics, selectedDate)
        set(s => { s.jobs = updatedJobs })
        updatedJobs
          .filter(j => {
            const orig = jobs.find(o => o.id === j.id)
            return orig && (orig.mechanicId !== j.mechanicId || orig.startTime !== j.startTime)
          })
          .forEach(j => {
            apiFetch(`/api/jobs/${j.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ mechanicId: j.mechanicId, startTime: j.startTime }),
            }).catch(() => null)
          })
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
      const { jobs, mechanics, selectedDate, suggestions } = get()
      const dismissed = new Set(suggestions.filter(s => s.dismissed).map(s => s.id))
      const next = runAIEngine({ jobs, mechanics, date: selectedDate })
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
