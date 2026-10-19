'use client'

/**
 * « Générer un devis » — assemblage assisté à partir d'opérations (GF-DUR-031).
 *
 * ─── Pourquoi ce composant existe ───────────────────────────────────────────
 * `POST /api/quotes/generate` était complète : nomenclature par type de
 * réparation, taux horaire et TVA du garage, moteur de « pièces oubliées »,
 * numérotation transactionnelle, journal d'audit, limitation de débit. Aucun
 * écran ne l'appelait. Le garage devait donc ressaisir à la main chaque ligne
 * d'un devis que le logiciel savait déjà composer — et, surtout, il ne voyait
 * jamais les pièces que le moteur signale comme habituellement oubliées.
 *
 * ─── L'aperçu n'est pas une politesse, c'est le contrat de la route ─────────
 * Sans `confirm: true`, la route N'ÉCRIT RIEN et rend une proposition. C'est
 * délibéré : un devis chiffré part chez un client, il ne se crée pas d'un clic
 * distrait. L'écran respecte cet ordre — on voit d'abord les lignes, les
 * totaux et les suggestions, on confirme ensuite. Enchaîner les deux appels
 * pour « simplifier » aurait annulé la garde.
 *
 * ─── Ce que l'écran dit et qu'il serait tentant de taire ────────────────────
 * · Le devis créé est un BROUILLON, à vérifier — la route l'inscrit elle-même
 *   dans ses notes. L'écrire ici évite qu'il soit envoyé tel quel.
 * · Les suggestions de pièces oubliées sont présentées comme des suggestions,
 *   avec leur justification, et non fondues dans le devis sans mention.
 */

