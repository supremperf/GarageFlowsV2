'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface QuoteLine {
  id: string
  description: string
  quantity: number
  unitPrice: number
  unitCost: number
  isLabor: boolean
  sortOrder: number
}

interface Garage {
  name: string
  phone: string | null
  email: string | null
  address: string | null
  siret: string | null
  logoBase64: string | null
  logoPath: string | null
  taxRate: number
  invoiceFooter: string | null
}

interface QuoteData {
  id: string
  number: string
  status: string
  issueDate: string
  validUntil: string | null
  taxRate: number
  notes: string | null
  clientName: string
  clientEmail: string | null
  clientPhone: string | null
  clientAddress: string | null
  vehicleModel: string | null
  licensePlate: string | null
  lines: QuoteLine[]
  garage: Garage
  totalHT: number
  totalTTC: number
  alreadySigned: boolean
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  sent: 'Envoyé',
  accepted: 'Accepté',
  refused: 'Refusé',
  converted: 'Converti en facture',
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-800',
  accepted: 'bg-emerald-100 text-emerald-800',
  refused: 'bg-red-100 text-red-800',
  converted: 'bg-purple-100 text-purple-800',
}

export default function QuoteApprovalPage() {
  const params = useParams()
  const token = params?.token as string

  const [data, setData] = useState<QuoteData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionDone, setActionDone] = useState<'accepted' | 'refused' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    fetch(`/api/portal/quote/${token}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) {
          setError(json.error ?? 'Erreur inconnue')
        } else {
          setData(json)
        }
      })
      .catch(() => setError('Impossible de charger le devis.'))
      .finally(() => setLoading(false))
  }, [token])

  const handleAction = async (action: 'accept' | 'refuse') => {
    setActionLoading(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/portal/quote/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) {
        setActionError(json.error ?? 'Une erreur est survenue.')
      } else {
        setActionDone(json.status as 'accepted' | 'refused')
        if (data) setData({ ...data, status: json.status, alreadySigned: true })
      }
    } catch {
      setActionError('Une erreur est survenue. Veuillez réessayer.')
    } finally {
      setActionLoading(false)
    }
  }

  const formatDate = (d: string | null | undefined) => {
    if (!d) return '—'
    try {
      return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
    } catch {
      return d
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-500 text-sm">Chargement du devis…</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Lien invalide ou expiré</h2>
          <p className="text-gray-500 text-sm">{error ?? 'Ce lien n\'est plus valide. Veuillez contacter votre garage.'}</p>
        </div>
      </div>
    )
  }

  const tva = data.totalTTC - data.totalHT
  const isAlreadySigned = data.alreadySigned || actionDone !== null

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          {data.garage.logoBase64 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.garage.logoBase64}
              alt={data.garage.name}
              className="h-10 w-auto object-contain rounded"
            />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-lg select-none">
              {data.garage.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="font-semibold text-gray-900 text-lg leading-tight">{data.garage.name}</h1>
            <div className="text-xs text-gray-500 flex flex-wrap gap-x-2">
              {data.garage.phone && <span>{data.garage.phone}</span>}
              {data.garage.email && <span>{data.garage.email}</span>}
              {data.garage.address && <span>{data.garage.address}</span>}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {/* Quote header card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Devis</p>
              <h2 className="text-2xl font-bold text-gray-900">{data.number}</h2>
            </div>
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${STATUS_COLORS[data.status] ?? 'bg-gray-100 text-gray-700'}`}>
              {STATUS_LABELS[data.status] ?? data.status}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-0.5">Date d&apos;émission</p>
              <p className="font-medium text-gray-800">{formatDate(data.issueDate)}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-0.5">Valable jusqu&apos;au</p>
              <p className="font-medium text-gray-800">{formatDate(data.validUntil)}</p>
            </div>
          </div>

          {/* Client & vehicle */}
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Client</p>
              <p className="font-medium text-gray-800">{data.clientName}</p>
              {data.clientEmail && <p className="text-gray-500 text-xs">{data.clientEmail}</p>}
              {data.clientPhone && <p className="text-gray-500 text-xs">{data.clientPhone}</p>}
              {data.clientAddress && <p className="text-gray-500 text-xs">{data.clientAddress}</p>}
            </div>
            {(data.vehicleModel || data.licensePlate) && (
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Véhicule</p>
                {data.vehicleModel && <p className="font-medium text-gray-800">{data.vehicleModel}</p>}
                {data.licensePlate && (
                  <span className="inline-block mt-1 px-2 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-700">
                    {data.licensePlate}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Lines table */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="font-semibold text-gray-800 mb-4">Détail des prestations</h3>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 pr-3 text-gray-500 font-medium">Description</th>
                  <th className="text-right py-2 px-2 text-gray-500 font-medium whitespace-nowrap">Qté</th>
                  <th className="text-right py-2 px-2 text-gray-500 font-medium whitespace-nowrap">P.U. HT</th>
                  <th className="text-right py-2 pl-2 text-gray-500 font-medium whitespace-nowrap">Total HT</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((line) => (
                  <tr key={line.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2.5 pr-3 text-gray-800">
                      {line.description}
                      {line.isLabor && (
                        <span className="ml-1.5 text-xs text-blue-500 font-medium">(MO)</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-right text-gray-600">{line.quantity}</td>
                    <td className="py-2.5 px-2 text-right text-gray-600">{line.unitPrice.toFixed(2)} €</td>
                    <td className="py-2.5 pl-2 text-right font-medium text-gray-800">
                      {(line.quantity * line.unitPrice).toFixed(2)} €
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="mt-4 space-y-1.5 text-sm border-t border-gray-100 pt-4">
            <div className="flex justify-between text-gray-600">
              <span>Sous-total HT</span>
              <span>{data.totalHT.toFixed(2)} €</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>TVA ({data.taxRate}%)</span>
              <span>{tva.toFixed(2)} €</span>
            </div>
            <div className="flex justify-between font-bold text-gray-900 text-lg pt-2 border-t border-gray-200 mt-2">
              <span>Total TTC</span>
              <span>{data.totalTTC.toFixed(2)} €</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {data.notes && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="font-semibold text-gray-800 mb-2">Notes</h3>
            <p className="text-sm text-gray-600 whitespace-pre-line">{data.notes}</p>
          </div>
        )}

        {/* Action zone */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          {isAlreadySigned ? (
            <div className={`rounded-xl p-5 text-center ${actionDone === 'accepted' || data.status === 'accepted' || data.status === 'converted' ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
              {(actionDone === 'accepted' || data.status === 'accepted' || data.status === 'converted') ? (
                <>
                  <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-emerald-800 text-lg mb-1">Devis accepté</h3>
                  <p className="text-emerald-700 text-sm">Merci ! Votre accord a bien été enregistré. Le garage vous contactera prochainement.</p>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-red-800 text-lg mb-1">Devis refusé</h3>
                  <p className="text-red-700 text-sm">Votre réponse a été enregistrée. N&apos;hésitez pas à contacter le garage si vous souhaitez en discuter.</p>
                </>
              )}
            </div>
          ) : (
            <>
              <h3 className="font-semibold text-gray-800 mb-1">Votre réponse</h3>
              <p className="text-sm text-gray-500 mb-4">
                Acceptez ou refusez ce devis en cliquant sur l&apos;un des boutons ci-dessous. Votre réponse sera immédiatement transmise au garage.
              </p>

              {actionError && (
                <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                  {actionError}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => handleAction('accept')}
                  disabled={actionLoading}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-base transition-colors shadow-sm"
                >
                  {actionLoading ? (
                    <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  Accepter le devis
                </button>

                <button
                  onClick={() => handleAction('refuse')}
                  disabled={actionLoading}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl border-2 border-red-300 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed text-red-700 font-semibold text-base transition-colors"
                >
                  {actionLoading ? (
                    <span className="w-5 h-5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                  Refuser
                </button>
              </div>
            </>
          )}
        </div>

        {/* Garage footer */}
        {(data.garage.siret || data.garage.invoiceFooter) && (
          <div className="text-center text-xs text-gray-400 pb-4 space-y-0.5">
            {data.garage.invoiceFooter && <p>{data.garage.invoiceFooter}</p>}
            {data.garage.siret && <p>SIRET : {data.garage.siret}</p>}
          </div>
        )}
      </main>
    </div>
  )
}
