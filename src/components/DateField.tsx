'use client'

/**
 * DateField — saisie rapide de date au format jj/mm/aaaa.
 *
 * L'utilisateur peut taper directement « 22032027 » ou « 22/03/2027 » : les
 * séparateurs sont insérés automatiquement. La valeur remontée via onChange
 * reste au format ISO (yyyy-mm-dd) attendu par l'API. Un bouton calendrier
 * ouvre le sélecteur natif du système en complément.
 */

import { useState, useEffect, useRef } from 'react'
import { CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'

function isoToFr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

function frToIso(fr: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fr.trim())
  if (!m) return null
  const day = Number(m[1]), month = Number(m[2]), year = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 3000) return null
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

/** Insère les « / » au fur et à mesure de la frappe (jj/mm/aaaa). */
function mask(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
}

interface Props {
  value: string
  onChange: (iso: string) => void
  className?: string
  wrapperClassName?: string
  placeholder?: string
  min?: string
  max?: string
  id?: string
  disabled?: boolean
}

export function DateField({
  value, onChange, className, wrapperClassName,
  placeholder = 'jj/mm/aaaa', min, max, id, disabled,
}: Props) {
  const [text, setText] = useState(() => isoToFr(value))
  const nativeRef = useRef<HTMLInputElement>(null)

  // Re-synchronise l'affichage quand la valeur change de l'extérieur.
  useEffect(() => {
    if (frToIso(text) !== value) setText(isoToFr(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function handleText(raw: string) {
    const masked = mask(raw)
    setText(masked)
    const iso = frToIso(masked)
    if (iso) onChange(iso)
    else if (masked === '') onChange('')
  }

  function handleBlur() {
    if (text.trim() === '') { onChange(''); return }
    const iso = frToIso(text)
    if (iso) {
      setText(isoToFr(iso))          // normalise l'affichage
    } else {
      setText(isoToFr(value))        // saisie incomplète/invalide → revient à la valeur courante
    }
  }

  function openPicker() {
    const el = nativeRef.current
    if (!el) return
    try {
      // showPicker() est disponible sous Chromium/Electron récent.
      ;(el as HTMLInputElement & { showPicker?: () => void }).showPicker?.()
    } catch {
      el.focus()
    }
  }

  return (
    <div className={cn('relative', wrapperClassName)}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={text}
        onChange={e => handleText(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(className, 'pr-8')}
      />
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        tabIndex={-1}
        title="Ouvrir le calendrier"
        className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400 hover:text-blue-500 transition-colors disabled:opacity-40"
      >
        <CalendarDays className="w-4 h-4" />
      </button>
      {/* Sélecteur natif — invisible, ouvert par le bouton calendrier. */}
      <input
        ref={nativeRef}
        type="date"
        value={value || ''}
        min={min}
        max={max}
        onChange={e => onChange(e.target.value)}
        tabIndex={-1}
        aria-hidden="true"
        className="absolute right-2 bottom-0 w-px h-px opacity-0 pointer-events-none"
      />
    </div>
  )
}

export default DateField
