'use client'

import { useState, useEffect, useCallback } from 'react'

export interface WorkOrder {
  id: string
  number: string
  garageId: string
  jobId?: string | null
  mechanicId?: string | null
  mechanic?: { id: string; name: string; color: string } | null
  clientName: string
  clientPhone?: string | null
  clientEmail?: string | null
  clientAddress?: string | null
  vehicleMake?: string | null
  vehicleModel?: string | null
  licensePlate?: string | null
  mileage?: number | null
  vin?: string | null
  worksJson: string
  partsJson: string
  taxRate: number
  totalHT: number
  totalTTC: number
  status: string
  signatureData?: string | null
  signedAt?: string | null
  notes?: string | null
  createdAt: string
  updatedAt: string
}

interface Filters {
  status?: string
  jobId?: string
}

export function useWorkOrders(filters?: Filters) {
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filters?.status) params.set('status', filters.status)
      if (filters?.jobId) params.set('jobId', filters.jobId)
      const qs = params.toString()
      const res = await fetch(`/api/work-orders${qs ? `?${qs}` : ''}`)
      if (!res.ok) throw new Error('Erreur lors du chargement des ordres de réparation')
      const data = await res.json()
      setOrders(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }, [filters?.status, filters?.jobId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load()
  }, [load])

  return { orders, loading, error, reload: load }
}
