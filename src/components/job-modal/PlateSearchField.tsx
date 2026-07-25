'use client'

import { useRef, useState } from 'react'
import { Brain, Camera, Car, Check, Loader2, Search } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'

export interface VehicleSuggestion {
  id: string
  licensePlate: string
  model: string
  clientName?: string
  clientPhone?: string
}

interface Props {
  plateSearch: string
  suggestions: VehicleSuggestion[]
  showSuggestions: boolean
  lookingUp: boolean
  onChange: (value: string) => void
  onFocus: () => void
  onSelectVehicle: (v: VehicleSuggestion) => void
  onLookup: () => void
  onPlateDetected?: (plate: string) => void
}

export function PlateSearchField({
  plateSearch, suggestions, showSuggestions, lookingUp,
  onChange, onFocus, onSelectVehicle, onLookup, onPlateDetected,
}: Props) {
  const { t } = useTranslation()
  const fileRef = useRef<HTMLInputElement>(null)
  const [ocrLoading, setOcrLoading] = useState(false)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const reader = new FileReader()
    reader.onload = async (ev) => {
      const imageBase64 = ev.target?.result as string
      setOcrLoading(true)
      try {
        const res = await fetch('/api/plate-ocr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64 }),
        })
        const data = await res.json()
        if (res.ok && data.plate) {
          onChange(data.plate)
          onPlateDetected?.(data.plate)
        }
      } finally {
        setOcrLoading(false)
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <div>
      <label className="block text-sm font-medium text-slate-300 mb-1.5">
        <Search className="w-3.5 h-3.5 inline mr-1" />
        {t.jmPlateSearchLabel}
      </label>
      <div className="relative flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={plateSearch}
            onChange={e => onChange(e.target.value)}
            onFocus={() => suggestions.length > 0 && onFocus()}
            placeholder={t.jmPlatePh}
            className="w-full rounded-lg border border-white/15 bg-white/[0.05] text-white px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-[#1a2235] rounded-lg border border-white/15 shadow-lg overflow-hidden">
              {suggestions.map(v => (
                <button
                  key={v.id}
                  onClick={() => onSelectVehicle(v)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-blue-500/10 transition-colors text-left"
                >
                  <Car className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white font-mono">{v.licensePlate}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {v.model}{v.clientName ? ` · ${v.clientName}` : ''}
                    </p>
                  </div>
                  <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* OCR camera button */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={ocrLoading}
          title={t.jmOcrTitle}
          className="flex items-center gap-1.5 px-3 py-2.5 bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed shrink-0 border border-white/10"
        >
          {ocrLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* SIV + AI lookup button */}
        <button
          onClick={onLookup}
          disabled={lookingUp || plateSearch.length < 4}
          title={t.jmSivTitle}
          className="flex items-center gap-1.5 px-3 py-2.5 bg-purple-600 text-white text-xs font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          {lookingUp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
          {lookingUp ? '' : 'SIV'}
        </button>
      </div>
    </div>
  )
}
