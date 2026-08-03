'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  X, CheckCircle2, AlertTriangle, XCircle, Minus,
  Camera, Trash2, Download, Send, ClipboardList,
  ChevronDown, ChevronRight, ZoomIn,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import { useTranslation } from '@/lib/i18n'
import { inspectionCategoryLabel } from '@/lib/i18n/labels'

interface InspectionItem {
  id: string
  category: string
  label: string
  status: 'ok' | 'warning' | 'critical' | 'na'
  notes?: string | null
  photoBase64?: string | null  // legacy base64
  photoPath?:   string | null  // filesystem path
  sortOrder: number
}

function inspectionPhotoSrc(item: InspectionItem): string | null {
  if (item.photoPath) return `/api/photos/${item.photoPath}`
  return item.photoBase64 ?? null
}

interface Inspection {
  id: string
  status: string
  clientName: string
  vehicleModel?: string | null
  licensePlate?: string | null
  mileage?: number | null
  notes?: string | null
  items: InspectionItem[]
  createdAt: string
}

interface Props {
  jobId?: string | null
  vehicleId?: string | null
  prefill?: {
    clientName?: string
    vehicleModel?: string
    licensePlate?: string
    mileage?: number
  }
  inspectionId?: string | null  // open existing
  onClose: () => void
  onSaved?: (inspection: Inspection) => void
}

const CATEGORY_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  brakes:     { label: 'Freins',           icon: '🔴', color: 'bg-red-50 border-red-200' },
  tires:      { label: 'Pneus',            icon: '⚫', color: 'bg-gray-50 border-gray-200' },
  lights:     { label: 'Éclairage',        icon: '💡', color: 'bg-yellow-50 border-yellow-200' },
  oil:        { label: 'Niveaux',          icon: '🛢️', color: 'bg-blue-50 border-blue-200' },
  suspension: { label: 'Suspension',       icon: '🔧', color: 'bg-purple-50 border-purple-200' },
  body:       { label: 'Carrosserie',      icon: '🚗', color: 'bg-slate-50 border-slate-200' },
  battery:    { label: 'Batterie',         icon: '🔋', color: 'bg-green-50 border-green-200' },
  belts:      { label: 'Courroies',        icon: '⚙️', color: 'bg-orange-50 border-orange-200' },
  filters:    { label: 'Filtres',          icon: '🌀', color: 'bg-teal-50 border-teal-200' },
}

