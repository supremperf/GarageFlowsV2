'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  X, Plus, Trash2, Download, Send, CheckCircle2, ArrowRight,
  FileText, Receipt, Edit3, Save
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { format, parseISO, addDays } from 'date-fns'
import toast from 'react-hot-toast'
import { useScheduleStore } from '@/store/schedule-store'
import { searchClients } from '@/lib/client-memory'
import type { ClientRecord } from '@/lib/client-memory'
import { DateField } from '@/components/DateField'
import { useTranslation } from '@/lib/i18n'
import { dateLocale } from '@/lib/i18n/date-locale'
import { docStatusLabel } from '@/lib/i18n/labels'
import { computeTotals, multiplyCents, toCents, fromCents, parseAmountToScaled, fromScaled, lineCents, formatEuros, roundEurosForDisplay } from '@/lib/money'
import { PartAutocomplete, type PartSuggestion } from '@/components/invoice/PartAutocomplete'
import { QuoteInvoicePrintDocument } from '@/components/invoice/QuoteInvoicePrintDocument'
import { EInvoicePanel } from '@/components/invoice/EInvoicePanel'
import { renderElementToA4Pdf, PRINT_HOST_STYLE } from '@/lib/pdf/render-a4'

interface Line {
  id?: string
  description: string
  quantity: number
  unitPrice: number
  unitCost: number
  isLabor: boolean
  sortOrder: number
  /**
   * Lien INTERNE vers la pièce du stock choisie dans l'autocomplétion. C'est ce
   * champ — jamais le libellé — qui rend fiable la décrémentation à la
   * validation puis la restitution à l'annulation.
   */
  partId?: string | null
  /** Stock disponible connu au moment du choix (affichage/garde-fou saisie). */
  stockAvailable?: number | null
  /** Nom exact de la pièce liée (message d'alerte lisible). */
  partName?: string | null
}

interface QuoteOrInvoice {
  id: string
  number: string
  status: string
  issueDate: string
  validUntil?: string | null
  dueDate?: string | null
  clientName: string
  clientEmail?: string | null
  clientPhone?: string | null
  clientAddress?: string | null
  vehicleModel?: string | null
  licensePlate?: string | null
  notes?: string | null
  taxRate: number
  invoiceId?: string | null
  lines: Line[]
}

interface Garage {
  name: string
  address?: string | null
  phone?: string | null
  email?: string | null
  siret?: string | null
  vatNumber?: string | null
  iban?: string | null
  bic?: string | null
  logoBase64?: string | null
  logoPath?:   string | null
  invoiceFooter?: string | null
  paymentTerms?: string | null
}

interface Props {
  mode: 'quote' | 'invoice'
  documentId?: string | null
  jobId?: string | null
  prefill?: Partial<QuoteOrInvoice>
  onClose: () => void
  onSaved?: (doc: QuoteOrInvoice) => void
}

const STATUS_COLORS: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-600',
  sent:      'bg-blue-100 text-blue-700',
  accepted:  'bg-emerald-100 text-emerald-700',
  refused:   'bg-red-100 text-red-600',
  converted: 'bg-purple-100 text-purple-700',
  paid:      'bg-emerald-100 text-emerald-700',
  overdue:   'bg-red-100 text-red-600',
  cancelled: 'bg-gray-200 text-gray-600',
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon', sent: 'Envoyé', accepted: 'Accepté',
  refused: 'Refusé', converted: 'Converti', paid: 'Payé', overdue: 'En retard',
  cancelled: 'Annulée',
}

// Input class for use inside the white invoice area — always dark text
const INP = 'border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-300'

function emptyLine(i = 0): Line {
  return { description: '', quantity: 1, unitPrice: 0, unitCost: 0, isLabor: false, sortOrder: i }
}

