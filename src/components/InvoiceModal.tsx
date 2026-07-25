'use client'

import { useState, useEffect } from 'react'
import { useTranslation } from '@/lib/i18n'
import { X, Printer, FileText, Receipt, Download } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Job {
  id: string
  customerName: string
  vehicleModel: string
  licensePlate?: string
  repairType: string
  estimatedDuration: number
  actualDuration?: number
  date: string
  notes?: string
}

interface JobPart {
  id: string
  quantity: number
  unitPrice: number
  part: { name: string; reference?: string }
}

interface GarageInfo {
  name: string
  address?: string
  phone?: string
  email?: string
  website?: string
  siret?: string
  vatNumber?: string
  taxRate: number
  iban?: string
  bic?: string
  bankName?: string
  currency: string
  paymentTerms?: string
  invoicePrefix: string
  invoiceCounter: number
  quotePrefix: string
  quoteCounter: number
  invoiceFooter?: string
  logoBase64?: string
  logoPath?:   string | null
  hourlyRate: number
}

interface Props {
  job: Job
  mode: 'invoice' | 'quote'
  onClose: () => void
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', CAD: 'CA$', AUD: 'AU$',
  JPY: '¥', MAD: 'MAD', TND: 'TND', DZD: 'DZD', XOF: 'XOF',
}

function fmt(amount: number, currency: string) {
  const sym = CURRENCY_SYMBOLS[currency] ?? currency
  return `${amount.toFixed(2)} ${sym}`
}

function pad(n: number) {
  return String(n).padStart(4, '0')
}