const STATUS_CONFIG = {
  ok:       { label: 'OK',       icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500' },
  warning:  { label: 'Attention',icon: AlertTriangle,color: 'text-amber-600 bg-amber-50 border-amber-200',    dot: 'bg-amber-500' },
  critical: { label: 'Critique', icon: XCircle,      color: 'text-red-600 bg-red-50 border-red-200',          dot: 'bg-red-500' },
  na:       { label: 'N/A',      icon: Minus,        color: 'text-gray-400 bg-gray-50 border-gray-200',       dot: 'bg-gray-300' },
}

function ItemRow({
  item,
  onUpdate,
}: {
  item: InspectionItem
  onUpdate: (id: string, field: string, value: string | null) => void
}) {
  const { t } = useTranslation()
  const statusLabels: Record<string, string> = { ok: STATUS_CONFIG.ok.label, warning: t.insStWarning, critical: t.insStCritical, na: STATUS_CONFIG.na.label }
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const statusCfg = STATUS_CONFIG[item.status]

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = ev => {
          const img = new Image()
          img.onload = () => {
            const canvas = document.createElement('canvas')
            const MAX = 600
            let { width, height } = img
            if (width > MAX || height > MAX) {
              if (width > height) { height = Math.round(height * MAX / width); width = MAX }
              else { width = Math.round(width * MAX / height); height = MAX }
            }
            canvas.width = width; canvas.height = height
            canvas.getContext('2d')?.drawImage(img, 0, 0, width, height)
            resolve(canvas.toDataURL('image/jpeg', 0.8))
          }
          img.onerror = reject
          img.src = ev.target?.result as string
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      onUpdate(item.id, 'photoBase64', base64)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className={cn('flex items-start gap-3 p-3 rounded-xl border', statusCfg.color)}>
      {/* Status selector */}
      <div className="flex gap-1 shrink-0">
        {(Object.entries(STATUS_CONFIG) as [string, typeof STATUS_CONFIG.ok][]).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => onUpdate(item.id, 'status', key)}
            className={cn(
              'w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all',
              item.status === key ? `${cfg.dot} border-transparent scale-110` : 'bg-white border-gray-200 hover:border-gray-400'
            )}
            title={statusLabels[key] ?? cfg.label}
          >
            {item.status === key && <cfg.icon className="w-3.5 h-3.5 text-white" />}
          </button>
        ))}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">{item.label}</p>
        <input
          value={item.notes ?? ''}
          onChange={e => onUpdate(item.id, 'notes', e.target.value)}
          placeholder={t.insObservationPh}
          className="mt-1 w-full text-xs border-0 bg-transparent text-gray-500 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1"
        />
      </div>

      {/* Photo */}
      <div className="shrink-0">
        {inspectionPhotoSrc(item) ? (
          <div className="relative group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={inspectionPhotoSrc(item)!}
              alt=""
              className="w-12 h-12 object-cover rounded-lg border border-gray-200 cursor-pointer"
              onClick={() => setPhotoPreview(inspectionPhotoSrc(item)!)}
            />
            <button
              onClick={() => onUpdate(item.id, 'photoBase64', null)}
              className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100"
            >
              ×
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-12 h-12 border-2 border-dashed border-gray-200 rounded-lg flex items-center justify-center text-gray-300 hover:border-blue-300 hover:text-blue-400 transition-colors disabled:opacity-50"
          >
            <Camera className="w-4 h-4" />
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
      </div>

      {/* Photo lightbox */}
      {photoPreview && (
        <div
          className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPhotoPreview(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoPreview} alt="" className="max-w-md max-h-[80vh] rounded-xl object-contain" />
        </div>
      )}
    </div>
  )
}

