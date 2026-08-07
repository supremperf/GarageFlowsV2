'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  X, FileText, Receipt, Plus, Search, Eye, Loader2,
  CheckCircle2, Clock, Send, Ban, TrendingUp, Euro, RefreshCw
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { asDocArray, docMatchesSearch, formatAmount, sumTTC } from '@/lib/billing-view'
import toast from 'react-hot-toast'
import QuoteInvoiceModal from './QuoteInvoiceModal'
import { useTranslation } from '@/lib/i18n'
import { useScheduleStore } from '@/store/schedule-store'

interface DocLine {
  id: string
  description: string
  quantity: number
  unitPrice: number
  unitCost: number
}

interface Doc {
  id: string
  number: string
  status: string
  totalTTC: number
  totalHT: number
  taxRate: number
  createdAt: string
  clientName: string
  clientPhone?: string | null
  vehicleModel?: string | null
  licensePlate?: string | null
  job?: { id: string; customerName: string; vehicleModel: string; licensePlate?: string | null } | null
  lines: DocLine[]
}

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_QUOTE: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft:     { label: 'Brouillon', color: 'text-slate-400 bg-slate-500/15 border-slate-500/25',      icon: <FileText    className="w-3 h-3" /> },
  sent:      { label: 'Envoyé',    color: 'text-blue-400 bg-blue-500/15 border-blue-500/25',          icon: <Send        className="w-3 h-3" /> },
  accepted:  { label: 'Accepté',   color: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/25', icon: <CheckCircle2 className="w-3 h-3" /> },
  rejected:  { label: 'Refusé',    color: 'text-red-400 bg-red-500/15 border-red-500/25',             icon: <Ban         className="w-3 h-3" /> },
  converted: { label: 'Converti',  color: 'text-purple-400 bg-purple-500/15 border-purple-500/25',    icon: <Receipt     className="w-3 h-3" /> },
}

const STATUS_INVOICE: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft:     { label: 'Brouillon', color: 'text-slate-400 bg-slate-500/15 border-slate-500/25',      icon: <FileText    className="w-3 h-3" /> },
  sent:      { label: 'Envoyée',   color: 'text-blue-400 bg-blue-500/15 border-blue-500/25',          icon: <Send        className="w-3 h-3" /> },
  paid:      { label: 'Payée',     color: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/25', icon: <CheckCircle2 className="w-3 h-3" /> },
  overdue:   { label: 'En retard', color: 'text-red-400 bg-red-500/15 border-red-500/25',             icon: <Clock       className="w-3 h-3" /> },
  cancelled: { label: 'Annulée',   color: 'text-slate-500 bg-slate-600/15 border-slate-600/25',       icon: <Ban         className="w-3 h-3" /> },
}

function StatusBadge({ status, type }: { status: string; type: 'quote' | 'invoice' }) {
  const map = type === 'quote' ? STATUS_QUOTE : STATUS_INVOICE
  const cfg = map[status] ?? { label: status, color: 'text-slate-400 bg-slate-500/15 border-slate-500/25', icon: null }
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border', cfg.color)}>
      {cfg.icon}{cfg.label}
    </span>
  )
}

