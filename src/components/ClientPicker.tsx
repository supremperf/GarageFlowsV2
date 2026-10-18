'use client'

/**
 * Sélecteur de client — un VRAI menu déroulant dans l'espace « Clients et
 * messages » (GF-DUR-052).
 *
 * ─── Le manque ───────────────────────────────────────────────────────────────
 *
 * L'espace « Clients et messages » menait à une LISTE (`ClientsPanel`) : pour
 * retrouver un client il fallait y entrer, puis taper son nom. Le comptoir
 * cherchait donc « la fiche de M. Martin » en quittant le planning, alors que
 * la question se pose AU COMPTOIR, téléphone à la main.
 *
 * ─── Ce que fait ce menu (et ce qu'il ne fait pas) ───────────────────────────
 *
 * Il interroge `/api/clients` — la route existante, avec sa recherche serveur et
 * sa pagination — et propose : recherche, informations (téléphone, courriel,
 * véhicules), sélection, et ouverture de la fiche. Il ne crée AUCUNE couche de
 * données parallèle : tout passe par les routes déjà en production.
 *
 * ─── Rafraîchissement après ajout ou modification ────────────────────────────
 *
 * Le panneau « Clients » signale chaque écriture réussie via `onClientsChanged`.
 * La liste du menu est alors rechargée ET sa correspondance (`cleRecherche`)
 * invalidée : sans cela, le client qu'on vient de créer restait introuvable
 * jusqu'au rechargement complet de la page — l'ajout semblait n'avoir servi à
 * rien.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search, UserRound, Car, Loader2, X, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Bornes de sécurité : ce menu reste intégralement au clavier. */
const TAILLE_PAGE   = 50
const MAX_AFFICHES  = 50

interface Vehicule {
  id: string
  licensePlate: string | null
  make: string | null
  model: string | null
  year?: number | null
}

interface ClientRow {
  id: string
  name: string
  email: string | null
  phone: string | null
  address?: string | null
  vehicles?: Vehicule[]
}

/** Une ligne du menu : soit un client, soit une invitation à filtrer. */
type Entree =
  | { type: 'client'; client: ClientRow }
  | { type: 'vide' }

export interface ClientPickerProps {
  /** Ouvre la fiche complète du client choisi (panneau Clients, onglet ouvert). */
  onOpenClient: (clientId: string) => void
  /** Change à chaque écriture d'un client (création, modification, accès portail). */
  refreshKey?: number
  /** Préfixe accessible pour l'identifiant de liste (`aria-controls`). */
  idPrefix?: string
  className?: string
}

