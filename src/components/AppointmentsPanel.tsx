'use client'

/**
 * Rendez-vous — côté GARAGE (GF-DUR-017).
 *
 * ─── Pourquoi ce panneau existe ─────────────────────────────────────────────
 * `/api/appointments` et `/api/appointments/[id]` servaient la liste et les
 * transitions (confirmer, annuler, terminer). Aucun écran ne les appelait — et
 * le constat lui-même était masqué : deux tests d'isolation importaient ces
 * routes, ce qui suffisait à les faire passer pour branchées tant que les tests
 * comptaient comme des appelants.
 *
 * Conséquence : un client aurait pu demander un créneau — s'il avait eu une page
 * pour le faire — sans que personne au garage ne puisse le confirmer. Une
 * demande sans réponse est le pire des deux mondes : le client attend, et
 * l'atelier ne sait pas qu'on l'attend.
 *
 * ─── L'ouverture montre « À confirmer » ─────────────────────────────────────
 * Les demandes `requested` sont les seules où quelqu'un attend une réponse. Le
 * planning complet noierait ces demandes-là dans les rendez-vous déjà réglés.
 *
 * ─── Ce que l'écran refuse de faire ─────────────────────────────────────────
 * Les actions proposées suivent la machine à états du serveur : on ne confirme
 * que depuis `requested`, on ne clôt que depuis `confirmed`. Proposer une
 * transition impossible mènerait à un 409 que l'utilisateur ne comprendrait pas.
 */

