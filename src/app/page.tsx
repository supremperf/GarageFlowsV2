'use client'

import { useEffect, useRef, useState, memo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { format, addDays, subDays, parseISO } from 'date-fns'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useScheduleStore } from '@/store/schedule-store'
import Header from '@/components/Header'
import ScheduleBoard from '@/components/ScheduleBoard'
const WeekView = dynamic(() => import('@/components/WeekView'), { ssr: false })
import SuggestionPanel from '@/components/SuggestionPanel'
import JobModal from '@/components/JobModal'
const Dashboard = dynamic(() => import('@/components/Dashboard'), { ssr: false })
const StockPanel = dynamic(() => import('@/components/StockPanel'), { ssr: false })
const CompanySetup = dynamic(() => import('@/components/CompanySetup'), { ssr: false })
const SettingsModal = dynamic(() => import('@/components/SettingsModal'), { ssr: false })
const LanguageSelector = dynamic(() => import('@/components/LanguageSelector'), { ssr: false })
const ReceptionBoard = dynamic(() => import('@/components/ReceptionBoard'), { ssr: false })
const ReminderPanel = dynamic(() => import('@/components/ReminderPanel'), { ssr: false })
const BillingPanel = dynamic(() => import('@/components/BillingPanel'), { ssr: false })
const FinancialDashboard = dynamic(() => import('@/components/FinancialDashboard'), { ssr: false })
const LaborCatalogPanel = dynamic(() => import('@/components/LaborCatalogPanel'), { ssr: false })
const WarrantyPanel = dynamic(() => import('@/components/WarrantyPanel'), { ssr: false })
const LoanerPanel = dynamic(() => import('@/components/LoanerPanel'), { ssr: false })
const CopilotPanel = dynamic(() => import('@/components/CopilotPanel'), { ssr: false })
const OcrPanel = dynamic(() => import('@/components/OcrPanel'), { ssr: false })
const SuppliersPanel = dynamic(() => import('@/components/SuppliersPanel'), { ssr: false })
const ClientsPanel = dynamic(() => import('@/components/ClientsPanel'), { ssr: false })
const TicketsPanel = dynamic(() => import('@/components/TicketsPanel'), { ssr: false })
const AppointmentsPanel = dynamic(() => import('@/components/AppointmentsPanel'), { ssr: false })
// Fiche VÉHICULE : historique des interventions, devis et garanties d'un
// véhicule. Elle n'était atteignable que depuis la fenêtre d'intervention ; le
// tableau de bord doit pouvoir l'ouvrir depuis un rendez-vous (GF-DUR-054).
const VehicleHistoryModal = dynamic(() => import('@/components/VehicleHistoryModal'), { ssr: false })
const CatalogPanel = dynamic(() => import('@/components/CatalogPanel'), { ssr: false })
import LicenseRevokedOverlay from '@/components/LicenseRevokedOverlay'
const UpdateModal = dynamic(() => import('@/components/UpdateModal'), { ssr: false })
import MobileNav from '@/components/MobileNav'
import GfDrawer from '@/components/GfDrawer'
import { Loader2, Sparkles, RefreshCw } from 'lucide-react'
import { GarageFlowIcon } from '@/components/GarageFlowLogo'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { viderBrouillons } from '@/lib/ui/brouillon'

