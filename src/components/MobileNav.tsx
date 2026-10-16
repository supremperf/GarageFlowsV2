'use client'

import { useState } from 'react'
import { signOut } from 'next-auth/react'
import {
  CalendarDays, ClipboardList, Plus, Sparkles, Menu,
  BarChart3, Package, ShieldCheck, Car, Bell, BookOpen,
  FileText, BarChart2, ScanLine, Truck, Users, Boxes, Settings,
  Sun, Moon, LogOut, MessageSquare,
} from 'lucide-react'
import { useScheduleStore } from '@/store/schedule-store'
import { useTranslation } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import GfDrawer from '@/components/GfDrawer'
import LanguageSelector from '@/components/LanguageSelector'

/** Actions de niveau page (panneaux/modales gérés dans page.tsx). */
export interface MobileNavActions {
  onNewJob: () => void
  onOpenAssistant: () => void
  onOpenReception: () => void
  onOpenReminders: () => void
  onOpenBilling: () => void
  onOpenFinance: () => void
  onOpenLaborCatalog: () => void
  onOpenWarranties: () => void
  /** Absent quand le garage a désactivé les véhicules de prêt (GF-039). */
  onOpenLoaner?: () => void
  onOpenCopilot: () => void
  onOpenOcr: () => void
  onOpenSuppliers: () => void
  onOpenClients: () => void
  onOpenTickets: () => void
  onOpenCatalog: () => void
  onOpenSettings: () => void
  warrantyAlerts?: number
  assistantCount?: number
}

// ── Bouton de la barre inférieure ─────────────────────────────────────────────
function TabButton({
  icon: Icon, label, onClick, active, badge, ariaLabel,
}: {
  icon: React.ElementType
  label: string
  onClick: () => void
  active?: boolean
  badge?: number
  ariaLabel?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'gf-touch relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 px-1 rounded-lg transition-colors',
        active ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200',
      )}
    >
      <Icon className="w-[22px] h-[22px]" />
      <span className="text-[10px] font-medium leading-none truncate max-w-full">{label}</span>
      {badge && badge > 0 ? (
        <span className="absolute top-0.5 right-[18%] min-w-[15px] h-[15px] px-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </button>
  )
}

// ── Item du menu « Plus » ─────────────────────────────────────────────────────
function MoreItem({
  icon: Icon, label, onClick, badge, tone = 'default',
}: {
  icon: React.ElementType
  label: string
  onClick: () => void
  badge?: number
  tone?: 'default' | 'finance' | 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'gf-touch relative flex items-center gap-3 w-full px-3 py-3 rounded-xl border text-left transition-colors',
        tone === 'finance'
          ? 'bg-emerald-500/[0.07] border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/[0.12]'
          : tone === 'danger'
          ? 'bg-red-500/[0.07] border-red-500/20 text-red-300 hover:bg-red-500/[0.12]'
          : 'bg-white/[0.04] border-white/[0.08] text-slate-200 hover:bg-white/[0.08]',
      )}
    >
      <Icon className="w-5 h-5 flex-shrink-0" />
      <span className="text-[13px] font-medium flex-1 min-w-0">{label}</span>
      {badge && badge > 0 ? (
        <span className="min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center flex-shrink-0">
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold tracking-[0.14em] uppercase text-slate-500 px-1 pt-3 pb-1.5">
      {children}
    </p>
  )
}