export default function QuoteInvoiceModal({ mode, documentId, jobId, prefill, onClose, onSaved }: Props) {
  const { t, lang } = useTranslation()
  const loc = dateLocale(lang)
  const { invalidateStats } = useScheduleStore()

  const [clientSuggestions, setClientSuggestions] = useState<ClientRecord[]>([])
  const [showClientDrop, setShowClientDrop]       = useState(false)
  const clientDropRef = useRef<HTMLDivElement>(null)
  /** Nœud du document d'impression, rendu hors écran (jamais l'interface). */
  const printRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (clientDropRef.current && !clientDropRef.current.contains(e.target as Node)) {
        setShowClientDrop(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const [doc,        setDoc]        = useState<QuoteOrInvoice | null>(null)
  const [garage,     setGarage]     = useState<Garage | null>(null)
  const [lines,      setLines]      = useState<Line[]>([emptyLine()])
  const [editing,    setEditing]    = useState(!documentId)
  const [saving,     setSaving]     = useState(false)
  const [converting, setConverting] = useState(false)
  const [printing,   setPrinting]   = useState(false)
  /** Un changement de statut est en vol → neutralise le double-clic. */
  const [statusBusy, setStatusBusy] = useState(false)
  const [form, setForm] = useState({
    clientName:   prefill?.clientName   ?? '',
    clientEmail:  prefill?.clientEmail  ?? '',
    clientPhone:  prefill?.clientPhone  ?? '',
    clientAddress:prefill?.clientAddress ?? '',
    vehicleModel: prefill?.vehicleModel  ?? '',
    licensePlate: prefill?.licensePlate  ?? '',
    notes:        prefill?.notes         ?? '',
    taxRate:      prefill?.taxRate       ?? 20,
    issueDate:    prefill?.issueDate     ?? format(new Date(), 'yyyy-MM-dd'),
    validUntil:   prefill?.validUntil    ?? format(addDays(new Date(), 30), 'yyyy-MM-dd'),
    dueDate:      prefill?.dueDate       ?? format(addDays(new Date(), 30), 'yyyy-MM-dd'),
  })

  const apiBase = mode === 'quote' ? '/api/quotes' : '/api/invoices'

  const fetchGarage = useCallback(async () => {
    const r = await fetch('/api/garages')
    if (r.ok) setGarage(await r.json())
  }, [])

  const fetchDoc = useCallback(async () => {
    if (!documentId) return
    const r = await fetch(`${apiBase}/${documentId}`)
    if (!r.ok) return
    const d: QuoteOrInvoice = await r.json()
    setDoc(d)
    setLines(d.lines.length > 0 ? d.lines : [emptyLine()])
    setForm({
      clientName:    d.clientName,
      clientEmail:   d.clientEmail   ?? '',
      clientPhone:   d.clientPhone   ?? '',
      clientAddress: d.clientAddress ?? '',
      vehicleModel:  d.vehicleModel  ?? '',
      licensePlate:  d.licensePlate  ?? '',
      notes:         d.notes         ?? '',
      taxRate:       d.taxRate,
      issueDate:     d.issueDate,
      validUntil:    d.validUntil    ?? format(addDays(new Date(), 30), 'yyyy-MM-dd'),
      dueDate:       d.dueDate       ?? format(addDays(new Date(), 30), 'yyyy-MM-dd'),
    })
  }, [documentId, apiBase])

  useEffect(() => {
    fetchGarage()
    fetchDoc()
  }, [fetchGarage, fetchDoc])

  // Pre-fill lines from job parts if creating new from a job.
  //
  // IMPORTANT — ces lignes NE SONT PAS rattachées au stock (`partId` absent).
  // Les pièces d'une intervention ont DÉJÀ été sorties de l'inventaire au
  // moment où elles ont été ajoutées à l'intervention (POST /api/jobs/:id/parts
  // décrémente atomiquement). Les rattacher ici ferait décrémenter une SECONDE
  // fois à la validation de la facture. Le rattachement au stock est réservé aux
  // pièces choisies dans l'autocomplétion de la facture (vente directe).
  useEffect(() => {
    if (documentId || !jobId) return
    fetch(`/api/jobs/${jobId}/parts`).then(r => r.ok ? r.json() : []).then((parts: { description?: string; name?: string; quantity: number; unitPrice: number; unitCost: number; part?: { name?: string } }[]) => {
      if (parts.length > 0) {
        setLines(parts.map((p, i) => ({
          description: p.description ?? p.part?.name ?? p.name ?? '',
          quantity:    p.quantity,
          unitPrice:   p.unitPrice,
          unitCost:    p.unitCost,
          isLabor:     false,
          sortOrder:   i,
          partId:      null, // stock déjà consommé par l'intervention — cf. ci-dessus
        })))
      }
    })
  }, [documentId, jobId])

  // Totaux EXACTS en centimes entiers (identiques à l'API/DB via lib/money).
  const _t          = computeTotals(lines.map(l => ({ quantity: l.quantity, unitPrice: l.unitPrice })), form.taxRate)
  const subtotalHT  = _t.totalHT
  const totalCost   = fromCents(lines.reduce((c, l) => c + multiplyCents(toCents(l.unitCost), l.quantity), 0))
  const taxAmount   = _t.taxAmount
  const totalTTC    = _t.totalTTC
  const profit      = fromCents(toCents(subtotalHT) - toCents(totalCost))

  async function handleSave() {
    if (!form.clientName.trim()) {
      toast.error(t.qiNameRequired)
      return
    }

    // ── QUANTITÉ : ne jamais corriger la saisie en silence ────────────────────
    // `Math.max(0.01, Number(quantity) || 1)` transformait une quantité à 0 —
    // ou toute saisie non numérique — en **1**. Le document enregistré ne valait
    // alors pas le montant affiché ; sur une facture, ce montant devient immuable
    // dès l'émission et la correction impose un avoir (GF31-AUD-052).
    const lignesRetenues = lines.filter(
      l => l.description.trim() !== '' || Number(l.unitPrice) > 0 || Number(l.unitCost) > 0,
    )
    const quantiteFautive = lignesRetenues.findIndex(l => {
      const q = Number(l.quantity)
      return !Number.isFinite(q) || q < 0.01
    })
    if (quantiteFautive !== -1) {
      const l = lignesRetenues[quantiteFautive]
      toast.error(
        `Quantité invalide ligne ${quantiteFautive + 1}${l.description.trim() ? ` (${l.description.trim()})` : ''} : `
        + 'saisissez une quantité supérieure à 0, ou supprimez la ligne.',
      )
      return
    }

    setSaving(true)
    try {
      // Keep only meaningful lines and normalise numbers so the server-side
      // validation (description requis, quantité ≥ 0.01…) never rejects the save.
      const cleanLines = lignesRetenues
        .map((l, i) => ({
          description: l.description.trim() || t.qiServiceFallback,
          // Validée juste au-dessus : on ne fabrique plus de quantité.
          quantity:    Math.min(9999, Number(l.quantity)),
          unitPrice:   Math.max(0, Number(l.unitPrice) || 0),
          unitCost:    Math.max(0, Number(l.unitCost) || 0),
          isLabor:     !!l.isLabor,
          sortOrder:   i,
          // Lien vers la pièce du stock — le serveur revérifie qu'elle
          // appartient bien au garage avant de l'enregistrer.
          partId:      l.isLabor ? null : (l.partId ?? null),
        }))
      const payload = {
        ...form,
        taxRate: Math.min(100, Math.max(0, Number(form.taxRate) || 0)),
        jobId: jobId ?? null,
        lines: cleanLines,
      }
      // Re-use the already-created document id so a second save updates
      // instead of creating a duplicate.
      const effectiveId = documentId ?? doc?.id
      let r: Response
      if (effectiveId) {
        r = await fetch(`${apiBase}/${effectiveId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        r = await fetch(apiBase, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      if (!r.ok) {
        const err = await r.json().catch(() => null)
        throw new Error(err?.error || `${t.qiSaveFailedN} (${r.status})`)
      }
      const saved: QuoteOrInvoice = await r.json()
      setDoc(saved)
      setLines(saved.lines && saved.lines.length > 0 ? saved.lines : [emptyLine()])
      setEditing(false)
      toast.success(effectiveId ? t.qiDocUpdated : `${mode === 'quote' ? t.jmQuote : t.jmInvoice} ${t.qiCreatedM}`)
      onSaved?.(saved)
      invalidateStats()  // refresh dashboard when document is saved
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.qiSaveError)
    } finally {
      setSaving(false)
    }
  }

  async function handleConvert() {
    if (!doc) return
    setConverting(true)
    try {
      const r = await fetch(`/api/quotes/${doc.id}/convert`, { method: 'POST' })
      if (!r.ok) throw new Error('Convert failed')
      const invoice: QuoteOrInvoice = await r.json()
      toast.success(t.qiInvoiceCreated.replace('{n}', invoice.number))
      invalidateStats()
      onSaved?.(invoice)
      onClose()
    } catch {
      toast.error(t.qiConvertError)
    } finally {
      setConverting(false)
    }
  }

  /**
   * Changement de statut — c'est ICI que le stock bascule pour une facture
   * (draft → émise = décrément ; → cancelled = restitution).
   *
   * `statusBusy` neutralise le DOUBLE-CLIC côté interface ; l'idempotence réelle
   * est garantie côté serveur par le verrou `stockCommittedAt` (deux requêtes
   * simultanées ne peuvent pas décrémenter deux fois).
   *
   * Un refus (stock insuffisant → 409) doit être VU : l'ancien code ignorait
   * silencieusement toute réponse non-OK, laissant croire à une validation.
   */
  async function handleStatusChange(status: string) {
    if (!doc || statusBusy) return
    setStatusBusy(true)
    try {
      const r = await fetch(`${apiBase}/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const payload = await r.json().catch(() => null)
      if (!r.ok) {
        toast.error(payload?.error ?? `${t.qiSaveFailedN} (${r.status})`)
        return
      }
      setDoc(payload)
      toast.success(t.qiStatusUpdated)
      // Always sync stats — especially important when marking as paid
      invalidateStats()
      onSaved?.(payload)
    } catch {
      toast.error(t.qiSaveError)
    } finally {
      setStatusBusy(false)
    }
  }

  /**
   * Export PDF — depuis le DOCUMENT D'IMPRESSION dédié, jamais depuis la modale.
   *
   * L'ancien export photographiait `#qimodal-print`, c'est-à-dire l'interface
   * d'édition telle qu'elle était mise en page à l'écran. Le PDF variait donc
   * selon l'appareil (896 px de large sur poste, 358 px sur iPhone, 328 px sur
   * Android) et embarquait champs de saisie et boutons. Le rendu passe
   * désormais par `renderElementToA4Pdf`, sur un nœud de largeur fixe.
   */
  async function handleDownloadPDF() {
    const el = printRef.current
    if (!el) return
    setPrinting(true)
    try {
      const number = doc?.number ?? (mode === 'quote' ? 'DEV-DRAFT' : 'FAC-DRAFT')
      await renderElementToA4Pdf(el, { fileName: number })
    } catch {
      toast.error(t.qiPdfGenError)
    } finally {
      setPrinting(false)
    }
  }

  function addLine(isLabor = false) {
    setLines(l => [...l, {
      description: isLabor ? t.jmLabor : '',
      quantity:    1,
      unitPrice:   isLabor ? 60 : 0,
      unitCost:    0,
      isLabor,
      sortOrder:   l.length,
    }])
  }

  function updateLine(i: number, field: keyof Line, value: string | number | boolean) {
    setLines(l => l.map((line, idx) => idx === i ? { ...line, [field]: value } : line))
  }

  /**
   * Choix d'une pièce du stock : la ligne est PRÉREMPLIE (désignation,
   * référence, prix de vente, coût) ET rattachée par identifiant. La TVA reste
   * celle du document — GarageFlows applique un taux par document, pas par
   * ligne (cf. modèle Invoice.taxRate).
   */
  function selectPartForLine(i: number, part: PartSuggestion) {
    setLines(l => l.map((line, idx) => idx === i ? {
      ...line,
      description: part.reference ? `${part.name} (réf. ${part.reference})` : part.name,
      unitPrice: part.unitPrice,
      unitCost: part.unitCost,
      isLabor: false,
      partId: part.id,
      partName: part.name,
      stockAvailable: part.quantity,
    } : line))
  }

  /** La saisie libre a divergé de la pièce : on retire le lien (et son garde-fou). */
  function unlinkPart(i: number) {
    setLines(l => l.map((line, idx) => idx === i
      ? { ...line, partId: null, partName: null, stockAvailable: null }
      : line))
  }

  /**
   * Lignes dont la quantité demandée dépasse le stock connu. Simple GARDE-FOU
   * D'INTERFACE : la disponibilité réelle est revalidée par le serveur dans la
   * transaction de validation — le stock affiché ici n'est jamais cru sur parole.
   */
  const overstockedLines = lines.filter(
    l => l.partId && typeof l.stockAvailable === 'number' && Number(l.quantity) > l.stockAvailable,
  )

  function removeLine(i: number) {
    setLines(l => l.filter((_, idx) => idx !== i))
  }

  const docTitle  = mode === 'quote' ? t.jmQuote : t.jmInvoice
  const docNumber = doc?.number ?? (mode === 'quote' ? 'DEV-XXXX-XXX' : 'FAC-XXXX-XXX')

  /**
   * Date lisible, TOLÉRANTE à une saisie incomplète. Le document d'impression
   * est rendu en permanence (hors écran) : pendant que l'utilisateur tape une
   * date, la valeur intermédiaire n'est pas encore une date valide, et un
   * `format(parseISO(…))` nu lèverait « Invalid time value » PENDANT LE RENDU —
   * ce qui emporterait toute la modale.
   */
  function safeDateLabel(value: string | null | undefined): string {
    if (!value) return '—'
    const parsed = parseISO(value)
    return Number.isNaN(parsed.getTime()) ? value : format(parsed, 'd MMMM yyyy', { locale: loc })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-modal flex flex-col">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-3">
            {mode === 'quote'
              ? <FileText className="w-5 h-5 text-blue-600" />
              : <Receipt  className="w-5 h-5 text-emerald-600" />}
            <h2 className="text-lg font-bold text-gray-900">{docTitle} {docNumber}</h2>
            {doc?.status && (
              <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', STATUS_COLORS[doc.status] ?? 'bg-gray-100 text-gray-600')}>
                {docStatusLabel(t, doc.status, STATUS_LABELS[doc.status])}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {doc && !editing && (
              <>
                <button onClick={() => setEditing(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors">
                  <Edit3 className="w-3.5 h-3.5" /> {t.uiEdit}
                </button>
                <button onClick={handleDownloadPDF} disabled={printing}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors">
                  <Download className="w-3.5 h-3.5" /> {printing ? 'PDF…' : 'PDF'}
                </button>
                {mode === 'quote' && doc.status !== 'converted' && (
                  <>
                    {doc.status === 'draft' && (
                      <button onClick={() => handleStatusChange('sent')}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-lg transition-colors">
                        <Send className="w-3.5 h-3.5" /> {t.qiSend}
                      </button>
                    )}
                    {doc.status === 'sent' && (
                      <button onClick={() => handleStatusChange('accepted')}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded-lg transition-colors">
                        <CheckCircle2 className="w-3.5 h-3.5" /> {t.qiStAccepted}
                      </button>
                    )}
                    <button onClick={handleConvert} disabled={converting}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-purple-600 text-white hover:bg-purple-700 rounded-lg disabled:opacity-50 transition-colors">
                      <ArrowRight className="w-3.5 h-3.5" /> {converting ? t.qiConverting : t.qiCreateInvoice}
                    </button>
                  </>
                )}
                {/* VALIDATION de la facture : c'est cette action qui engage le
                    stock (décrément atomique, une seule fois). */}
                {mode === 'invoice' && doc.status === 'draft' && (
                  <button onClick={() => handleStatusChange('sent')} disabled={statusBusy}
                    title="Valider et émettre la facture — le stock des pièces liées sera décrémenté."
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {statusBusy ? '…' : 'Valider la facture'}
                  </button>
                )}
                {mode === 'invoice' && doc.status !== 'paid' && doc.status !== 'cancelled' && (
                  <button onClick={() => handleStatusChange('paid')} disabled={statusBusy}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg disabled:opacity-50 transition-colors">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {t.qiMarkPaid}
                  </button>
                )}
                {/* ANNULATION : la facture est CONSERVÉE (série séquentielle,
                    FEC) et les pièces reviennent en stock. */}
                {mode === 'invoice' && doc.status !== 'draft' && doc.status !== 'cancelled' && (
                  <button onClick={() => handleStatusChange('cancelled')} disabled={statusBusy}
                    title="Annuler la facture — les pièces liées reviennent en stock. La facture reste conservée."
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 rounded-lg disabled:opacity-50 transition-colors">
                    <X className="w-3.5 h-3.5" /> Annuler
                  </button>
                )}
              </>
            )}
            {editing && (
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors">
                <Save className="w-3.5 h-3.5" /> {saving ? t.qiSaving : t.qiSave}
              </button>
            )}
            <button onClick={onClose} className="gf-close p-2 hover:bg-gray-100 rounded-lg text-gray-400 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">

          {/* Print area — always light/white background for PDF */}
          <div id="qimodal-print" className="p-8 bg-white min-h-[600px] invoice-light">

            {/* Garage header */}
            {garage && (
              <div className="flex items-start justify-between mb-8">
                <div>
                  {(garage.logoBase64 || garage.logoPath) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={garage.logoBase64 || `/api/photos/${garage.logoPath}`}
                      alt="Logo"
                      className="h-14 object-contain mb-2"
                    />
                  )}
                  <h1 className="text-xl font-bold text-gray-900">{garage.name}</h1>
                  {garage.address  && <p className="text-sm text-gray-500">{garage.address}</p>}
                  {garage.phone    && <p className="text-sm text-gray-500">{garage.phone}</p>}
                  {garage.email    && <p className="text-sm text-gray-500">{garage.email}</p>}
                  {garage.siret    && <p className="text-xs text-gray-400 mt-1">{t.qiSiretLabel} {garage.siret}</p>}
                  {garage.vatNumber && <p className="text-xs text-gray-400">{t.qiVatLabel} {garage.vatNumber}</p>}
                </div>
                <div className="text-right">
                  <div className={cn('inline-block px-4 py-2 rounded-xl font-bold text-lg',
                    mode === 'quote' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700')}>
                    {docTitle.toUpperCase()}
                  </div>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{docNumber}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {editing ? (
                      <DateField value={form.issueDate}
                        onChange={v => setForm(f => ({ ...f, issueDate: v }))}
                        wrapperClassName="inline-block"
                        className={cn(INP, 'text-sm w-36')} />
                    ) : (
                      `${t.woIssuedOn} ${format(parseISO(form.issueDate), 'd MMMM yyyy', { locale: loc })}`
                    )}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {mode === 'quote' ? (
                      editing ? (
                        <span className="flex items-center gap-1 justify-end">
                          {t.qiValidUntil}
                          <DateField value={form.validUntil}
                            onChange={v => setForm(f => ({ ...f, validUntil: v }))}
                            wrapperClassName="inline-block"
                            className={cn(INP, 'text-xs w-32')} />
                        </span>
                      ) : form.validUntil ? `${t.qiValidUntil} ${format(parseISO(form.validUntil), 'd MMMM yyyy', { locale: loc })}` : ''
                    ) : (
                      editing ? (
                        <span className="flex items-center gap-1 justify-end">
                          {t.qiDueDate}
                          <DateField value={form.dueDate}
                            onChange={v => setForm(f => ({ ...f, dueDate: v }))}
                            wrapperClassName="inline-block"
                            className={cn(INP, 'text-xs w-32')} />
                        </span>
                      ) : form.dueDate ? `${t.qiDueDate} : ${format(parseISO(form.dueDate), 'd MMMM yyyy', { locale: loc })}` : ''
                    )}
                  </p>
                </div>
              </div>
            )}

            {/* Client & Vehicle */}
            <div className="grid grid-cols-2 gap-6 mb-8">
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{t.vmClient}</p>
                {editing ? (
                  <div className="space-y-2">
                    <div ref={clientDropRef} className="relative">
                      <input
                        value={form.clientName}
                        onChange={e => {
                          setForm(f => ({ ...f, clientName: e.target.value }))
                          setClientSuggestions(searchClients(e.target.value))
                          setShowClientDrop(true)
                        }}
                        onFocus={() => { setClientSuggestions(searchClients(form.clientName)); setShowClientDrop(true) }}
                        placeholder={t.qiClientNamePh}
                        autoComplete="off"
                        className={cn(INP, 'w-full font-semibold')}
                      />
                      {showClientDrop && clientSuggestions.length > 0 && (
                        <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl bg-[#1a2235] border border-white/10 shadow-2xl overflow-hidden">
                          {clientSuggestions.map(c => (
                            <button key={c.customerName} type="button"
                              onMouseDown={e => {
                                e.preventDefault()
                                setForm(f => ({
                                  ...f,
                                  clientName:   c.customerName,
                                  licensePlate: c.licensePlate ?? f.licensePlate,
                                  vehicleModel: c.vehicleModel ?? f.vehicleModel,
                                  clientPhone:  c.phone        ?? f.clientPhone,
                                }))
                                setShowClientDrop(false)
                              }}
                              className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-white/[0.07] border-b border-white/[0.05] last:border-0"
                            >
                              <span className="font-medium">{c.customerName}</span>
                              {c.licensePlate && <span className="ml-2 text-xs font-mono text-blue-400">{c.licensePlate}</span>}
                              {c.vehicleModel && <span className="ml-2 text-xs text-slate-400">{c.vehicleModel}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <input value={form.clientEmail}   onChange={e => setForm(f => ({ ...f, clientEmail:   e.target.value }))} placeholder={t.uiEmail}    className={cn(INP, 'w-full')} />
                    <input value={form.clientPhone}   onChange={e => setForm(f => ({ ...f, clientPhone:   e.target.value }))} placeholder={t.uiPhone}    className={cn(INP, 'w-full')} />
                    <input value={form.clientAddress} onChange={e => setForm(f => ({ ...f, clientAddress: e.target.value }))} placeholder={t.woAddress}  className={cn(INP, 'w-full')} />
                  </div>
                ) : (
                  <>
                    <p className="font-semibold text-gray-900">{form.clientName || '—'}</p>
                    {form.clientEmail   && <p className="text-sm text-gray-500">{form.clientEmail}</p>}
                    {form.clientPhone   && <p className="text-sm text-gray-500">{form.clientPhone}</p>}
                    {form.clientAddress && <p className="text-sm text-gray-500">{form.clientAddress}</p>}
                  </>
                )}
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{t.jmVehicle}</p>
                {editing ? (
                  <div className="space-y-2">
                    <input value={form.vehicleModel} onChange={e => setForm(f => ({ ...f, vehicleModel: e.target.value }))} placeholder={t.insMakeModelPh} className={cn(INP, 'w-full font-semibold')} />
                    <input value={form.licensePlate} onChange={e => setForm(f => ({ ...f, licensePlate: e.target.value }))} placeholder={t.woPlate} className={cn(INP, 'w-full font-mono')} />
                  </div>
                ) : (
                  <>
                    <p className="font-semibold text-gray-900">{form.vehicleModel || '—'}</p>
                    {form.licensePlate && <p className="font-mono text-blue-700 text-sm">{form.licensePlate}</p>}
                  </>
                )}
              </div>
            </div>

            {/* Lines table */}
            <table className="w-full mb-4 text-sm">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="text-left py-2 font-semibold text-gray-600">{t.woColDesc}</th>
                  <th className="text-center py-2 font-semibold text-gray-600 w-16">{t.woColQty}</th>
                  <th className="text-right py-2 font-semibold text-gray-600 w-24">{t.qiPriceHT}</th>
                  <th className="text-right py-2 font-semibold text-gray-600 w-24">{t.woTotalHT}</th>
                  {editing && <th className="w-8" />}
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2 pr-2">
                      {editing ? (
                        <div className="flex items-center gap-2">
                          {line.isLabor && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-semibold shrink-0">{t.qiLaborBadge}</span>}
                          {line.isLabor ? (
                            // MAIN-D'ŒUVRE : jamais rattachable au stock.
                            <input value={line.description} onChange={e => updateLine(i, 'description', e.target.value)}
                              placeholder={t.woColDesc} className={cn(INP, 'w-full')} />
                          ) : (
                            <PartAutocomplete
                              value={line.description}
                              onChange={v => updateLine(i, 'description', v)}
                              onSelectPart={p => selectPartForLine(i, p)}
                              onClearPart={() => unlinkPart(i)}
                              linkedPartId={line.partId}
                              placeholder={t.woColDesc}
                              className={cn(INP, 'w-full', line.partId && 'pr-16')}
                            />
                          )}
                        </div>
                      ) : (
                        <span className="flex items-center gap-2 text-gray-800">
                          {line.isLabor && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-semibold">{t.qiLaborBadge}</span>}
                          {line.description || '—'}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-center text-gray-800">
                      {editing ? (
                        <>
                          <input type="number" min="0.01" step="0.01" value={line.quantity}
                            onChange={e => updateLine(i, 'quantity', fromScaled(parseAmountToScaled(e.target.value) ?? 0))}
                            className={cn(
                              INP, 'w-16 text-center',
                              line.partId && typeof line.stockAvailable === 'number'
                                && Number(line.quantity) > line.stockAvailable
                                && 'border-red-400 ring-1 ring-red-300',
                            )} />
                          {line.partId && typeof line.stockAvailable === 'number' && (
                            <span className={cn(
                              'mt-0.5 block text-[10px]',
                              Number(line.quantity) > line.stockAvailable ? 'font-semibold text-red-600' : 'text-gray-400',
                            )}>
                              {Number(line.quantity) > line.stockAvailable
                                ? `${line.stockAvailable} dispo.`
                                : `stock ${line.stockAvailable}`}
                            </span>
                          )}
                        </>
                      ) : line.quantity}
                    </td>
                    <td className="py-2 text-right text-gray-800">
                      {editing ? (
                        <input type="number" min="0" step="0.01" value={line.unitPrice}
                          onChange={e => updateLine(i, 'unitPrice', fromScaled(parseAmountToScaled(e.target.value) ?? 0))}
                          className={cn(INP, 'w-24 text-right')} />
                      ) : `${line.unitPrice.toFixed(2)} €`}
                    </td>
                    <td className="py-2 text-right font-medium text-gray-800">
                      {fromCents(lineCents(line.unitPrice, line.quantity)).toFixed(2)} €
                    </td>
                    {editing && (
                      <td className="py-2 pl-2">
                        <button onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600 p-1 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Stock insuffisant : on PRÉVIENT explicitement plutôt que de laisser
                l'utilisateur découvrir le refus au moment de la validation. Le
                serveur reste l'autorité (revalidation transactionnelle). */}
            {editing && overstockedLines.length > 0 && (
              <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <span className="text-base leading-none">⚠️</span>
                <div className="text-xs text-amber-800">
                  <p className="font-semibold">Stock insuffisant sur {overstockedLines.length} ligne(s)</p>
                  <ul className="mt-1 space-y-0.5">
                    {overstockedLines.map((l, idx) => (
                      <li key={idx}>
                        {l.partName ?? l.description} — {l.quantity} demandé(s), {l.stockAvailable} disponible(s)
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 opacity-80">
                    La facture reste enregistrable en brouillon ; sa validation sera refusée tant que le stock ne suffit pas.
                  </p>
                </div>
              </div>
            )}

            {editing && (
              <div className="flex gap-2 mb-6">
                <button onClick={() => addLine(false)}
                  className="flex items-center gap-1.5 text-sm text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200 transition-colors">
                  <Plus className="w-3.5 h-3.5" /> {t.qiPartService}
                </button>
                <button onClick={() => addLine(true)}
                  className="flex items-center gap-1.5 text-sm text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200 transition-colors">
                  <Plus className="w-3.5 h-3.5" /> {t.jmLabor}
                </button>
              </div>
            )}

            {/* Totals */}
            <div className="flex justify-end mb-6">
              <div className="w-64 space-y-1">
                <div className="flex justify-between text-sm text-gray-600">
                  <span>{t.qiSubtotalHT}</span>
                  <span className="font-medium text-gray-800">{subtotalHT.toFixed(2)} €</span>
                </div>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>
                    {t.woVAT} ({editing ? (
                      <input type="number" min="0" max="100" value={form.taxRate}
                        onChange={e => setForm(f => ({ ...f, taxRate: fromScaled(parseAmountToScaled(e.target.value) ?? 0) }))}
                        className="w-10 text-center border-b border-gray-300 text-sm text-gray-800 bg-transparent focus:outline-none" />
                    ) : form.taxRate}%)
                  </span>
                  <span className="font-medium text-gray-800">{taxAmount.toFixed(2)} €</span>
                </div>
                <div className="flex justify-between text-base font-bold text-gray-900 pt-2 border-t border-gray-200">
                  <span>{t.woTotalTTC}</span>
                  <span className={cn('text-lg', mode === 'quote' ? 'text-blue-700' : 'text-emerald-700')}>
                    {totalTTC.toFixed(2)} €
                  </span>
                </div>
              </div>
            </div>

            {/* Notes */}
            {editing ? (
              <div className="mb-4">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t.qiNotesConditions}</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2} className={cn(INP, 'w-full mt-1 resize-none')} placeholder={t.qiNotesPh} />
              </div>
            ) : form.notes ? (
              <div className="mb-4 bg-gray-50 rounded-xl p-3">
                <p className="text-xs font-semibold text-gray-400 uppercase mb-1">{t.uiNotes}</p>
                <p className="text-sm text-gray-600 whitespace-pre-line">{form.notes}</p>
              </div>
            ) : null}

            {/* Banking / IBAN */}
            {garage?.iban && (
              <div className="mt-6 pt-4 border-t border-gray-100 text-xs text-gray-400">
                <span className="font-semibold text-gray-500">{t.qiPaymentTransfer} </span>
                IBAN {garage.iban}{garage.bic ? ` · BIC ${garage.bic}` : ''}
              </div>
            )}
            {garage?.invoiceFooter && (
              <p className="text-xs text-gray-400 mt-2 text-center">{garage.invoiceFooter}</p>
            )}
          </div>

          {/* Profitability card — internal only, not printed */}
          {editing && totalCost > 0 && (
            <div className="mx-8 mb-8 rounded-xl bg-gradient-to-r from-slate-50 to-emerald-50 border border-emerald-100 p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{t.qiEstProfit}</p>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">{t.jmPartsCost}</p>
                  <p className="font-bold text-red-600">{formatEuros(totalCost, 'negative')}</p>
                </div>
                <div>
                  <p className="text-gray-500">{t.qiSaleHT}</p>
                  <p className="font-bold text-gray-900">{subtotalHT.toFixed(2)} €</p>
                </div>
                <div>
                  <p className="text-gray-500">{t.qiGrossMargin}</p>
                  <p className={cn('font-bold text-lg', roundEurosForDisplay(profit) >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                    {formatEuros(profit, 'always')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Transmission à la plateforme agréée ───────────────────────────
              Uniquement sur une FACTURE enregistrée, et hors édition : on ne
              transmet pas un document en cours de modification. Le panneau se
              retire de lui-même là où la fonctionnalité n'existe pas — sur le
              poste, ou sans droit de lecture financière. */}
          {mode === 'invoice' && doc?.id && !editing && (
            <EInvoicePanel invoiceId={doc.id} statutFacture={doc.status} />
          )}
        </div>
      </div>

      {/* ── Document d'impression ────────────────────────────────────────────
          Rendu HORS ÉCRAN, à largeur A4 fixe : c'est LUI qui part dans le PDF,
          jamais la modale ci-dessus. Le PDF est ainsi identique sur poste et
          sur téléphone, et ne contient ni champ de saisie ni bouton. */}
      <div aria-hidden="true" data-gf-print="quote-invoice" style={PRINT_HOST_STYLE}>
        <div ref={printRef}>
          <QuoteInvoicePrintDocument
            mode={mode}
            garage={garage}
            documentTitle={docTitle}
            documentNumber={docNumber}
            issueDateLabel={`${t.woIssuedOn} ${safeDateLabel(form.issueDate)}`}
            secondaryDateLabel={
              mode === 'quote'
                ? (form.validUntil ? `${t.qiValidUntil} ${safeDateLabel(form.validUntil)}` : null)
                : (form.dueDate ? `${t.qiDueDate} : ${safeDateLabel(form.dueDate)}` : null)
            }
            clientName={form.clientName}
            clientEmail={form.clientEmail}
            clientPhone={form.clientPhone}
            clientAddress={form.clientAddress}
            vehicleModel={form.vehicleModel}
            licensePlate={form.licensePlate}
            lines={lines.map(l => ({
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              // Même calcul EXACT que la ligne affichée (centimes entiers) :
              // le PDF ne peut pas diverger du document enregistré.
              lineTotal: fromCents(lineCents(l.unitPrice, l.quantity)),
              isLabor: l.isLabor,
            }))}
            subtotalHT={subtotalHT}
            taxRate={form.taxRate}
            taxAmount={taxAmount}
            totalTTC={totalTTC}
            notes={form.notes}
            labels={{
              client: t.vmClient,
              vehicle: t.jmVehicle,
              description: t.woColDesc,
              quantity: t.woColQty,
              priceHT: t.qiPriceHT,
              totalHT: t.woTotalHT,
              subtotalHT: t.qiSubtotalHT,
              vat: t.woVAT,
              totalTTC: t.woTotalTTC,
              notes: t.uiNotes,
              labor: t.qiLaborBadge,
              siret: t.qiSiretLabel,
              vatNumber: t.qiVatLabel,
              paymentTransfer: t.qiPaymentTransfer,
            }}
          />
        </div>
      </div>
    </div>
  )
}