export default function InvoiceModal({ job, mode, onClose }: Props) {
  const { t } = useTranslation()
  const [garage, setGarage] = useState<GarageInfo | null>(null)
  const [parts, setParts] = useState<JobPart[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/garages').then(r => r.ok ? r.json() : null),
      fetch(`/api/jobs/${job.id}/parts`).then(r => r.ok ? r.json() : []),
    ]).then(([g, p]) => {
      setGarage(g)
      setParts(Array.isArray(p) ? p : [])
    }).finally(() => setLoading(false))
  }, [job.id])

  if (loading || !garage) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-2xl p-8 text-gray-500 text-sm">{t.loading}</div>
      </div>
    )
  }

  const isInvoice = mode === 'invoice'
  const prefix = isInvoice ? garage.invoicePrefix : garage.quotePrefix
  const counter = isInvoice ? garage.invoiceCounter + 1 : garage.quoteCounter + 1
  const docNumber = `${prefix}-${pad(counter)}`

  const duration = job.actualDuration ?? job.estimatedDuration
  const laborHours = duration / 60
  const laborHT = laborHours * garage.hourlyRate
  const partsHT = parts.reduce((s, p) => s + p.unitPrice * p.quantity, 0)
  const totalHT = laborHT + partsHT
  const tva = totalHT * (garage.taxRate / 100)
  const totalTTC = totalHT + tva
  const currency = garage.currency

  const issueDate = new Date().toLocaleDateString('fr-FR')
  const jobDate = new Date(job.date).toLocaleDateString('fr-FR')

  async function handleDownloadPDF() {
    try {
      const el = document.getElementById('invoice-content')
      if (!el) return
      const { default: html2canvas } = await import('html2canvas')
      const { default: jsPDF } = await import('jspdf')
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const imgW = pageW - 20
      const imgH = (canvas.height * imgW) / canvas.width
      const yOffset = imgH > pageH - 20 ? 10 : (pageH - imgH) / 2
      pdf.addImage(imgData, 'PNG', 10, yOffset > 10 ? 10 : yOffset, imgW, Math.min(imgH, pageH - 20))
      pdf.save(`${docNumber}.pdf`)
    } catch (err) {
      console.error('PDF generation failed', err)
    }
  }

  return (
    <>
      <style>{`
        @media print {
          body > *:not(#invoice-print-wrapper) { display: none !important; }
          #invoice-print-wrapper { display: block !important; }
        }
        @media screen {
          #invoice-print-wrapper { display: none; }
        }
      `}</style>

      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">

          {/* Modal toolbar */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 print:hidden">
            <div className="flex items-center gap-3">
              {isInvoice
                ? <Receipt className="w-5 h-5 text-blue-600" />
                : <FileText className="w-5 h-5 text-purple-600" />}
              <h2 className="text-lg font-bold text-gray-900">
                {isInvoice ? t.generateInvoice : t.generateQuote} — {docNumber}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDownloadPDF}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
              >
                <Download className="w-4 h-4" />
                {t.download}
              </button>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
              >
                <Printer className="w-4 h-4" />
                {t.print}
              </button>
              <button onClick={onClose} className="gf-close p-2 rounded-lg hover:bg-gray-100 text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Document preview */}
          <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
            <div className="bg-white max-w-2xl mx-auto shadow-sm rounded-xl p-8 text-gray-900 text-sm" id="invoice-content">

              {/* Header */}
              <div className="flex items-start justify-between mb-8">
                <div className="flex items-start gap-4">
                  {(garage.logoBase64 || garage.logoPath) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={garage.logoBase64 || `/api/photos/${garage.logoPath}`}
                      alt={garage.name}
                      className="w-16 h-16 object-contain rounded"
                    />
                  )}
                  <div>
                    <h1 className="text-xl font-bold text-gray-900">{garage.name}</h1>
                    {garage.address && <p className="text-gray-500 text-xs mt-0.5">{garage.address}</p>}
                    {garage.phone && <p className="text-gray-500 text-xs">{garage.phone}</p>}
                    {garage.email && <p className="text-gray-500 text-xs">{garage.email}</p>}
                    {garage.website && <p className="text-gray-500 text-xs">{garage.website}</p>}
                  </div>
                </div>
                <div className="text-right">
                  <div className={cn(
                    'inline-block px-4 py-1.5 rounded-lg text-white font-bold text-sm mb-2',
                    isInvoice ? 'bg-blue-600' : 'bg-purple-600'
                  )}>
                    {isInvoice ? t.invoice : t.quote}
                  </div>
                  <p className="text-base font-bold text-gray-800">{docNumber}</p>
                  <p className="text-xs text-gray-400 mt-1">{t.issueDate}: {issueDate}</p>
                  {!isInvoice && <p className="text-xs text-gray-400">{t.validFor30Days}</p>}
                </div>
              </div>

              <div className="h-px bg-gray-200 mb-6" />

              {/* Client + vehicle */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{t.customer}</p>
                  <p className="font-semibold text-gray-900">{job.customerName}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{t.vehicle}</p>
                  <p className="font-semibold text-gray-900">{job.vehicleModel}</p>
                  {job.licensePlate && (
                    <span className="inline-block text-xs text-gray-600 font-mono bg-gray-200 px-2 py-0.5 rounded mt-1">
                      {job.licensePlate}
                    </span>
                  )}
                  <p className="text-xs text-gray-400 mt-1">{t.interventionDate}: {jobDate}</p>
                </div>
              </div>

              {/* Line items */}
              <table className="w-full mb-6 text-sm">
                <thead>
                  <tr className="bg-gray-800 text-white text-xs">
                    <th className="text-left px-4 py-2.5 rounded-tl-lg font-medium">{t.description}</th>
                    <th className="text-center px-3 py-2.5 font-medium">{t.qty}</th>
                    <th className="text-right px-3 py-2.5 font-medium">{t.unitPrice}</th>
                    <th className="text-right px-4 py-2.5 rounded-tr-lg font-medium">{t.subtotal}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-100">
                    <td className="px-4 py-3">
                      <p className="font-medium">{t.laborLine}: {job.repairType}</p>
                      <p className="text-xs text-gray-400">{laborHours.toFixed(1)}h × {fmt(garage.hourlyRate, currency)}/h</p>
                    </td>
                    <td className="px-3 py-3 text-center text-gray-600">{laborHours.toFixed(1)}</td>
                    <td className="px-3 py-3 text-right text-gray-600">{fmt(garage.hourlyRate, currency)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{fmt(laborHT, currency)}</td>
                  </tr>
                  {parts.map(p => (
                    <tr key={p.id} className="border-b border-gray-100">
                      <td className="px-4 py-3">
                        <p className="font-medium">{p.part.name}</p>
                        {p.part.reference && <p className="text-xs text-gray-400">Réf: {p.part.reference}</p>}
                      </td>
                      <td className="px-3 py-3 text-center text-gray-600">{p.quantity}</td>
                      <td className="px-3 py-3 text-right text-gray-600">{fmt(p.unitPrice, currency)}</td>
                      <td className="px-4 py-3 text-right font-semibold">{fmt(p.unitPrice * p.quantity, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals */}
              <div className="flex justify-end mb-6">
                <div className="w-60 space-y-1.5">
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>{t.subtotal}</span>
                    <span>{fmt(totalHT, currency)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>{t.vat} ({garage.taxRate}%)</span>
                    <span>{fmt(tva, currency)}</span>
                  </div>
                  <div className="h-px bg-gray-200 my-1" />
                  <div className="flex justify-between text-base font-bold">
                    <span>{t.total}</span>
                    <span className={isInvoice ? 'text-blue-600' : 'text-purple-600'}>
                      {fmt(totalTTC, currency)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Payment info */}
              {(garage.paymentTerms || garage.iban || garage.bankName) && (
                <div className="bg-blue-50 rounded-lg p-4 mb-4">
                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">{t.paymentInfo}</p>
                  {garage.paymentTerms && (
                    <p className="text-xs text-blue-800">{t.paymentTerms}: <span className="font-medium">{garage.paymentTerms}</span></p>
                  )}
                  {garage.bankName && <p className="text-xs text-blue-800 mt-0.5">{t.bankName}: {garage.bankName}</p>}
                  {garage.iban && <p className="text-xs text-blue-800 font-mono mt-0.5">IBAN: {garage.iban}</p>}
                  {garage.bic && <p className="text-xs text-blue-800">BIC: {garage.bic}</p>}
                </div>
              )}

              {/* Notes */}
              {job.notes && (
                <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 mb-4">
                  <span className="font-medium">{t.notes}: </span>{job.notes}
                </div>
              )}

              {/* Legal footer */}
              {(garage.siret || garage.vatNumber || garage.invoiceFooter) && (
                <div className="border-t border-gray-200 pt-3 space-y-1">
                  {(garage.siret || garage.vatNumber) && (
                    <p className="text-xs text-gray-400 flex gap-4">
                      {garage.siret && <span>SIRET: {garage.siret}</span>}
                      {garage.vatNumber && <span>N° TVA: {garage.vatNumber}</span>}
                    </p>
                  )}
                  {garage.invoiceFooter && (
                    <p className="text-xs text-gray-400 text-center">{garage.invoiceFooter}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Print target */}
      <div id="invoice-print-wrapper" style={{ display: 'none' }} />
    </>
  )
}
