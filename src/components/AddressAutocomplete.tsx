'use client'

/**
 * Champ d'adresse avec propositions — composant UNIQUE du produit (GF-022).
 *
 * ─── Ce qui existait ────────────────────────────────────────────────────────
 * Rien. Chaque adresse — celle du garage, celle d'un client, celle imprimée sur
 * un devis ou un ordre de réparation — était un `<input>` en texte libre.
 * Résultat : « 10 rue de la Poste », « 10 r. de la poste » et « 10 Rue De La
 * Poste » désignaient trois adresses différentes pour le logiciel, et une
 * coquille de code postal ne se voyait qu'au retour du courrier.
 *
 * ─── Ce que ce composant garantit ───────────────────────────────────────────
 *  · saisie progressive : « 10 » → « 10 rue » → « 10 rue de la poste », la liste
 *    se resserre à chaque frappe ;
 *  · débat de 300 ms — on n'interroge pas le service à chaque caractère ;
 *  · réponses PÉRIMÉES ignorées : sans ce garde, taper vite fait revenir une
 *    réponse ancienne après une récente, et la liste affiche le résultat d'une
 *    saisie précédente ;
 *  · clavier (flèches, Entrée, Échap), souris et tactile ;
 *  · états explicites : recherche en cours, aucun résultat, service
 *    indisponible ;
 *  · SAISIE LIBRE toujours possible — une adresse absente de la base, un lieu-dit
 *    ou un garage hors de France doivent rester saisissables. Le composant
 *    propose, il n'impose pas ;
 *  · accessibilité : `role="combobox"`, `aria-expanded`, `aria-activedescendant`,
 *    liste `role="listbox"` et options `role="option"`.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { MapPin, Loader2, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AdresseTrouvee } from '@/lib/adresse/ban'

const DEBAT_MS = 300
/** En deçà, le service refuse la requête : inutile de l'appeler. */
const MIN_CARACTERES = 3

type Etat = 'repos' | 'recherche' | 'resultats' | 'vide' | 'indisponible'

export interface AddressAutocompleteProps {
  value: string
  /** Saisie libre — appelé à chaque frappe. */
  onChange: (valeur: string) => void
  /**
   * Adresse CHOISIE dans la liste, avec ses composantes.
   * Permet de remplir de vrais champs (code postal, ville, coordonnées) là où le
   * schéma les possède, au lieu de tout écraser dans une chaîne.
   */
  onSelect?: (adresse: AdresseTrouvee) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  id?: string
  'aria-label'?: string
}

