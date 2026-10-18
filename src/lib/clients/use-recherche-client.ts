'use client'

/**
 * Recherche de client — LA BASE, plus le `localStorage` du poste (GF-016).
 *
 * ─── Ce qui existait ────────────────────────────────────────────────────────
 * `src/lib/client-memory.ts` tenait un second annuaire dans le `localStorage`
 * (clé `gf_clients`, 300 entrées, indexé sur le nom en minuscules), alimenté par
 * la seule modale d'intervention et lu par elle et par la modale devis/facture.
 * Il n'avait AUCUN échange avec la table `Client`.
 *
 * Conséquences, toutes constatables :
 *  · un client dont on corrige le téléphone dans l'écran Clients ressortait avec
 *    l'ANCIEN numéro à la facture suivante, recopié dans le document ;
 *  · les clients réellement enregistrés n'étaient jamais proposés ;
 *  · vider le cache du navigateur ou réinstaller le poste effaçait l'annuaire
 *    alors que la base était intacte ;
 *  · deux postes du même garage n'avaient pas le même annuaire ;
 *  · rien n'était cloisonné par garage ni purgé à la déconnexion.
 *
 * ─── Ce que fait ce hook ────────────────────────────────────────────────────
 * Une requête serveur, débattue (300 ms), dont les réponses PÉRIMÉES sont
 * ignorées : sans ce garde, taper vite fait revenir une réponse ancienne APRÈS
 * la récente et la liste affichait le résultat d'une saisie précédente.
 * Une recherche vide ne propose RIEN — jamais le début de la table.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface SuggestionClient {
  /** Clé de rendu — un client peut apparaître une fois par véhicule. */
  cle: string
  clientId: string
  customerName: string
  phone?: string | null
  email?: string | null
  address?: string | null
  vehicleId?: string
  licensePlate?: string
  vehicleModel?: string
}

interface VehiculeApi { id: string; licensePlate: string; make?: string | null; model?: string | null }
interface ClientApi {
  id: string; name: string; phone?: string | null; email?: string | null; address?: string | null
  vehicles?: VehiculeApi[]
}

/** Aplatit un client et ses véhicules en suggestions choisissables. */
function enSuggestions(c: ClientApi): SuggestionClient[] {
  const base = {
    clientId: c.id, customerName: c.name,
    phone: c.phone ?? null, email: c.email ?? null, address: c.address ?? null,
  }
  if (!c.vehicles?.length) return [{ cle: c.id, ...base }]
  return c.vehicles.map((v) => ({
    cle: `${c.id}:${v.id}`,
    ...base,
    vehicleId: v.id,
    licensePlate: v.licensePlate,
    vehicleModel: [v.make, v.model].filter(Boolean).join(' ').trim() || undefined,
  }))
}

export const MAX_SUGGESTIONS_CLIENT = 8

export function useRechercheClient() {
  const [suggestions, setSuggestions] = useState<SuggestionClient[]>([])
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null)
  const generation = useRef(0)

  // Une modale qui se ferme pendant une requête ne doit pas écrire dans un
  // composant démonté.
  const monte = useRef(true)
  useEffect(() => () => {
    monte.current = false
    if (minuteur.current) clearTimeout(minuteur.current)
  }, [])

  const chercher = useCallback((recherche: string) => {
    const q = recherche.trim()
    if (minuteur.current) clearTimeout(minuteur.current)

    // Une recherche vide vide la liste TOUT DE SUITE : attendre 300 ms pour
    // afficher « rien » donne l'impression d'un écran qui traîne.
    if (q.length < 2) { generation.current += 1; setSuggestions([]); return }

    const mienne = ++generation.current
    minuteur.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients?q=${encodeURIComponent(q)}&limit=${MAX_SUGGESTIONS_CLIENT}`, {
          cache: 'no-store',
        })
        if (!res.ok) return
        const corps = await res.json()
        // Réponse périmée (une frappe plus récente est partie depuis) : on la
        // jette plutôt que d'afficher le résultat d'une saisie précédente.
        if (!monte.current || mienne !== generation.current) return
        const clients: ClientApi[] = Array.isArray(corps?.data) ? corps.data : []
        setSuggestions(clients.flatMap(enSuggestions).slice(0, MAX_SUGGESTIONS_CLIENT))
      } catch {
        // Hors ligne : on n'efface pas ce qui est affiché, on n'invente rien.
      }
    }, 300)
  }, [])

  const vider = useCallback(() => {
    generation.current += 1
    if (minuteur.current) clearTimeout(minuteur.current)
    setSuggestions([])
  }, [])

  return { suggestions, chercher, vider }
}