import { useState } from 'react'
import { Sparkles, Loader2, X, AlertCircle, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { REPAIR_TYPES } from '@/lib/types'

import type { QuoteProposal } from '@/lib/quote-gen/types'

interface Apercu {
  proposal: QuoteProposal
  vehicle: { id: string; model: string | null; plate: string | null } | null
  client: { id: string | null; name: string }
}

const TYPES = Object.entries(REPAIR_TYPES).map(([id, def]) => ({
  id,
  label: (def as { label: string }).label,
}))

export function QuoteGenerator({ onClose, onCree }: { onClose: () => void; onCree: () => void }) {
  const [choisis, setChoisis] = useState<string[]>([])
  const [plaque, setPlaque] = useState('')
  const [nomClient, setNomClient] = useState('')
  const [apercu, setApercu] = useState<Apercu | null>(null)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  function basculer(id: string) {
    setChoisis(c => (c.includes(id) ? c.filter(x => x !== id) : [...c, id]))
    // Le choix a changé : l'aperçu affiché ne correspond plus à la demande.
    // Le laisser serait pire que de ne rien montrer.
    setApercu(null)
  }

  /** Corps commun aux deux appels — l'aperçu et la confirmation doivent porter
      EXACTEMENT la même demande, sinon on confirmerait autre chose. */
  function corps(confirm: boolean) {
    return JSON.stringify({
      repairTypes: choisis,
      ...(plaque.trim() ? { licensePlate: plaque.trim().toUpperCase() } : {}),
      ...(nomClient.trim() ? { clientName: nomClient.trim() } : {}),
      includeSuggestions: true,
      ...(confirm ? { confirm: true } : {}),
    })
  }

  async function appeler(confirm: boolean) {
    if (choisis.length === 0) return
    setOccupe(true)
    setErreur(null)
    try {
      const r = await fetch('/api/quotes/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corps(confirm),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErreur(d?.error ?? 'Génération refusée.'); return }
      if (confirm) { onCree(); onClose(); return }
      setApercu({ proposal: d.proposal, vehicle: d.vehicle ?? null, client: d.client ?? { id: null, name: '' } })
    } catch {
      setErreur('Serveur injoignable.')
    } finally {
      setOccupe(false)
    }
  }

  // `suggestions` est un tableau SÉPARÉ de `lines`, et la route ne persiste que
  // `lines` : les suggestions ne seront donc PAS sur le devis créé. L'écran doit
  // le dire, sinon le garage croira les avoir facturées.
  const suggestions = apercu?.proposal.suggestions ?? []
  const lignes = apercu?.proposal.lines ?? []
  const avertissements = apercu?.proposal.warnings ?? []

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-white/[0.08] bg-[#0f1629] shadow-2xl">
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-white/[0.07] px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-purple-500/30 bg-purple-500/15">
            <Sparkles className="h-4 w-4 text-purple-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-bold text-white">Générer un devis</h2>
            <p className="text-[11px] text-slate-500">
              Choisissez les opérations : les pièces, la main-d’œuvre et la TVA de votre garage
              sont chiffrées automatiquement.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/[0.07]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Opérations</p>
            <div className="flex flex-wrap gap-1.5">
              {TYPES.map(t => (
                <button
                  key={t.id}
                  onClick={() => basculer(t.id)}
                  className={cn(
                    'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                    choisis.includes(t.id)
                      ? 'border-purple-500/50 bg-purple-500/20 text-purple-200'
                      : 'border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-500">Plaque (facultatif)</span>
              <input
                value={plaque}
                onChange={e => { setPlaque(e.target.value); setApercu(null) }}
                placeholder="AA-000-BB"
                className="w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 font-mono text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-500">Client (facultatif)</span>
              <input
                value={nomClient}
                onChange={e => { setNomClient(e.target.value); setApercu(null) }}
                placeholder="Nom du client"
                className="w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
            </label>
          </div>

          {erreur && (
            <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{erreur}
            </p>
          )}

          {apercu && (
            <div className="space-y-3">
              {/* Le véhicule reconnu est affiché : une plaque non trouvée donne
                  un devis sans véhicule, et il faut le voir AVANT de créer. */}
              <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
                {apercu.vehicle
                  ? <>Véhicule : <span className="text-slate-200">{apercu.vehicle.plate} · {apercu.vehicle.model}</span></>
                  : plaque.trim()
                    ? <span className="text-amber-400">Aucun véhicule ne correspond à cette plaque — le devis sera créé sans véhicule.</span>
                    : <>Aucun véhicule renseigné.</>}
                {apercu.client.name && <> · Client : <span className="text-slate-200">{apercu.client.name}</span></>}
              </div>

              <div className="overflow-hidden rounded-lg border border-white/[0.06]">
                {lignes.map((l, i) => (
                  <div key={i} className="flex items-center gap-3 border-b border-white/[0.04] px-3 py-2 text-sm last:border-b-0">
                    <span className="flex-1 text-slate-200">
                      {l.description}
                      {l.isLabor && <span className="ml-1.5 text-[10px] text-slate-500">main-d’œuvre</span>}
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {l.quantity} × {l.unitPrice.toFixed(2)} €
                    </span>
                    <span className="w-20 shrink-0 text-right font-semibold text-slate-200">
                      {l.lineTotalHT.toFixed(2)} €
                    </span>
                  </div>
                ))}
              </div>

              {/* Avertissements du moteur (tarif horaire à zéro, pièce sans prix…).
                  Les taire donnerait un devis chiffré sur une base fausse. */}
              {avertissements.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-300">
                  {avertissements.map((w, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />{w}
                    </li>
                  ))}
                </ul>
              )}

              {/* Les suggestions sont DISTINGUÉES, avec leur justification, et
                  l'écran dit qu'elles ne seront PAS reprises : la route ne
                  persiste que `lines`. Les présenter comme faisant partie du
                  devis ferait croire au garage qu'il les a facturées. */}
              {suggestions.length > 0 && (
                <div className="rounded-lg border border-purple-500/20 bg-purple-500/[0.07] p-3">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-purple-300">
                    Pièces souvent oubliées sur ces opérations
                  </p>
                  <p className="mb-2 text-[11px] text-purple-300/60">
                    À titre indicatif — elles ne seront pas ajoutées au devis. Ajoutez-les
                    vous-même si elles s’appliquent.
                  </p>
                  {suggestions.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 py-1 text-xs">
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-purple-400" />
                      <div className="min-w-0 flex-1">
                        <span className="text-purple-200">{s.name}</span>
                        {s.reason && <p className="text-[11px] text-purple-300/60">{s.reason}</p>}
                      </div>
                      <span className="shrink-0 text-purple-200">
                        {s.lineTotalHT === null ? 'prix inconnu' : `${s.lineTotalHT.toFixed(2)} €`}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                <div className="text-xs text-slate-500">
                  Total HT {apercu.proposal.totals.subtotalHT.toFixed(2)} €
                  {' · '}TVA {apercu.proposal.totals.vatRate} %
                  {apercu.proposal.totals.marginPct !== null && (
                    <> · marge {apercu.proposal.totals.marginPct} %</>
                  )}
                </div>
                <div className="text-lg font-black text-white">
                  {apercu.proposal.totals.totalTTC.toFixed(2)} €
                </div>
              </div>

              <p className="text-[11px] text-slate-500">
                Le devis sera créé en <strong className="text-slate-400">brouillon</strong>, à vérifier
                avant envoi.
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 gap-2 border-t border-white/[0.07] px-5 py-4">
          {/* Deux boutons distincts, jamais fondus en un : l'aperçu n'écrit rien,
              la confirmation crée un document numéroté. */}
          <button
            onClick={() => appeler(false)}
            disabled={occupe || choisis.length === 0}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/10 py-2.5 text-sm font-semibold text-slate-300 hover:bg-white/[0.06] disabled:opacity-40"
          >
            {occupe && !apercu ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {apercu ? 'Recalculer' : 'Prévisualiser'}
          </button>
          <button
            onClick={() => appeler(true)}
            disabled={occupe || !apercu}
            title={apercu ? undefined : 'Prévisualisez d’abord le devis'}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-purple-600 py-2.5 text-sm font-semibold text-white hover:bg-purple-500 disabled:opacity-40"
          >
            {occupe && apercu ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Créer le devis
          </button>
        </div>
      </div>
    </div>
  )
}
