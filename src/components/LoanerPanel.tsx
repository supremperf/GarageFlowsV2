'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Car, Plus, Calendar, RefreshCw, Check, AlertCircle, Euro, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format, parseISO, addDays, startOfWeek, eachDayOfInterval, isWithinInterval, differenceInDays } from 'date-fns'
import type { Locale } from 'date-fns'
import { CAR_DATABASE } from '@/lib/car-database'
import { DateField } from '@/components/DateField'
import { useTranslation } from '@/lib/i18n'
import { dateLocale } from '@/lib/i18n/date-locale'
import { formatEuros, fromCents, lineTotalCentsFromScaled, toScaled } from '@/lib/money'

/**
 * Durée facturée d'un prêt, en jours entiers, plancher à 1 : un prêt rendu le
 * jour même reste facturé une journée. Extrait pour que l'estimation affichée et
 * son libellé s'appuient sur la MÊME valeur — ils étaient recalculés deux fois.
 */
function joursEstimes(debut: string, fin: string): number {
  const d = differenceInDays(parseISO(fin), parseISO(debut))
  return Number.isFinite(d) ? Math.max(1, d) : 1
}

// ── Types (match actual API field names) ─────────────────────────────────────
interface LoanerVehicle {
  id: string
  name: string
  licensePlate: string
  make: string | null
  model: string | null
  color: string | null
  isActive: boolean
  notes: string | null
  reservations: LoanerReservation[]
}

interface LoanerReservation {
  id: string
  vehicleId: string
  clientName: string
  clientPhone: string | null
  startDate: string
  endDate: string
  status: string
  notes: string | null
  returnedAt: string | null
  isPaid?: boolean
  dailyRate?: number | null
  depositAmount?: number | null
}

// ── Vehicle make autocomplete ─────────────────────────────────────────────────
function getMakeSuggestions(q: string): string[] {
  if (!q.trim()) return []
  const lq = q.trim().toLowerCase()
  return CAR_DATABASE
    .filter(e => e.make.toLowerCase().startsWith(lq) || e.make.toLowerCase().includes(lq))
    .slice(0, 6)
    .map(e => e.make)
}

function getModelSuggestions(make: string, q: string): string[] {
  if (!q.trim()) return []
  const entry = CAR_DATABASE.find(e => e.make.toLowerCase() === make.toLowerCase())
  if (!entry) return []
  const lq = q.trim().toLowerCase()
  return entry.models
    .filter(m => m.toLowerCase().startsWith(lq) || m.toLowerCase().includes(lq))
    .slice(0, 6)
}

function fmtDate(d: string, loc: Locale) {
  try { return format(parseISO(d), 'd MMM', { locale: loc }) } catch { return d }
}

function activeDates(v: LoanerVehicle): LoanerReservation | null {
  const today = new Date()
  return v.reservations.find(r =>
    (r.status === 'reserved' || r.status === 'active') &&
    !isNaN(parseISO(r.startDate).getTime()) &&
    isWithinInterval(today, { start: parseISO(r.startDate), end: parseISO(r.endDate) })
  ) ?? null
}

const emptyVehicleForm = { name: '', licensePlate: '', make: '', model: '', color: '', notes: '' }
const emptyResForm = {
  vehicleId: '', clientName: '', clientPhone: '',
  startDate: format(new Date(), 'yyyy-MM-dd'),
  endDate: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
  notes: '', isPaid: false, dailyRate: '', depositAmount: '',
}

type PanelTab = 'fleet' | 'calendar' | 'book'

