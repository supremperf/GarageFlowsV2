'use client'

import { useState, useEffect } from 'react'
import {
  X, Car, Hash, User, Phone, Mail, Wrench, Clock, Calendar,
  ChevronRight, AlertCircle, Loader2, Package, Edit3, Check, ShieldAlert
} from 'lucide-react'
import { REPAIR_TYPES } from '@/lib/types'
import { cn, formatDuration, getStatusColor, getStatusLabel } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import { DateField } from '@/components/DateField'
import { useTranslation } from '@/lib/i18n'
import { dateLocale } from '@/lib/i18n/date-locale'
import { repairTypeLabel, jobStatusLabel } from '@/lib/i18n/labels'

interface VehicleData {
  id: string
  licensePlate: string
  vin?: string
  make: string
  model: string
  year?: number
  mileage?: number
  color?: string
  notes?: string
  ctDate?: string | null
  client: {
    id: string
    name: string
    phone?: string
    email?: string
    address?: string
  }
  jobs: Array<{
    id: string
    date: string
    repairType: string
    estimatedDuration: number
    actualDuration?: number
    status: string
    notes?: string
    mileageAtVisit?: number
    mechanic: { name: string; color: string; avatar: string }
    jobParts: Array<{
      quantity: number
      unitPrice: number
      part: { name: string; reference?: string }
    }>
  }>
}

interface VehicleModalProps {
  vehicleId?: string
  licensePlate?: string
  onClose: () => void
  onEditJob?: (jobId: string) => void
}