export default function MobileNav(props: MobileNavActions) {
  const { t, theme, setTheme } = useTranslation()
  const [moreOpen, setMoreOpen] = useState(false)
  const {
    openCreateModal, toggleDashboard, isDashboardOpen,
    toggleStockPanel, isStockPanelOpen, isJobModalOpen,
  } = useScheduleStore()

  const planningActive = !isDashboardOpen && !isStockPanelOpen
  const close = () => setMoreOpen(false)
  const run = (fn?: () => void) => { close(); fn?.() }

  const cycleTheme = () => {
    const order: import('@/lib/i18n').Theme[] = ['dark', 'light', 'night-shift', 'true-tone']
    const next = order[(order.indexOf(theme as any) + 1) % order.length]
    setTheme(next)
  }
  const themeLabel = theme === 'light' ? (t.themeLightDesc ?? 'Clair')
    : theme === 'night-shift' ? (t.themeNightShiftDesc ?? 'Night Shift')
    : theme === 'true-tone' ? (t.themeTrueToneDesc ?? 'True Tone')
    : (t.themeDarkDesc ?? 'Sombre')

  // Amène le planning au premier plan (ferme les vues plein écran/panneaux).
  const showPlanning = () => {
    if (isDashboardOpen) toggleDashboard()
    if (isStockPanelOpen) toggleStockPanel()
  }

  return (
    <>
      {/* ── Barre inférieure fixe (mobile uniquement) ─────────────────────── */}
      <nav
        aria-label="Navigation principale"
        className="md:hidden flex-shrink-0 z-30 bg-[#111827]/95 backdrop-blur-md border-t border-white/[0.08] pb-safe px-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="flex items-stretch justify-around gap-0.5 pt-1">
          <TabButton icon={CalendarDays} label={t.secPlanning} onClick={showPlanning} active={planningActive && !isJobModalOpen} />
          <TabButton icon={ClipboardList} label={t.secWorkshop} onClick={props.onOpenReception} />

          {/* Bouton central « Ajouter » mis en avant */}
          <button
            type="button"
            onClick={() => openCreateModal()}
            aria-label={t.navNewJob}
            className="gf-touch relative flex flex-col items-center justify-center flex-1 max-w-[76px]"
          >
            <span className="flex items-center justify-center w-12 h-12 -mt-4 rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/40 border-4 border-[#111827]">
              <Plus className="w-6 h-6" />
            </span>
            <span className="text-[10px] font-medium text-slate-400 leading-none mt-0.5">{t.navAdd}</span>
          </button>

          <TabButton icon={Sparkles} label={t.navAssistant} onClick={props.onOpenAssistant} badge={props.assistantCount} />
          <TabButton icon={Menu} label={t.navMore} onClick={() => setMoreOpen(true)} badge={props.warrantyAlerts} />
        </div>
      </nav>

      {/* ── Menu « Plus » (bottom-sheet) ──────────────────────────────────── */}
      <GfDrawer
        open={moreOpen}
        onClose={close}
        side="bottom"
        title={t.navMenuTitle}
        ariaLabel={t.navMenuTitle}
        heightClass="max-h-[90dvh]"
        bodyClassName="px-4 pb-safe-3"
      >
        <SectionLabel>{t.secWorkshop}</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <MoreItem icon={ClipboardList} label={t.navReception} onClick={() => run(props.onOpenReception)} />
          <MoreItem icon={BarChart3} label={t.navDashboard} onClick={() => run(toggleDashboard)} />
        </div>

        <SectionLabel>{t.secManagement}</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <MoreItem icon={Package} label={t.navStock} onClick={() => run(toggleStockPanel)} />
          <MoreItem icon={ShieldCheck} label={t.navWarranties} onClick={() => run(props.onOpenWarranties)} badge={props.warrantyAlerts} />
          {props.onOpenLoaner && (
            <MoreItem icon={Car} label={t.navLoaner} onClick={() => run(props.onOpenLoaner!)} />
          )}
          <MoreItem icon={Bell} label={t.navReminders} onClick={() => run(props.onOpenReminders)} />
          <MoreItem icon={BookOpen} label={t.navLaborCatalog} onClick={() => run(props.onOpenLaborCatalog)} />
        </div>

        <SectionLabel>{t.secFinance}</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <MoreItem icon={FileText} label={t.navBilling} onClick={() => run(props.onOpenBilling)} tone="finance" />
          <MoreItem icon={BarChart2} label={t.navFinance} onClick={() => run(props.onOpenFinance)} tone="finance" />
          <MoreItem icon={Sparkles} label={t.navCopilot} onClick={() => run(props.onOpenCopilot)} tone="finance" />
          <MoreItem icon={ScanLine} label={t.navOcr} onClick={() => run(props.onOpenOcr)} tone="finance" />
          <MoreItem icon={Truck} label={t.navSuppliers} onClick={() => run(props.onOpenSuppliers)} tone="finance" />
          <MoreItem icon={Users} label={t.navClients} onClick={() => run(props.onOpenClients)} tone="finance" />
          <MoreItem icon={MessageSquare} label="Messages" onClick={() => run(props.onOpenTickets)} tone="finance" />
          {/* L'entrée « Rendez-vous » a été retirée du menu : la vue globale des
              rendez-vous vit désormais dans le tableau de bord, où les filtres
              par client, véhicule, plaque, date, période et statut existent.
              La fonction est intacte (routes, tiroir de décision, espace client). */}
          <MoreItem icon={Boxes} label={t.navCatalog} onClick={() => run(props.onOpenCatalog)} tone="finance" />
        </div>

        <SectionLabel>{t.secThemes}</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <MoreItem
            icon={theme === 'light' ? Sun : Moon}
            label={themeLabel}
            onClick={cycleTheme}
          />
          <div className="gf-touch flex items-center gap-2 w-full px-3 py-2 rounded-xl border bg-white/[0.04] border-white/[0.08]">
            <LanguageSelector mode="compact" />
            <span className="text-[13px] font-medium text-slate-200">{t.navLanguage}</span>
          </div>
          <MoreItem icon={Settings} label={t.navSettings} onClick={() => run(props.onOpenSettings)} />
          <MoreItem
            icon={LogOut}
            label={t.signOut}
            tone="danger"
            onClick={() => {
              close()
              try { navigator.serviceWorker?.controller?.postMessage('CLEAR_PRIVATE_CACHE') } catch { /* SW absent */ }
              signOut({ callbackUrl: '/login' })
            }}
          />
        </div>
      </GfDrawer>
    </>
  )
}