export function AddressAutocomplete({
  value, onChange, onSelect, placeholder, className, disabled, id, ...reste
}: AddressAutocompleteProps) {
  const [propositions, setPropositions] = useState<AdresseTrouvee[]>([])
  const [etat, setEtat] = useState<Etat>('repos')
  const [ouvert, setOuvert] = useState(false)
  const [surligne, setSurligne] = useState(0)

  const listeId = useId()
  const boiteRef = useRef<HTMLDivElement>(null)
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Numéro de la requête en vol : une réponse tardive n'écrase pas une récente. */
  const generation = useRef(0)
  const monte = useRef(true)

  useEffect(() => {
    monte.current = true
    return () => {
      monte.current = false
      if (minuteur.current) clearTimeout(minuteur.current)
    }
  }, [])

  // Fermeture au clic extérieur — l'écouteur est retiré au démontage.
  useEffect(() => {
    function auClic(e: MouseEvent) {
      if (boiteRef.current && !boiteRef.current.contains(e.target as Node)) setOuvert(false)
    }
    document.addEventListener('mousedown', auClic)
    return () => document.removeEventListener('mousedown', auClic)
  }, [])

  const chercher = useCallback(async (q: string) => {
    const mienne = ++generation.current
    setEtat('recherche')
    try {
      const res = await fetch(`/api/adresse/recherche?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
      if (!monte.current || mienne !== generation.current) return
      if (!res.ok) { setPropositions([]); setEtat('indisponible'); return }
      const corps = await res.json() as { ok: boolean; adresses?: AdresseTrouvee[]; code?: string }
      if (!monte.current || mienne !== generation.current) return

      if (!corps.ok && corps.code !== 'TROP_COURT') { setPropositions([]); setEtat('indisponible'); return }
      const liste = Array.isArray(corps.adresses) ? corps.adresses : []
      setPropositions(liste)
      setSurligne(0)
      setEtat(liste.length ? 'resultats' : 'vide')
    } catch {
      if (!monte.current || mienne !== generation.current) return
      setPropositions([])
      setEtat('indisponible')
    }
  }, [])

  function saisir(suivant: string) {
    onChange(suivant)
    if (minuteur.current) clearTimeout(minuteur.current)

    const q = suivant.trim()
    if (q.length < MIN_CARACTERES) {
      // On vide TOUT DE SUITE : attendre 300 ms pour afficher « rien » donne
      // l'impression d'un écran qui traîne.
      generation.current += 1
      setPropositions([])
      setEtat('repos')
      setOuvert(false)
      return
    }
    setOuvert(true)
    minuteur.current = setTimeout(() => { void chercher(q) }, DEBAT_MS)
  }

  function choisir(a: AdresseTrouvee) {
    onChange(a.libelle)
    onSelect?.(a)
    setOuvert(false)
    setPropositions([])
    setEtat('repos')
  }

  function auClavier(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!ouvert || propositions.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setSurligne((h) => Math.min(h + 1, propositions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSurligne((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); choisir(propositions[surligne]) }
    else if (e.key === 'Escape') { setOuvert(false) }
  }

  const optionId = (i: number) => `${listeId}-opt-${i}`

  return (
    <div ref={boiteRef} className="relative w-full">
      <input
        id={id}
        value={value}
        onChange={(e) => saisir(e.target.value)}
        onFocus={() => { if (propositions.length > 0) setOuvert(true) }}
        onKeyDown={auClavier}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        className={className}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={ouvert}
        aria-controls={listeId}
        aria-activedescendant={ouvert && propositions.length ? optionId(surligne) : undefined}
        {...reste}
      />

      {etat === 'recherche' && (
        <Loader2 className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-slate-500" aria-hidden="true" />
      )}

      {ouvert && (etat === 'resultats' || etat === 'vide' || etat === 'indisponible') && (
        <div
          id={listeId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-xl border border-white/15 bg-[#1a2235] shadow-2xl"
        >
          {etat === 'resultats' && propositions.map((a, i) => (
            <button
              key={a.id}
              id={optionId(i)}
              type="button"
              role="option"
              aria-selected={i === surligne}
              // `onMouseDown` (et non `onClick`) : le clic est traité AVANT le
              // blur du champ, qui refermerait la liste et annulerait le choix.
              onMouseDown={(e) => { e.preventDefault(); choisir(a) }}
              onMouseEnter={() => setSurligne(i)}
              className={cn(
                'flex w-full items-start gap-2 border-b border-white/[0.05] px-3 py-2 text-left last:border-0 transition-colors',
                i === surligne ? 'bg-blue-500/15' : 'hover:bg-white/[0.06]',
              )}
            >
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-400" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate text-sm text-slate-200">{a.libelle}</span>
                {(a.codePostal || a.departement) && (
                  <span className="block truncate text-[11px] text-slate-500">
                    {[a.codePostal, a.ville, a.departement].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
            </button>
          ))}

          {etat === 'vide' && (
            <p className="px-3 py-2 text-[11px] text-slate-500">
              Aucune adresse trouvée. Vous pouvez saisir la vôtre librement.
            </p>
          )}

          {etat === 'indisponible' && (
            <p className="flex items-center gap-1.5 px-3 py-2 text-[11px] text-amber-300">
              <WifiOff className="h-3 w-3 shrink-0" aria-hidden="true" />
              Recherche d’adresse indisponible — saisissez l’adresse à la main.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
