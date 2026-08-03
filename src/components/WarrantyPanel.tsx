'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, ShieldCheck, AlertTriangle, Clock, Wrench, Plus, ChevronRight, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format, parseISO, differenceInDays } from 'date-fns'
import type { Locale } from 'date-fns'
import { DateField } from '@/components/DateField'
import toast from 'react-hot-toast'
import { useTranslation } from '@/lib/i18n'
import { dateLocale } from '@/lib/i18n/date-locale'

interface Warranty {
  id: string
  partName: string
  partReference: string | null
  lotNumber: string | null
  installedAt: string
  durationMonths: number
  expiresAt: string
  status: string
  supplierName: string | null
  notes: string | null
  claimedAt: string | null
  jobId: string | null
  vehicleId: string | null
  vehicle?: { plate: string; brand: string; model: string } | null
}

interface Alerts {
  expiringSoon: Warranty[]
  justExpired: Warranty[]
  totalAlerts: number
}

const STATUS_COLORS: Record<string, string> = {
  active:  'bg-emerald-500/15 text-emerald-400',
  expired: 'bg-red-500/15 text-red-400',
  claimed: 'bg-amber-500/15 text-amber-400',
}

type TabId = 'active' | 'expiring' | 'claimed' | 'expired'

function fmtDate(d: string, loc: Locale) {
  try { return format(parseISO(d), 'd MMM yyyy', { locale: loc }) } catch { return d }
}

function daysLeft(expiresAt: string) {
  try { return differenceInDays(parseISO(expiresAt), new Date()) } catch { return 0 }
}

const emptyForm = {
  partName: '', partReference: '', lotNumber: '', installedAt: format(new Date(), 'yyyy-MM-dd'),
  durationMonths: 12, supplierName: '', notes: '', vehicleId: '', jobId: '',
  clientName: '', licensePlate: '', vehicleModel: '',
}

