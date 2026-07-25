'use client'

import { useEffect, useRef, useState, memo, useCallback } from 'react'
import { format, addDays, subDays, parseISO } from 'date-fns'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useScheduleStore } from '@/store/schedule-store'
import Header from '@/components/Header'
import ScheduleBoard from '@/components/ScheduleBoard'
import WeekView from '@/components/WeekView'
import SuggestionPanel from '@/components/SuggestionPanel'
import JobModal from '@/components/JobModal'
import Dashboard from '@/components/Dashboard'
import StockPanel from '@/components/StockPanel'
import CompanySetup from '@/components/CompanySetup'
import SettingsModal from '@/components/SettingsModal'
import LanguageSelector from '@/components/LanguageSelector'
import ReceptionBoard from '@/components/ReceptionBoard'
import ReminderPanel from '@/components/ReminderPanel'
import BillingPanel from '@/components/BillingPanel'
import FinancialDashboard from '@/components/FinancialDashboard'
import LaborCatalogPanel from '@/components/LaborCatalogPanel'
import WarrantyPanel from '@/components/WarrantyPanel'
import LoanerPanel from '@/components/LoanerPanel'
import LicenseRevokedOverlay from '@/components/LicenseRevokedOverlay'
import { Loader2 } from 'lucide-react'
import { GarageFlowIcon } from '@/components/GarageFlowLogo'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'

// ── Splash-loader shown while session + data load ─────────────────────────────
const AppLoader = memo(function AppLoader() {
  return (
    <div className="min-h-screen bg-[#0f1629] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="w-14 h-14 bg-gradient-to-br from-blue-600 to-blue-800 rounded-2xl flex items-center justify-center shadow-xl shadow-blue-600/30">
            <GarageFlowIcon size={32} />
          </div>
          {/* Pulsing ring */}
          <div className="absolute inset-0 rounded-2xl ring-2 ring-blue-500/30 animate-ping" />
        </div>
        <div className="text-center">
          <p className="text-slate-300 text-sm font-semibold">GarageFlow</p>
          <p className="text-slate-600 text-xs mt-0.5">Chargement du planning…</p>
        </div>
        <Loader2 className="w-4 h-4 animate-spin text-blue-500/60" />
      </div>
    </div>
  )
})