export default function VehicleModal({ vehicleId, licensePlate, onClose, onEditJob }: VehicleModalProps) {
  const { t, lang } = useTranslation()
  const loc = dateLocale(lang)
  const [vehicle, setVehicle] = useState<VehicleData | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [mileageEdit, setMileageEdit] = useState('')
  const [ctEdit, setCtEdit]           = useState('')
  const [editingCt, setEditingCt]     = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        let data: VehicleData | null = null

        if (vehicleId) {
          const res = await fetch(`/api/vehicles/${vehicleId}`)
          if (res.ok) data = await res.json()
        } else if (licensePlate) {
          const res = await fetch(`/api/vehicles?plate=${encodeURIComponent(licensePlate)}`)
          if (res.ok) {
            const raw = await res.json()
            const arr = raw?.data ?? raw ?? []
            if (arr.length > 0) {
              const res2 = await fetch(`/api/vehicles/${arr[0].id}`)
              if (res2.ok) data = await res2.json()
            }
          }
        }
        setVehicle(data)
        if (data?.mileage) setMileageEdit(String(data.mileage))
        if (data?.ctDate)  setCtEdit(data.ctDate)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [vehicleId, licensePlate])

  async function saveMileage() {
    if (!vehicle) return
    const km = Number(mileageEdit)
    if (isNaN(km) || km < 0) return

    const res = await fetch(`/api/vehicles/${vehicle.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mileage: km }),
    })
    if (res.ok) {
      setVehicle(v => v ? { ...v, mileage: km } : v)
      setEditing(false)
      toast.success(t.vmMileageUpdated)
    }
  }

  async function saveCt() {
    if (!vehicle) return
    const res = await fetch(`/api/vehicles/${vehicle.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ctDate: ctEdit || null }),
    })
    if (res.ok) {
      setVehicle(v => v ? { ...v, ctDate: ctEdit || null } : v)
      setEditingCt(false)
      toast.success(t.vmCtUpdated)
    }
  }

  const totalRevenue = vehicle?.jobs.reduce((sum, j) => {
    const parts = j.jobParts.reduce((s, p) => s + p.unitPrice * p.quantity, 0)
    return sum + parts
  }, 0) ?? 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-slide-in">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
            <Car className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            {loading ? (
              <div className="h-5 w-32 bg-gray-100 rounded animate-pulse" />
            ) : vehicle ? (
              <>
                <h2 className="text-lg font-bold text-gray-900 leading-tight">
                  {vehicle.make} {vehicle.model}
                  {vehicle.year && <span className="text-gray-400 font-normal ml-1">({vehicle.year})</span>}
                </h2>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="font-mono text-sm font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                    {vehicle.licensePlate}
                  </span>
                  {vehicle.color && (
                    <span className="text-xs text-gray-500">{vehicle.color}</span>
                  )}
                  {vehicle.vin && (
                    <span className="text-xs text-gray-400 font-mono">VIN: {vehicle.vin}</span>
                  )}
                </div>
              </>
            ) : (
              <p className="text-gray-500">{t.jmVehicleNotFound}</p>
            )}
          </div>
          <button onClick={onClose} className="gf-close p-2 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : !vehicle ? (
          <div className="flex-1 flex items-center justify-center py-12 text-center">
            <div>
              <AlertCircle className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-gray-500">{t.vmNoSheet}</p>
              <p className="text-xs text-gray-400 mt-1">{t.vmNoSheetHint}</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* Info grid */}
            <div className="p-6 grid grid-cols-2 gap-4 border-b border-gray-100">
              {/* Client */}
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t.vmClient}</p>
                <div className="flex items-start gap-2">
                  <User className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-gray-800">{vehicle.client.name}</p>
                    {vehicle.client.phone && (
                      <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
                        <Phone className="w-3 h-3" /> {vehicle.client.phone}
                      </p>
                    )}
                    {vehicle.client.email && (
                      <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
                        <Mail className="w-3 h-3" /> {vehicle.client.email}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Mileage + stats */}
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t.vmMileage}</p>
                {editing ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={mileageEdit}
                      onChange={e => setMileageEdit(e.target.value)}
                      className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                    <span className="text-sm text-gray-500">km</span>
                    <button onClick={saveMileage} className="p-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <p className="text-2xl font-bold text-gray-900">
                      {vehicle.mileage ? vehicle.mileage.toLocaleString(lang) : '—'}
                      <span className="text-sm font-normal text-gray-500 ml-1">km</span>
                    </p>
                    <button
                      onClick={() => setEditing(true)}
                      className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                <div className="mt-2 flex gap-3 text-xs text-gray-500">
                  <span>{vehicle.jobs.length} {t.vmInterventions}</span>
                  {totalRevenue > 0 && <span>{totalRevenue.toLocaleString(lang)} € {t.vmParts}</span>}
                </div>
              </div>
            </div>

            {/* CT date */}
            <div className="px-6 pb-4">
              {(() => {
                const ctDays = vehicle.ctDate
                  ? Math.ceil((new Date(vehicle.ctDate).getTime() - Date.now()) / 86400000)
                  : null
                const ctExpired = ctDays !== null && ctDays < 0
                const ctUrgent  = ctDays !== null && ctDays >= 0 && ctDays <= 30
                return (
                  <div className={cn(
                    'rounded-xl p-4 border',
                    ctExpired ? 'bg-red-50 border-red-200' :
                    ctUrgent  ? 'bg-amber-50 border-amber-200' :
                    'bg-gray-50 border-gray-100'
                  )}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                        <ShieldAlert className="w-3.5 h-3.5" /> {t.vmCT}
                      </p>
                      <button onClick={() => setEditingCt(true)} className="p-1 rounded hover:bg-gray-200 text-gray-400">
                        <Edit3 className="w-3 h-3" />
                      </button>
                    </div>
                    {editingCt ? (
                      <div className="flex items-center gap-2 mt-1">
                        <DateField value={ctEdit} onChange={setCtEdit}
                          wrapperClassName="flex-1"
                          className="w-full border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        <button onClick={saveCt} className="p-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditingCt(false)} className="p-1.5 rounded-lg bg-gray-200 text-gray-600 hover:bg-gray-300">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : vehicle.ctDate ? (
                      <div>
                        <p className={cn('font-semibold text-base', ctExpired ? 'text-red-700' : ctUrgent ? 'text-amber-700' : 'text-gray-900')}>
                          {format(new Date(vehicle.ctDate), 'd MMMM yyyy', { locale: loc })}
                        </p>
                        <p className={cn('text-xs mt-0.5', ctExpired ? 'text-red-500' : ctUrgent ? 'text-amber-500' : 'text-gray-500')}>
                          {ctExpired ? `${t.vmCtExpiredSince} ${Math.abs(ctDays!)} ${t.vmDaysUnit}` :
                           ctDays === 0 ? t.vmExpiresToday :
                           `${t.vmInDays} ${ctDays} ${t.vmDaysUnit}`}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 mt-1">{t.vmNotSet} — <button onClick={() => setEditingCt(true)} className="text-blue-500 hover:underline">{t.uiAdd}</button></p>
                    )}
                  </div>
                )
              })()}
            </div>

            {/* Intervention history */}
            <div className="p-6">
              <h3 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
                <Clock className="w-4 h-4 text-gray-400" />
                {t.vmHistory}
                <span className="ml-auto text-xs font-normal text-gray-400">
                  {vehicle.jobs.length} {t.vmTotalCount}
                </span>
              </h3>

              {vehicle.jobs.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <Wrench className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">{t.vmNoInterventions}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {vehicle.jobs.map(job => {
                    const config = REPAIR_TYPES[job.repairType as keyof typeof REPAIR_TYPES]
                    const statusColor = getStatusColor(job.status as any)
                    const partsTotal = job.jobParts.reduce((s, p) => s + p.unitPrice * p.quantity, 0)

                    return (
                      <div
                        key={job.id}
                        className="border border-gray-200 rounded-xl p-4 hover:border-gray-300 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-base"
                            style={{ backgroundColor: config?.color + '20' }}>
                            {config?.icon ?? '🔧'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-gray-800 text-sm">
                                {repairTypeLabel(t, job.repairType, config?.label)}
                              </span>
                              <span
                                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white"
                                style={{ backgroundColor: statusColor }}
                              >
                                {jobStatusLabel(t, job.status, getStatusLabel(job.status as any))}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {format(parseISO(job.date), 'd MMM yyyy', { locale: loc })}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatDuration(job.actualDuration ?? job.estimatedDuration)}
                              </span>
                              {job.mileageAtVisit && (
                                <span>{job.mileageAtVisit.toLocaleString(lang)} km</span>
                              )}
                              <span className="flex items-center gap-1">
                                <div
                                  className="w-3 h-3 rounded-full"
                                  style={{ backgroundColor: job.mechanic.color }}
                                />
                                {job.mechanic.name}
                              </span>
                            </div>

                            {/* Parts used */}
                            {job.jobParts.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {job.jobParts.map((jp, i) => (
                                  <span
                                    key={i}
                                    className="inline-flex items-center gap-1 text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full"
                                  >
                                    <Package className="w-2.5 h-2.5" />
                                    {jp.part.name} ×{jp.quantity}
                                    <span className="text-gray-400">{(jp.unitPrice * jp.quantity).toFixed(0)}€</span>
                                  </span>
                                ))}
                              </div>
                            )}

                            {job.notes && (
                              <p className="mt-1.5 text-xs text-gray-500 italic">{job.notes}</p>
                            )}
                          </div>

                          {partsTotal > 0 && (
                            <span className="text-xs font-semibold text-gray-700 flex-shrink-0">
                              {partsTotal.toFixed(0)}€
                            </span>
                          )}

                          {onEditJob && (
                            <button
                              onClick={() => { onEditJob(job.id); onClose() }}
                              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 flex-shrink-0"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