export default function WarrantyPanel({ onClose }: { onClose: () => void }) {
  const { t, lang } = useTranslation()
  const loc = dateLocale(lang)
  const statusLabels: Record<string, string> = { active: t.wrStActive, expired: t.wrStExpired, claimed: t.wrStClaimed }
  const tabs: { id: TabId; label: string }[] = [
    { id: 'active',   label: t.wrTabActive },
    { id: 'expiring', label: t.wrTabExpiring },
    { id: 'claimed',  label: t.wrTabClaimed },
    { id: 'expired',  label: t.wrTabExpired },
  ]
  const [tab, setTab]       = useState<TabId>('active')
  const [warranties, setWarranties] = useState<Warranty[]>([])
  const [alerts, setAlerts]         = useState<Alerts | null>(null)
  const [loading, setLoading]       = useState(true)
  const [showAdd, setShowAdd]       = useState(false)
  const [form, setForm]             = useState(emptyForm)
  const [saving, setSaving]         = useState(false)
  const [claiming, setClaiming]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [wRes, aRes] = await Promise.all([
        fetch('/api/warranties'),
        fetch('/api/warranties/alerts'),
      ])
      const wData = await wRes.json().catch(() => null)
      const aData = await aRes.json().catch(() => null)
      setWarranties(Array.isArray(wData) ? wData : (wData?.warranties ?? []))
      setAlerts(aData && aData.expiringSoon ? aData : { expiringSoon: [], justExpired: [], totalAlerts: 0 })
    } catch {
      setWarranties([])
      setAlerts({ expiringSoon: [], justExpired: [], totalAlerts: 0 })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = warranties.filter(w => {
    if (tab === 'active')   return w.status === 'active' && daysLeft(w.expiresAt) > 30
    if (tab === 'expiring') return w.status === 'active' && daysLeft(w.expiresAt) <= 30
    if (tab === 'claimed')  return w.status === 'claimed'
    if (tab === 'expired')  return w.status === 'expired'
    return true
  })

  async function save() {
    if (!form.partName.trim() || !form.clientName.trim()) {
      toast.error(t.wrReqPartClient)
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/warranties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          clientName:   form.clientName.trim(),
          durationMonths: Math.max(1, Number(form.durationMonths) || 12),
          licensePlate: form.licensePlate || null,
          vehicleModel: form.vehicleModel || null,
          vehicleId:    form.vehicleId || null,
          jobId:        form.jobId || null,
          partReference:form.partReference || null,
          lotNumber:    form.lotNumber || null,
          supplierName: form.supplierName || null,
          notes:        form.notes || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.error || t.uiSaveFailed)
      }
      toast.success(t.wrSaved)
      await load()
      setShowAdd(false)
      setForm(emptyForm)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.uiSaveError)
    } finally { setSaving(false) }
  }

  async function claim(id: string) {
    if (!confirm(t.wrClaimConfirm)) return
    setClaiming(id)
    try {
      await fetch(`/api/warranties/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'claimed' }),
      })
      await load()
    } finally { setClaiming(null) }
  }

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-[460px] bg-[#0f1629] border-l border-white/[0.07] flex flex-col shadow-2xl z-40 pt-safe pb-safe pr-safe">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <h2 className="text-base font-bold text-white">{t.wrTitle}</h2>
          {alerts && alerts.totalAlerts > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">
              {alerts.totalAlerts}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-1.5 rounded-lg hover:bg-white/[0.07] text-slate-400" title={t.navRefresh}>
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setShowAdd(true); setForm(emptyForm) }}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
          >
            <Plus className="w-3.5 h-3.5" /> {t.uiAdd}
          </button>
          <button onClick={onClose} className="gf-close p-1.5 rounded-lg hover:bg-white/[0.07] text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Alert banner */}
      {alerts && alerts.totalAlerts > 0 && (
        <div className="mx-4 mt-3 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-amber-300 leading-relaxed">
            {alerts.expiringSoon.length > 0 && (
              <span><strong>{alerts.expiringSoon.length}</strong> {alerts.expiringSoon.length > 1 ? t.wrWarrantiesWord : t.wrWarrantyWord} {t.wrExpiresSoon} </span>
            )}
            {alerts.justExpired.length > 0 && (
              <span><strong>{alerts.justExpired.length}</strong> {alerts.justExpired.length > 1 ? t.wrWarrantiesWord : t.wrWarrantyWord} {t.wrJustExpired}</span>
            )}
          </div>
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="border-b border-white/[0.07] p-4 bg-white/[0.02] space-y-3 mt-2">
          <h3 className="text-sm font-semibold text-white">{t.wrNew}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-slate-500 mb-1 block">{t.wrClient} *</label>
              <input value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))}
                placeholder={t.wrClientName}
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{t.wrPlate}</label>
              <input value={form.licensePlate} onChange={e => setForm(f => ({ ...f, licensePlate: e.target.value }))}
                placeholder="AA-000-BB"
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{t.wrVehicle}</label>
              <input value={form.vehicleModel} onChange={e => setForm(f => ({ ...f, vehicleModel: e.target.value }))}
                placeholder="ex: Peugeot 308"
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-slate-500 mb-1 block">{t.wrPart} *</label>
              <input value={form.partName} onChange={e => setForm(f => ({ ...f, partName: e.target.value }))}
                placeholder="ex: Plaquettes de frein avant"
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{t.wrRef}</label>
              <input value={form.partReference} onChange={e => setForm(f => ({ ...f, partReference: e.target.value }))}
                placeholder="REF-001"
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{t.wrLot}</label>
              <input value={form.lotNumber} onChange={e => setForm(f => ({ ...f, lotNumber: e.target.value }))}
                placeholder="LOT-2024-001"
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{t.wrInstallDate}</label>
              <DateField value={form.installedAt} onChange={v => setForm(f => ({ ...f, installedAt: v }))}
                wrapperClassName="w-full"
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{t.wrDuration}</label>
              <input type="number" inputMode="numeric" min={1} max={120} value={form.durationMonths || ''}
                onChange={e => setForm(f => ({ ...f, durationMonths: e.target.value === '' ? 0 : Number(e.target.value) }))}
                placeholder="12"
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-slate-500 mb-1 block">{t.wrSupplier}</label>
              <input value={form.supplierName} onChange={e => setForm(f => ({ ...f, supplierName: e.target.value }))}
                placeholder="ex: Bosch"
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-slate-500 mb-1 block">{t.uiNotes}</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2} placeholder={t.wrConditions}
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => setShowAdd(false)} className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-white/10 text-slate-400 hover:bg-white/[0.05]">{t.uiCancel}</button>
            <button onClick={save} disabled={saving || !form.partName.trim() || !form.clientName.trim()}
              className="flex-1 px-3 py-1.5 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium disabled:opacity-50">
              {saving ? t.uiSaving : t.uiSave}
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 px-4 pt-3 pb-2 border-b border-white/[0.07]">
        {tabs.map(tb => (
          <button key={tb.id} onClick={() => setTab(tb.id)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              tab === tb.id ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.07]')}>
            {tb.label}
            {tb.id === 'expiring' && alerts && alerts.expiringSoon.length > 0 && (
              <span className="ml-1 px-1 rounded-full text-[9px] bg-amber-500/25 text-amber-400">{alerts.expiringSoon.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading && (
          <div className="flex justify-center py-8">
            <span className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-10">
            <ShieldCheck className="w-8 h-8 text-slate-700 mx-auto mb-2" />
            <p className="text-slate-500 text-sm">{t.wrEmpty}</p>
          </div>
        )}

        {!loading && filtered.map(w => {
          const days = daysLeft(w.expiresAt)
          const urgent = w.status === 'active' && days <= 30
          return (
            <div key={w.id} className={cn(
              'bg-white/[0.03] hover:bg-white/[0.06] border rounded-xl px-4 py-3 transition-colors',
              urgent ? 'border-amber-500/30' : 'border-white/[0.07]'
            )}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-white truncate">{w.partName}</span>
                    <span className={cn('px-1.5 py-0.5 rounded-full text-[10px] font-semibold shrink-0',
                      STATUS_COLORS[w.status] ?? 'bg-slate-500/15 text-slate-400')}>
                      {statusLabels[w.status] ?? w.status}
                    </span>
                  </div>
                  {w.vehicle && (
                    <p className="text-xs text-slate-500 mb-1">{w.vehicle.plate} · {w.vehicle.brand} {w.vehicle.model}</p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    {w.partReference && <span>{t.wrRef}: {w.partReference}</span>}
                    {w.lotNumber && <span>{t.wrLot}: {w.lotNumber}</span>}
                    {w.supplierName && <span>{w.supplierName}</span>}
                  </div>
                  <div className="flex items-center gap-3 text-xs mt-1">
                    <span className="text-slate-500">{t.wrInstalledOn} {fmtDate(w.installedAt, loc)}</span>
                    <span className={cn(urgent ? 'text-amber-400 font-medium' : 'text-slate-400')}>
                      {w.status === 'expired' ? `${t.wrExpiredOn} ${fmtDate(w.expiresAt, loc)}`
                        : w.status === 'claimed' ? `${t.wrClaimedOn} ${w.claimedAt ? fmtDate(w.claimedAt, loc) : '—'}`
                        : days <= 0 ? t.wrStExpired
                        : `${days} ${t.wrDaysLeft}`}
                    </span>
                  </div>
                </div>
                {w.status === 'active' && (
                  <button
                    onClick={() => claim(w.id)}
                    disabled={claiming === w.id}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-white/10 text-slate-400 hover:border-amber-500/40 hover:text-amber-400 hover:bg-amber-500/10 transition-colors shrink-0"
                    title={t.wrClaimTitle}
                  >
                    {claiming === w.id ? <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" /> : <Wrench className="w-3 h-3" />}
                    <span>{t.wrClaim}</span>
                    <ChevronRight className="w-3 h-3" />
                  </button>
                )}
              </div>
              {urgent && (
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-400">
                  <Clock className="w-3 h-3" />
                  {t.wrExpiresIn} {days} {days > 1 ? t.wrDays : t.wrDay}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-white/[0.07] text-xs text-slate-500">
        {warranties.filter(w => w.status === 'active').length} {warranties.filter(w => w.status === 'active').length !== 1 ? t.wrWarrantiesWord : t.wrWarrantyWord} {t.wrActiveWord}
      </div>
    </div>
  )
}
