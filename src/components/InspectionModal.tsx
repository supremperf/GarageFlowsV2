'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  X, CheckCircle2, AlertTriangle, XCircle, Minus,
  Camera, Trash2, Download, Send, ClipboardList,
  ChevronDown, ChevronRight, ZoomIn,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { reduirePhoto } from '@/lib/photo-client'
import { groupPendingUpdates, pendingKeysForItem } from '@/lib/inspection-autosave'
import toast from 'react-hot-toast'
import { useTranslation } from '@/lib/i18n'
import { inspectionCategoryLabel } from '@/lib/i18n/labels'
import { InspectionPrintDocument, type PrintGarage } from '@/components/inspection/InspectionPrintDocument'
import { renderElementToA4Pdf, PRINT_HOST_STYLE } from '@/lib/pdf/render-a4'

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

/**
 * Champ de saisie de la modale — la modale est une SURFACE CLAIRE (`bg-white`,
 * cf. `.gf-surface-light` dans globals.css) : le texte saisi doit rester sombre
 * quel que soit le thème de l'application. La couleur vient des variables
 * `--input-text` / `--input-placeholder` héritées de la surface ; les classes
 * ci-dessous fixent la géométrie et documentent l'intention.
 */
const INSP_INPUT =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 ' +
  'placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-300'

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
      // Réduction par le module partagé (GF-038) — vignette de contrôle : 600 px.
      const base64 = await reduirePhoto(file, { coteMax: 600, qualite: 0.8 })
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
          className="mt-1 w-full text-xs border-0 bg-transparent text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1"
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
  const [garage, setGarage] = useState<PrintGarage | null>(null)
  const pendingUpdates = useRef<Map<string, string | null>>(new Map())
  const saveTimer = useRef<NodeJS.Timeout | null>(null)
  /** Nœud du document d'impression, rendu hors écran (jamais l'interface). */
  const printRef = useRef<HTMLDivElement>(null)

  // En-tête du PDF : sans ces informations le document ne ressemble pas à une
  // pièce de garage. Chargé une fois, sans bloquer l'ouverture de la modale.
  useEffect(() => {
    let cancelled = false
    fetch('/api/garages')
      .then(r => r.ok ? r.json() : null)
      .then((g) => { if (!cancelled && g) setGarage(g) })
      .catch(() => { /* le PDF reste imprimable sans en-tête */ })
    return () => { cancelled = true }
  }, [])

  /** Véhicule réellement rattaché, résolu par le serveur (jamais deviné ici). */
  const [resolvedVehicleId, setResolvedVehicleId] = useState<string | null>(vehicleId ?? null)

  function applyInspection(d: Inspection) {
    setInspection(d)
    setItems(d.items)
    setForm({
      clientName: d.clientName,
      vehicleModel: d.vehicleModel ?? '',
      licensePlate: d.licensePlate ?? '',
      mileage: d.mileage?.toString() ?? '',
      notes: d.notes ?? '',
    })
  }

  useEffect(() => {
    if (inspectionId) {
      fetch(`/api/inspections/${inspectionId}`)
        .then(r => r.ok ? r.json() : null)
        .then((d: Inspection | null) => { if (d) applyInspection(d) })
    }
  }, [inspectionId])

  // Ouverture depuis une intervention / un véhicule : on REPREND le contrôle en
  // cours s'il existe (rouvrir la modale créait sinon un doublon et perdait la
  // saisie), sinon on préremplit depuis les RELATIONS RÉELLES résolues côté
  // serveur — et non depuis les seuls libellés recopiés en props.
  useEffect(() => {
    if (inspectionId) return
    if (!jobId && !vehicleId) return
    let cancelled = false
    const qs = new URLSearchParams()
    if (jobId) qs.set('jobId', jobId)
    if (vehicleId) qs.set('vehicleId', vehicleId)

    ;(async () => {
      try {
        const existingRes = await fetch(`/api/inspections?${qs.toString()}`)
        const existing: Inspection[] = existingRes.ok ? await existingRes.json() : []
        const draft = Array.isArray(existing) ? existing.find(i => i.status === 'draft') : undefined
        if (cancelled) return
        if (draft) { applyInspection(draft); return }

        const ctxRes = await fetch(`/api/inspections/prefill?${qs.toString()}`)
        if (!ctxRes.ok || cancelled) return
        const ctx = await ctxRes.json() as {
          vehicleId: string | null; clientName: string
          vehicleModel: string; licensePlate: string; mileage: number | null
        }
        if (cancelled) return
        setResolvedVehicleId(ctx.vehicleId ?? null)
        // Les valeurs serveur complètent le formulaire sans écraser une saisie
        // déjà faite par l'utilisateur.
        setForm(f => ({
          ...f,
          clientName:   f.clientName   || ctx.clientName   || '',
          vehicleModel: f.vehicleModel || ctx.vehicleModel || '',
          licensePlate: f.licensePlate || ctx.licensePlate || '',
          mileage:      f.mileage      || (ctx.mileage != null ? String(ctx.mileage) : ''),
        }))
      } catch {
        /* hors ligne : le préremplissage par props reste affiché */
      }
    })()

    return () => { cancelled = true }
  }, [inspectionId, jobId, vehicleId])

  // Auto-sauvegarde débouncée. On flushe TOUS les items en attente (pas seulement
  // le dernier édité) : un timer partagé ne ciblant qu'un id orphelinait sinon
  // les modifications des autres items. Les clés d'un item ne sont retirées
  // qu'APRÈS envoi réussi (une erreur réseau les conserve pour un re-flush).
  const flushAll = useCallback(async () => {
    if (!inspection || pendingUpdates.current.size === 0) return
    const patches = groupPendingUpdates(pendingUpdates.current)
    for (const patch of patches) {
      try {
        const res = await fetch(`/api/inspections/${inspection.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId: patch.itemId, ...patch.fields }),
        })
        if (res.ok) {
          for (const key of pendingKeysForItem(patch)) pendingUpdates.current.delete(key)
        }
      } catch {
        /* on garde les clés en attente pour un re-flush ultérieur (fermeture) */
      }
    }
  }, [inspection])

  // Flush à l'unmount (fermeture de la modale, navigation) — via une ref pour
  // toujours appeler la dernière version sans re-souscrire le cleanup.
  const flushRef = useRef(flushAll)
  flushRef.current = flushAll
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    void flushRef.current()
  }, [])

  function updateItem(id: string, field: string, value: string | null) {
    setItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } as InspectionItem : item))

    if (inspection) {
      pendingUpdates.current.set(`${id}:${field}`, value)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => { void flushAll() }, 800)
    }
  }

  // Fermeture sûre : on flushe les dernières modifications AVANT de fermer.
  const handleClose = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    await flushAll()
    onClose()
  }, [flushAll, onClose])

  async function handleCreate() {
    setSaving(true)
    try {
      const r = await fetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: jobId ?? null,
          // Le serveur re-résout de toute façon le rattachement depuis
          // l'intervention ; on transmet ce qu'il nous a déjà répondu.
          vehicleId: resolvedVehicleId ?? null,
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
      // Flush toutes les modifications en attente avant de finaliser.
      if (saveTimer.current) clearTimeout(saveTimer.current)
      await flushAll()
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
    // On n'imprime PAS l'interface : un document dédié est rendu hors écran,
    // en thème clair déterministe, avec l'en-tête garage, l'identification du
    // véhicule et TOUTES les catégories (même celles repliées à l'écran).
    const el = printRef.current
    if (!el) return
    setPrinting(true)
    try {
      // Rendu A4 mutualisé (lib/pdf/render-a4) : largeur fixe + découpe en
      // bandes. Contrôle véhicule, devis et facture partagent la même géométrie,
      // donc le même comportement sur téléphone.
      await renderElementToA4Pdf(el, { fileName: `controle-${form.licensePlate || 'vehicule'}` })
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
      {/* `gf-surface-light` : déclare explicitement une surface claire — les
          champs de tout le sous-arbre héritent d'un texte sombre lisible,
          dans les quatre thèmes (cf. globals.css § Surfaces). */}
      <div className="gf-surface-light bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-modal flex flex-col">
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
            <button onClick={() => { void handleClose() }} className="gf-close p-2 hover:bg-gray-100 rounded-lg text-gray-400">
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
                      className={INSP_INPUT} placeholder={t.lnClientNamePh} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">{t.jmVehicle}</label>
                    <input value={form.vehicleModel} onChange={e => setForm(f => ({ ...f, vehicleModel: e.target.value }))}
                      className={INSP_INPUT} placeholder={t.insMakeModelPh} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">{t.woPlate}</label>
                    <input value={form.licensePlate} onChange={e => setForm(f => ({ ...f, licensePlate: e.target.value.toUpperCase() }))}
                      className={cn(INSP_INPUT, 'font-mono')} placeholder="AB-123-CD" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">{t.vmMileage}</label>
                    <input type="number" value={form.mileage} onChange={e => setForm(f => ({ ...f, mileage: e.target.value }))}
                      className={INSP_INPUT} placeholder={t.insMileagePh} />
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
                  className={cn(INSP_INPUT, 'resize-none')}
                  placeholder={t.insGeneralNotesPh}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Document d'impression — rendu HORS ÉCRAN, jamais visible.
          `left:-10000px` le sort du champ de vision sans le retirer du flux :
          `display:none` ou `visibility:hidden` donneraient un canevas vide,
          html2canvas ayant besoin d'un nœud réellement mis en page. */}
      {inspection && (
        <div
          aria-hidden="true"
          data-gf-print="inspection"
          style={PRINT_HOST_STYLE}
        >
          <div ref={printRef}>
            <InspectionPrintDocument
              garage={garage}
              clientName={form.clientName}
              vehicleModel={form.vehicleModel}
              licensePlate={form.licensePlate}
              mileage={form.mileage}
              notes={form.notes}
              items={items}
              createdAt={inspection.createdAt}
              categoryLabel={(cat) =>
                inspectionCategoryLabel(t, cat, CATEGORY_CONFIG[cat]?.label ?? cat)
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}
