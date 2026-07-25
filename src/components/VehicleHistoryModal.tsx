'use client'

import { useState, useEffect } from 'react'
import { X, Car, Wrench, Calendar, TrendingUp, Camera, Clock, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'

interface Job {
  id: string
  date: string
  repairType: string
  status: string
  estimatedDuration: number
  actualDuration?: number | null
  notes?: string | null
  customerName: string
  licensePlate?: string | null
  vehicleModel: string
  mileageAtVisit?: number | null
  jobParts?: { unitPrice: number; quantity: number; unitCost: number }[]
}

interface Vehicle {
  id: string
  licensePlate: string
  make: string
  model: string
  year?: number | null
  mileage?: number | null
  color?: string | null
  notes?: string | null
  vin?: string | null
  client: {
    name: string
    phone?: string | null
    email?: string | null
  }
  jobs: Job[]
}

interface Props {
  vehicleId: string
  onClose: () => void
}

const REPAIR_LABELS: Record<string, string> = {
  vidange: 'Vidange',
  freins: 'Freins',
  distribution: 'Distribution',
  pneus: 'Pneus',
  batterie: 'Batterie',
  ct: 'Contrôle technique',
  climatisation: 'Climatisation',
  suspension: 'Suspension',
  embrayage: 'Embrayage',
  diagnostic: 'Diagnostic',
  autre: 'Autre',
}

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-700',
  in_progress: 'bg-blue-100 text-blue-700',
  scheduled: 'bg-gray-100 text-gray-600',
  delayed: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-500',
}

const STATUS_LABELS: Record<string, string> = {
  completed: 'Terminé', in_progress: 'En cours',
  scheduled: 'Planifié', delayed: 'En retard', cancelled: 'Annulé',
}

export default function VehicleHistoryModal({ vehicleId, onClose }: Props) {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/vehicles/${vehicleId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setVehicle(d); setLoading(false) })
  }, [vehicleId])

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-2xl p-8 text-gray-400">Chargement…</div>
      </div>
    )
  }

  if (!vehicle) return null

  const completedJobs = vehicle.jobs.filter(j => j.status === 'completed')
  const totalRevenue = completedJobs.reduce((s, j) => {
    const parts = j.jobParts ?? []
    const partsRevenue = parts.reduce((ps, p) => ps + p.unitPrice * p.quantity, 0)
    const laborRevenue = ((j.actualDuration ?? j.estimatedDuration) / 60) * 60
    return s + partsRevenue + laborRevenue
  }, 0)
  const totalCost = completedJobs.reduce((s, j) => {
    const parts = j.jobParts ?? []
    return s + parts.reduce((ps, p) => ps + p.unitCost * p.quantity, 0)
  }, 0)

  const sortedJobs = [...vehicle.jobs].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <Car className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="font-bold text-gray-900">{vehicle.make} {vehicle.model}</h2>
              <p className="font-mono text-blue-700 text-sm">{vehicle.licensePlate}</p>
            </div>
            {vehicle.year && <span className="text-sm text-gray-400">{vehicle.year}</span>}
            {vehicle.color && <span className="text-sm text-gray-400">· {vehicle.color}</span>}
          </div>
          <button onClick={onClose} className="gf-close p-2 hover:bg-gray-100 rounded-lg text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Vehicle & client info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Propriétaire</p>
              <p className="font-semibold text-gray-900">{vehicle.client.name}</p>
              {vehicle.client.phone && <p className="text-sm text-gray-500">{vehicle.client.phone}</p>}
              {vehicle.client.email && <p className="text-sm text-gray-500">{vehicle.client.email}</p>}
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Informations</p>
              {vehicle.mileage && <p className="text-sm text-gray-600">Kilométrage : <span className="font-semibold">{vehicle.mileage.toLocaleString('fr-FR')} km</span></p>}
              {vehicle.vin && <p className="text-xs text-gray-400 font-mono mt-1">VIN : {vehicle.vin}</p>}
              {vehicle.notes && <p className="text-sm text-gray-500 italic mt-1">{vehicle.notes}</p>}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Interventions', value: vehicle.jobs.length, icon: Wrench, color: 'text-blue-600 bg-blue-50' },
              { label: 'Terminées', value: completedJobs.length, icon: Calendar, color: 'text-emerald-600 bg-emerald-50' },
              { label: 'CA total', value: `${totalRevenue.toFixed(0)} €`, icon: TrendingUp, color: 'text-purple-600 bg-purple-50' },
              { label: 'Photos', value: '—', icon: Camera, color: 'text-amber-600 bg-amber-50' },
            ].map(s => (
              <div key={s.label} className={cn('rounded-xl p-3', s.color)}>
                <s.icon className="w-4 h-4 mb-1 opacity-70" />
                <p className="text-lg font-bold">{s.value}</p>
                <p className="text-xs opacity-70">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Timeline */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-400" />
              Historique des interventions
            </h3>
            {sortedJobs.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Aucune intervention</p>
            ) : (
              <div className="space-y-2">
                {sortedJobs.map((job, idx) => {
                  const parts = job.jobParts ?? []
                  const partsRevenue = parts.reduce((s, p) => s + p.unitPrice * p.quantity, 0)
                  const laborRevenue = ((job.actualDuration ?? job.estimatedDuration) / 60) * 60
                  const total = partsRevenue + laborRevenue
                  const partsCost = parts.reduce((s, p) => s + p.unitCost * p.quantity, 0)
                  const profit = total - partsCost
                  return (
                    <div key={job.id} className={cn('border rounded-xl p-3.5 transition-colors', idx === 0 ? 'border-blue-200 bg-blue-50/30' : 'border-gray-100 bg-white')}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-gray-900 text-sm">
                              {REPAIR_LABELS[job.repairType] ?? job.repairType}
                            </span>
                            <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full', STATUS_COLORS[job.status] ?? 'bg-gray-100 text-gray-500')}>
                              {STATUS_LABELS[job.status] ?? job.status}
                            </span>
                            {idx === 0 && <span className="text-[10px] bg-blue-100 text-blue-700 font-semibold px-1.5 py-0.5 rounded-full">Dernière visite</span>}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {format(parseISO(job.date), 'd MMMM yyyy', { locale: fr })}
                            {job.mileageAtVisit && ` · ${job.mileageAtVisit.toLocaleString('fr-FR')} km`}
                          </p>
                          {job.notes && <p className="text-xs text-gray-400 italic mt-1">{job.notes}</p>}
                          {parts.length > 0 && (
                            <p className="text-xs text-gray-400 mt-1">
                              {parts.length} pièce{parts.length > 1 ? 's' : ''}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-semibold text-gray-900 text-sm">{total.toFixed(0)} €</p>
                          {partsCost > 0 && (
                            <p className={cn('text-xs', profit >= 0 ? 'text-emerald-600' : 'text-red-500')}>
                              marge {profit >= 0 ? '+' : ''}{profit.toFixed(0)} €
                            </p>
                          )}
                          <p className="text-xs text-gray-400">
                            {job.actualDuration ? `${job.actualDuration} min réels` : `${job.estimatedDuration} min estimés`}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Total spent */}
          {totalRevenue > 0 && (
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-4 border border-blue-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total dépensé chez vous</p>
                  <p className="text-2xl font-bold text-blue-700">{totalRevenue.toFixed(2)} €</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-600">Marge totale</p>
                  <p className={cn('text-xl font-bold', (totalRevenue - totalCost) >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                    {(totalRevenue - totalCost) >= 0 ? '+' : ''}{(totalRevenue - totalCost).toFixed(2)} €
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