export default function InspectionModal({ jobId, vehicleId, prefill, inspectionId, onClose, onSaved }: Props) {
  const { t } = useTranslation()
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [items, setItems] = useState<InspectionItem[]>([])
  const [form, setForm] = useState({
    clientName: prefill?.clientName ?? '',
    vehicleModel: prefill?.vehicleModel ?? '',
    licensePlate: prefill?.licensePlate ?? '',
    mileage: prefill?.mileage?.toString() ?? '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())
  const pendingUpdates = useRef<Map<string, string | null>>(new Map())
  const saveTimer = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (inspectionId) {
      fetch(`/api/inspections/${inspectionId}`)
        .then(r => r.ok ? r.json() : null)
        .then((d: Inspection | null) => {
          if (!d) return
          setInspection(d)
          setItems(d.items)
          setForm({
            clientName: d.clientName,
            vehicleModel: d.vehicleModel ?? '',
            licensePlate: d.licensePlate ?? '',
            mileage: d.mileage?.toString() ?? '',
            notes: d.notes ?? '',
          })
        })
    }
  }, [inspectionId])

  // Debounced auto-save of item updates
  const flushItemUpdates = useCallback(async (id: string) => {
    if (!inspection || pendingUpdates.current.size === 0) return
    const updates: Record<string, string | null> = {}
    pendingUpdates.current.forEach((val, key) => {
      if (key.startsWith(id + ':')) updates[key.split(':')[1]] = val
    })
    if (Object.keys(updates).length === 0) return
    await fetch(`/api/inspections/${inspection.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: id, ...updates }),
    })
    Array.from(pendingUpdates.current.keys()).forEach(key => {
      if (key.startsWith(id + ':')) pendingUpdates.current.delete(key)
    })
  }, [inspection])

  function updateItem(id: string, field: string, value: string | null) {
    setItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } as InspectionItem : item))

    if (inspection) {
      pendingUpdates.current.set(`${id}:${field}`, value)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => flushItemUpdates(id), 800)
    }
  }

  async function handleCreate() {
    setSaving(true)
    try {
      const r = await fetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: jobId ?? null,
          vehicleId: vehicleId ?? null,
          clientName: form.clientName,
          vehicleModel: form.vehicleModel || null,
          licensePlate: form.licensePlate || null,
          mileage: form.mileage || null,
          notes: form.notes || null,
        }),
      })
      if (!r.ok) throw new Error()
      const created: Inspection = await r.json()
      setInspection(created)
      setItems(created.items)
      toast.success(t.insCreated)
      onSaved?.(created)
    } catch {
      toast.error(t.insCreateError)
    } finally {
      setSaving(false)
    }
  }

  async function handleComplete() {
    if (!inspection) return
    setSaving(true)
    try {
      // Flush any pending item updates first
    const ids = new Set<string>()
    pendingUpdates.current.forEach((_, key) => ids.add(key.split(':')[0]))
    for (const id of Array.from(ids)) {
        await flushItemUpdates(id)
      }
      const r = await fetch(`/api/inspections/${inspection.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed', notes: form.notes }),
      })
      if (!r.ok) throw new Error()
      const updated: Inspection = await r.json()
      setInspection(updated)
      toast.success(t.insFinalized)
      onSaved?.(updated)
    } catch {
      toast.error(t.insFinalizeError)
    } finally {
      setSaving(false)
    }
  }

  async function handleDownloadPDF() {
    const el = document.getElementById('inspection-print')
    if (!el) return
    setPrinting(true)
    try {
      const { default: html2canvas } = await import('html2canvas')
      const { default: jsPDF } = await import('jspdf')
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false })
      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pageW = 210, pageH = 297
      const imgW = pageW - 20
      const imgH = (canvas.height * imgW) / canvas.width
      let remaining = imgH, yOffset = 10
      while (remaining > 0) {
        const sliceH = Math.min(remaining, pageH - 20)
        if (yOffset !== 10) pdf.addPage()
        pdf.addImage(imgData, 'PNG', 10, yOffset, imgW, sliceH)
        remaining -= sliceH
        yOffset = 10
      }
      pdf.save(`inspection-${form.licensePlate || 'vehicule'}.pdf`)
    } catch {
      toast.error(t.insPdfError)
    } finally {
      setPrinting(false)
    }
  }

  const categories = Array.from(new Set(items.map(i => i.category)))
  const criticalItems = items.filter(i => i.status === 'critical')
  const warningItems = items.filter(i => i.status === 'warning')
  const okItems = items.filter(i => i.status === 'ok')
  const score = items.length === 0 ? 0 : Math.round((okItems.length / items.filter(i => i.status !== 'na').length) * 100)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-modal flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <ClipboardList className="w-5 h-5 text-blue-600" />
            <div>
              <h2 className="font-bold text-gray-900">{t.insTitle}</h2>
              {form.vehicleModel && <p className="text-xs text-gray-500">{form.vehicleModel} {form.licensePlate && <span className="font-mono text-blue-600 ml-1">{form.licensePlate}</span>}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {inspection && (
              <button
                onClick={handleDownloadPDF}
                disabled={printing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-lg disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                {printing ? 'PDF…' : t.insPdfClient}
              </button>
            )}
            {inspection && inspection.status === 'draft' && (
              <button
                onClick={handleComplete}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                {t.insFinalize}
              </button>
            )}
            <button onClick={onClose} className="gf-close p-2 hover:bg-gray-100 rounded-lg text-gray-400">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Printable section */}
          <div id="inspection-print" className="p-6 bg-white">
            {/* Setup form (shown when no inspection yet) */}
            {!inspection && (
              <div className="space-y-4 mb-6">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">{t.vmClient} *</label>
                    <input value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder={t.lnClientNamePh} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">{t.jmVehicle}</label>
                    <input value={form.vehicleModel} onChange={e => setForm(f => ({ ...f, vehicleModel: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder={t.insMakeModelPh} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">{t.woPlate}</label>
                    <input value={form.licensePlate} onChange={e => setForm(f => ({ ...f, licensePlate: e.target.value.toUpperCase() }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" placeholder="AB-123-CD" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">{t.vmMileage}</label>
                    <input type="number" value={form.mileage} onChange={e => setForm(f => ({ ...f, mileage: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder={t.insMileagePh} />
                  </div>
                </div>
                <button
                  onClick={handleCreate}
                  disabled={!form.clientName || saving}
                  className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? t.insCreating : t.insStart}
                </button>
              </div>
            )}

            {/* Score summary (when inspection exists) */}
            {inspection && items.length > 0 && (
              <div className="mb-6">
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <div className="text-center bg-emerald-50 rounded-xl p-3">
                    <p className="text-2xl font-bold text-emerald-600">{score}%</p>
                    <p className="text-xs text-emerald-600">{t.insScore}</p>
                  </div>
                  <div className="text-center bg-emerald-50 rounded-xl p-3">
                    <p className="text-2xl font-bold text-emerald-700">{okItems.length}</p>
                    <p className="text-xs text-emerald-600">OK</p>
                  </div>
                  <div className="text-center bg-amber-50 rounded-xl p-3">
                    <p className="text-2xl font-bold text-amber-600">{warningItems.length}</p>
                    <p className="text-xs text-amber-600">{t.insStWarning}</p>
                  </div>
                  <div className="text-center bg-red-50 rounded-xl p-3">
                    <p className="text-2xl font-bold text-red-600">{criticalItems.length}</p>
                    <p className="text-xs text-red-600">{t.insStCritical}</p>
                  </div>
                </div>

                {/* Critical items call-to-action */}
                {criticalItems.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
                    <p className="font-bold text-red-700 text-sm mb-2">
                      ⚠️ {criticalItems.length} {t.insPointsCritical} — {t.insUrgentRecommended}
                    </p>
                    <div className="space-y-1">
                      {criticalItems.map(item => (
                        <p key={item.id} className="text-xs text-red-600 flex items-center gap-2">
                          <XCircle className="w-3 h-3 shrink-0" />
                          {item.label}
                          {item.notes && <span className="text-red-400">— {item.notes}</span>}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {warningItems.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
                    <p className="font-semibold text-amber-700 text-sm mb-1">
                      {warningItems.length} {t.insPointsWatch}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {warningItems.map(item => (
                        <span key={item.id} className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                          {item.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Checklist by category */}
            {inspection && categories.map(cat => {
              const cfg = CATEGORY_CONFIG[cat] ?? { label: cat, icon: '🔧', color: 'bg-gray-50 border-gray-200' }
              const catItems = items.filter(i => i.category === cat)
              const hasCritical = catItems.some(i => i.status === 'critical')
              const hasWarning = catItems.some(i => i.status === 'warning')
              const collapsed = collapsedCats.has(cat)

              return (
                <div key={cat} className={cn('border rounded-xl mb-3 overflow-hidden', cfg.color)}>
                  <button
                    onClick={() => setCollapsedCats(prev => {
                      const next = new Set(prev)
                      next.has(cat) ? next.delete(cat) : next.add(cat)
                      return next
                    })}
                    className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-black/5"
                  >
                    <span className="text-base">{cfg.icon}</span>
                    <span className="font-semibold text-gray-900 text-sm flex-1">{inspectionCategoryLabel(t, cat, cfg.label)}</span>
                    <span className="flex items-center gap-1.5">
                      {hasCritical && <span className="w-2 h-2 rounded-full bg-red-500" />}
                      {hasWarning && !hasCritical && <span className="w-2 h-2 rounded-full bg-amber-500" />}
                      {!hasCritical && !hasWarning && <span className="w-2 h-2 rounded-full bg-emerald-500" />}
                      {collapsed ? <ChevronRight className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                    </span>
                  </button>
                  {!collapsed && (
                    <div className="px-4 pb-3 space-y-2">
                      {catItems.map(item => (
                        <ItemRow key={item.id} item={item} onUpdate={updateItem} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Notes */}
            {inspection && (
              <div className="mt-4">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-1">{t.insGeneralNotes}</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  placeholder={t.insGeneralNotesPh}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
