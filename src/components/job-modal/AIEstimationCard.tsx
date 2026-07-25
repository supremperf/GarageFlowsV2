'use client'

import { Brain, ChevronDown, TrendingUp } from 'lucide-react'
import { formatDuration, cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n'

export interface EstimateResult {
  recommended: number
  confidence: 'high' | 'medium' | 'low'
  sampleSize: number
  source: string
  defaultDuration: number
  breakdown: {
    mechanicComparison: Array<{
      mechanicId: string
      mechanicName: string
      mechanicColor: string
      avgActualMinutes: number
      sampleSize: number
    }>
  } | null
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high:   'text-green-600',
  medium: 'text-blue-600',
  low:    'text-amber-600',
}

interface Props {
  estimate: EstimateResult | null
  loading: boolean
  showComparison: boolean
  onToggleComparison: () => void
}

export function AIEstimationCard({ estimate, loading, showComparison, onToggleComparison }: Props) {
  const { t } = useTranslation()
  const confidenceLabel: Record<string, string> = { high: t.jmConfHigh, medium: t.jmConfMedium, low: t.jmConfLow }
  const scopeLabel = (source: string) =>
    source === 'mechanic+brand' ? t.jmScopeMechBrand :
    source === 'mechanic' ? t.jmScopeMech :
    source === 'brand' ? t.jmScopeBrand : t.jmScopeGlobal
  return (
    <div className="bg-purple-500/10 rounded-xl border border-purple-500/25 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Brain className="w-4 h-4 text-purple-400" />
        <p className="text-xs font-semibold text-purple-300">{t.jmAiEstimation}</p>
        {loading && <span className="ml-auto text-[10px] text-purple-400 animate-pulse">{t.jmAnalyzing}</span>}
        {!loading && estimate && (
          <span className={cn('ml-auto text-[10px] font-medium', CONFIDENCE_COLORS[estimate.confidence])}>
            {confidenceLabel[estimate.confidence]}
            {estimate.sampleSize > 0 && ` (${estimate.sampleSize} ${t.jmCases})`}
          </span>
        )}
      </div>
      {!loading && estimate && (
        <>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-lg font-bold text-purple-300">{formatDuration(estimate.recommended)}</p>
              <p className="text-[10px] text-purple-400">
                {estimate.source === 'default'
                  ? t.jmDefaultValue
                  : `${t.jmBasedOn} ${estimate.sampleSize} ${t.jmCases} (${scopeLabel(estimate.source)})`}
              </p>
            </div>
            {estimate.breakdown && estimate.breakdown.mechanicComparison.length > 1 && (
              <button
                onClick={onToggleComparison}
                className="flex items-center gap-1 text-[10px] text-purple-400 hover:text-purple-300"
              >
                <TrendingUp className="w-3 h-3" />
                <span>{t.jmCompare}</span>
                <ChevronDown className={cn('w-3 h-3 transition-transform', showComparison && 'rotate-180')} />
              </button>
            )}
          </div>
          {showComparison && estimate.breakdown && estimate.breakdown.mechanicComparison.length > 0 && (
            <div className="mt-2 space-y-1 border-t border-purple-500/25 pt-2">
              <p className="text-[10px] font-semibold text-purple-400 mb-1">{t.jmPerfByMech}</p>
              {estimate.breakdown.mechanicComparison.map(m => (
                <div key={m.mechanicId} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: m.mechanicColor }} />
                  <span className="text-[10px] text-slate-300 flex-1 truncate">{m.mechanicName}</span>
                  <span className="text-[10px] font-semibold text-white">{formatDuration(m.avgActualMinutes)}</span>
                  <span className="text-[10px] text-slate-500">({m.sampleSize} cas)</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
