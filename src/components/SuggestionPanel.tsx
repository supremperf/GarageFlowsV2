'use client'

import { useScheduleStore } from '@/store/schedule-store'
import { Suggestion, SuggestionType } from '@/lib/types'
import { cn } from '@/lib/utils'
import {
  AlertTriangle,
  Lightbulb,
  RefreshCw,
  UserX,
  AlertCircle,
  Sparkles,
  X,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useState } from 'react'

const SUGGESTION_ICONS: Record<SuggestionType, React.ReactNode> = {
  delay_warning: <AlertTriangle className="w-4 h-4 text-amber-500" />,
  fill_slot: <Lightbulb className="w-4 h-4 text-blue-500" />,
  redistribute: <RefreshCw className="w-4 h-4 text-green-500" />,
  absence_impact: <UserX className="w-4 h-4 text-red-500" />,
  overload_warning: <AlertCircle className="w-4 h-4 text-orange-500" />,
  optimization: <Sparkles className="w-4 h-4 text-purple-500" />,
  conflict: <AlertCircle className="w-4 h-4 text-red-600" />,
  stock_alert: <AlertTriangle className="w-4 h-4 text-amber-600" />,
}

const SUGGESTION_BG: Record<SuggestionType, string> = {
  delay_warning: 'bg-amber-500/10 border-amber-500/25',
  fill_slot: 'bg-blue-500/10 border-blue-500/25',
  redistribute: 'bg-emerald-500/10 border-emerald-500/25',
  absence_impact: 'bg-red-500/10 border-red-500/25',
  overload_warning: 'bg-orange-500/10 border-orange-500/25',
  optimization: 'bg-purple-500/10 border-purple-500/25',
  conflict: 'bg-red-500/10 border-red-500/25',
  stock_alert: 'bg-amber-500/10 border-amber-500/25',
}

const PRIORITY_BADGE: Record<Suggestion['priority'], string> = {
  high: 'bg-red-500/20 text-red-400',
  medium: 'bg-amber-500/20 text-amber-400',
  low: 'bg-white/10 text-slate-400',
}

const PRIORITY_LABEL: Record<Suggestion['priority'], string> = {
  high: 'Urgent',
  medium: 'Important',
  low: 'Info',
}

interface SuggestionCardProps {
  suggestion: Suggestion
}

function SuggestionCard({ suggestion }: SuggestionCardProps) {
  const { dismissSuggestion, acceptSuggestion } = useScheduleStore()

  return (
    <div
      className={cn(
        'rounded-xl border p-3 animate-slide-in',
        SUGGESTION_BG[suggestion.type]
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 mt-0.5">
          {SUGGESTION_ICONS[suggestion.type]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-sm font-semibold text-slate-200 leading-tight">
              {suggestion.title}
            </p>
            <span
              className={cn(
                'text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0',
                PRIORITY_BADGE[suggestion.priority]
              )}
            >
              {PRIORITY_LABEL[suggestion.priority]}
            </span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            {suggestion.description}
          </p>

          {suggestion.action && (
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => acceptSuggestion(suggestion.id)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.07] border border-white/15 text-xs font-medium text-slate-300 hover:bg-white/[0.12] transition-colors"
              >
                <Check className="w-3 h-3 text-green-500" />
                {suggestion.action.label}
              </button>
              <button
                onClick={() => dismissSuggestion(suggestion.id)}
                className="p-1.5 rounded-lg hover:bg-white/[0.07] transition-colors text-slate-500"
                title="Ignorer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {!suggestion.action && (
            <button
              onClick={() => dismissSuggestion(suggestion.id)}
              className="mt-1.5 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              <X className="w-3 h-3" />
              Ignorer
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function SuggestionPanel() {
  const { suggestions, runAI } = useScheduleStore()
  const [collapsed, setCollapsed] = useState(false)

  const activeSuggestions = suggestions.filter(s => !s.dismissed)
  const highPriority = activeSuggestions.filter(s => s.priority === 'high')

  return (
    <div className="bg-[#111827] rounded-xl shadow-sm border border-white/[0.07] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.07] flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-purple-400" />
        <h3 className="font-semibold text-slate-200 text-sm flex-1">
          Assistant IA
        </h3>
        {activeSuggestions.length > 0 && (
          <span className="bg-purple-500/20 text-purple-400 text-xs font-bold px-2 py-0.5 rounded-full">
            {activeSuggestions.length}
          </span>
        )}
        {highPriority.length > 0 && (
          <span className="bg-red-500/20 text-red-400 text-xs font-bold px-2 py-0.5 rounded-full animate-pulse-slow">
            {highPriority.length} urgent{highPriority.length > 1 ? 's' : ''}
          </span>
        )}
        <button
          onClick={runAI}
          className="p-1.5 rounded-lg hover:bg-white/[0.07] text-slate-500 transition-colors"
          title="Analyser le planning"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-lg hover:bg-white/[0.07] text-slate-500 transition-colors"
        >
          {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
      </div>

      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {activeSuggestions.length === 0 ? (
            <div className="text-center py-6">
              <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-2">
                <Check className="w-5 h-5 text-emerald-400" />
              </div>
              <p className="text-sm font-medium text-slate-300">Planning optimisé</p>
              <p className="text-xs text-slate-500 mt-0.5">Aucune anomalie détectée</p>
            </div>
          ) : (
            activeSuggestions.map(suggestion => (
              <SuggestionCard key={suggestion.id} suggestion={suggestion} />
            ))
          )}
        </div>
      )}
    </div>
  )
}
