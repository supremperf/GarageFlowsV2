'use client'

import { ExternalLink, History } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'

export interface VehicleHistorySummary {
  id: string
  licensePlate: string
  model: string
  clientName?: string
  lastVisitDate?: string
  lastRepairType?: string
  totalVisits: number
}

interface Props {
  history: VehicleHistorySummary
  repairTypeLabel: (type: string) => string
  onShowHistory: () => void
}

export function VehicleHistoryCard({ history, repairTypeLabel, onShowHistory }: Props) {
  const { t, lang } = useTranslation()
  return (
    <div className="bg-blue-500/10 border border-blue-500/25 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <History className="w-3.5 h-3.5 text-blue-400" />
        <p className="text-xs font-semibold text-blue-300">{t.jmClientHistory}</p>
        <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full font-medium">
          {history.totalVisits} {t.jmVisits}
        </span>
        <button
          onClick={onShowHistory}
          className="ml-auto flex items-center gap-1 text-[10px] text-blue-400 hover:underline"
        >
          <ExternalLink className="w-3 h-3" />
          {t.jmSeeAll}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-slate-300">
        {history.clientName && (
          <span><span className="text-blue-400">{t.jmClientLabel}</span> {history.clientName}</span>
        )}
        <span><span className="text-blue-400">{t.jmVehicleLabel}</span> {history.model}</span>
        {history.lastVisitDate && (
          <span>
            <span className="text-blue-400">{t.jmLastVisit}</span>{' '}
            {new Date(history.lastVisitDate).toLocaleDateString(lang)}
          </span>
        )}
        {history.lastRepairType && (
          <span>
            <span className="text-blue-400">{t.jmLastRepair}</span>{' '}
            {repairTypeLabel(history.lastRepairType)}
          </span>
        )}
      </div>
    </div>
  )
}
