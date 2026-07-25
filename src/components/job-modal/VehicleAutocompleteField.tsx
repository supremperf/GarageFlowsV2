'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Car } from 'lucide-react'
import { CAR_DATABASE } from '@/lib/car-database'
import { cn } from '@/lib/utils'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

function getSuggestions(query: string): string[] {
  if (!query.trim()) return []
  const q = query.trim().toLowerCase()
  const results: string[] = []

  for (const entry of CAR_DATABASE) {
    const makeQ = entry.make.toLowerCase()
    if (makeQ.startsWith(q)) {
      // Suggest full make + top models
      for (const model of entry.models.slice(0, 4)) {
        results.push(`${entry.make} ${model}`)
        if (results.length >= 8) return results
      }
    } else if (makeQ.includes(q)) {
      results.push(entry.make)
      if (results.length >= 8) return results
    } else {
      // Try matching "Make Model" pattern
      for (const model of entry.models) {
        const full = `${entry.make} ${model}`.toLowerCase()
        if (full.includes(q)) {
          results.push(`${entry.make} ${model}`)
          if (results.length >= 8) return results
        }
      }
    }
  }

  return results.slice(0, 8)
}

export function VehicleAutocompleteField({ value, onChange, placeholder }: Props) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSuggestions(getSuggestions(value))
  }, [value])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Car className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
        <input
          type="text"
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder ?? 'ex: Peugeot 308'}
          autoComplete="off"
          className="w-full rounded-lg border border-white/15 bg-white/[0.05] text-white pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
        />
      </div>

      {open && suggestions.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl bg-[#1a2235] border border-white/10 shadow-2xl overflow-hidden">
          {suggestions.map(s => (
            <button
              key={s}
              type="button"
              onMouseDown={e => {
                e.preventDefault()
                onChange(s)
                setOpen(false)
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.07] text-left transition-colors"
            >
              <Car className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
