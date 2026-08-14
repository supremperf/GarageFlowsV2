'use client'

import { Session } from 'next-auth'
import { signOut } from 'next-auth/react'
import { useScheduleStore } from '@/store/schedule-store'
import { format, addDays, subDays, isToday, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  BarChart3,
  BarChart2,
  RefreshCw,
  CalendarDays,
  LogOut,
  Building2,
  ChevronDown,
  Shield,
  Package,
  Settings,
  ClipboardList,
  Bell,
  FileText,
  Sun,
  Moon,
  Wrench,
  BookOpen,
  ShieldCheck,
  Car,
  KeyRound,
  Sparkles,
  ScanLine,
  Truck,
  Users,
  Boxes,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState, useRef, useEffect, useCallback } from 'react'
import LanguageSelector from '@/components/LanguageSelector'
import { GarageFlowIcon } from '@/components/GarageFlowLogo'
import { useTranslation } from '@/lib/i18n'
import WindowControls from '@/components/WindowControls'
import LicenseChangeModal from '@/components/LicenseChangeModal'

const ROLE_COLORS: Record<string, string> = {
  OWNER:        'text-amber-400 bg-amber-500/20',
  MANAGER:      'text-blue-400 bg-blue-500/20',
  RECEPTIONIST: 'text-emerald-400 bg-emerald-500/20',
}

