'use client'

/**
 * « Rapports historisés » — relire et exporter (GF-DUR-032).
 *
 * ─── Le défaut : on enregistrait sans jamais pouvoir relire ─────────────────
 * La page du copilote appelait `POST /api/copilot/reports` et affichait
 * « Rapport historisé ». Puis plus rien : ni `GET /api/copilot/reports` (la
 * liste), ni `GET /api/copilot/reports/[id]/export` (le téléchargement) n'avait
 * d'appelant. Le bouton « Historiser » écrivait donc dans un tiroir sans
 * poignée — l'exploitant accumulait des instantanés qu'il ne reverrait jamais,
 * en croyant se constituer un historique.
 *
 * ─── Pourquoi l'inventaire des routes orphelines ne l'avait pas montré ──────
 * Il raisonne par ROUTE, pas par VERBE. `/api/copilot/reports` avait bien un
 * appelant — son `POST` — donc la route entière paraissait atteinte, et son
 * `GET` inutilisé restait invisible. La leçon vaut au-delà de ce cas : une
 * route mixte peut être à moitié morte sans que rien ne le signale.
 *
 * ─── L'export ne peut pas passer par `fetch` ────────────────────────────────
 * La route répond avec un `Content-Disposition: attachment`. C'est le
 * NAVIGATEUR qui doit recevoir la réponse pour déclencher l'enregistrement ; un
 * `fetch` la lirait en mémoire et il ne se passerait rien à l'écran. D'où les
 * liens directs plutôt qu'un gestionnaire de clic.
 */

import { useCallback, useEffect, useState } from 'react'
import { History, Loader2, FileDown, FileJson, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface RapportHistorise {
  id: string
  periodDays: number
  healthScore: number | null
  summary: string | null
  createdBy: string | null
  createdAt: string
}

/** Couleur du score — même lecture que le tableau de bord du copilote. */
function tonScore(v: number | null): string {
  if (v === null) return 'text-slate-500 bg-slate-500/10'
  if (v >= 70) return 'text-emerald-400 bg-emerald-500/10'
  if (v >= 45) return 'text-amber-400 bg-amber-500/10'
  return 'text-red-400 bg-red-500/10'
}

function quand(v: string): string {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-FR')
}

export function HistoriqueRapports({ version }: { version: number }) {
  const [rapports, setRapports] = useState<RapportHistorise[] | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [refus, setRefus] = useState(false)

  const charger = useCallback(async () => {
    try {
      const r = await fetch('/api/copilot/reports', { cache: 'no-store' })
      if (r.status === 403) {
        // Refus de PERMISSION, pas absence de rapports. Afficher une liste vide
        // ferait croire à un historique inexistant et à une fonction en panne.
        setRefus(true)
        setRapports([])
        return
      }
      const d = await r.json().catch(() => null)
      if (!r.ok || !d) { setErreur('Impossible de charger l’historique.'); return }
      setErreur(null)
      setRefus(false)
      setRapports(Array.isArray(d.reports) ? d.reports : [])
    } catch {
      setErreur('Serveur injoignable.')
    }
  }, [])

  // `version` change à chaque historisation : le nouveau rapport doit apparaître
  // sans que l'exploitant ait à recharger la page.
  useEffect(() => { void charger() }, [charger, version])

  if (!rapports && !erreur) {
    return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-600" /></div>
  }
  if (erreur) return <p className="text-xs text-red-400">{erreur}</p>

  if (refus) {
    return (
      <p className="rounded-xl border border-white/[0.06] px-4 py-4 text-center text-xs text-slate-500">
        L’historique des rapports est réservé aux comptes autorisés à consulter les données
        financières.
      </p>
    )
  }

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#111827]/95 p-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="flex flex-1 items-center gap-2 text-sm font-bold text-white">
          <History className="h-4 w-4 text-blue-400" /> Rapports historisés
        </h2>
        <button
          onClick={() => void charger()}
          title="Actualiser"
          className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/[0.07] hover:text-white"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {rapports!.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/[0.06] px-3 py-5 text-center text-xs text-slate-600">
          Aucun rapport historisé. Utilisez « Historiser » pour conserver l’analyse d’aujourd’hui
          et pouvoir la comparer plus tard.
        </div>
      ) : (
        <div className="space-y-2">
          {rapports!.map(r => (
            <div key={r.id} className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2">
              <span className={cn('shrink-0 rounded-lg px-2 py-1 text-sm font-black', tonScore(r.healthScore))}>
                {r.healthScore ?? '—'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-slate-200">{r.summary ?? `Analyse sur ${r.periodDays} jours`}</div>
                <div className="text-[11px] text-slate-500">
                  {quand(r.createdAt)} · {r.periodDays} j
                  {r.createdBy ? ` · ${r.createdBy}` : ''}
                </div>
              </div>
              {/* Liens directs, et non `fetch` : c'est le navigateur qui doit
                  recevoir la réponse pour proposer l'enregistrement du fichier. */}
              <a
                href={`/api/copilot/reports/${r.id}/export?format=csv`}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 text-[11px] font-semibold text-slate-300 transition-colors hover:bg-white/[0.07] hover:text-white"
                title="Télécharger au format CSV (ouvre dans Excel)"
              >
                <FileDown className="h-3 w-3" /> CSV
              </a>
              <a
                href={`/api/copilot/reports/${r.id}/export?format=json`}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 text-[11px] font-semibold text-slate-300 transition-colors hover:bg-white/[0.07] hover:text-white"
                title="Télécharger le rapport complet au format JSON"
              >
                <FileJson className="h-3 w-3" /> JSON
              </a>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
