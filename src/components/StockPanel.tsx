'use client'
import { lineCents, fromCents } from '@/lib/money'

import { useState, useEffect, useCallback } from 'react'
import { Part } from '@/lib/types'
import { cn } from '@/lib/utils'
import {
  Package, X, Plus, AlertTriangle, Search, Edit3, Check, ChevronDown,
  ChevronUp, Loader2, Trash2, RefreshCw, TrendingDown
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from '@/lib/i18n'

interface StockPanelProps {
  onClose: () => void
}

function PartRow({ part, onUpdate, onDelete }: {
  part: Part
  onUpdate: (id: string, data: Partial<Part> & { expectedQuantity?: number }) => void
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [qty, setQty] = useState(String(part.quantity))
  const isLow = part.quantity <= part.minQuantity
  const isEmpty = part.quantity === 0

  async function saveQty() {
    const newQty = Math.max(0, Number(qty))
    // On transmet la quantité OBSERVÉE (celle affichée quand l'édition a
    // commencé) : le serveur n'applique la correction que si le stock vaut
    // encore cette valeur. Sans cela, une vente concurrente était écrasée.
    await onUpdate(part.id, { quantity: newQty, expectedQuantity: part.quantity })
    setEditing(false)
  }

  // La quantité affichée peut avoir changé sous nos pieds (vente, réception) :
  // on resynchronise le champ d'édition sur la valeur du serveur.
  useEffect(() => { setQty(String(part.quantity)) }, [part.quantity])

  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-0',
      isEmpty && 'bg-red-50/50',
      !isEmpty && isLow && 'bg-amber-50/50'
    )}>
      {/* Status dot */}
      <div className={cn(
        'w-2 h-2 rounded-full flex-shrink-0',
        isEmpty ? 'bg-red-500' : isLow ? 'bg-amber-500' : 'bg-green-500'
      )} />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{part.name}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {part.reference && (
            <span className="text-[10px] text-gray-600 font-mono">{part.reference}</span>
          )}
          {part.location && (
            <span className="text-[10px] text-gray-600">📍 {part.location}</span>
          )}
          <span className="text-[10px] text-gray-600">
            {t.stkBuy} {part.unitCost.toFixed(2)}€ · {t.stkSell} {part.unitPrice.toFixed(2)}€
          </span>
        </div>
      </div>

      {/* Quantity editor */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {editing ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setQty(q => String(Math.max(0, Number(q) - 1)))}
              className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-100"
            >
              −
            </button>
            <input
              type="number"
              inputMode="numeric"
              value={qty}
              onChange={e => setQty(e.target.value)}
              className="w-12 text-center border border-blue-300 rounded px-1 py-0.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              onKeyDown={e => { if (e.key === 'Enter') saveQty() }}
              autoFocus
            />
            <button
              onClick={() => setQty(q => String(Number(q) + 1))}
              className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-100"
            >
              +
            </button>
            <button onClick={saveQty} className="p-1 rounded bg-blue-600 text-white hover:bg-blue-700">
              <Check className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setQty(String(part.quantity)); setEditing(true) }}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded-lg text-sm font-bold hover:bg-gray-100 transition-colors',
              isEmpty ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-gray-700'
            )}
          >
            {isEmpty && <AlertTriangle className="w-3 h-3" />}
            {part.quantity}
            <span className="text-[10px] font-normal text-gray-500">/ {t.stkMin} {part.minQuantity}</span>
          </button>
        )}
      </div>

      <button
        onClick={() => onDelete(part.id)}
        aria-label={`Supprimer ${part.name}`}
        title={`Supprimer ${part.name}`}
        className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-500 transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function AddPartForm({ onAdd }: { onAdd: (p: Partial<Part>) => Promise<void> }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    name: '', reference: '', quantity: '0', minQuantity: '5',
    unitCost: '0', unitPrice: '0', location: '',
    // Fournisseur : c'est ce champ qui alimente le réapprovisionnement groupé du
    // module « Fournisseurs ». Sans lui, aucune pièce n'était rattachée à un
    // fournisseur et ce module restait vide sur toute installation réelle.
    supplierName: '', supplierRef: '',
  })
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await onAdd({
        name: form.name,
        reference: form.reference || undefined,
        quantity: Number(form.quantity),
        minQuantity: Number(form.minQuantity),
        unitCost: Number(form.unitCost),
        unitPrice: Number(form.unitPrice),
        location: form.location || undefined,
        supplierName: form.supplierName || undefined,
        supplierRef: form.supplierRef || undefined,
      })
      setForm({
        name: '', reference: '', quantity: '0', minQuantity: '5',
        unitCost: '0', unitPrice: '0', location: '', supplierName: '', supplierRef: '',
      })
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  const input = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="border-t border-gray-100">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors"
      >
        <Plus className="w-4 h-4" />
        {t.stkAddPart}
        {open ? <ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="p-4 bg-gray-50 border-t border-gray-100 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <input className={input} placeholder={`${t.stkPartName} *`} value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </div>
            <input className={input} placeholder={t.stkReference} value={form.reference}
              onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
            <input className={input} placeholder={t.stkLocation} value={form.location}
              onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
            {/* Fournisseur — c'est ce couple qui rend le réapprovisionnement
                groupé possible : /api/suppliers regroupe les pièces sous le
                seuil par `supplierName`, et interroge le connecteur avec
                `supplierRef` comme référence catalogue. */}
            <input className={input} placeholder={t.stkSupplier} value={form.supplierName}
              onChange={e => setForm(f => ({ ...f, supplierName: e.target.value }))} />
            <input className={input} placeholder={t.stkSupplierRef} value={form.supplierRef}
              onChange={e => setForm(f => ({ ...f, supplierRef: e.target.value }))} />
            <div>
              <label className="text-xs text-gray-500 mb-0.5 block">{t.stkBuyPrice}</label>
              <input type="number" step="0.01" min="0" className={input} value={form.unitCost}
                onChange={e => setForm(f => ({ ...f, unitCost: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-0.5 block">{t.stkSellPrice}</label>
              <input type="number" step="0.01" min="0" className={input} value={form.unitPrice}
                onChange={e => setForm(f => ({ ...f, unitPrice: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-0.5 block">{t.stkQty}</label>
              <input type="number" min="0" className={input} value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-0.5 block">{t.stkMinThreshold}</label>
              <input type="number" min="0" className={input} value={form.minQuantity}
                onChange={e => setForm(f => ({ ...f, minQuantity: e.target.value }))} />
            </div>
          </div>
          <button
            type="submit"
            disabled={saving || !form.name.trim()}
            className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {t.stkAddToCatalog}
          </button>
        </form>
      )}
    </div>
  )
}

export default function StockPanel({ onClose }: StockPanelProps) {
  const { t } = useTranslation()
  const [parts, setParts] = useState<Part[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [view, setView] = useState<'all' | 'stock' | 'low'>('all')

  const fetchParts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/parts')
      if (res.ok) setParts(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchParts() }, [fetchParts])

  async function handleUpdate(id: string, data: Partial<Part> & { expectedQuantity?: number }) {
    const res = await fetch(`/api/parts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (res.ok) {
      const updated = await res.json()
      setParts(p => p.map(x => x.id === id ? updated : x))
      toast.success(t.stkUpdated)
      return
    }
    // Un échec était AVALÉ : l'écran affichait l'ancienne valeur sans un mot, et
    // l'utilisateur croyait sa correction enregistrée. Le refus de correction
    // concurrente (409) exige au contraire d'être vu et de rafraîchir l'écran.
    const err = await res.json().catch(() => ({} as { error?: string }))
    toast.error(err.error ?? `Erreur ${res.status}`)
    if (res.status === 409) await fetchParts()
  }

  async function handleDelete(id: string) {
    if (!confirm(t.stkConfirmDelete)) return
    const res = await fetch(`/api/parts/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setParts(p => p.filter(x => x.id !== id))
      toast.success(t.stkDeleted)
      return
    }
    // Idem : le refus de supprimer une pièce qui porte un historique de stock
    // (GF31-AUD-015) était invisible — la pièce restait là, sans explication.
    const err = await res.json().catch(() => ({} as { error?: string }))
    toast.error(err.error ?? `Erreur ${res.status}`)
  }

  async function handleAdd(data: Partial<Part>) {
    const res = await fetch('/api/parts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (res.ok) {
      const created = await res.json()
      setParts(p => [...p, created])
      toast.success(t.stkAdded)
    } else {
      const err = await res.json().catch(() => ({}))
      toast.error(err.error ?? `Erreur ${res.status}`)
      throw new Error(err.error ?? `Erreur ${res.status}`)
    }
  }

  const filtered = parts.filter(p => {
    const matchQ = !q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.reference ?? '').toLowerCase().includes(q.toLowerCase())
    const matchView = view === 'stock' ? p.quantity > 0 : view === 'low' ? p.quantity <= p.minQuantity : true
    return matchQ && matchView
  })

  const lowCount = parts.filter(p => p.quantity <= p.minQuantity).length
  const inStockCount = parts.filter(p => p.quantity > 0).length
  const totalValue = parts.reduce((s, p) => s + fromCents(lineCents(p.unitCost, p.quantity)), 0)

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-end p-4">
      {/*
        Fond cliquable — il FERME le volet au premier clic, y compris sur toute
        la surface laissée libre à gauche du panneau. Auparavant cette surface
        était en `pointer-events-none` : les clics n'atteignaient rien du tout,
        alors que le panneau se déclare `aria-modal="true"` (un dialogue modal
        qui laisse l'application cliquable derrière ment à l'utilisateur comme
        aux lecteurs d'écran). C'est aussi la convention du reste de
        l'application : `BillingPanel`, `FinancialDashboard` et `GfDrawer`
        ferment tous sur un clic à l'extérieur.
      */}
      <button
        type="button"
        aria-label={`Fermer — ${t.stkTitle}`}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-backdrop cursor-default"
        tabIndex={-1}
      />
      <div role="dialog" aria-modal="true" aria-label={t.stkTitle} className="relative z-[1] w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-200 max-h-modal flex flex-col animate-slide-in">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-600" />
            <h2 className="font-bold text-gray-900">{t.stkTitle}</h2>
            {lowCount > 0 && (
              <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {lowCount} {lowCount > 1 ? t.stkAlertPlural : t.stkAlertSingular}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchParts} aria-label="Rafraîchir le stock" title="Rafraîchir" className="p-1.5 rounded hover:bg-gray-100 text-gray-500">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={onClose} aria-label="Fermer" title="Fermer" className="gf-close p-1.5 rounded hover:bg-gray-100 text-gray-500">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="px-5 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center gap-4 text-xs text-gray-600">
          <span><strong className="text-gray-900">{parts.length}</strong> {t.stkRefs}</span>
          <span><strong className="text-gray-900">{inStockCount}</strong> {t.stkInStockStat}</span>
          <span><strong className="text-gray-900">{totalValue.toFixed(0)}€</strong> {t.stkStockValue}</span>
          {lowCount > 0 && (
            <span className="text-amber-600 flex items-center gap-1">
              <TrendingDown className="w-3 h-3" />
              <strong>{lowCount}</strong> {t.stkBelowMin}
            </span>
          )}
        </div>

        {/* Search */}
        <div className="px-4 pt-3 pb-2 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={t.stkSearch}
              className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {/* View filter: all / in stock / low */}
          <div className="flex items-center gap-1 mt-2">
            {([
              { id: 'all',   label: t.stkFilterAll,   count: parts.length },
              { id: 'stock', label: t.stkFilterInStock, count: inStockCount },
              { id: 'low',   label: t.stkFilterAlerts,  count: lowCount },
            ] as const).map(f => (
              <button
                key={f.id}
                onClick={() => setView(f.id)}
                className={cn(
                  'flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold border transition-colors flex items-center justify-center gap-1',
                  view === f.id
                    ? (f.id === 'low' ? 'bg-amber-100 border-amber-300 text-amber-800' : 'bg-blue-100 border-blue-300 text-blue-800')
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                )}
              >
                {f.id === 'low' && <AlertTriangle className="w-3 h-3" />}
                {f.label}
                <span className={cn('px-1.5 py-0.5 rounded-full text-[10px]',
                  view === f.id ? 'bg-white/70 text-gray-700' : 'bg-gray-100 text-gray-500')}>{f.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Parts list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10">
              <Package className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-500">
                {parts.length === 0 ? t.stkEmptyCatalog
                  : view === 'stock' ? t.stkEmptyInStock
                  : view === 'low' ? t.stkEmptyAlerts
                  : t.stkNoResult}
              </p>
            </div>
          ) : (
            filtered.map(part => (
              <PartRow key={part.id} part={part} onUpdate={handleUpdate} onDelete={handleDelete} />
            ))
          )}
        </div>

        <AddPartForm onAdd={handleAdd} />
      </div>
    </div>
  )
}
