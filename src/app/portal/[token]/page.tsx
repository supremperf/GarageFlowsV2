'use client'
import { lineCents, fromCents } from '@/lib/money'
import { readLineAmounts } from '@/lib/money-db'
import { repairConfig } from '@/lib/types'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface Mechanic {
  name: string
  avatar: string
  color: string
}

interface Photo {
  id: string
  phase: string
  caption: string | null
  base64: string
  photoPath: string | null
  createdAt: string
}

interface QuoteLine {
  id: string
  description: string
  /** Euros/unités — dérivés par l'API. Absents des instantanés publiés avant
   *  la correction du contrat : `readLineAmounts` retombe alors sur les entiers
   *  exacts ci-dessous. JAMAIS de coût d'achat ici (marge du garage). */
  quantity?: number
  unitPrice?: number
  quantityTenThousandths?: number
  unitPriceTenThousandths?: number
  isLabor: boolean
}

interface Quote {
  id: string
  number: string
  status: string
  issueDate: string
  validUntil: string | null
  taxRate: number
  lines: QuoteLine[]
  totalHT?: number
  totalTTC?: number
}

interface Garage {
  name: string
  phone: string | null
  email: string | null
  logoBase64: string | null
  logoPath: string | null
}

interface PortalData {
  customerName: string
  vehicleModel: string
  licensePlate: string | null
  status: string
  date: string
  startTime: string
  repairType: string
  notes: string | null
  mechanic: Mechanic | null
  photos: Photo[]
  quote: Quote | null
  garage: Garage
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Planifié',
  in_progress: 'En cours',
  completed: 'Terminé',
  delayed: 'En retard',
  cancelled: 'Annulé',
}

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-800 border-blue-200',
  in_progress: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  completed: 'bg-gray-100 text-gray-700 border-gray-200',
  delayed: 'bg-amber-100 text-amber-800 border-amber-200',
  cancelled: 'bg-red-100 text-red-800 border-red-200',
}

const PHASE_LABELS: Record<string, string> = {
  before: 'Avant',
  during: 'Pendant',
  after: 'Après',
}