import { useCallback, useEffect, useState } from 'react'
import { X, CalendarClock, Loader2, Check, XCircle, Flag, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import { nextAppointmentStatus, type AppointmentStatus, type AppointmentAction } from '@/lib/portal/appointments'

interface Rdv {
  id: string
  clientName: string
  vehicleModel: string | null
  licensePlate: string | null
  reason: string
  date: string
  startTime: string
  durationMin: number
  status: string
  notes: string | null
}

/** Ce que le statut demande AU GARAGE. */
const ETAT: Record<string, { texte: string; teinte: string }> = {
  requested: { texte: 'À confirmer', teinte: 'text-amber-300 bg-amber-500/15' },
  confirmed: { texte: 'Confirmé', teinte: 'text-emerald-300 bg-emerald-500/15' },
  cancelled: { texte: 'Annulé', teinte: 'text-slate-400 bg-slate-500/15' },
  completed: { texte: 'Terminé', teinte: 'text-blue-300 bg-blue-500/15' },
}

const ACTIONS: Array<{ action: AppointmentAction; libelle: string; icone: typeof Check; classe: string }> = [
  { action: 'confirm', libelle: 'Confirmer', icone: Check, classe: 'border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/10' },
  { action: 'complete', libelle: 'Terminé', icone: Flag, classe: 'border-blue-500/25 text-blue-400 hover:bg-blue-500/10' },
  { action: 'cancel', libelle: 'Annuler', icone: XCircle, classe: 'border-white/10 text-slate-400 hover:bg-red-500/10 hover:text-red-300' },
]

function jour(v: string): string {
  const d = new Date(`${v}T00:00:00`)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}

function duree(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const r = min % 60
  return r === 0 ? `${h} h` : `${h} h ${r}`
}

export default function AppointmentsPanel({ onClose }: { onClose: () => void }) {
  const [rdvs, setRdvs] = useState<Rdv[] | null>(null)
  const [vue, setVue] = useState<'a-confirmer' | 'a-venir' | 'tous'>('a-confirmer')
  const [occupe, setOccupe] = useState<string | null>(null)

  const charger = useCallback(async () => {
    try {
      const r = await fetch('/api/appointments', { cache: 'no-store' })
      const d = await r.json().catch(() => null)
      if (!r.ok || !d) { toast.error(d?.error ?? 'Chargement impossible.'); return }
      setRdvs(d.appointments ?? [])
    } catch {
      toast.error('Serveur injoignable.')
    }
  }, [])

  useEffect(() => { void charger() }, [charger])

  async function agir(r: Rdv, action: AppointmentAction) {
    if (action === 'cancel' && !window.confirm(
      `Annuler le rendez-vous de ${r.clientName} du ${jour(r.date)} à ${r.startTime} ?\n\n`
      + 'Le client le verra annulé dans son espace ; prévenez-le si c’est de votre fait.',
    )) return

    setOccupe(r.id)
    try {
      const res = await fetch(`/api/appointments/${r.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d?.error ?? 'Action refusée par le serveur.'); return }
      // La liste est relue : le statut décide de la vue où le rendez-vous reste.
      await charger()
      toast.success(action === 'confirm' ? 'Rendez-vous confirmé' : action === 'complete' ? 'Rendez-vous terminé' : 'Rendez-vous annulé')
    } catch {
      toast.error('Serveur injoignable.')
    } finally {
      setOccupe(null)
    }
  }

  const aujourdhui = new Date().toISOString().slice(0, 10)
  const tous = rdvs ?? []
  const aConfirmer = tous.filter((r) => r.status === 'requested')
  const visibles = vue === 'tous'
    ? tous
    : vue === 'a-confirmer'
      ? aConfirmer
      // « À venir » : ce qui est confirmé et pas encore passé. Un rendez-vous
      // confirmé d'hier n'attend plus rien de l'accueil.
      : tous.filter((r) => r.status === 'confirmed' && r.date >= aujourdhui)

  return (
    <div className="fixed right-0 top-0 bottom-0 w-full max-w-[520px] bg-[#0f1629] z-40 shadow-2xl shadow-black/50 flex flex-col border-l border-white/[0.07] pt-safe pb-safe pr-safe">
      <div className="bg-[#111827] border-b border-white/[0.07] px-5 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
            <CalendarClock className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h2 className="font-bold text-white text-base">Rendez-vous clients</h2>
            {aConfirmer.length > 0 && (
              <p className="text-[10px] text-amber-400">
                {aConfirmer.length} demande{aConfirmer.length > 1 ? 's' : ''} en attente de confirmation
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={charger} aria-label="Actualiser"
            className="p-2 rounded-lg text-slate-500 hover:bg-white/[0.07] hover:text-slate-300 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button aria-label="Fermer" title="Fermer" onClick={onClose} className="gf-close p-2 rounded-lg hover:bg-white/[0.07] text-slate-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex gap-1 px-5 py-3 border-b border-white/[0.05] flex-shrink-0">
        {([['a-confirmer', 'À confirmer'], ['a-venir', 'À venir'], ['tous', 'Tous']] as const).map(([v, libelle]) => (
          <button
            key={v}
            onClick={() => setVue(v)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
              vue === v
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-300',
            )}
          >
            {libelle}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {rdvs === null ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
        ) : visibles.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto mb-4">
              <CalendarClock className="w-6 h-6 text-slate-600" />
            </div>
            <p className="text-slate-400 font-medium">
              {vue === 'a-confirmer' ? 'Aucune demande en attente.' : vue === 'a-venir' ? 'Aucun rendez-vous à venir.' : 'Aucun rendez-vous.'}
            </p>
            {vue !== 'tous' && tous.length > 0 && (
              <button onClick={() => setVue('tous')} className="mt-2 text-blue-400 text-sm hover:text-blue-300">
                Voir tous les rendez-vous
              </button>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {visibles.map((r) => (
              <li key={r.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{r.clientName}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{r.reason}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {jour(r.date)} à {r.startTime} · {duree(r.durationMin)}
                      {r.licensePlate ? ` · ${r.licensePlate}` : ''}
                      {r.vehicleModel ? ` (${r.vehicleModel})` : ''}
                    </p>
                    {r.notes && (
                      <p className="mt-1 whitespace-pre-line text-[11px] text-slate-500">{r.notes}</p>
                    )}
                  </div>
                  <span className={cn('shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full', ETAT[r.status]?.teinte)}>
                    {ETAT[r.status]?.texte ?? r.status}
                  </span>
                </div>

                {/* Seules les transitions que le serveur accepterait sont
                    proposées — `nextAppointmentStatus` est la MÊME fonction qu'il
                    applique, pas une copie qui divergerait. */}
                <div className="flex flex-wrap gap-2 mt-2.5">
                  {ACTIONS.filter((a) => nextAppointmentStatus(r.status as AppointmentStatus, a.action) !== null).map((a) => (
                    <button
                      key={a.action}
                      onClick={() => agir(r, a.action)}
                      disabled={occupe !== null}
                      className={cn(
                        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all disabled:opacity-40',
                        a.classe,
                      )}
                    >
                      {occupe === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <a.icone className="w-3 h-3" />}
                      {a.libelle}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
