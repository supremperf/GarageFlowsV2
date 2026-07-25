'use client'

import { Package } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Part } from '@/lib/types'
import { useTranslation } from '@/lib/i18n'

interface DefaultPart {
  part: Part
  defaultQuantity: number
}

interface Props {
  parts: DefaultPart[]
}

export function JobDefaultPartsSuggestion({ parts }: Props) {
  const { t } = useTranslation()
  if (parts.length === 0) return null
  return (
    <div className="bg-amber-50 rounded-lg border border-amber-200 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Package className="w-3.5 h-3.5 text-amber-600" />
        <p className="text-xs font-semibold text-amber-700">{t.jmSuggestedParts}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {parts.map(({ part, defaultQuantity }) => {
          const isLow = part.quantity <= part.minQuantity
          return (
            <span
              key={part.id}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium',
                isLow
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                  : 'bg-white/[0.07] text-slate-300 border border-white/15'
              )}
            >
              {part.name}
              <span className="text-slate-500">×{defaultQuantity}</span>
              {isLow && <span className="text-red-500 font-bold">!</span>}
            </span>
          )
        })}
      </div>
    </div>
  )
}