/** Réactivation survenue pendant le chargement initial : rien n'est chargé, on recharge. */
function recharger() {
  window.location.reload()
}

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
          <p className="text-slate-300 text-sm font-semibold">GarageFlows</p>
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
    fetchHoraires,
    // Le réglage `loanerEnabled` commande l'entrée de menu (GF-039). Le panneau
    // lui-même n'est PAS démonté : une réservation ouverte resterait sinon
    // inaccessible du jour où le garage décoche la case.
    loanerActif,
    runAI,
    isDashboardOpen,
    // Le tableau de bord s'ouvre et se ferme par le magasin d'état (bouton de la
    // barre d'outils, raccourci clavier) : la page unique s'y synchronise.
    toggleDashboard,
    isStockPanelOpen,
    toggleStockPanel,
    openCreateModal,
    closeModal,
    selectedDate,
    setSelectedDate,
    suggestions,
  } = useScheduleStore()

  const initialised   = useRef(false)
  const aiIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const [onboarding,           setOnboarding]           = useState<'loading' | 'needed' | 'done'>('loading')
  const [setupError,           setSetupError]           = useState<string | null>(null)
  const [view,                 setView]                 = useState<'day' | 'week'>('day')
  const [showLangPicker,       setShowLangPicker]       = useState(false)
  const [isAssistantOpen,      setIsAssistantOpen]      = useState(false)
  const [warrantyAlerts,       setWarrantyAlerts]       = useState(0)
  /** Fiche client à ouvrir directement dans la page « Clients ». */
  const [clientACibler,        setClientACibler]        = useState<string | null>(null)
  /**
   * Incrémenté à chaque écriture dans les clients : le menu déroulant de la
   * barre d'outils relit alors sa liste (voir `ClientPicker.refreshKey`).
   */
  const [clientsVersion,       setClientsVersion]       = useState(0)
  /** Rendez-vous à mettre en évidence dans le tableau de bord. */
  const [rdvACibler,           setRdvACibler]           = useState<string | null>(null)
  /**
   * Tiroir « Rendez-vous » (décisions détaillées). Ce n'est PAS une page : il
   * s'ouvre PAR-DESSUS le tableau de bord, qui reste visible derrière lui.
   * Il n'est atteignable que depuis le tableau de bord — l'entrée de barre
   * d'outils a été retirée, la fonction est demeurée entière.
   */
  const [isApptsOpen,          setIsApptsOpen]          = useState(false)
  /** Véhicule dont l'historique est affiché (fiche véhicule). */
  const [vehiculeCible,        setVehiculeCible]        = useState<string | null>(null)

  /**
   * ── UNE SEULE PAGE À L'ÉCRAN (GF-DUR-053) ───────────────────────────────────
   *
   * Chaque entrée de la barre d'outils ouvrait SA propre variable booléenne
   * (`isClientsOpen`, `isBillingOpen`, …). Rien ne les fermait les unes les
   * autres : ouvrir « Réception » puis « Clients » laissait DEUX pages plein
   * écran empilées, toutes deux en `fixed inset-0 z-50`. Le comptoir voyait
   * l'écran clignoter, ne savait plus quelle page il avait devant lui, et un
   * clic pouvait atterrir sur la page du dessous.
   *
   * Une seule variable remplace les seize booléens : `surface`. Ouvrir une page
   * ferme donc la précédente, par construction — il n'existe plus d'état dans
   * lequel deux pages cohabitent.
   *
   * Ce qui N'EST PAS une page garde son comportement : le planning, les
   * fenêtres de dialogue (intervention, inspection, mise à jour) et la fenêtre
   * de licence restent des MODALES par-dessus la page courante. Les fermer ne
   * touche pas à la page qui est dessous.
   */
  type Surface =
    | 'dashboard' | 'reception' | 'reminders' | 'billing' | 'finance'
    | 'labor' | 'warranty' | 'loaner' | 'copilot' | 'ocr'
    | 'suppliers' | 'clients' | 'tickets' | 'catalog'
    | 'settings'

  const [surface, setSurface] = useState<Surface | null>(null)

  /**
   * Brouillons conservés lors d'un CHANGEMENT de page, effacés lors d'une
   * FERMETURE volontaire (✕ ou Échap). Voir `src/lib/ui/brouillon.ts`.
   */
  const PREFIXE_BROUILLON: Partial<Record<Surface, string>> = {
    clients: 'clients:', tickets: 'tickets:', ocr: 'ocr:', copilot: 'copilot:',
    loaner: 'loaner:', warranty: 'warranty:', labor: 'labor:',
    reminders: 'reminders:', suppliers: 'suppliers:', billing: 'billing:',
  }

  /**
   * Ouvre une page — et ferme celle qui était affichée.
   *
   * Le tableau de bord est piloté par le store (`useScheduleStore`) parce que
   * la barre d'outils et le raccourci clavier l'ouvrent tous les deux ; on le
   * synchronise ici pour qu'il obéisse à la même règle que les autres.
   */
  const ouvrirPage = useCallback((cible: Surface) => {
    setSurface(cible)
    // Le tableau de bord appartient au store : c'est lui qui commande l'affichage.
    if (cible === 'dashboard') { if (!isDashboardOpen) toggleDashboard() }
    else if (isDashboardOpen) toggleDashboard()
    // Le volet « Stock » est un tiroir latéral : il n'a rien à faire par-dessus
    // une page plein écran. On le referme, et son état suit.
    if (isStockPanelOpen) toggleStockPanel()
  }, [isDashboardOpen, isStockPanelOpen, toggleDashboard, toggleStockPanel])

  /** Ferme la page courante (✕, Échap) — un abandon, donc brouillons effacés. */
  const fermerPage = useCallback(() => {
    setSurface((courante) => {
      const prefixe = courante ? PREFIXE_BROUILLON[courante] : undefined
      if (prefixe) viderBrouillons(prefixe)
      return null
    })
    if (isDashboardOpen) toggleDashboard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDashboardOpen, toggleDashboard])

  // Le tableau de bord peut aussi être ouvert ou fermé SANS passer par ici
  // (bouton de la barre d'outils, raccourci clavier, ✕ de son propre en-tête).
  // On recale `surface` sur son état réel, sinon la page suivante s'ouvrirait
  // en refermant un tableau de bord déjà fermé.
  useEffect(() => {
    setSurface((courante) => {
      if (isDashboardOpen) return 'dashboard'
      return courante === 'dashboard' ? null : courante
    })
  }, [isDashboardOpen])

  const activeSuggestionsCount = suggestions.filter(s => !s.dismissed).length

  // ── Global keyboard shortcuts ──────────────────────────────────────────────
  const goToPrevDay = useCallback(() => {
    setSelectedDate(format(subDays(parseISO(selectedDate), 1), 'yyyy-MM-dd'))
  }, [selectedDate, setSelectedDate])

  const goToNextDay = useCallback(() => {
    setSelectedDate(format(addDays(parseISO(selectedDate), 1), 'yyyy-MM-dd'))
  }, [selectedDate, setSelectedDate])

  // Copilot proposes an action, then opens its dedicated screen — it never
  // fires an underspecified write itself. The screen must disclose unavailable flows.
  const handleCopilotAction = useCallback((intent: string) => {
    switch (intent) {
      case 'create_appointment': openCreateModal(); break
      case 'create_quote':       ouvrirPage('billing'); break
      case 'order_parts':        ouvrirPage('suppliers'); break
      case 'send_reminder':      ouvrirPage('reminders'); break
      case 'generate_report':    ouvrirPage('finance'); break
    }
    // La page demandée REMPLACE l'assistant : `ouvrirPage` s'en charge. Le
    // fermer ici en plus ferait clignoter l'écran sans rien apporter.
  }, [openCreateModal, ouvrirPage])

  // OCR decode → open the create-job modal pre-filled with the decoded vehicle.
  const handleOcrVehicle = useCallback((preset: { licensePlate?: string; vehicleModel?: string }) => {
    // Le véhicule décodé part dans le formulaire d'intervention ; la page OCR
    // laisse place au PLANNING (la modale s'ouvre par-dessus).
    fermerPage()
    openCreateModal(preset)
  }, [fermerPage, openCreateModal])

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
      // Une seule page peut être ouverte : une seule instruction la referme.
      fermerPage()
      setIsAssistantOpen(false)
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

  /**
   * SENS MÉCANICIEN → POSTE (GF-DUR-041).
   *
   * Mesuré avant correction : un mécanicien démarre son intervention depuis la
   * PWA, la base enregistre `status=in_progress`, et l'écran du poste reste
   * inchangé — indéfiniment. Le rafraîchissement au retour de focus ne sert à
   * rien sur un écran d'atelier qui ne perd jamais le focus.
   *
   * On sonde une EMPREINTE (`/api/jobs/pulse`, deux agrégats, aucune donnée
   * métier) toutes les 10 s, et on ne recharge le planning que si elle change.
   * Coût en régime stable : 6 req/min, contre ~40 pour un sondage classique des
   * deux listes — ce qui, avec la limite de 120 req/min PAR IP partagée par tout
   * le garage, faisait la différence entre tenir et fabriquer des 429.
   *
   * En arrière-plan, aucune requête : `document.hidden` suspend la boucle, et
   * le retour au premier plan relance immédiatement.
   */
  const [syncCloud, setSyncCloud] = useState<'attente' | null>(null)

  useEffect(() => {
    if (status !== 'authenticated') return
    let vu: string | null = null
    let actif = true
    let minuteur: ReturnType<typeof setTimeout> | null = null

    const battre = async () => {
      if (!actif) return
      if (!document.hidden) {
        try {
          const r = await fetch(`/api/jobs/pulse?date=${encodeURIComponent(selectedDate)}`, { cache: 'no-store' })
          if (r.ok) {
            const { v, cloud } = await r.json()
            // Premier passage : on mémorise sans recharger (les données
            // viennent d'être chargées par le bootstrap).
            if (vu !== null && v !== vu) { fetchData(); fetchMechanics() }
            vu = v
            // ── L'état de la remontée cloud devient VISIBLE (GF-039) ────────
            // Une remontée non confirmée n'était que journalisée : rien ne
            // distinguait « le mécanicien a reçu l'affectation » de « le cloud
            // ne répond plus ». Le rattrapage a lieu au passage suivant, mais
            // tant qu'il n'a pas abouti, le comptoir doit le savoir.
            setSyncCloud(cloud === 'attente' ? 'attente' : null)
          }
        } catch { /* hors ligne : on retentera au prochain battement */ }
      }
      if (actif) minuteur = setTimeout(battre, 10_000)
    }

    minuteur = setTimeout(battre, 10_000)

    /**
     * Retour au premier plan : on REMPLACE la chaîne en cours, on n'en ajoute
     * pas une seconde.
     *
     * `battre()` se replanifie lui-même. Sans annuler le minuteur déjà en vol,
     * chaque bascule arrière-plan → premier plan engendrait une chaîne
     * indépendante et durable : vingt bascules dans la journée = vingt et une
     * chaînes, soit 126 requêtes/min au lieu de 6. Le poste finissait par
     * atteindre son propre quota (120 req/min, sujet partagé sous Electron) et
     * le garage recevait « Trop de requêtes » en enregistrant une intervention,
     * sans qu'aucune action humaine ne l'explique.
     */
    const auRetour = () => {
      if (document.hidden) return
      if (minuteur) { clearTimeout(minuteur); minuteur = null }
      battre()
    }
    document.addEventListener('visibilitychange', auRetour)

    return () => {
      actif = false
      if (minuteur) clearTimeout(minuteur)
      document.removeEventListener('visibilitychange', auRetour)
    }
  }, [status, selectedDate, fetchData, fetchMechanics])

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

    // Load mechanics first (faster perceived startup), then jobs + AI.
    // `alive` évite de créer l'intervalle APRÈS un démontage survenu pendant les
    // deux fetch de bootstrap (sinon runAI tournait indéfiniment sur un composant
    // démonté, jamais nettoyé).
    // Les horaires d'atelier bornent la grille du planning : sans ce chargement,
    // elle repart des constantes 8 h – 18 h et le réglage du garage reste sans
    // effet (GF-021). Non bloquant : la grille s'affiche avec le repli en
    // attendant la réponse.
    void fetchHoraires()

    let alive = true
    fetchMechanics().then(() => {
      fetchData().then(() => {
        if (!alive) return
        runAI()
        // Refresh AI analysis every 3 minutes (reduced frequency = less CPU)
        aiIntervalRef.current = setInterval(runAI, 3 * 60 * 1000)
      })
    })

    return () => {
      alive = false
      if (aiIntervalRef.current) clearInterval(aiIntervalRef.current)
    }
  }, [status, fetchData, fetchMechanics, fetchHoraires, runAI])

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

  // Show loader while session resolves or first data loads. L'overlay de
  // licence est monté dès ce stade : une licence suspendue, révoquée ou
  // expirée fait échouer le chargement initial (403), et la page restait sinon
  // sur « Chargement du planning… » sans jamais dire pourquoi.
  if (
    status === 'loading' ||
    (status === 'authenticated' && onboarding === 'loading')
  ) {
    return (
      <>
        <AppLoader />
        {status === 'authenticated' && <LicenseRevokedOverlay onReactivated={recharger} />}
      </>
    )
  }

  if (status !== 'authenticated') return null

  return (
    <div className="flex flex-col h-app overflow-hidden bg-[#0f1629]">
      <Header
        session={session}
        surfaceActive={surface}
        onOpenSettings={() => ouvrirPage('settings')}
        onOpenReception={() => ouvrirPage('reception')}
        onOpenReminders={() => ouvrirPage('reminders')}
        onOpenBilling={() => ouvrirPage('billing')}
        onOpenFinance={() => ouvrirPage('finance')}
        onOpenLaborCatalog={() => ouvrirPage('labor')}
        onOpenWarranties={() => ouvrirPage('warranty')}
        onOpenLoaner={loanerActif ? () => ouvrirPage('loaner') : undefined}
        onOpenCopilot={() => ouvrirPage('copilot')}
        onOpenOcr={() => ouvrirPage('ocr')}
        onOpenSuppliers={() => ouvrirPage('suppliers')}
        onOpenClients={() => ouvrirPage('clients')}
        onOpenClient={(id) => { setClientACibler(id); ouvrirPage('clients') }}
        onOpenTickets={() => ouvrirPage('tickets')}
        onOpenCatalog={() => ouvrirPage('catalog')}
        clientsVersion={clientsVersion}
        warrantyAlerts={warrantyAlerts}
      />

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <main className="gf-app-main flex-1 min-w-0 p-3 overflow-hidden flex flex-col">
          {/* ── Remontée cloud en attente : le comptoir doit le savoir (GF-039)
              Le planning reste pleinement utilisable — l'écriture locale est
              déjà faite. Ce qui est en attente, c'est sa propagation vers la
              PWA du mécanicien, rejouée au passage suivant. */}
          {syncCloud === 'attente' && (
            <div className="mb-2 flex-shrink-0 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300">
              Synchronisation cloud en attente — les affectations n’ont pas encore
              atteint l’espace mécanicien. Nouvel essai automatique.
            </div>
          )}

          {/* ── View toggle ─────────────────────────────────────────────────── */}
          {!isDashboardOpen && (
            <div className="flex items-center gap-1 mb-2 flex-shrink-0">
              <button
                onClick={() => setView('day')}
                className={
                  view === 'day'
                    ? 'px-3 py-1.5 rounded-md text-xs font-semibold bg-blue-600/20 text-blue-400 border border-blue-500/30'
                    : 'px-3 py-1.5 rounded-md text-xs font-semibold text-slate-500 hover:text-slate-300 hover:bg-white/[0.07] border border-transparent transition-colors'
                }
              >
                Jour
              </button>
              <button
                onClick={() => setView('week')}
                className={
                  view === 'week'
                    ? 'px-3 py-1.5 rounded-md text-xs font-semibold bg-blue-600/20 text-blue-400 border border-blue-500/30'
                    : 'px-3 py-1.5 rounded-md text-xs font-semibold text-slate-500 hover:text-slate-300 hover:bg-white/[0.07] border border-transparent transition-colors'
                }
              >
                Semaine
              </button>
            </div>
          )}
          {view === 'day' ? <ScheduleBoard /> : <WeekView />}
        </main>
        {/* Assistant IA : colonne permanente à partir de md ; en drawer en dessous. */}
        <aside className="hidden md:flex md:flex-col w-72 lg:w-80 flex-shrink-0 p-3 pl-0 min-h-0 overflow-hidden">
          <SuggestionPanel />
        </aside>
      </div>

      {/* ── Navigation mobile (barre inférieure + menu « Plus ») ────────────── */}
      <MobileNav
        onNewJob={() => openCreateModal()}
        onOpenAssistant={() => setIsAssistantOpen(true)}
        onOpenReception={() => ouvrirPage('reception')}
        onOpenReminders={() => ouvrirPage('reminders')}
        onOpenBilling={() => ouvrirPage('billing')}
        onOpenFinance={() => ouvrirPage('finance')}
        onOpenLaborCatalog={() => ouvrirPage('labor')}
        onOpenWarranties={() => ouvrirPage('warranty')}
        onOpenLoaner={loanerActif ? () => ouvrirPage('loaner') : undefined}
        onOpenCopilot={() => ouvrirPage('copilot')}
        onOpenOcr={() => ouvrirPage('ocr')}
        onOpenSuppliers={() => ouvrirPage('suppliers')}
        onOpenClients={() => ouvrirPage('clients')}
        onOpenTickets={() => ouvrirPage('tickets')}
        onOpenCatalog={() => ouvrirPage('catalog')}
        onOpenSettings={() => ouvrirPage('settings')}
        warrantyAlerts={warrantyAlerts}
        assistantCount={activeSuggestionsCount}
      />

      {/* Assistant IA — bottom-sheet mobile (sous md) */}
      <GfDrawer
        open={isAssistantOpen}
        onClose={() => setIsAssistantOpen(false)}
        side="bottom"
        heightClass="max-h-[88dvh]"
        bodyClassName="p-3 pb-safe-3"
        ariaLabel="Assistant IA"
        title={<span className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-purple-400" />Assistant IA{activeSuggestionsCount > 0 && <span className="bg-purple-500/20 text-purple-400 text-xs font-bold px-2 py-0.5 rounded-full">{activeSuggestionsCount}</span>}</span>}
        headerRight={
          <button
            onClick={() => runAI()}
            aria-label="Analyser le planning"
            className="gf-touch flex items-center justify-center w-9 h-9 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/[0.08] transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        }
      >
        <SuggestionPanel embedded />
      </GfDrawer>

      {/* ── Modals & panels (lazy rendered) ─────────────────────────────────── */}
      <JobModal />

      {/*
        ── Pages ─────────────────────────────────────────────────────────────
        `surface` ne contient QU'UNE valeur : au plus une page est montée, donc
        aucune ne peut recouvrir une autre. Le stock reste une page à part
        (`isStockPanelOpen`), piloté par le magasin d'état — il se ferme dès
        qu'une page s'ouvre, pour la même raison.
      */}
      {surface === 'dashboard'    && (
        <Dashboard
          onOpenClient={(id) => { setClientACibler(id); ouvrirPage('clients') }}
          onOpenVehicle={(id) => setVehiculeCible(id)}
          onOpenAppointments={() => setIsApptsOpen(true)}
          rdvACibler={rdvACibler}
        />
      )}
      {surface === 'reception'    && <ReceptionBoard     onClose={fermerPage} />}
      {surface === 'reminders'    && <ReminderPanel      onClose={fermerPage} />}
      {surface === 'billing'      && <BillingPanel       onClose={fermerPage} />}
      {surface === 'finance'      && <FinancialDashboard onClose={fermerPage} />}
      {surface === 'labor'        && <LaborCatalogPanel  onClose={fermerPage} />}
      {surface === 'warranty'     && <WarrantyPanel      onClose={fermerPage} />}
      {surface === 'loaner'       && <LoanerPanel        onClose={fermerPage} />}
      {surface === 'copilot'      && <CopilotPanel       onClose={fermerPage} onAction={handleCopilotAction} />}
      {surface === 'ocr'          && <OcrPanel           onClose={fermerPage} onUseVehicle={handleOcrVehicle} />}
      {surface === 'suppliers'    && <SuppliersPanel     onClose={fermerPage} />}
      {surface === 'clients'      && (
        <ClientsPanel
          onClose={fermerPage}
          initialClientId={clientACibler}
          onClientsChanged={() => setClientsVersion(v => v + 1)}
        />
      )}
      {surface === 'tickets'      && <TicketsPanel       onClose={fermerPage} />}
      {surface === 'catalog'      && <CatalogPanel       onClose={fermerPage} />}
      {surface === 'settings'     && <SettingsModal      onClose={fermerPage} />}
      {/* Le volet « Stock » est fermé par `ouvrirPage` : il ne peut donc pas
          cohabiter avec une page plein écran (`z-40` sous un `z-50`). */}
      {isStockPanelOpen && <StockPanel onClose={toggleStockPanel} />}

      {/*
        Tiroir des rendez-vous : décisions détaillées (confirmer, terminer,
        annuler, consulter les demandes en attente), ouvert depuis le tableau de
        bord. Il se ferme aussi lors d'un changement de page, pour ne jamais
        survivre par-dessus un autre écran.
      */}
      {isApptsOpen && surface === 'dashboard' && (
        <AppointmentsPanel onClose={() => setIsApptsOpen(false)} />
      )}

      {/* Fiche véhicule — historique complet, ouvert depuis un rendez-vous. */}
      {vehiculeCible && (
        <VehicleHistoryModal vehicleId={vehiculeCible} onClose={() => setVehiculeCible(null)} />
      )}

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

      {/* Fenêtre de mise à jour automatique (démarrage + toutes les heures) */}
      <UpdateModal />
    </div>
  )
}