// ── Reusable toolbar button ───────────────────────────────────────────────────
function ToolBtn({
  onClick,
  active,
  activeClass,
  icon: Icon,
  label,
  badge,
  title,
  variant = 'default',
}: {
  onClick: () => void
  active?: boolean
  activeClass?: string
  icon: React.ElementType
  label?: string
  badge?: number
  title?: string
  variant?: 'default' | 'primary' | 'finance'
}) {
  const base = 'relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all duration-150 whitespace-nowrap'
  const styles = {
    default:  active
      ? cn(base, activeClass ?? 'bg-blue-600/20 text-blue-400 border border-blue-500/30')
      : cn(base, 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.07] border border-transparent'),
    primary:  cn(base, 'bg-blue-600 text-white hover:bg-blue-500 shadow-md shadow-blue-600/25 border border-transparent'),
    finance:  cn(base, 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/30'),
  }

  return (
    <button onClick={onClick} className={styles[variant]} title={title}>
      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
      {label && <span className="hidden lg:inline">{label}</span>}
      {badge && badge > 0 ? (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 animate-pulse">
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </button>
  )
}

// ── Section divider ───────────────────────────────────────────────────────────
function Sep() {
  return <div className="w-px h-5 bg-white/[0.08] mx-1.5 flex-shrink-0" />
}

// ── Section group wrapper ─────────────────────────────────────────────────────
function SectionGroup({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-0', className)}>
      <span className="text-[8px] text-slate-500 font-bold tracking-[0.15em] uppercase leading-none mb-1">
        {label}
      </span>
      <div className="flex items-center gap-1">
        {children}
      </div>
    </div>
  )
}

interface HeaderProps {
  session: Session | null
  onOpenSettings?:      () => void
  onOpenReception?:     () => void
  onOpenReminders?:     () => void
  onOpenBilling?:       () => void
  onOpenFinance?:       () => void
  onOpenLaborCatalog?:  () => void
  onOpenWarranties?:    () => void
  onOpenLoaner?:        () => void
  onOpenCopilot?:       () => void
  onOpenOcr?:           () => void
  onOpenSuppliers?:     () => void
  onOpenClients?:       () => void
  onOpenCatalog?:       () => void
  warrantyAlerts?:      number
}

export default function Header({
  session,
  onOpenSettings,
  onOpenReception,
  onOpenReminders,
  onOpenBilling,
  onOpenFinance,
  onOpenLaborCatalog,
  onOpenWarranties,
  onOpenLoaner,
  onOpenCopilot,
  onOpenOcr,
  onOpenSuppliers,
  onOpenClients,
  onOpenCatalog,
  warrantyAlerts = 0,
}: HeaderProps) {
  const {
    selectedDate,
    setSelectedDate,
    openCreateModal,
    toggleDashboard,
    isDashboardOpen,
    suggestions,
    jobs,
    mechanics,
    isLoading,
    isStockPanelOpen,
    toggleStockPanel,
    refreshAll,
  } = useScheduleStore()

  const { t, theme, setTheme } = useTranslation()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [showLicenseModal, setShowLicenseModal] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [stockAlertCount, setStockAlertCount] = useState(0)
  const [garageLogo, setGarageLogo] = useState<string | null>(null)
  // Le logo du garage peut échouer (fichier supprimé du disque, base restaurée
  // sur un autre poste…). On bascule alors sur l'icône GarageFlows : la zone de
  // marque ne doit JAMAIS afficher une image cassée. La cause racine du 404
  // (logoPath non autorisé par /api/photos) est corrigée côté serveur.
  const [logoFailed, setLogoFailed] = useState(false)

  // Fetch stock alerts once
  useEffect(() => {
    fetch('/api/stats?period=1')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.stockAlerts) setStockAlertCount(data.stockAlerts.length) })
  }, [])

  // Fetch the garage's own logo — shown in the header brand area when set.
  useEffect(() => {
    fetch('/api/garages')
      .then(r => r.ok ? r.json() : null)
      .then(g => {
        if (!g) return
        const logo = g.logoBase64 || (g.logoPath ? `/api/photos/${g.logoPath}` : null)
        if (logo) { setLogoFailed(false); setGarageLogo(logo) }
      })
      .catch(() => {})
  }, [])

  // Close user menu on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const parsedDate = parseISO(selectedDate)
  const dateLabel  = isToday(parsedDate)
    ? t.todayLabel
    : format(parsedDate, 'EEEE d MMM', { locale: fr })

  const activeSuggestions = suggestions.filter(s => !s.dismissed)
  const highPrio   = activeSuggestions.filter(s => s.priority === 'high')
  const dayJobs    = jobs.filter(j => j.date === selectedDate && j.status !== 'cancelled')
  const absentCount= mechanics.filter(m => m.isAbsent).length

  const user = session?.user
  const role = user?.role ?? 'RECEPTIONIST'
  const roleLabels: Record<string, string> = {
    OWNER: t.roleOwner, MANAGER: t.roleManager, RECEPTIONIST: t.roleReceptionist,
  }

  const handleRefresh = useCallback(() => { refreshAll() }, [refreshAll])

  return (
    <header
      /**
       * z-40 (et non z-20) : `relative z-20` créait un CONTEXTE D'EMPILEMENT
       * dont l'en-tête ne sortait jamais. Le `z-50` du menu profil est LOCAL à
       * ce contexte : il ne pouvait donc pas passer devant la barre des
       * mécaniciens du planning (`sticky top-0 z-30`, ScheduleBoard.tsx:435),
       * qui appartient au contexte racine. Résultat observé : le menu
       * « Changer de licence / Déconnexion » se faisait recouvrir par la bande
       * « Mécanicien 1…4 ». L'en-tête passe au-dessus du plateau (z-30) tout en
       * restant SOUS les modales (z-50 et plus).
       */
      className="gf-app-header bg-[#111827] border-b border-white/[0.07] z-40 relative shadow-lg shadow-black/20 select-none flex-shrink-0 pt-safe pl-safe pr-safe"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >

      {/* ── ROW 1 : Identity + Date + User ─────────────────────────────────── */}
      <div className="flex items-center gap-2 sm:gap-3 px-2 sm:px-4 h-10 border-b border-white/[0.05]">

        {/* Logo + Garage name */}
        <div
          className="flex items-center gap-2 mr-0 sm:mr-1 min-w-0 flex-shrink-0"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {garageLogo && !logoFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={garageLogo}
              alt="logo"
              className="w-[26px] h-[26px] object-contain rounded flex-shrink-0"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <GarageFlowIcon size={26} />
          )}
          {/* Sous xs (téléphone étroit) : on ne garde que le logo pour libérer de la place. */}
          <div className="hidden xs:block min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-black text-white text-xs leading-none flex-shrink-0">
                Garage<span className="text-blue-400">Flows</span>
              </span>
              {user?.garageName && (
                <span className="hidden sm:flex items-center gap-1.5 min-w-0">
                  <span className="text-white/20 text-[10px]">·</span>
                  <span className="text-slate-400 text-[11px] font-medium truncate max-w-[110px]">
                    {user.garageName}
                  </span>
                </span>
              )}
            </div>
            <p className="hidden sm:block text-[8px] text-slate-700 leading-none tracking-widest uppercase mt-0.5">
              {t.planningIntelligent}
            </p>
          </div>
        </div>

        <Sep />

        {/* Date navigator */}
        <div
          className="flex items-center gap-0.5 bg-white/[0.05] rounded-lg p-0.5 border border-white/[0.07] flex-shrink-0"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={() => setSelectedDate(format(subDays(parsedDate, 1), 'yyyy-MM-dd'))}
            className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-slate-400 hover:text-slate-200"
            title={t.prevDay}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setSelectedDate(format(new Date(), 'yyyy-MM-dd'))}
            className={cn(
              'px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors capitalize flex items-center gap-1.5',
              isToday(parsedDate)
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/40'
                : 'text-slate-300 hover:bg-white/10'
            )}
          >
            <CalendarDays className="w-3 h-3" />
            {dateLabel}
          </button>
          <button
            onClick={() => setSelectedDate(format(addDays(parsedDate, 1), 'yyyy-MM-dd'))}
            className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-slate-400 hover:text-slate-200"
            title={t.nextDay}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Stats pills — masquées sous sm (place limitée sur téléphone) */}
        <div
          className="hidden sm:flex items-center gap-1.5 min-w-0"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <span className="text-[11px] bg-blue-500/15 text-blue-300 font-semibold px-2 py-0.5 rounded-full border border-blue-500/20">
            {dayJobs.length} {dayJobs.length === 1 ? t.jobSingular : t.jobPlural}
          </span>
          {absentCount > 0 && (
            <span className="text-[11px] bg-red-500/15 text-red-400 font-semibold px-2 py-0.5 rounded-full border border-red-500/20">
              {absentCount} {t.absentPlural}
            </span>
          )}
        </div>

        <div className="flex-1" />

        {/* Settings — accès rapide, toujours visible en haut à droite */}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            title={t.ttSettings}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/[0.07] border border-transparent transition-colors"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <Settings className="w-4 h-4" />
            <span className="hidden md:inline text-xs font-medium">{t.navSettings}</span>
          </button>
        )}

        {/* User menu */}
        <div
          className="relative"
          ref={menuRef}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className={cn(
              'flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-lg border transition-colors',
              userMenuOpen
                ? 'bg-white/[0.08] border-white/15'
                : 'border-transparent hover:bg-white/[0.07]'
            )}
          >
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
              {user?.name?.substring(0, 2).toUpperCase() ?? 'U'}
            </div>
            <div className="hidden md:block text-left">
              <p className="text-[11px] font-semibold text-slate-200 leading-tight truncate max-w-[90px]">
                {user?.name ?? 'Utilisateur'}
              </p>
              <p className="text-[9px] text-slate-500 leading-tight">{roleLabels[role] ?? role}</p>
            </div>
            <ChevronDown className={cn('w-3 h-3 text-slate-500 transition-transform', userMenuOpen && 'rotate-180')} />
          </button>

          {/* Dropdown */}
          {userMenuOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-56 bg-[#1a2235] rounded-xl border border-white/[0.1] shadow-2xl shadow-black/40 z-50 py-1.5">
              <div className="px-3 py-2.5 border-b border-white/[0.07]">
                <p className="text-sm font-semibold text-white">{user?.name}</p>
                <p className="text-xs text-slate-400 truncate">{user?.email}</p>
                <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full mt-1', ROLE_COLORS[role])}>
                  <Shield className="w-2.5 h-2.5" />
                  {roleLabels[role] ?? role}
                </span>
              </div>
              {user?.garageName && (
                <div className="px-3 py-2 border-b border-white/[0.07]">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-200 truncate">{user.garageName}</p>
                      <p className="text-[10px] text-slate-500">{t.currentGarage}</p>
                    </div>
                  </div>
                </div>
              )}
              <div className="py-1">
                <button
                  onClick={() => { setUserMenuOpen(false); setShowLicenseModal(true) }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-400 hover:bg-white/[0.07] transition-colors"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  {t.changeLicense}
                </button>
                <button
                  onClick={() => {
                    setUserMenuOpen(false)
                    // Purge le cache de pages privées du Service Worker avant de
                    // fermer la session (aucune page ne doit rester pour un autre
                    // utilisateur du même appareil).
                    try { navigator.serviceWorker?.controller?.postMessage('CLEAR_PRIVATE_CACHE') } catch { /* SW absent */ }
                    signOut({ callbackUrl: '/login' })
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  {t.signOut}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Window controls (Electron only) */}
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <WindowControls />
        </div>
      </div>

      {/* ── ROW 2 : Action toolbar grouped by section ──────────────────────── */}
      {/* py-1.5 (auto height) instead of a fixed h-9 so each section's tiny
          label sits cleanly ABOVE its buttons without overflowing into row 1.
          Masquée sous md : sur téléphone, ces actions passent dans la barre de
          navigation inférieure + le menu « Plus » (aucune fonction perdue). */}
      <div
        className="hidden md:flex items-center px-4 py-1.5 gap-0 overflow-x-auto scrollbar-hide"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >

        {/* ── PLANNING ─────────────────────────────────────────────────────── */}
        <SectionGroup label={t.secPlanning}>
          <ToolBtn
            onClick={() => openCreateModal()}
            icon={Plus}
            label={t.navNewJob}
            title={t.ttCreateJob}
            variant="primary"
          />
          <ToolBtn
            onClick={handleRefresh}
            icon={RefreshCw}
            label={t.navRefresh}
            title={t.ttRefreshAI}
            badge={highPrio.length}
            active={isLoading}
            activeClass="text-blue-400"
          />
        </SectionGroup>

        <Sep />

        {/* ── ATELIER ──────────────────────────────────────────────────────── */}
        <SectionGroup label={t.secWorkshop}>
          {onOpenReception && (
            <ToolBtn
              onClick={onOpenReception}
              icon={ClipboardList}
              label={t.navReception}
              title={t.ttReception}
            />
          )}
          <ToolBtn
            onClick={toggleDashboard}
            icon={BarChart3}
            label={t.navDashboard}
            title={t.ttDashboard}
            active={isDashboardOpen}
          />
        </SectionGroup>

        <Sep />

        {/* ── GESTION ──────────────────────────────────────────────────────── */}
        <SectionGroup label={t.secManagement}>
          <ToolBtn
            onClick={toggleStockPanel}
            icon={Package}
            label={t.navStock}
            title={t.ttStock}
            active={isStockPanelOpen}
            badge={stockAlertCount}
          />
          {onOpenWarranties && (
            <ToolBtn
              onClick={onOpenWarranties}
              icon={ShieldCheck}
              label={t.navWarranties}
              title={t.ttWarranties}
              badge={warrantyAlerts}
            />
          )}
          {onOpenLoaner && (
            <ToolBtn
              onClick={onOpenLoaner}
              icon={Car}
              label={t.navLoaner}
              title={t.ttLoaner}
            />
          )}
          {onOpenReminders && (
            <ToolBtn
              onClick={onOpenReminders}
              icon={Bell}
              label={t.navReminders}
              title={t.ttReminders}
            />
          )}
          {onOpenLaborCatalog && (
            <ToolBtn
              onClick={onOpenLaborCatalog}
              icon={BookOpen}
              label={t.navLaborCatalog}
              title={t.ttLaborCatalog}
            />
          )}
        </SectionGroup>

        <Sep />

        {/* ── FINANCE ──────────────────────────────────────────────────────── */}
        <SectionGroup label={t.secFinance}>
          {onOpenBilling && (
            <ToolBtn
              onClick={onOpenBilling}
              icon={FileText}
              label={t.navBilling}
              title={t.ttBilling}
              variant="finance"
            />
          )}
          {onOpenFinance && (
            <ToolBtn
              onClick={onOpenFinance}
              icon={BarChart2}
              label={t.navFinance}
              title={t.ttFinance}
              variant="finance"
            />
          )}
          {onOpenCopilot && (
            <ToolBtn
              onClick={onOpenCopilot}
              icon={Sparkles}
              label={t.navCopilot}
              title={t.ttCopilot}
              variant="finance"
            />
          )}
          {onOpenOcr && (
            <ToolBtn
              onClick={onOpenOcr}
              icon={ScanLine}
              label={t.navOcr}
              title={t.ttOcr}
              variant="finance"
            />
          )}
          {onOpenSuppliers && (
            <ToolBtn
              onClick={onOpenSuppliers}
              icon={Truck}
              label={t.navSuppliers}
              title={t.ttSuppliers}
              variant="finance"
            />
          )}
          {onOpenClients && (
            <ToolBtn
              onClick={onOpenClients}
              icon={Users}
              label={t.navClients}
              title={t.ttClients}
              variant="finance"
            />
          )}
          {onOpenCatalog && (
            <ToolBtn
              onClick={onOpenCatalog}
              icon={Boxes}
              label={t.navCatalog}
              title={t.ttCatalog}
              variant="finance"
            />
          )}
        </SectionGroup>

        <Sep />

        {/* ── APPARENCE & PARAMÈTRES ───────────────────────────────────────── */}
        <SectionGroup label={t.secThemes}>
          {/* Cycle through 4 themes */}
          <button
            onClick={() => {
              const order: import('@/lib/i18n').Theme[] = ['dark','light','night-shift','true-tone']
              const next = order[(order.indexOf(theme as any) + 1) % order.length]
              setTheme(next)
            }}
            className="p-1.5 rounded-md hover:bg-white/[0.07] text-slate-500 hover:text-slate-300 transition-colors"
            title={theme === 'dark' ? (t.themeDarkDesc ?? 'Mode sombre') :
                   theme === 'light' ? (t.themeLightDesc ?? 'Mode clair') :
                   theme === 'night-shift' ? (t.themeNightShiftDesc ?? 'Night Shift') :
                   (t.themeTrueToneDesc ?? 'True Tone')}
          >
            {theme === 'light'       ? <Sun  className="w-3.5 h-3.5" /> :
             theme === 'night-shift' ? <span className="text-amber-400 text-[11px] font-bold leading-none">NS</span> :
             theme === 'true-tone'   ? <span className="text-blue-400 text-[11px] font-bold leading-none">TT</span> :
             <Moon className="w-3.5 h-3.5" />}
          </button>
          <LanguageSelector mode="compact" />
        </SectionGroup>

      </div>

      {showLicenseModal && <LicenseChangeModal onClose={() => setShowLicenseModal(false)} />}
    </header>
  )
}
