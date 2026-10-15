'use client'

/**
 * AUTOCOMPLÉTION DES PIÈCES DU STOCK sur une ligne de devis/facture.
 *
 * Objectif d'expérience : dès la PREMIÈRE lettre (« F »), les pièces
 * correspondantes apparaissent ; en précisant (« Fil »), la liste se réduit
 * INSTANTANÉMENT, sans attendre le réseau.
 *
 * Comment l'instantanéité est obtenue sans marteler le serveur :
 *  1. une requête réseau n'est émise qu'après un court `DEBOUNCE_MS` ;
 *  2. si la nouvelle saisie ne fait que PRÉCISER la précédente
 *     (`isNarrowingQuery`), on reclasse localement les résultats déjà obtenus
 *     avec EXACTEMENT le même algorithme que le serveur (lib/stock/search) :
 *     l'affichage est mis à jour dans la même frame, la requête réseau ne sert
 *     plus qu'à confirmer/compléter ;
 *  3. un petit cache par requête évite de redemander ce qu'on a déjà.
 *
 * Le serveur reste seul juge : il borne le nombre de suggestions et n'expose
 * jamais une pièce d'un autre garage.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Package, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { rankParts, isNarrowingQuery } from '@/lib/stock/search'

export interface PartSuggestion {
  id: string
  name: string
  reference?: string | null
  supplierRef?: string | null
  supplierName?: string | null
  description?: string | null
  quantity: number
  minQuantity: number
  location?: string | null
  unitPrice: number
  unitCost: number
  lowStock?: boolean
}

interface Props {
  value: string
  onChange: (description: string) => void
  /** Appelé quand l'utilisateur CHOISIT une pièce du stock. */
  onSelectPart: (part: PartSuggestion) => void
  /** Appelé quand la saisie libre ne correspond plus à la pièce liée. */
  onClearPart?: () => void
  /** Pièce actuellement liée à la ligne (badge + garde-fou quantité). */
  linkedPartId?: string | null
  className?: string
  placeholder?: string
  disabled?: boolean
}

const DEBOUNCE_MS = 140
const MIN_CHARS = 1

export function PartAutocomplete({
  value, onChange, onSelectPart, onClearPart,
  linkedPartId, className, placeholder, disabled,
}: Props) {
  const [suggestions, setSuggestions] = useState<PartSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [loading, setLoading] = useState(false)
  const listId = useId()

  const boxRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Dernière requête RÉSEAU aboutie + son résultat (base de l'affinage local). */
  const lastNetwork = useRef<{ query: string; results: PartSuggestion[] }>({ query: '', results: [] })
  /** Cache requête → résultats, borné : une liste déroulante ne fuit pas. */
  const cache = useRef<Map<string, PartSuggestion[]>>(new Map())
  /** Numéro de la requête en vol : une réponse tardive n'écrase pas une récente. */
  const seq = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // Fermeture au clic extérieur — listener retiré au démontage (aucune fuite).
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  const fetchSuggestions = useCallback(async (query: string) => {
    const cached = cache.current.get(query)
    if (cached) { setSuggestions(cached); setHighlight(0); return }

    const mySeq = ++seq.current
    setLoading(true)
    try {
      const res = await fetch(`/api/parts/search?q=${encodeURIComponent(query)}&limit=8`, { cache: 'no-store' })
      if (!res.ok) return
      const body = await res.json() as { data: PartSuggestion[] }
      // Réponse périmée (l'utilisateur a continué de taper) : on l'ignore.
      if (!mounted.current || mySeq !== seq.current) return
      const data = Array.isArray(body.data) ? body.data : []
      if (cache.current.size > 50) cache.current.clear()
      cache.current.set(query, data)
      lastNetwork.current = { query, results: data }
      setSuggestions(data)
      setHighlight(0)
    } catch {
      /* hors ligne : on garde l'affinage local du dernier jeu connu */
    } finally {
      if (mounted.current && mySeq === seq.current) setLoading(false)
    }
  }, [])

  function handleInput(next: string) {
    onChange(next)
    // La saisie libre détache la ligne de sa pièce : sans cela on facturerait
    // « Filtre à air » tout en décrémentant le filtre à huile.
    if (linkedPartId) onClearPart?.()

    const trimmed = next.trim()
    if (trimmed.length < MIN_CHARS) {
      setOpen(false)
      setSuggestions([])
      if (timerRef.current) clearTimeout(timerRef.current)
      return
    }

    setOpen(true)
    // AFFINAGE LOCAL IMMÉDIAT (aucune latence perçue).
    if (isNarrowingQuery(lastNetwork.current.query, trimmed)) {
      setSuggestions(rankParts(lastNetwork.current.results, trimmed, 8))
      setHighlight(0)
    }

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { void fetchSuggestions(trimmed) }, DEBOUNCE_MS)
  }

  function choose(part: PartSuggestion) {
    onSelectPart(part)
    setOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(suggestions[highlight]) }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  return (
    <div ref={boxRef} className="relative w-full">
      <input
        value={value}
        onChange={e => handleInput(e.target.value)}
        onFocus={() => { if (value.trim().length >= MIN_CHARS && suggestions.length > 0) setOpen(true) }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        disabled={disabled}
        className={className}
        // `role="combobox"` est requis pour que `aria-expanded` soit valide sur
        // un input (dont le rôle implicite est `textbox`) ; `aria-controls`
        // désigne la liste de suggestions pour les lecteurs d'écran.
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
      />

      {linkedPartId && (
        <span
          className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
          title="Ligne rattachée à une pièce du stock — la validation de la facture décrémentera l'inventaire."
        >
          <Package className="h-3 w-3" /> Stock
        </span>
      )}

      {open && suggestions.length > 0 && (
        <div id={listId} role="listbox" className="gf-surface-light absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-2xl">
          {suggestions.map((p, i) => (
            <button
              key={p.id}
              type="button"
              // `onMouseDown` (et non `onClick`) : le clic est traité AVANT le
              // blur du champ, qui refermerait la liste et annulerait le choix.
              onMouseDown={e => { e.preventDefault(); choose(p) }}
              onMouseEnter={() => setHighlight(i)}
              className={cn(
                'flex w-full items-start justify-between gap-3 border-b border-gray-100 px-3 py-2 text-left last:border-0',
                i === highlight ? 'bg-blue-50' : 'hover:bg-gray-50',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-gray-900">
                  {p.name}
                  {p.supplierName && <span className="ml-1.5 font-normal text-gray-500">{p.supplierName}</span>}
                </span>
                <span className="block truncate text-[11px] text-gray-500">
                  {p.reference ? `Réf. ${p.reference}` : p.supplierRef ? `Réf. fourn. ${p.supplierRef}` : '—'}
                  {p.location && <span className="ml-2">· {p.location}</span>}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span
                  className={cn(
                    'block text-xs font-semibold',
                    p.quantity <= 0 ? 'text-red-600' : p.lowStock ? 'text-amber-600' : 'text-emerald-600',
                  )}
                >
                  {p.quantity <= 0 && <AlertTriangle className="mr-0.5 inline h-3 w-3" />}
                  Stock : {p.quantity}
                </span>
                <span className="block text-xs text-gray-700">{p.unitPrice.toFixed(2)} € HT</span>
              </span>
            </button>
          ))}
          {loading && <p className="px-3 py-1.5 text-[11px] text-gray-400">Recherche…</p>}
        </div>
      )}
    </div>
  )
}