export default function LoanerPanel({ onClose }: { onClose: () => void }) {
  const { t, lang } = useTranslation()
  const loc = dateLocale(lang)
  const [tab, setTab]                   = useState<PanelTab>('fleet')
  const [vehicles, setVehicles]         = useState<LoanerVehicle[]>([])
  const [reservations, setReservations] = useState<LoanerReservation[]>([])
  const [loading, setLoading]           = useState(true)
  const [showAddVehicle, setShowAddVehicle] = useState(false)
  const [vehicleForm, setVehicleForm]   = useState(emptyVehicleForm)
  const [resForm, setResForm]           = useState(emptyResForm)
  const [savingVehicle, setSavingVehicle] = useState(false)
  const [savingRes, setSavingRes]       = useState(false)
  const [weekStart, setWeekStart]       = useState(startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [error, setError]               = useState<string | null>(null)
  /** Véhicule dont une action est en cours — évite le double clic. */
  const [vehiculeOccupe, setVehiculeOccupe] = useState<string | null>(null)
  /** Véhicule pour lequel le serveur a refusé la suppression et conseillé la désactivation. */
  const [desactivationProposee, setDesactivationProposee] = useState<string | null>(null)

  // Make/model autocomplete state
  const [makeSuggestions, setMakeSuggestions] = useState<string[]>([])
  const [modelSuggestions, setModelSuggestions] = useState<string[]>([])
  const [showMakeDrop, setShowMakeDrop] = useState(false)
  const [showModelDrop, setShowModelDrop] = useState(false)
  const makeRef  = useRef<HTMLDivElement>(null)
  const modelRef = useRef<HTMLDivElement>(null)

  // Click outside to close dropdowns
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (makeRef.current  && !makeRef.current.contains(e.target as Node))  setShowMakeDrop(false)
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setShowModelDrop(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [vRes, rRes] = await Promise.all([
        fetch('/api/loaner-vehicles'),
        fetch(`/api/loaner-reservations?startDate=${format(weekStart, 'yyyy-MM-dd')}&endDate=${format(addDays(weekStart, 6), 'yyyy-MM-dd')}`),
      ])
      const vData = await vRes.json()
      const rData = await rRes.json()
      setVehicles(Array.isArray(vData) ? vData : [])
      setReservations(Array.isArray(rData) ? rData : [])
    } catch {
      // Réseau coupé / JSON invalide : on affiche une erreur au lieu de laisser
      // le spinner bloqué indéfiniment (setLoading(false) était inatteignable).
      setError('Impossible de charger les véhicules de prêt. Réessayez.')
    } finally {
      setLoading(false)
    }
  }, [weekStart])

  useEffect(() => { load() }, [load])

  const weekDays = eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) })

  function getResForVehicleDay(vehicleId: string, day: Date) {
    return reservations.filter(r =>
      r.vehicleId === vehicleId &&
      (r.status === 'reserved' || r.status === 'active') &&
      isWithinInterval(day, { start: parseISO(r.startDate), end: parseISO(r.endDate) })
    )
  }

  async function saveVehicle() {
    if (!vehicleForm.licensePlate.trim() || !vehicleForm.name.trim()) return
    setSavingVehicle(true)
    setError(null)
    try {
      const res = await fetch('/api/loaner-vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:         vehicleForm.name,
          licensePlate: vehicleForm.licensePlate,
          make:         vehicleForm.make || null,
          model:        vehicleForm.model || null,
          color:        vehicleForm.color || null,
          notes:        vehicleForm.notes || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `${res.status}: ${t.lnErrSaveVehicle}`)
        return
      }
      await load()
      setShowAddVehicle(false)
      setVehicleForm(emptyVehicleForm)
    } catch (e: any) {
      setError(e.message ?? t.uiNetworkError)
    } finally { setSavingVehicle(false) }
  }

  /**
   * Retire un véhicule de la flotte — ou explique pourquoi c'est refusé
   * (GF-DUR-029).
   *
   * `PATCH` et `DELETE /api/loaner-vehicles/[id]` existaient, avec un garde
   * soigneux côté serveur, et AUCUN écran ne les appelait : un garage qui
   * saisissait une plaque de travers gardait la ligne fautive pour toujours, et
   * une voiture vendue restait proposée à la réservation.
   *
   * Le serveur refuse la suppression dès qu'il existe un prêt à l'historique —
   * l'effacer emporterait les kilométrages, états des lieux et cautions, c'est-à-
   * dire les pièces qui tranchent un litige. Son message dit « désactivez-le ».
   * L'écran doit donc PROPOSER cette désactivation dans la foulée : renvoyer un
   * conseil sans le bouton correspondant serait une impasse polie.
   */
  async function supprimerVehicule(v: LoanerVehicle) {
    if (!window.confirm(`Supprimer définitivement « ${v.name} » (${v.licensePlate}) ?`)) return
    setError(null)
    setVehiculeOccupe(v.id)
    try {
      const res = await fetch(`/api/loaner-vehicles/${v.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Suppression refusée.')
        // Le serveur distingue « réservations vives » (attendre) de « historique »
        // (désactiver). Seul le second se règle par la désactivation.
        if (data.code === 'VEHICLE_HAS_HISTORY') setDesactivationProposee(v.id)
        return
      }
      await load()
    } catch {
      setError(t.uiNetworkError)
    } finally { setVehiculeOccupe(null) }
  }

  /** Sort le véhicule des listes SANS toucher à son historique de prêts. */
  async function basculerActivite(v: LoanerVehicle) {
    setError(null)
    setVehiculeOccupe(v.id)
    try {
      const res = await fetch(`/api/loaner-vehicles/${v.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !v.isActive }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Modification refusée.')
        return
      }
      setDesactivationProposee(null)
      await load()
    } catch {
      setError(t.uiNetworkError)
    } finally { setVehiculeOccupe(null) }
  }

  async function saveReservation() {
    if (!resForm.vehicleId || !resForm.clientName.trim()) {
      setError(t.lnErrVehicleClient)
      return
    }
    if (resForm.endDate < resForm.startDate) {
      setError(t.lnErrEndAfterStart)
      return
    }
    setError(null)
    setSavingRes(true)
    try {
      const res = await fetch('/api/loaner-reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId:     resForm.vehicleId,
          clientName:    resForm.clientName.trim(),
          clientPhone:   resForm.clientPhone || null,
          startDate:     resForm.startDate,
          endDate:       resForm.endDate,
          notes:         resForm.notes || null,
          isPaid:        resForm.isPaid,
          dailyRate:     resForm.isPaid && resForm.dailyRate ? Number(resForm.dailyRate) : null,
          depositAmount: resForm.isPaid && resForm.depositAmount ? Number(resForm.depositAmount) : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? t.uiSaveFailed); return }
      await load()
      setTab('calendar')
      setResForm(emptyResForm)
    } finally { setSavingRes(false) }
  }

  async function returnVehicle(reservationId: string) {
    if (!confirm(t.lnConfirmReturn)) return
    await fetch(`/api/loaner-reservations/${reservationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'returned' }),
    })
    await load()
  }

  const INPUT = 'w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-[520px] bg-[#0f1629] border-l border-white/[0.07] flex flex-col shadow-2xl z-40 pt-safe pb-safe pr-safe">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
        <div className="flex items-center gap-2.5">
          <Car className="w-5 h-5 text-blue-400" />
          <h2 className="text-base font-bold text-white">{t.lnTitle}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-1.5 rounded-lg hover:bg-white/[0.07] text-slate-400" title={t.uiRefresh}>
            <RefreshCw className="w-4 h-4" />
          </button>
          <button aria-label="Fermer" title="Fermer" onClick={onClose} className="gf-close p-1.5 rounded-lg hover:bg-white/[0.07] text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 pt-3 pb-2 border-b border-white/[0.07]">
        {([['fleet', t.lnTabFleet], ['calendar', t.lnTabCalendar], ['book', t.lnTabBook]] as [PanelTab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              tab === id ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.07]')}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Fleet tab ─────────────────────────────────────────────────────── */}
      {tab === 'fleet' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="flex justify-end">
            <button onClick={() => setShowAddVehicle(!showAddVehicle)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium">
              <Plus className="w-3.5 h-3.5" /> {t.lnAddVehicle}
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            </div>
          )}

          {showAddVehicle && (
            <div className="border border-white/[0.1] rounded-xl p-4 bg-white/[0.02] space-y-3">
              <h3 className="text-sm font-semibold text-white">{t.lnNewVehicle}</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">{t.lnName} *</label>
                  <input value={vehicleForm.name}
                    onChange={e => setVehicleForm(f => ({ ...f, name: e.target.value }))}
                    placeholder={t.lnNamePh}
                    className={INPUT} />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">{t.lnPlate} *</label>
                  <input value={vehicleForm.licensePlate}
                    onChange={e => setVehicleForm(f => ({ ...f, licensePlate: e.target.value }))}
                    placeholder="AA-000-BB"
                    className={INPUT} />
                </div>

                {/* Make autocomplete */}
                <div ref={makeRef} className="relative">
                  <label className="text-xs text-slate-500 mb-1 block">{t.lnMake}</label>
                  <input value={vehicleForm.make}
                    onChange={e => {
                      setVehicleForm(f => ({ ...f, make: e.target.value, model: '' }))
                      setMakeSuggestions(getMakeSuggestions(e.target.value))
                      setShowMakeDrop(true)
                    }}
                    onFocus={() => { setMakeSuggestions(getMakeSuggestions(vehicleForm.make)); setShowMakeDrop(true) }}
                    placeholder="ex: Renault"
                    autoComplete="off"
                    className={INPUT} />
                  {showMakeDrop && makeSuggestions.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl bg-[#1a2235] border border-white/10 shadow-2xl overflow-hidden">
                      {makeSuggestions.map(s => (
                        <button key={s} type="button"
                          onMouseDown={e => { e.preventDefault(); setVehicleForm(f => ({ ...f, make: s, model: '' })); setShowMakeDrop(false) }}
                          className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.07]">
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Model autocomplete */}
                <div ref={modelRef} className="relative">
                  <label className="text-xs text-slate-500 mb-1 block">{t.lnModel}</label>
                  <input value={vehicleForm.model}
                    onChange={e => {
                      setVehicleForm(f => ({ ...f, model: e.target.value }))
                      setModelSuggestions(getModelSuggestions(vehicleForm.make, e.target.value))
                      setShowModelDrop(true)
                    }}
                    onFocus={() => { setModelSuggestions(getModelSuggestions(vehicleForm.make, vehicleForm.model)); setShowModelDrop(true) }}
                    placeholder="ex: Clio"
                    autoComplete="off"
                    className={INPUT} />
                  {showModelDrop && modelSuggestions.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl bg-[#1a2235] border border-white/10 shadow-2xl overflow-hidden">
                      {modelSuggestions.map(s => (
                        <button key={s} type="button"
                          onMouseDown={e => { e.preventDefault(); setVehicleForm(f => ({ ...f, model: s })); setShowModelDrop(false) }}
                          className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.07]">
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs text-slate-500 mb-1 block">{t.lnColor}</label>
                  <input value={vehicleForm.color}
                    onChange={e => setVehicleForm(f => ({ ...f, color: e.target.value }))}
                    placeholder={t.lnColorPh}
                    className={INPUT} />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setShowAddVehicle(false); setVehicleForm(emptyVehicleForm) }}
                  className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-white/10 text-slate-400 hover:bg-white/[0.05]">{t.uiCancel}</button>
                <button onClick={saveVehicle}
                  disabled={savingVehicle || !vehicleForm.licensePlate.trim() || !vehicleForm.name.trim()}
                  className="flex-1 px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50">
                  {savingVehicle ? t.uiSaving : t.uiSave}
                </button>
              </div>
            </div>
          )}

          {loading && <div className="flex justify-center py-8"><span className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>}

          {!loading && vehicles.length === 0 && (
            <div className="text-center py-10">
              <Car className="w-8 h-8 text-slate-700 mx-auto mb-2" />
              <p className="text-slate-500 text-sm">{t.lnEmptyFleet}</p>
            </div>
          )}

          {!loading && vehicles.map(v => {
            const current = activeDates(v)
            return (
              <div key={v.id} className="bg-white/[0.03] border border-white/[0.07] rounded-xl px-4 py-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-blue-400 text-sm font-semibold">{v.licensePlate}</span>
                      <span className="text-white text-sm">{v.name}</span>
                      {v.color && <span className="text-xs text-slate-500">{v.color}</span>}
                      {/* `isActive` était porté par le composant et n'apparaissait
                          nulle part : un véhicule retiré de la flotte semblait
                          disponible. */}
                      {!v.isActive && (
                        <span className="rounded-full bg-slate-700/60 px-2 py-0.5 text-[10px] font-bold text-slate-400">
                          hors flotte
                        </span>
                      )}
                    </div>
                    {v.make && <p className="text-xs text-slate-500 mb-1">{v.make}{v.model ? ` ${v.model}` : ''}</p>}
                    {current ? (
                      <div className="text-xs text-amber-400">
                        {t.lnLentTo} {current.clientName} {t.lnUntil} {fmtDate(current.endDate, loc)}
                        {current.isPaid && current.dailyRate && (
                          <span className="ml-2 text-emerald-400">{current.dailyRate}€/{t.lnDayShort}</span>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-emerald-400 flex items-center gap-1">
                        <Check className="w-3 h-3" /> {t.lnAvailable}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {current && (
                      <button
                        onClick={() => returnVehicle(current.id)}
                        className="px-2 py-1 text-xs rounded-lg border border-white/10 text-slate-400 hover:border-emerald-500/40 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                      >
                        {t.lnReturn}
                      </button>
                    )}
                    {/* Retirer un véhicule de la flotte sans effacer ses prêts.
                        Le serveur l'offrait ; aucun bouton ne l'appelait. */}
                    <button
                      onClick={() => basculerActivite(v)}
                      disabled={vehiculeOccupe === v.id}
                      title={v.isActive
                        ? 'Retirer de la flotte — les prêts passés sont conservés'
                        : 'Remettre dans la flotte'}
                      className="px-2 py-1 text-xs rounded-lg border border-white/10 text-slate-400 hover:border-amber-500/40 hover:text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-40"
                    >
                      {v.isActive ? 'Retirer' : 'Remettre'}
                    </button>
                    <button
                      onClick={() => supprimerVehicule(v)}
                      disabled={vehiculeOccupe === v.id}
                      title="Supprimer définitivement"
                      className="p-1 rounded-lg border border-white/10 text-slate-500 hover:border-red-500/40 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Le serveur a refusé la suppression et conseillé la
                    désactivation : on met le bouton correspondant SOUS le
                    conseil. Renvoyer l'un sans l'autre serait une impasse. */}
                {desactivationProposee === v.id && v.isActive && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                    <span className="flex-1 text-xs text-amber-300">
                      Son historique de prêts doit être conservé. Vous pouvez le retirer de la flotte :
                      il ne sera plus proposé, mais ses prêts passés resteront consultables.
                    </span>
                    <button
                      onClick={() => basculerActivite(v)}
                      disabled={vehiculeOccupe === v.id}
                      className="shrink-0 rounded-lg bg-amber-600/80 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                    >
                      Retirer de la flotte
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Calendar tab ──────────────────────────────────────────────────── */}
      {tab === 'calendar' && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setWeekStart(d => addDays(d, -7))}
              className="p-1.5 rounded-lg hover:bg-white/[0.07] text-slate-400">←</button>
            <span className="text-sm font-medium text-slate-300">
              {t.lnWeekOf} {format(weekStart, 'd MMM', { locale: loc })} {t.lnTo} {format(addDays(weekStart, 6), 'd MMM yyyy', { locale: loc })}
            </span>
            <button onClick={() => setWeekStart(d => addDays(d, 7))}
              className="p-1.5 rounded-lg hover:bg-white/[0.07] text-slate-400">→</button>
          </div>

          {loading && <div className="flex justify-center py-8"><span className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>}
          {!loading && vehicles.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-8">{t.lnNoVehicles}</p>
          )}

          {!loading && vehicles.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left text-slate-500 py-1 pr-2 font-medium w-28">{t.lnVehicle}</th>
                    {weekDays.map(day => (
                      <th key={day.toISOString()} className="text-center text-slate-500 py-1 px-1 font-medium">
                        <div>{format(day, 'EEE', { locale: loc })}</div>
                        <div className="text-slate-600">{format(day, 'd')}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vehicles.map(v => (
                    <tr key={v.id} className="border-t border-white/[0.05]">
                      <td className="py-2 pr-2">
                        <div className="font-mono text-blue-400 font-semibold truncate max-w-[100px]">{v.licensePlate}</div>
                        <div className="text-slate-500 truncate max-w-[100px]">{v.make ?? v.name}</div>
                      </td>
                      {weekDays.map(day => {
                        const res = getResForVehicleDay(v.id, day)
                        return (
                          <td key={day.toISOString()} className="py-2 px-0.5 text-center">
                            {res.length > 0 ? (
                              <div className="bg-amber-500/20 border border-amber-500/30 rounded px-1 py-0.5 text-amber-400 text-[9px] truncate max-w-[52px]">
                                {res[0].clientName.split(' ')[0]}
                              </div>
                            ) : (
                              <div className="w-full h-5 rounded bg-emerald-500/10" />
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Book tab ──────────────────────────────────────────────────────── */}
      {tab === 'book' && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-400" /> {t.lnNewReservation}
            </h3>

            {error && (
              <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
              </div>
            )}

            <div className="space-y-3">
              {/* Vehicle selector from saved fleet */}
              <div>
                <label className="text-xs text-slate-500 mb-1 block">{t.lnFleetVehicle} *</label>
                <select value={resForm.vehicleId}
                  onChange={e => setResForm(f => ({ ...f, vehicleId: e.target.value }))}
                  className={INPUT}>
                  <option value="" className="bg-[#111827]">{t.lnSelectVehicle}</option>
                  {vehicles.filter(v => v.isActive).map(v => {
                    const cur = activeDates(v)
                    return (
                      <option key={v.id} value={v.id} className="bg-[#111827]"
                        disabled={!!cur}>
                        {cur ? '🔴 ' : '🟢 '}{v.licensePlate} — {v.name}{v.make ? ` (${v.make}${v.model ? ' ' + v.model : ''})` : ''}
                        {cur ? ` [${t.lnLentUntil} ${fmtDate(cur.endDate, loc)}]` : ''}
                      </option>
                    )
                  })}
                </select>
                {vehicles.length === 0 && (
                  <p className="text-xs text-slate-500 mt-1">{t.lnNoVehiclesHint}</p>
                )}
              </div>

              <div>
                <label className="text-xs text-slate-500 mb-1 block">{t.lnClient} *</label>
                <input value={resForm.clientName}
                  onChange={e => setResForm(f => ({ ...f, clientName: e.target.value }))}
                  placeholder={t.lnClientNamePh}
                  className={INPUT} />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">{t.uiPhone}</label>
                <input value={resForm.clientPhone}
                  onChange={e => setResForm(f => ({ ...f, clientPhone: e.target.value }))}
                  placeholder="+33 6 00 00 00 00"
                  className={INPUT} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">{t.lnStartDate}</label>
                  <DateField value={resForm.startDate}
                    onChange={v => setResForm(f => ({ ...f, startDate: v }))}
                    wrapperClassName="w-full" className={INPUT} />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">{t.lnEndDate}</label>
                  <DateField value={resForm.endDate}
                    onChange={v => setResForm(f => ({ ...f, endDate: v }))}
                    wrapperClassName="w-full" className={INPUT} />
                </div>
              </div>

              {/* Paid / Free toggle */}
              <div className="border border-white/[0.1] rounded-xl p-3 space-y-3 bg-white/[0.02]">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                    <Euro className="w-3.5 h-3.5 text-emerald-400" /> {t.lnPaidLoan}
                  </label>
                  <button
                    type="button"
                    onClick={() => setResForm(f => ({ ...f, isPaid: !f.isPaid }))}
                    className={cn(
                      'relative inline-flex h-5 w-9 rounded-full transition-colors',
                      resForm.isPaid ? 'bg-emerald-600' : 'bg-slate-700'
                    )}
                  >
                    <span className={cn(
                      'inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform m-1',
                      resForm.isPaid ? 'translate-x-4' : 'translate-x-0'
                    )} />
                  </button>
                </div>
                {resForm.isPaid && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">{t.lnDailyRate}</label>
                      <input type="number" min={0} value={resForm.dailyRate}
                        onChange={e => setResForm(f => ({ ...f, dailyRate: e.target.value }))}
                        placeholder="50"
                        className={INPUT} />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">{t.lnDeposit}</label>
                      <input type="number" min={0} value={resForm.depositAmount}
                        onChange={e => setResForm(f => ({ ...f, depositAmount: e.target.value }))}
                        placeholder="200"
                        className={INPUT} />
                    </div>
                    {resForm.dailyRate && resForm.startDate && resForm.endDate && (
                      <div className="col-span-2 text-xs text-emerald-400 bg-emerald-500/10 rounded-lg px-3 py-2">
                        {/* Le total était un produit flottant BRUT : 3 × 19,90 s'affichait
                            « 59.699999999999996€ » au comptoir, au moment même où l'on
                            annonce le prix au client. Passage par la couche monétaire
                            entière (dix-millièmes) puis rendu au centime. */}
                        {t.lnEstTotal} {joursEstimes(resForm.startDate, resForm.endDate)} {t.lnDayShort} × {resForm.dailyRate}€ = <strong>{formatEuros(fromCents(lineTotalCentsFromScaled(toScaled(Number(resForm.dailyRate) || 0), toScaled(joursEstimes(resForm.startDate, resForm.endDate)))))}</strong>
                        {resForm.depositAmount ? ` + ${t.lnPlusDeposit} ${resForm.depositAmount}€` : ''}
                      </div>
                    )}
                  </div>
                )}
                {!resForm.isPaid && (
                  <p className="text-xs text-slate-500">{t.lnFreeLoan}</p>
                )}
              </div>

              <div>
                <label className="text-xs text-slate-500 mb-1 block">{t.uiNotes}</label>
                <textarea value={resForm.notes}
                  onChange={e => setResForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2} placeholder={t.lnNotesPh}
                  className={cn(INPUT, 'resize-none')} />
              </div>
              <button onClick={saveReservation} disabled={savingRes}
                className="w-full px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2">
                {savingRes ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
                {t.lnConfirmReservation}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-5 py-3 border-t border-white/[0.07] flex items-center justify-between text-xs text-slate-500">
        <span>{vehicles.length} {t.lnLoanerVehicles}</span>
        <span>{vehicles.filter(v => !activeDates(v)).length} {t.lnAvailablePl}</span>
      </div>
    </div>
  )
}