export default function ClientPicker({
  onOpenClient,
  refreshKey = 0,
  idPrefix = 'gf-client-picker',
  className,
}: ClientPickerProps) {
  const [ouvert, setOuvert]       = useState(false)
  const [recherche, setRecherche] = useState('')
  const [debounce, setDebounce]   = useState('')
  const [liste, setListe]         = useState<ClientRow[]>([])
  const [chargement, setChargement] = useState(false)
  const [erreur, setErreur]       = useState<string | null>(null)
  const [surligne, setSurligne]   = useState(0)

  const zoneRef  = useRef<HTMLDivElement>(null)
  const champRef = useRef<HTMLInputElement>(null)
  const listeRef = useRef<HTMLUListElement>(null)

  const listeId = `${idPrefix}-liste`

  // ── Anti-rebond : une requête par pause de frappe, pas une par caractère ───
  useEffect(() => {
    const id = setTimeout(() => setDebounce(recherche.trim()), 220)
    return () => clearTimeout(id)
  }, [recherche])

  const charger = useCallback(async (q: string) => {
    setChargement(true)
    setErreur(null)
    try {
      const r = await fetch(`/api/clients?limit=${TAILLE_PAGE}${q ? `&q=${encodeURIComponent(q)}` : ''}`)
      if (!r.ok) {
        // 403 = rôle sans accès aux clients : on l'annonce, on ne fait pas
        // semblant d'avoir une liste vide (qui laisserait croire à zéro client).
        setErreur(r.status === 403
          ? 'Votre compte n’a pas accès aux fiches clients.'
          : `Impossible de charger les clients (erreur ${r.status}).`)
        setListe([])
        return
      }
      const d = await r.json().catch(() => null)
      const data: ClientRow[] = Array.isArray(d?.data) ? d.data : []
      setListe(data.slice(0, MAX_AFFICHES))
    } catch {
      setErreur('Réseau indisponible — impossible de charger les clients.')
      setListe([])
    } finally {
      setChargement(false)
    }
  }, [])

  // Rechargement à l'ouverture, à chaque frappe stabilisée, ET à chaque écriture
  // signalée par le panneau Clients (`refreshKey`).
  useEffect(() => {
    if (!ouvert) return
    void charger(debounce)
  }, [ouvert, debounce, refreshKey, charger])

  // ── Fermeture au clic extérieur ─────────────────────────────────────────────
  useEffect(() => {
    if (!ouvert) return
    function surClic(e: MouseEvent) {
      if (zoneRef.current && !zoneRef.current.contains(e.target as Node)) setOuvert(false)
    }
    document.addEventListener('mousedown', surClic)
    return () => document.removeEventListener('mousedown', surClic)
  }, [ouvert])

  // ── Remise à zéro de la surbrillance à chaque nouvelle liste ────────────────
  useEffect(() => { setSurligne(0) }, [debounce, refreshKey, liste.length])

  const entrees: Entree[] = useMemo(
    () => (liste.length ? liste.map(c => ({ type: 'client' as const, client: c })) : [{ type: 'vide' as const }]),
    [liste],
  )

  const ouvrirFiche = useCallback((client: ClientRow) => {
    setOuvert(false)
    setRecherche('')
    // Le panneau Clients reste ouvert : l'utilisateur garde le contexte.
    onOpenClient(client.id)
  }, [onOpenClient])

  /** Flèches, Entrée, Échap : le menu est utilisable sans souris. */
  const surTouche = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); setOuvert(false); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSurligne(i => Math.min(i + 1, Math.max(0, liste.length - 1)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSurligne(i => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      const c = liste[surligne]
      if (c) { e.preventDefault(); ouvrirFiche(c) }
    }
  }, [liste, surligne, ouvrirFiche])

  // Garde la ligne surlignée visible dans la liste défilante.
  useEffect(() => {
    if (!ouvert) return
    const el = listeRef.current?.querySelector<HTMLElement>(`[data-idx="${surligne}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [surligne, ouvert])

  const libelleVehicules = (c: ClientRow) => {
    const v = c.vehicles ?? []
    if (!v.length) return 'Aucun véhicule enregistré'
    return v
      .slice(0, 3)
      .map(x => [x.make, x.model].filter(Boolean).join(' ') || 'Véhicule')
      .join(' · ')
  }

  return (
    <div ref={zoneRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => { setOuvert(o => !o); if (!ouvert) setTimeout(() => champRef.current?.focus(), 0) }}
        aria-haspopup="listbox"
        aria-expanded={ouvert}
        aria-controls={listeId}
        title="Rechercher un client et ouvrir sa fiche"
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all duration-150 whitespace-nowrap border',
          ouvert
            ? 'bg-blue-600/20 text-blue-400 border-blue-500/30'
            : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.07] border border-transparent',
        )}
      >
        <UserRound className="w-3.5 h-3.5" />
        Client
        <ChevronDown className={cn('w-3 h-3 transition-transform', ouvert && 'rotate-180')} />
      </button>

      {ouvert && (
        <div className="absolute right-0 top-full mt-1 z-[80] w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-xl border border-white/[0.1] bg-[#0f1629] shadow-2xl shadow-black/60 overflow-hidden">
          {/* Champ de recherche */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.07]">
            <Search className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
            <input
              ref={champRef}
              value={recherche}
              onChange={e => setRecherche(e.target.value)}
              onKeyDown={surTouche}
              type="text"
              role="combobox"
              aria-expanded={ouvert}
              aria-controls={listeId}
              aria-autocomplete="list"
              placeholder="Nom, téléphone, courriel…"
              aria-label="Rechercher un client"
              className="flex-1 min-w-0 bg-transparent text-sm text-slate-200 placeholder:text-slate-600 outline-none"
            />
            {chargement && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400 flex-shrink-0" />}
            {recherche && !chargement && (
              <button
                type="button"
                onClick={() => { setRecherche(''); champRef.current?.focus() }}
                aria-label="Effacer la recherche"
                className="text-slate-500 hover:text-slate-300 flex-shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {erreur && (
            <div className="flex items-start gap-2 px-3 py-2.5 text-[11px] text-amber-300 bg-amber-500/10">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
              <span>{erreur}</span>
            </div>
          )}

          {/* Liste */}
          <ul ref={listeRef} id={listeId} role="listbox" className="max-h-72 overflow-y-auto py-1">
            {entrees.map((e, idx) => {
              if (e.type === 'vide') {
                return (
                  <li key="vide" className="px-3 py-6 text-center text-xs text-slate-500">
                    {erreur ? 'Aucun client affichable.' : debounce
                      ? `Aucun client ne correspond à « ${debounce} ».`
                      : 'Aucun client enregistré pour ce garage.'}
                  </li>
                )
              }
              const c = e.client
              const actif = idx === surligne
              return (
                <li
                  key={c.id}
                  data-idx={idx}
                  role="option"
                  aria-selected={actif}
                  onMouseEnter={() => setSurligne(idx)}
                  onMouseDown={ev => { ev.preventDefault(); ouvrirFiche(c) }}
                  className={cn(
                    'px-3 py-2 cursor-pointer select-none',
                    actif ? 'bg-blue-600/20' : 'hover:bg-white/[0.05]',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-slate-100 font-medium truncate">{c.name}</span>
                    {c.phone && <span className="text-[11px] text-slate-400 flex-shrink-0">{c.phone}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                    <Car className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{libelleVehicules(c)}</span>
                  </div>
                  {c.email && <div className="text-[11px] text-slate-600 truncate mt-0.5">{c.email}</div>}
                </li>
              )
            })}
          </ul>

          <div className="px-3 py-1.5 border-t border-white/[0.07] text-[10px] text-slate-600">
            ↑ ↓ pour parcourir · Entrée pour ouvrir la fiche
          </div>
        </div>
      )}
    </div>
  )
}
