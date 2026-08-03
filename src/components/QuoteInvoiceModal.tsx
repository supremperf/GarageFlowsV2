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
import { computeTotals, multiplyCents, toCents, fromCents } from '@/lib/money'

interface Line {
  id?: string
  description: string
  quantity: number
  unitPrice: number
  unitCost: number
  isLabor: boolean
  sortOrder: number
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
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon', sent: 'Envoyé', accepted: 'Accepté',
  refused: 'Refusé', converted: 'Converti', paid: 'Payé', overdue: 'En retard',
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

  // Pre-fill lines from job parts if creating new from a job
  useEffect(() => {
    if (documentId || !jobId) return
    fetch(`/api/jobs/${jobId}/parts`).then(r => r.ok ? r.json() : []).then((parts: { description?: string; name?: string; quantity: number; unitPrice: number; unitCost: number }[]) => {
      if (parts.length > 0) {
        setLines(parts.map((p, i) => ({
          description: p.description ?? p.name ?? '',
          quantity:    p.quantity,
          unitPrice:   p.unitPrice,
          unitCost:    p.unitCost,
          isLabor:     false,
          sortOrder:   i,
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
    setSaving(true)
    try {
      // Keep only meaningful lines and normalise numbers so the server-side
      // validation (description requis, quantité ≥ 0.01…) never rejects the save.
      const cleanLines = lines
        .filter(l => l.description.trim() !== '' || Number(l.unitPrice) > 0 || Number(l.unitCost) > 0)
        .map((l, i) => ({
          description: l.description.trim() || t.qiServiceFallback,
          quantity:    Math.min(9999, Math.max(0.01, Number(l.quantity) || 1)),
          unitPrice:   Math.max(0, Number(l.unitPrice) || 0),
          unitCost:    Math.max(0, Number(l.unitCost) || 0),
          isLabor:     !!l.isLabor,
          sortOrder:   i,
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

  async function handleStatusChange(status: string) {
    if (!doc) return
    const r = await fetch(`${apiBase}/${doc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (r.ok) {
      const updated = await r.json()
      setDoc(updated)
      toast.success(t.qiStatusUpdated)
      // Always sync stats — especially important when marking as paid
      invalidateStats()
      onSaved?.(updated)
    }
  }

  async function handleDownloadPDF() {
    const el = document.getElementById('qimodal-print')
    if (!el) return
    setPrinting(true)
    try {
      const { default: html2canvas } = await import('html2canvas')
      const { default: jsPDF }       = await import('jspdf')
      const canvas  = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false })
      const imgData = canvas.toDataURL('image/png')
      const pdf     = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pageW   = 210, pageH = 297
      const imgW    = pageW - 20
      const imgH    = (canvas.height * imgW) / canvas.width
      let yOffset   = 10
      let remaining = imgH
      while (remaining > 0) {
        const sliceH = Math.min(remaining, pageH - 20)
        if (yOffset !== 10) pdf.addPage()
        pdf.addImage(imgData, 'PNG', 10, yOffset, imgW, sliceH)
        remaining -= sliceH
        yOffset    = 10
      }
      const number = doc?.number ?? (mode === 'quote' ? 'DEV-DRAFT' : 'FAC-DRAFT')
      pdf.save(`${number}.pdf`)
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

  function removeLine(i: number) {
    setLines(l => l.filter((_, idx) => idx !== i))
  }

  const docTitle  = mode === 'quote' ? t.jmQuote : t.jmInvoice
  const docNumber = doc?.number ?? (mode === 'quote' ? 'DEV-XXXX-XXX' : 'FAC-XXXX-XXX')

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
                {mode === 'invoice' && doc.status !== 'paid' && (
                  <button onClick={() => handleStatusChange('paid')}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg transition-colors">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {t.qiMarkPaid}
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
                          <input value={line.description} onChange={e => updateLine(i, 'description', e.target.value)}
                            placeholder={t.woColDesc} className={cn(INP, 'w-full')} />
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
                        <input type="number" min="0.01" step="0.01" value={line.quantity}
                          onChange={e => updateLine(i, 'quantity', parseFloat(e.target.value) || 0)}
                          className={cn(INP, 'w-16 text-center')} />
                      ) : line.quantity}
                    </td>
                    <td className="py-2 text-right text-gray-800">
                      {editing ? (
                        <input type="number" min="0" step="0.01" value={line.unitPrice}
                          onChange={e => updateLine(i, 'unitPrice', parseFloat(e.target.value) || 0)}
                          className={cn(INP, 'w-24 text-right')} />
                      ) : `${line.unitPrice.toFixed(2)} €`}
                    </td>
                    <td className="py-2 text-right font-medium text-gray-800">
                      {(line.quantity * line.unitPrice).toFixed(2)} €
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
                        onChange={e => setForm(f => ({ ...f, taxRate: parseFloat(e.target.value) || 0 }))}
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
                  <p className="font-bold text-red-600">− {totalCost.toFixed(2)} €</p>
                </div>
                <div>
                  <p className="text-gray-500">{t.qiSaleHT}</p>
                  <p className="font-bold text-gray-900">{subtotalHT.toFixed(2)} €</p>
                </div>
                <div>
                  <p className="text-gray-500">{t.qiGrossMargin}</p>
                  <p className={cn('font-bold text-lg', profit >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                    {profit >= 0 ? '+' : ''}{profit.toFixed(2)} €
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
