'use client'

/**
 * Pièces posées sur une intervention (GF-018).
 *
 * ─── Ce qui manquait ────────────────────────────────────────────────────────
 * `POST /api/jobs/:id/parts` — transactionnelle, idempotente, refusant un stock
 * insuffisant en 409 — n'était appelée par AUCUN écran. Les trois seuls appels
 * du produit à cette route étaient des GET. La table `JobPart` restait donc vide
 * sur toute installation réelle, et TOUT ce qui la lit rendait des zéros :
 *
 *   · « Rentabilité » déclarait dormante chaque pièce du stock, y compris celles
 *     vendues la veille, et n'affichait aucune marge par pièce ;
 *   · « Prévision de stock » annonçait « consommation moyenne 0 » pour chaque
 *     référence et ne recommandait jamais de réapprovisionnement ;
 *   · l'historique d'un véhicule affichait 0 € de pièces ;
 *   · le copilote raisonnait sur ces zéros.
 *
 * Le module prédictif était inerte sur 100 % des installations — non par défaut
 * de calcul, mais faute d'un écran pour saisir la donnée d'entrée.
 *
 * ─── Ce que fait cet écran ──────────────────────────────────────────────────
 * Il rend la route atteignable, et rien de plus : le stock est décrémenté par le
 * SERVEUR au moment de l'ajout, restitué à la suppression. Aucune quantité n'est
 * calculée ici — l'écran affiche ce que la base répond.
 */
import { useCallback, useEffect, useState } from 'react'
import { Package, Plus, Trash2, Loader2, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { PartAutocomplete, type PartSuggestion } from '@/components/invoice/PartAutocomplete'
import { formatEuros } from '@/lib/money'

interface LignePiece {
  id: string
  quantity: number
  unitPrice: number
  /** Absent pour les rôles sans `financial:read` — ne jamais l'inventer. */
  unitCost?: number
  part?: { id: string; name: string; quantity: number; reference?: string | null } | null
}

export function JobPartsSection({ jobId }: { jobId: string }) {
  const [lignes, setLignes] = useState<LignePiece[]>([])
  const [chargement, setChargement] = useState(true)
  const [saisie, setSaisie] = useState('')
  const [choisie, setChoisie] = useState<PartSuggestion | null>(null)
  const [quantite, setQuantite] = useState('1')
  const [occupe, setOccupe] = useState(false)

  const recharger = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/parts`, { cache: 'no-store' })
      if (!res.ok) return
      const corps = await res.json()
      setLignes(Array.isArray(corps) ? corps : [])
    } finally {
      setChargement(false)
    }
  }, [jobId])

  useEffect(() => { void recharger() }, [recharger])

  async function ajouter() {
    if (!choisie || occupe) return
    const q = Number(quantite)
    if (!Number.isInteger(q) || q <= 0) { toast.error('Quantité invalide.'); return }

    setOccupe(true)
    try {
      const res = await fetch(`/api/jobs/${jobId}/parts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partId: choisie.id, quantity: q }),
      })
      const corps = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Le refus le plus fréquent est le stock insuffisant (409) : le motif du
        // serveur est affiché tel quel, jamais remplacé par un message générique.
        toast.error(corps?.error ?? 'Ajout refusé par le serveur.')
        return
      }
      setSaisie(''); setChoisie(null); setQuantite('1')
      await recharger()
      toast.success(`${choisie.name} ×${q} — stock mis à jour`)
    } catch {
      toast.error('Serveur injoignable — la pièce n’a pas été ajoutée.')
    } finally {
      setOccupe(false)
    }
  }

  async function retirer(ligne: LignePiece) {
    if (occupe) return
    setOccupe(true)
    try {
      const res = await fetch(`/api/jobs/${jobId}/parts`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobPartId: ligne.id }),
      })
      const corps = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(corps?.error ?? 'Retrait refusé.'); return }
      await recharger()
      toast.success('Pièce retirée — stock restitué')
    } catch {
      toast.error('Serveur injoignable — la pièce n’a pas été retirée.')
    } finally {
      setOccupe(false)
    }
  }

  const totalVente = lignes.reduce((s, l) => s + l.quantity * (l.unitPrice ?? 0), 0)

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
      <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <Package className="h-3.5 w-3.5 text-blue-400" />
        Pièces posées
      </p>

      {chargement ? (
        <p className="text-xs text-slate-500">Chargement…</p>
      ) : lignes.length === 0 ? (
        <p className="text-xs text-slate-500">Aucune pièce posée sur cette intervention.</p>
      ) : (
        <ul className="mb-3 space-y-1.5">
          {lignes.map(l => (
            <li key={l.id} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-200">{l.part?.name ?? 'Pièce retirée du stock'}</span>
                {l.part?.reference && <span className="block text-[11px] text-slate-500">Réf. {l.part.reference}</span>}
              </span>
              <span className="shrink-0 text-xs text-slate-400">×{l.quantity}</span>
              <span className="shrink-0 text-xs font-semibold text-slate-200">
                {formatEuros(l.quantity * (l.unitPrice ?? 0))}
              </span>
              <button
                type="button"
                onClick={() => retirer(l)}
                disabled={occupe}
                aria-label={`Retirer ${l.part?.name ?? 'cette pièce'}`}
                className="shrink-0 rounded p-1 text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {lignes.length > 0 && (
        <p className="mb-3 text-right text-xs text-slate-400">
          Total pièces : <span className="font-semibold text-slate-200">{formatEuros(totalVente)}</span>
        </p>
      )}

      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label className="mb-1 block text-[11px] text-slate-500">Ajouter une pièce du stock</label>
          <PartAutocomplete
            value={saisie}
            onChange={(v) => { setSaisie(v) }}
            onSelectPart={(p) => { setChoisie(p); setSaisie(p.name) }}
            onClearPart={() => setChoisie(null)}
            linkedPartId={choisie?.id ?? null}
            placeholder="Filtre, plaquettes, huile…"
            className="w-full rounded-lg border border-white/15 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="w-20">
          <label className="mb-1 block text-[11px] text-slate-500">Qté</label>
          <input
            type="number"
            min={1}
            value={quantite}
            onChange={e => setQuantite(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-white/[0.05] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="button"
          onClick={ajouter}
          disabled={!choisie || occupe}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
        >
          {occupe ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Ajouter
        </button>
      </div>

      {choisie && choisie.quantity <= 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-300">
          <AlertTriangle className="h-3 w-3" />
          {choisie.name} est en rupture : le serveur refusera l’ajout.
        </p>
      )}
      <p className="mt-2 text-[10px] text-slate-600">
        Le stock est décrémenté à l’ajout et restitué au retrait. C’est cette saisie
        qui alimente la rentabilité, la prévision de stock et l’historique du véhicule.
      </p>
    </div>
  )
}
