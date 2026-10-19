'use client'

/**
 * « À relancer » — clients que le garage devrait recontacter (GF-DUR-013).
 *
 * ─── Pourquoi ce panneau existe ─────────────────────────────────────────────
 * Deux routes calculaient exactement cela, et aucun écran ne les appelait :
 *
 *   · `GET /api/reminders/suggestions` — véhicules dont la dernière intervention
 *     remonte au-delà du seuil réglé par le garage, et pour lesquels aucun rappel
 *     n'est déjà en attente ;
 *   · `GET /api/vehicles/ct-alerts` — contrôles techniques arrivant à échéance
 *     ou déjà dépassés.
 *
 * Le garage payait donc le calcul de sa propre relance commerciale sans jamais
 * en voir le résultat.
 *
 * ─── Une suggestion qui ne se transforme pas en acte ne sert à rien ─────────
 * Chaque ligne porte son bouton de création : le rappel est écrit par
 * `POST /api/reminders`, la ligne disparaît de la liste, et le compteur du
 * panneau se met à jour. Afficher une liste que l'utilisateur devrait ensuite
 * ressaisir à la main dans le formulaire d'à côté aurait été une décoration.
 *
 * Un CT dépassé n'est PAS présenté comme une échéance à venir : la distinction
 * est portée par le libellé et par la couleur, parce que ce ne sont pas les
 * mêmes appels téléphoniques.
 */

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Bell, CalendarClock, Loader2, Plus, RefreshCw } from 'lucide-react'
import { format, addDays, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'

interface SuggestionEntretien {
  vehicleId: string
  licensePlate: string
  make: string
  model: string
  clientName: string
  clientPhone: string | null
  clientEmail: string | null
  lastJobDate: string
  lastJobType: string
  monthsAgo: number
}

interface AlerteCt {
  vehicleId: string
  plate: string
  make: string
  model: string
  ctDate: string
  daysLeft: number
  expired: boolean
  client: { id: string; name: string; phone: string | null } | null
}

/** Corps accepté par `POST /api/reminders`. */
interface NouveauRappel {
  clientName: string
  vehicleModel: string
  licensePlate: string
  phone: string
  email: string
  type: string
  scheduledDate: string
  notes: string
}

export function ReminderSuggestions({ onCreated }: { onCreated: () => void }) {
  const [entretiens, setEntretiens] = useState<SuggestionEntretien[] | null>(null)
  const [cts, setCts] = useState<AlerteCt[] | null>(null)
  const [seuil, setSeuil] = useState<number | null>(null)
  const [occupe, setOccupe] = useState<string | null>(null)
  /** Lignes déjà transformées en rappel — retirées sans attendre un rechargement. */
  const [traitees, setTraitees] = useState<Set<string>>(new Set())

  const charger = useCallback(async () => {
    setEntretiens(null)
    setCts(null)
    const [a, b] = await Promise.all([
      fetch('/api/reminders/suggestions', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/vehicles/ct-alerts?days=60', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
    setEntretiens(a?.suggestions ?? [])
    setSeuil(typeof a?.thresholdMonths === 'number' ? a.thresholdMonths : null)
    setCts(a === null && b === null ? [] : (b?.alerts ?? []))
    setTraitees(new Set())
  }, [])

  useEffect(() => { void charger() }, [charger])

  async function creer(cle: string, rappel: NouveauRappel) {
    setOccupe(cle)
    try {
      const r = await fetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rappel),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => null)
        toast.error(d?.error ?? 'Création refusée par le serveur.')
        return
      }
      // Retirée seulement APRÈS la réponse : une ligne qui disparaît sur un
      // échec ferait croire au garage qu'il a relancé ce client.
      setTraitees((s) => new Set(s).add(cle))
      toast.success('Rappel créé')
      onCreated()
    } catch {
      toast.error('Serveur injoignable.')
    } finally {
      setOccupe(null)
    }
  }

  if (entretiens === null || cts === null) {
    return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-600" /></div>
  }

  const ctsVisibles = cts.filter((c) => !traitees.has(`ct:${c.vehicleId}`))
  const entretiensVisibles = entretiens.filter((e) => !traitees.has(`ent:${e.vehicleId}`))

  if (ctsVisibles.length === 0 && entretiensVisibles.length === 0) {
    return (
      <div className="text-center py-10">
        <Bell className="w-8 h-8 mx-auto mb-3 text-slate-700" />
        <p className="text-sm text-slate-500">Personne à relancer pour l’instant.</p>
        {seuil !== null && (
          <p className="text-[11px] text-slate-600 mt-1">
            Seuil d’entretien : {seuil} mois (réglable dans les paramètres).
          </p>
        )}
        <button onClick={charger} className="mt-3 text-[11px] text-blue-400 hover:text-blue-300">
          Actualiser
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={charger} aria-label="Actualiser les suggestions"
          className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
          <RefreshCw className="w-3 h-3" />Actualiser
        </button>
      </div>

      {ctsVisibles.length > 0 && (
        <section>
          <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5" />Contrôle technique ({ctsVisibles.length})
          </h3>
          <div className="space-y-2">
            {ctsVisibles.map((c) => {
              const cle = `ct:${c.vehicleId}`
              return (
                <div key={cle} className={cn(
                  'rounded-xl border p-3',
                  c.expired ? 'border-red-500/25 bg-red-500/[0.05]' : 'border-white/[0.07] bg-white/[0.02]',
                )}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">
                        {c.client?.name ?? 'Client inconnu'}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {c.make} {c.model} · {c.plate}
                      </p>
                      <p className={cn('text-[11px] mt-0.5 flex items-center gap-1', c.expired ? 'text-red-400' : 'text-amber-400')}>
                        {c.expired && <AlertTriangle className="w-3 h-3" />}
                        {c.expired
                          ? `CT dépassé depuis ${Math.abs(c.daysLeft)} jour${Math.abs(c.daysLeft) > 1 ? 's' : ''}`
                          : `CT dans ${c.daysLeft} jour${c.daysLeft > 1 ? 's' : ''}`}
                      </p>
                    </div>
                    <button
                      onClick={() => creer(cle, {
                        clientName: c.client?.name ?? 'Client',
                        vehicleModel: `${c.make} ${c.model}`.trim(),
                        licensePlate: c.plate,
                        phone: c.client?.phone ?? '',
                        email: '',
                        type: 'ct',
                        // Un CT déjà dépassé se rappelle AUJOURD'HUI ; sinon, la
                        // veille de l'échéance.
                        scheduledDate: c.expired
                          ? format(new Date(), 'yyyy-MM-dd')
                          : format(addDays(parseISO(c.ctDate), -1), 'yyyy-MM-dd'),
                        notes: `Contrôle technique au ${format(parseISO(c.ctDate), 'dd/MM/yyyy')}`,
                      })}
                      disabled={occupe !== null}
                      className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold disabled:opacity-50 transition-colors"
                    >
                      {occupe === cle ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      Créer le rappel
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {entretiensVisibles.length > 0 && (
        <section>
          <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Bell className="w-3.5 h-3.5" />Entretien à revoir ({entretiensVisibles.length})
          </h3>
          <div className="space-y-2">
            {entretiensVisibles.map((e) => {
              const cle = `ent:${e.vehicleId}`
              return (
                <div key={cle} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{e.clientName}</p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {e.make} {e.model} · {e.licensePlate}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Dernier passage il y a {e.monthsAgo} mois ({e.lastJobType})
                      </p>
                    </div>
                    <button
                      onClick={() => creer(cle, {
                        clientName: e.clientName,
                        vehicleModel: `${e.make} ${e.model}`.trim(),
                        licensePlate: e.licensePlate,
                        phone: e.clientPhone ?? '',
                        email: e.clientEmail ?? '',
                        type: 'vidange',
                        scheduledDate: format(addDays(new Date(), 7), 'yyyy-MM-dd'),
                        notes: `Dernier passage le ${e.lastJobDate} (${e.lastJobType})`,
                      })}
                      disabled={occupe !== null}
                      className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold disabled:opacity-50 transition-colors"
                    >
                      {occupe === cle ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      Créer le rappel
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