function DocRow({ doc, type, onClick }: { doc: Doc; type: 'quote' | 'invoice'; onClick(): void }) {
  const date  = new Date(doc.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
  const label = doc.job?.customerName ?? doc.clientName ?? '—'
  const model = doc.job?.vehicleModel ?? doc.vehicleModel ?? ''
  const plate = doc.job?.licensePlate ?? doc.licensePlate ?? ''

  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.04] transition-colors text-left border-b border-white/[0.05] last:border-b-0 group">
      <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center flex-shrink-0">
        {type === 'quote'
          ? <FileText className="w-4 h-4 text-purple-400" />
          : <Receipt  className="w-4 h-4 text-blue-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="text-xs font-bold text-white font-mono">{doc.number}</span>
          <StatusBadge status={doc.status} type={type} />
        </div>
        <p className="text-xs text-slate-400 truncate">
          {label}{model ? ` · ${model}` : ''}
          {plate && <span className="ml-1 font-mono text-blue-400">{plate}</span>}
        </p>
        <p className="text-[10px] text-slate-600">{date}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-bold text-white">{formatAmount(doc.totalTTC)} €</p>
        <p className="text-[10px] text-slate-500">TTC</p>
      </div>
      <Eye className="w-4 h-4 text-slate-600 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  )
}

interface Props { onClose(): void }

export default function BillingPanel({ onClose }: Props) {
  const { t }                       = useTranslation()
  const { invalidateStats, statsVersion } = useScheduleStore()

  const [tab,     setTab]     = useState<'invoices' | 'quotes'>('invoices')
  const [quotes,  setQuotes]  = useState<Doc[]>([])
  const [invoices,setInvoices]= useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [openDoc, setOpenDoc] = useState<{ type: 'quote' | 'invoice'; jobId?: string | null; docId: string } | null>(null)
  const [creating,setCreating]= useState<'quote' | 'invoice' | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [qRes, iRes] = await Promise.all([
        fetch('/api/quotes'),
        fetch('/api/invoices'),
      ])
      // asDocArray : une réponse non-tableau (objet d'erreur, null, {data:[]})
      // ne doit JAMAIS être stockée telle quelle (sinon filter/reduce crashe la
      // page entière). On stocke toujours un tableau.
      if (qRes.ok) { setQuotes(asDocArray<Doc>(await qRes.json())) }
      if (iRes.ok) { setInvoices(asDocArray<Doc>(await iRes.json())) }
    } catch {
      toast.error('Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => { load() }, [load])

  // Auto-reload when stats change (e.g. paid from elsewhere)
  const prevStatsVersionRef = useRef(statsVersion)
  useEffect(() => {
    if (statsVersion !== prevStatsVersionRef.current) {
      prevStatsVersionRef.current = statsVersion
      load()
    }
  }, [statsVersion, load])

  const docs     = asDocArray<Doc>(tab === 'quotes' ? quotes : invoices)
  // Recherche robuste aux champs null/legacy (docMatchesSearch garde `number` null).
  const filtered = docs.filter(d => docMatchesSearch(d, search))

  // Panel stats (montants non finis comptés comme 0 — jamais de NaN affiché).
  const totalTTC      = sumTTC(docs)
  const paidOrAccepted = docs.filter(d => d.status === 'paid' || d.status === 'accepted')
  const totalPaid     = sumTTC(paidOrAccepted)
  const pending       = docs.filter(d => ['draft', 'sent'].includes(d.status)).length

  function openExisting(doc: Doc) {
    setOpenDoc({
      type:  tab === 'quotes' ? 'quote' : 'invoice',
      jobId: doc.job?.id ?? null,
      docId: doc.id,
    })
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

        {/* Slide-in panel */}
        <div className="relative ml-auto w-full max-w-lg h-full bg-[#0f1629] border-l border-white/[0.08] flex flex-col shadow-2xl shadow-black/60 animate-slide-right">

          {/* Header */}
          <div className="px-5 py-4 border-b border-white/[0.07] flex items-center gap-3 flex-shrink-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
              <FileText className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-base font-bold text-white">Devis &amp; Facturation</h2>
              <p className="text-[11px] text-slate-500">Gestion commerciale</p>
            </div>
            <button onClick={load} title="Actualiser"
              className={cn('p-2 rounded-lg hover:bg-white/[0.07] text-slate-500 hover:text-white transition-all', loading && 'pointer-events-none')}>
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin text-blue-400')} />
            </button>
            <button onClick={onClose} className="gf-close p-2 rounded-lg hover:bg-white/[0.07] text-slate-400 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Stats row */}
          <div className="px-5 py-3 grid grid-cols-3 gap-3 border-b border-white/[0.07] flex-shrink-0">
            <div className="bg-white/[0.04] rounded-xl p-3 text-center">
              <p className="text-lg font-black text-white">{docs.length}</p>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">{tab === 'quotes' ? 'Devis' : 'Factures'}</p>
            </div>
            <div className="bg-emerald-500/10 rounded-xl p-3 text-center border border-emerald-500/20">
              <p className="text-lg font-black text-emerald-400">{formatAmount(totalPaid, 0)} €</p>
              <p className="text-[10px] text-emerald-600 uppercase tracking-wide">{tab === 'quotes' ? 'Acceptés' : 'Encaissé'}</p>
            </div>
            <div className="bg-amber-500/10 rounded-xl p-3 text-center border border-amber-500/20">
              <p className="text-lg font-black text-amber-400">{pending}</p>
              <p className="text-[10px] text-amber-600 uppercase tracking-wide">En attente</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-white/[0.07] px-5 flex-shrink-0">
            {([
              { id: 'invoices' as const, label: 'Factures', icon: <Receipt   className="w-3.5 h-3.5" />, count: invoices.length },
              { id: 'quotes'   as const, label: 'Devis',    icon: <FileText  className="w-3.5 h-3.5" />, count: quotes.length   },
            ]).map(ti => (
              <button key={ti.id} onClick={() => setTab(ti.id)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors',
                  tab === ti.id ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500 hover:text-slate-300'
                )}>
                {ti.icon}{ti.label}
                <span className="ml-1 text-[10px] bg-white/10 px-1.5 py-0.5 rounded-full">{ti.count}</span>
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={() => setCreating(tab === 'quotes' ? 'quote' : 'invoice')}
              className="my-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors">
              <Plus className="w-3.5 h-3.5" />
              Nouveau
            </button>
          </div>

          {/* Search */}
          <div className="px-5 py-3 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder={`${t.search}…`}
                className="w-full pl-9 pr-4 py-2 bg-white/[0.05] border border-white/10 rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto mb-4">
                  {tab === 'quotes' ? <FileText className="w-6 h-6 text-slate-600" /> : <Receipt className="w-6 h-6 text-slate-600" />}
                </div>
                <p className="text-slate-400 font-medium mb-1">
                  {search ? 'Aucun résultat' : `Aucune ${tab === 'quotes' ? 'devis' : 'facture'}`}
                </p>
                <p className="text-slate-600 text-sm">
                  {search ? 'Modifiez votre recherche' : 'Cliquez "Nouveau" pour créer'}
                </p>
              </div>
            ) : (
              <div>
                {filtered.map(doc => (
                  <DocRow key={doc.id} doc={doc}
                    type={tab === 'quotes' ? 'quote' : 'invoice'}
                    onClick={() => openExisting(doc)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer total */}
          {filtered.length > 0 && (
            <div className="px-5 py-3 border-t border-white/[0.07] flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-1.5 text-slate-400 text-xs">
                <TrendingUp className="w-3.5 h-3.5" />
                Total affiché
              </div>
              <div className="flex items-center gap-1 text-white font-bold">
                <Euro className="w-3.5 h-3.5 text-slate-400" />
                {formatAmount(sumTTC(filtered))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Edit existing document */}
      {openDoc && (
        <QuoteInvoiceModal
          key={openDoc.docId}
          mode={openDoc.type}
          documentId={openDoc.docId}
          jobId={openDoc.jobId}
          onClose={() => {
            setOpenDoc(null)
            load()
            invalidateStats()
          }}
          onSaved={() => {
            load()
            invalidateStats()
          }}
        />
      )}

      {/* Create new document (no job context) */}
      {creating && (
        <QuoteInvoiceModal
          key={`new-${creating}`}
          mode={creating}
          onClose={() => {
            setCreating(null)
            load()
          }}
          onSaved={() => {
            load()
            invalidateStats()
          }}
        />
      )}
    </>
  )
}
