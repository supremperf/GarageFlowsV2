'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Plus, Pencil, Trash2, Check, BookOpen, RefreshCw, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import { LABOR_DEFAULTS } from '@/lib/labor-defaults'
import { useTranslation } from '@/lib/i18n'

interface LaborOp {
  id: string; name: string; category: string | null; durationMin: number
  unitPrice: number; description: string | null; isActive: boolean
}

const CATEGORIES = ['Tous', 'Moteur', 'Freinage', 'Pneumatiques', 'Électricité', 'Carrosserie', 'Autre']
const CAT_COLORS: Record<string, string> = {
  Moteur:        'bg-orange-500/15 text-orange-400',
  Freinage:      'bg-red-500/15 text-red-400',
  Pneumatiques:  'bg-green-500/15 text-green-400',
  Électricité:   'bg-yellow-500/15 text-yellow-400',
  Carrosserie:   'bg-purple-500/15 text-purple-400',
  Autre:         'bg-slate-500/15 text-slate-400',
}

function fmtDuration(min: number) {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60), m = min % 60
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
}

const emptyForm = { name: '', category: 'Moteur', durationMin: 30, unitPrice: 0, description: '' }

export default function LaborCatalogPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const catLabel: Record<string, string> = {
    Tous: t.catAll, Moteur: t.catEngine, Freinage: t.catBraking, Pneumatiques: t.catTires,
    'Électricité': t.catElectrical, Carrosserie: t.catBodywork, Autre: t.catOther,
  }
  const [ops, setOps]         = useState<LaborOp[]>([])
  const [defaults, setDefaults] = useState<typeof emptyForm[]>([])
  const [loading, setLoading] = useState(true)
  const [catFilter, setCatFilter] = useState('Tous')
  const [q, setQ]             = useState('')
  const [editId, setEditId]   = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm]       = useState(emptyForm)
  const [saving, setSaving]   = useState(false)
  const [importing, setImporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/labor-operations')
    const data = await res.json()
    setOps(data.operations ?? [])
    setDefaults(data.defaults ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const visible = ops.filter(o => {
    if (catFilter !== 'Tous' && o.category !== catFilter) return false
    if (q && !o.name.toLowerCase().includes(q.toLowerCase())) return false
    return true
  })

  async function save() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (editId) {
        await fetch(`/api/labor-operations/${editId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      } else {
        await fetch('/api/labor-operations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      }
      await load()
      setShowAdd(false); setEditId(null); setForm(emptyForm)
    } finally { setSaving(false) }
  }

  async function del(id: string) {
    if (!confirm(t.lcConfirmDelete)) return
    await fetch(`/api/labor-operations/${id}`, { method: 'DELETE' })
    setOps(o => o.filter(x => x.id !== id))
  }

  async function importDefaults() {
    if (importing) return
    setImporting(true)
    try {
      // Utilise les défauts renvoyés par l'API, avec repli sur la liste locale
      // si jamais ils n'ont pas encore été chargés.
      const operations = (defaults && defaults.length > 0) ? defaults : LABOR_DEFAULTS
      const res = await fetch('/api/labor-operations/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operations }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`)
      toast.success(`${data.created ?? operations.length} ${((data.created ?? operations.length) > 1) ? t.lcOpPlural : t.lcOpSingular} ${t.lcImportedWord}`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.lcImportFailed)
    } finally {
      setImporting(false)
    }
  }

  function startEdit(op: LaborOp) {
    setEditId(op.id)
    setForm({ name: op.name, category: op.category ?? 'Autre', durationMin: op.durationMin, unitPrice: op.unitPrice, description: op.description ?? '' })
    setShowAdd(true)
  }

  return (
    <div className="fixed inset-y-0 right-0 w-[440px] bg-[#0f1629] border-l border-white/[0.07] flex flex-col shadow-2xl z-40">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
        <div className="flex items-center gap-2.5">
          <BookOpen className="w-5 h-5 text-blue-400" />
          <h2 className="text-base font-bold text-white">{t.ttLaborCatalog}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-1.5 rounded-lg hover:bg-white/[0.07] text-slate-400"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={importDefaults} disabled={importing}
            title={t.lcImportDefaults}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 font-medium disabled:opacity-50">
            {importing ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{t.lcDefaultsBtn}</span>
          </button>
          <button onClick={() => { setShowAdd(true); setEditId(null); setForm(emptyForm) }}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium">
            <Plus className="w-3.5 h-3.5" /> {t.uiAdd}
          </button>
          <button onClick={onClose} className="gf-close p-1.5 rounded-lg hover:bg-white/[0.07] text-slate-400"><X className="w-5 h-5" /></button>
        </div>
      </div>

      {/* Add/edit form */}
      {showAdd && (
        <div className="border-b border-white/[0.07] p-4 bg-white/[0.02] space-y-3">
          <h3 className="text-sm font-semibold text-white">{editId ? t.uiEdit : t.lcNewOp}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-slate-500 mb-1 block">{t.lcName} *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={t.lcNamePlaceholder}
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{t.lcCategory}</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {CATEGORIES.filter(c => c !== 'Tous').map(c => <option key={c} value={c} className="bg-[#111827]">{catLabel[c] ?? c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{t.lcDurationMin}</label>
              <input type="number" inputMode="numeric" min={1} value={form.durationMin || ''}
                onChange={e => setForm(f => ({ ...f, durationMin: e.target.value === '' ? 0 : Number(e.target.value) }))}
                placeholder="30"
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{t.lcPriceHT}</label>
              <input type="number" inputMode="decimal" min={0} step={0.01} value={form.unitPrice || ''}
                onChange={e => setForm(f => ({ ...f, unitPrice: e.target.value === '' ? 0 : Number(e.target.value) }))}
                placeholder="0"
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{t.lcDurationShown}</label>
              <div className="w-full bg-white/[0.02] border border-white/[0.05] rounded-lg px-3 py-2 text-slate-400 text-sm">{fmtDuration(form.durationMin)}</div>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => { setShowAdd(false); setEditId(null) }} className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-white/10 text-slate-400 hover:bg-white/[0.05]">{t.uiCancel}</button>
            <button onClick={save} disabled={saving || !form.name.trim()}
              className="flex-1 px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-1.5">
              {saving ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {t.uiSave}
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="px-4 pt-3 pb-2 space-y-2 border-b border-white/[0.07]">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={t.lcSearch}
          className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <div className="flex gap-1 flex-wrap">
          {CATEGORIES.map(c => (
            <button key={c} onClick={() => setCatFilter(c)}
              className={cn('px-2 py-0.5 rounded-full text-xs font-medium transition-colors',
                catFilter === c ? 'bg-blue-600 text-white' : 'bg-white/[0.05] text-slate-400 hover:bg-white/[0.1]')}>
              {catLabel[c] ?? c}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading && <div className="flex justify-center py-8"><span className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>}

        {!loading && ops.length === 0 && (
          <div className="text-center py-10 space-y-3">
            <BookOpen className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="text-slate-500 text-sm">{t.lcEmpty}</p>
            <button onClick={importDefaults} disabled={importing}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/30 disabled:opacity-50">
              {importing ? t.lcImporting : `⚡ ${t.lcImportDefaults}`}
            </button>
          </div>
        )}

        {!loading && visible.map(op => (
          <div key={op.id} className="group bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.07] rounded-xl px-4 py-3 flex items-center gap-3 transition-colors">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-medium text-white truncate">{op.name}</span>
                {op.category && <span className={cn('px-1.5 py-0.5 rounded-full text-[10px] font-semibold shrink-0', CAT_COLORS[op.category] ?? CAT_COLORS.Autre)}>{op.category}</span>}
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span className="text-blue-400 font-medium">{fmtDuration(op.durationMin)}</span>
                <span>{op.unitPrice.toLocaleString('fr-FR', { minimumFractionDigits: 0 })} €</span>
              </div>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => startEdit(op)} className="p-1.5 rounded-lg hover:bg-white/[0.1] text-slate-400 hover:text-white"><Pencil className="w-3.5 h-3.5" /></button>
              <button onClick={() => del(op.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}

        {!loading && visible.length === 0 && ops.length > 0 && <p className="text-slate-500 text-sm text-center py-6">{t.lcNoResult}</p>}
      </div>

      {/* Footer stats */}
      <div className="px-5 py-3 border-t border-white/[0.07] text-xs text-slate-500">
        {ops.length} {ops.length !== 1 ? t.lcOpPlural : t.lcOpSingular} {t.lcAtCatalog}
      </div>
    </div>
  )
}