export default function Home() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const {
    fetchData,
    fetchMechanics,
    runAI,
    isDashboardOpen,
    isStockPanelOpen,
    toggleStockPanel,
    openCreateModal,
    closeModal,
    selectedDate,
    setSelectedDate,
  } = useScheduleStore()

  const initialised   = useRef(false)
  const aiIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const [onboarding,           setOnboarding]           = useState<'loading' | 'needed' | 'done'>('loading')
  const [setupError,           setSetupError]           = useState<string | null>(null)
  const [view,                 setView]                 = useState<'day' | 'week'>('day')
  const [isSettingsOpen,       setIsSettingsOpen]       = useState(false)
  const [showLangPicker,       setShowLangPicker]       = useState(false)
  const [isReceptionBoardOpen, setIsReceptionBoardOpen] = useState(false)
  const [isReminderPanelOpen,  setIsReminderPanelOpen]  = useState(false)
  const [isBillingOpen,        setIsBillingOpen]        = useState(false)
  const [isFinanceOpen,        setIsFinanceOpen]        = useState(false)
  const [isLaborCatalogOpen,   setIsLaborCatalogOpen]   = useState(false)
  const [isWarrantyPanelOpen,  setIsWarrantyPanelOpen]  = useState(false)
  const [isLoanerPanelOpen,    setIsLoanerPanelOpen]    = useState(false)
  const [warrantyAlerts,       setWarrantyAlerts]       = useState(0)

  // ── Global keyboard shortcuts ──────────────────────────────────────────────
  const goToPrevDay = useCallback(() => {
    setSelectedDate(format(subDays(parseISO(selectedDate), 1), 'yyyy-MM-dd'))
  }, [selectedDate, setSelectedDate])

  const goToNextDay = useCallback(() => {
    setSelectedDate(format(addDays(parseISO(selectedDate), 1), 'yyyy-MM-dd'))
  }, [selectedDate, setSelectedDate])

  useKeyboardShortcuts({
    onNewJob:  () => openCreateModal(),
    // F5 : rafraîchit TOUT le logiciel (rechargement complet)
    onRefresh: () => { window.location.reload() },
    onSearch:  () => {
      const searchInput = document.querySelector<HTMLInputElement>('input[type="search"], input[placeholder*="earch"], input[placeholder*="echerche"]')
      searchInput?.focus()
    },
    onClose:   () => {
      closeModal()
      setIsSettingsOpen(false)
      setIsReceptionBoardOpen(false)
      setIsReminderPanelOpen(false)
      setIsBillingOpen(false)
      setIsLaborCatalogOpen(false)
      setIsWarrantyPanelOpen(false)
      setIsLoanerPanelOpen(false)
      if (isStockPanelOpen) toggleStockPanel()
    },
    onSave:    () => { /* forms handle their own Ctrl+S */ },
    onPrevDay: goToPrevDay,
    onNextDay:  goToNextDay,
  })

  // Live updates: refetch jobs when tab regains focus (max once per 30s)
  useEffect(() => {
    if (status !== 'authenticated') return
    let lastFetch = Date.now()
    function onVisibility() {
      if (document.visibilityState === 'visible' && Date.now() - lastFetch > 30_000) {
        lastFetch = Date.now()
        fetchData()
        fetchMechanics()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [status, fetchData, fetchMechanics])

  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  // One-time data bootstrap
  useEffect(() => {
    if (status !== 'authenticated' || initialised.current) return
    initialised.current = true

    // Check onboarding — if backend is broken, show setup instructions
    fetch('/api/garages')
      .then(async r => {
        if (r.status === 500 || r.status === 503) {
          // Backend crash — check health endpoint for details
          const h = await fetch('/api/health').then(hr => hr.json()).catch(() => null)
          if (h && !h.ok) {
            setSetupError(h.fix ?? 'Erreur de configuration backend.')
            setOnboarding('done')
            return null
          }
        }
        return r.ok ? r.json() : null
      })
      .then(data => {
        if (!data) return
        if (!data.onboardingComplete) {
          if (typeof window !== 'undefined' && !localStorage.getItem('gf_lang')) {
            setShowLangPicker(true)
          }
          setOnboarding('needed')
        } else {
          setOnboarding('done')
        }
      })
      .catch(() => setOnboarding('done'))

    // Fetch warranty alerts count
    fetch('/api/warranties/alerts')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.totalAlerts) setWarrantyAlerts(data.totalAlerts) })
      .catch(() => {})

    // Load mechanics first (faster perceived startup), then jobs + AI
    fetchMechanics().then(() => {
      fetchData().then(() => {
        runAI()
        // Refresh AI analysis every 3 minutes (reduced frequency = less CPU)
        aiIntervalRef.current = setInterval(runAI, 3 * 60 * 1000)
      })
    })

    return () => {
      if (aiIntervalRef.current) clearInterval(aiIntervalRef.current)
    }
  }, [status, fetchData, fetchMechanics, runAI])

  // Backend setup error — show clear instructions instead of blue screen
  if (setupError) {
    return (
      <div className="min-h-screen bg-[#0f1629] flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-[#111827] border border-red-500/30 rounded-2xl p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center text-red-400 text-xl">⚠</div>
            <div>
              <h1 className="text-white font-bold text-lg">Configuration manquante</h1>
              <p className="text-slate-400 text-sm">Le backend ne peut pas démarrer</p>
            </div>
          </div>
          <pre className="bg-black/40 rounded-xl p-4 text-emerald-400 text-xs font-mono whitespace-pre-wrap border border-white/[0.07] mb-6">
            {setupError}
          </pre>
          <ol className="text-slate-300 text-sm space-y-2 list-decimal list-inside mb-6">
            <li>Créez <code className="text-blue-400 bg-blue-500/10 px-1 rounded">.env</code> à la racine du projet (voir ci-dessus)</li>
            <li>Lancez <code className="text-blue-400 bg-blue-500/10 px-1 rounded">npx prisma db push</code></li>
            <li>Relancez <code className="text-blue-400 bg-blue-500/10 px-1 rounded">npm run dev</code></li>
          </ol>
          <button
            onClick={() => window.location.reload()}
            className="w-full py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
          >
            Réessayer
          </button>
        </div>
      </div>
    )
  }

  // Show loader while session resolves or first data loads
  if (
    status === 'loading' ||
    (status === 'authenticated' && onboarding === 'loading')
  ) {
    return <AppLoader />
  }

  if (status !== 'authenticated') return null

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#0f1629]">
      <Header
        session={session}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenReception={() => setIsReceptionBoardOpen(true)}
        onOpenReminders={() => setIsReminderPanelOpen(true)}
        onOpenBilling={() => setIsBillingOpen(true)}
        onOpenFinance={() => setIsFinanceOpen(true)}
        onOpenLaborCatalog={() => setIsLaborCatalogOpen(true)}
        onOpenWarranties={() => setIsWarrantyPanelOpen(true)}
        onOpenLoaner={() => setIsLoanerPanelOpen(true)}
        warrantyAlerts={warrantyAlerts}
      />

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <main className="flex-1 min-w-0 p-3 overflow-hidden flex flex-col">
          {/* ── View toggle ─────────────────────────────────────────────────── */}
          {!isDashboardOpen && (
            <div className="flex items-center gap-1 mb-2 flex-shrink-0">
              <button
                onClick={() => setView('day')}
                className={
                  view === 'day'
                    ? 'px-3 py-1 rounded-md text-xs font-semibold bg-blue-600/20 text-blue-400 border border-blue-500/30'
                    : 'px-3 py-1 rounded-md text-xs font-semibold text-slate-500 hover:text-slate-300 hover:bg-white/[0.07] border border-transparent transition-colors'
                }
              >
                Jour
              </button>
              <button
                onClick={() => setView('week')}
                className={
                  view === 'week'
                    ? 'px-3 py-1 rounded-md text-xs font-semibold bg-blue-600/20 text-blue-400 border border-blue-500/30'
                    : 'px-3 py-1 rounded-md text-xs font-semibold text-slate-500 hover:text-slate-300 hover:bg-white/[0.07] border border-transparent transition-colors'
                }
              >
                Semaine
              </button>
            </div>
          )}
          {view === 'day' ? <ScheduleBoard /> : <WeekView />}
        </main>
        <aside className="w-72 flex-shrink-0 p-3 pl-0 flex flex-col min-h-0 overflow-hidden">
          <SuggestionPanel />
        </aside>
      </div>

      {/* ── Modals & panels (lazy rendered) ─────────────────────────────────── */}
      <JobModal />

      {isDashboardOpen        && <Dashboard />}
      {isStockPanelOpen       && <StockPanel     onClose={toggleStockPanel} />}
      {isReceptionBoardOpen   && <ReceptionBoard onClose={() => setIsReceptionBoardOpen(false)} />}
      {isReminderPanelOpen    && <ReminderPanel  onClose={() => setIsReminderPanelOpen(false)} />}
      {isBillingOpen          && <BillingPanel         onClose={() => setIsBillingOpen(false)} />}
      {isFinanceOpen          && <FinancialDashboard   onClose={() => setIsFinanceOpen(false)} />}
      {isLaborCatalogOpen     && <LaborCatalogPanel     onClose={() => setIsLaborCatalogOpen(false)} />}
      {isWarrantyPanelOpen    && <WarrantyPanel         onClose={() => setIsWarrantyPanelOpen(false)} />}
      {isLoanerPanelOpen      && <LoanerPanel           onClose={() => setIsLoanerPanelOpen(false)} />}
      {isSettingsOpen         && <SettingsModal        onClose={() => setIsSettingsOpen(false)} />}

      {/* ── First-launch onboarding ──────────────────────────────────────────── */}
      {showLangPicker && (
        <LanguageSelector mode="modal" onDone={() => setShowLangPicker(false)} />
      )}
      {onboarding === 'needed' && !showLangPicker && (
        <CompanySetup
          onComplete={() => setOnboarding('done')}
          onSkip={() => {
            // Mark onboarding done so it won't show on next launch
            fetch('/api/garages', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ onboardingComplete: true }),
            }).catch(() => {})
            setOnboarding('done')
          }}
        />
      )}

      {/* License revocation overlay — shown when Electron sends license:revoked */}
      <LicenseRevokedOverlay />
    </div>
  )
}