export default function PortalPage() {
  const params = useParams()
  const token = params?.token as string

  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activePhase, setActivePhase] = useState<string>('before')

  useEffect(() => {
    if (!token) return
    fetch(`/api/portal/${token}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) {
          setError(json.error ?? 'Erreur inconnue')
        } else {
          setData(json)
          // Default to the first available phase
          const phases = Array.from(new Set((json.photos as Photo[]).map((p) => p.phase)))
          if (phases.length > 0) setActivePhase(phases[0])
        }
      })
      .catch(() => setError('Impossible de charger les données.'))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-500 text-sm">Chargement en cours…</p>
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

  const statusLabel = STATUS_LABELS[data.status] ?? data.status
  const statusColor = STATUS_COLORS[data.status] ?? 'bg-gray-100 text-gray-700 border-gray-200'

  const phases = Array.from(new Set(data.photos.map((p) => p.phase)))
  const visiblePhotos = data.photos.filter((p) => p.phase === activePhase)

  const quote = data.quote
  const totalHT  = quote?.totalHT  ?? 0
  const totalTTC = quote?.totalTTC ?? 0
  const tva = totalTTC - totalHT

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
    } catch {
      return d
    }
  }

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
            {(data.garage.phone || data.garage.email) && (
              <p className="text-xs text-gray-500">
                {data.garage.phone && <span>{data.garage.phone}</span>}
                {data.garage.phone && data.garage.email && <span className="mx-1">·</span>}
                {data.garage.email && <span>{data.garage.email}</span>}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {/* Status card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Suivi de votre véhicule</p>
              <h2 className="text-xl font-bold text-gray-900">{data.customerName}</h2>
              <p className="text-gray-600 text-sm mt-0.5">
                {data.vehicleModel}
                {data.licensePlate && (
                  <span className="ml-2 px-2 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-700">
                    {data.licensePlate}
                  </span>
                )}
              </p>
            </div>
            <span className={`inline-flex items-center px-3 py-1 rounded-full border text-sm font-semibold ${statusColor}`}>
              {statusLabel}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-0.5">Date</p>
              <p className="font-medium text-gray-800">{formatDate(data.date)}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-0.5">Heure</p>
              <p className="font-medium text-gray-800">{data.startTime}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-0.5">Type d&apos;intervention</p>
              {/* Libellé LISIBLE : le client ne doit pas voir la clé interne
                  (« brake_pads » au lieu de « Plaquettes de frein »). */}
              <p className="font-medium text-gray-800">{repairConfig(data.repairType).label}</p>
            </div>
            {data.mechanic && (
              <div className="bg-gray-50 rounded-xl p-3 flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                  style={{ backgroundColor: data.mechanic.color }}
                >
                  {data.mechanic.avatar}
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Mécanicien</p>
                  <p className="font-medium text-gray-800 text-sm leading-none">{data.mechanic.name}</p>
                </div>
              </div>
            )}
          </div>

          {data.notes && (
            <div className="mt-3 p-3 bg-blue-50 rounded-xl border border-blue-100">
              <p className="text-xs text-blue-600 font-medium mb-0.5">Notes</p>
              <p className="text-sm text-blue-900">{data.notes}</p>
            </div>
          )}
        </div>

        {/* Photos */}
        {data.photos.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="font-semibold text-gray-800 mb-3">Photos</h3>

            {phases.length > 1 && (
              <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
                {phases.map((phase) => (
                  <button
                    key={phase}
                    onClick={() => setActivePhase(phase)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                      activePhase === phase
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {PHASE_LABELS[phase] ?? phase}
                    <span className="ml-1.5 text-xs opacity-70">
                      ({data.photos.filter((p) => p.phase === phase).length})
                    </span>
                  </button>
                ))}
              </div>
            )}

            {visiblePhotos.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-4">Aucune photo pour cette phase.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {visiblePhotos.map((photo) => (
                  <div key={photo.id} className="rounded-xl overflow-hidden bg-gray-100 aspect-square">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.base64 || (photo.photoPath ? `/uploads/${photo.photoPath}` : '')}
                      alt={photo.caption ?? 'Photo'}
                      className="w-full h-full object-cover"
                    />
                    {photo.caption && (
                      <p className="text-xs text-gray-500 px-2 py-1 truncate">{photo.caption}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Quote */}
        {quote && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-800">Devis {quote.number}</h3>
              <span className="text-xs text-gray-400">
                Émis le {formatDate(quote.issueDate)}
                {quote.validUntil && ` · Valable jusqu'au ${formatDate(quote.validUntil)}`}
              </span>
            </div>

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
                  {quote.lines.map((line) => {
                    const { quantity, unitPrice } = readLineAmounts(line)
                    return (
                      <tr key={line.id} className="border-b border-gray-50">
                        <td className="py-2 pr-3 text-gray-800">{line.description}</td>
                        <td className="py-2 px-2 text-right text-gray-600">{quantity}</td>
                        <td className="py-2 px-2 text-right text-gray-600">{unitPrice.toFixed(2)} €</td>
                        <td className="py-2 pl-2 text-right font-medium text-gray-800">
                          {fromCents(lineCents(unitPrice, quantity)).toFixed(2)} €
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 space-y-1 text-sm border-t border-gray-100 pt-3">
              <div className="flex justify-between text-gray-600">
                <span>Total HT</span>
                <span>{totalHT.toFixed(2)} €</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>TVA ({quote.taxRate}%)</span>
                <span>{tva.toFixed(2)} €</span>
              </div>
              <div className="flex justify-between font-bold text-gray-900 text-base pt-1 border-t border-gray-200">
                <span>Total TTC</span>
                <span>{totalTTC.toFixed(2)} €</span>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 pb-4">
          {/* Durée RÉELLE du jeton (7 jours, cf. /api/portal/generate) — le
              texte annonçait 48 h, ce qui était faux. */}
          Cette page est réservée à votre usage personnel. Lien valable 7 jours.
        </p>
      </main>
    </div>
  )
}
