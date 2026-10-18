'use client'

/**
 * Rendez-vous — côté CLIENT (GF-DUR-017).
 *
 * ─── Pourquoi cette page existe ─────────────────────────────────────────────
 * Deux routes portaient la demande, la modification et l'annulation, avec une
 * validation de créneau éprouvée (`lib/portal/appointments` : format, futur,
 * dans les heures d'ouverture, tient avant la fermeture). Aucune page du portail
 * ne les appelait — et le côté garage était encore plus invisible : il ne l'a
 * été qu'après avoir retiré les tests du corpus de la garde.
 *
 * ─── Une DEMANDE n'est pas un rendez-vous ───────────────────────────────────
 * C'est la distinction que l'écran doit porter du début à la fin. Le client
 * propose un créneau ; le garage confirme, ou non. Afficher « Rendez-vous pris »
 * sur un `requested` ferait venir des clients devant un rideau fermé.
 *
 *   · `requested` — demande envoyée, en attente du garage ;
 *   · `confirmed` — le garage s'est engagé ;
 *   · `cancelled` / `completed` — terminé, plus rien à faire.
 *
 * ─── Les heures d'ouverture viennent du serveur ─────────────────────────────
 * `validateSlot` refuse tout créneau hors ouverture. Les recopier ici les ferait
 * diverger au premier changement de réglage : le client se verrait proposer une
 * heure que le serveur refuse. Elles arrivent donc avec la liste, et bornent
 * directement le champ.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  CalendarClock, Plus, Loader2, ArrowLeft, X, Pencil, Check,
} from 'lucide-react'
import { lienPortail } from '@/lib/portal/garage-slug'
import { cheminPortail } from '@/lib/portal/routes'
import { redirectionPortail } from '@/lib/portal/redirection'
import { cn } from '@/lib/utils'

interface Rdv {
  id: string
  reason: string
  date: string
  startTime: string
  durationMin: number
  status: string
  notes: string | null
  vehicleModel: string | null
  licensePlate: string | null
}

interface Vehicule { id: string; licensePlate: string; make: string; model: string }
interface Horaires { ouverture: number; fermeture: number }

/** Ce que le statut signifie pour le client — jamais l'état technique. */
const ETAT: Record<string, { texte: string; teinte: string }> = {
  requested: { texte: 'Demande envoyée', teinte: 'bg-amber-500/15 text-amber-300' },
  confirmed: { texte: 'Confirmé par le garage', teinte: 'bg-emerald-500/15 text-emerald-300' },
  cancelled: { texte: 'Annulé', teinte: 'bg-slate-500/15 text-slate-400' },
  completed: { texte: 'Terminé', teinte: 'bg-blue-500/15 text-blue-300' },
}

/** Seuls ces deux états se modifient — le serveur applique la même règle. */
const MODIFIABLES = new Set(['requested', 'confirmed'])

const DUREES = [30, 60, 90, 120, 180, 240]

function jour(v: string): string {
  const d = new Date(`${v}T00:00:00`)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

function duree(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const r = min % 60
  return r === 0 ? `${h} h` : `${h} h ${r}`
}

export default function PortalAppointmentsPage() {
  const router = useRouter()
  const [rdvs, setRdvs] = useState<Rdv[] | null>(null)
  const [horaires, setHoraires] = useState<Horaires>({ ouverture: 8, fermeture: 18 })
  const [vehicules, setVehicules] = useState<Vehicule[]>([])
  const [redaction, setRedaction] = useState(false)
  /** Rendez-vous en cours de déplacement. */
  const [deplace, setDeplace] = useState<Rdv | null>(null)
  const [occupe, setOccupe] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  const charger = useCallback(async () => {
    try {
      const r = await fetch('/api/portal/appointments', { cache: 'no-store' })
      const ailleurs = await redirectionPortail(r)
      if (ailleurs) { router.replace(ailleurs); return }
      const d = await r.json().catch(() => null)
      if (!r.ok || !d) { setErreur('Chargement impossible.'); return }
      setErreur(null)
      setRdvs(d.appointments ?? [])
      if (d.horaires) setHoraires(d.horaires)
    } catch {
      setErreur('Serveur injoignable.')
    }
  }, [router])

  useEffect(() => { void charger() }, [charger])

  useEffect(() => {
    fetch('/api/portal/me/dashboard', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.vehicles) setVehicules(d.vehicles) })
      .catch(() => {})
  }, [])

  async function annuler(r: Rdv) {
    if (!window.confirm(`Annuler votre rendez-vous du ${jour(r.date)} à ${r.startTime} ?`)) return
    setOccupe(r.id)
    try {
      const res = await fetch(`/api/portal/appointments/${r.id}`, { method: 'DELETE' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setErreur(d?.error ?? 'Annulation refusée.'); return }
      await charger()
    } catch {
      setErreur('Serveur injoignable.')
    } finally {
      setOccupe(null)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0f1e] px-4 py-8 text-slate-200 md:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-black text-white">Mes <span className="text-blue-400">rendez-vous</span></h1>
          <Link
            href={lienPortail(cheminPortail('account'))}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/[0.08]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />Mon espace
          </Link>
        </div>

        {erreur && (
          <p role="alert" className="mt-4 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {erreur}
          </p>
        )}

        {redaction || deplace ? (
          <Formulaire
            horaires={horaires}
            vehicules={vehicules}
            existant={deplace}
            onAnnuler={() => { setRedaction(false); setDeplace(null) }}
            onFait={async () => { setRedaction(false); setDeplace(null); await charger() }}
            onErreur={setErreur}
          />
        ) : (
          <>
            <button
              onClick={() => { setErreur(null); setRedaction(true) }}
              className="mt-6 flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500"
            >
              <Plus className="h-4 w-4" />Demander un rendez-vous
            </button>

            {rdvs === null ? (
              <div className="mt-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-600" /></div>
            ) : rdvs.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-white/[0.08] p-10 text-center">
                <CalendarClock className="mx-auto mb-3 h-8 w-8 text-slate-700" />
                <p className="text-sm text-slate-500">Aucun rendez-vous.</p>
                <p className="mt-1 text-[11px] text-slate-600">
                  Proposez un créneau : votre garage vous le confirme ou vous en propose un autre.
                </p>
              </div>
            ) : (
              <ul className="mt-4 space-y-2">
                {rdvs.map((r) => {
                  const e = ETAT[r.status] ?? { texte: r.status, teinte: 'bg-slate-500/15 text-slate-400' }
                  const modifiable = MODIFIABLES.has(r.status)
                  return (
                    <li key={r.id} className="rounded-xl border border-white/[0.08] bg-[#111827]/95 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white">{r.reason}</p>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            {jour(r.date)} à {r.startTime} · {duree(r.durationMin)}
                            {r.licensePlate ? ` · ${r.licensePlate}` : ''}
                          </p>
                          {r.notes && <p className="mt-1 whitespace-pre-line text-[11px] text-slate-500">{r.notes}</p>}
                        </div>
                        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold', e.teinte)}>
                          {e.texte}
                        </span>
                      </div>

                      {modifiable && (
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => { setErreur(null); setDeplace(r) }}
                            disabled={occupe !== null}
                            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-white/[0.06] disabled:opacity-50"
                          >
                            <Pencil className="h-3 w-3" />Déplacer
                          </button>
                          <button
                            onClick={() => annuler(r)}
                            disabled={occupe !== null}
                            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-slate-400 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                          >
                            {occupe === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                            Annuler
                          </button>
                        </div>
                      )}

                      {r.status === 'confirmed' && (
                        // Déplacer un créneau confirmé le renvoie en demande : le
                        // garage doit se réengager. Le dire AVANT évite au client
                        // de croire qu'il conserve sa place.
                        <p className="mt-2 text-[10px] text-slate-600">
                          Déplacer ce rendez-vous annulera la confirmation : votre garage devra la renouveler.
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Formulaire({ horaires, vehicules, existant, onAnnuler, onFait, onErreur }: {
  horaires: Horaires
  vehicules: Vehicule[]
  existant: Rdv | null
  onAnnuler: () => void
  onFait: () => void
  onErreur: (e: string | null) => void
}) {
  const [motif, setMotif] = useState(existant?.reason ?? '')
  const [date, setDate] = useState(existant?.date ?? '')
  const [heure, setHeure] = useState(existant?.startTime ?? '')
  const [minutes, setMinutes] = useState(existant?.durationMin ?? 60)
  const [vehiculeId, setVehiculeId] = useState('')
  const [notes, setNotes] = useState(existant?.notes ?? '')
  const [envoi, setEnvoi] = useState(false)

  // Bornes calquées sur celles du serveur : `min` interdit une date passée,
  // `min`/`max` sur l'heure cadrent l'ouverture. Ce ne sont que des garde-fous
  // de saisie — c'est le serveur qui tranche.
  const aujourdhui = new Date().toISOString().slice(0, 10)
  const heureMin = `${String(horaires.ouverture).padStart(2, '0')}:00`
  const heureMax = `${String(Math.max(0, horaires.fermeture - 1)).padStart(2, '0')}:00`

  async function envoyer() {
    setEnvoi(true)
    onErreur(null)
    try {
      const corps = {
        reason: motif.trim(),
        date,
        startTime: heure,
        durationMin: minutes,
        notes: notes.trim() || null,
        ...(existant ? {} : (() => {
          const v = vehicules.find((x) => x.id === vehiculeId)
          return vehiculeId
            ? { vehicleId: vehiculeId, vehicleModel: `${v?.make ?? ''} ${v?.model ?? ''}`.trim(), licensePlate: v?.licensePlate }
            : {}
        })()),
      }
      const r = existant
        ? await fetch(`/api/portal/appointments/${existant.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
          })
        : await fetch('/api/portal/appointments', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
          })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        // Le motif du refus vient du serveur — « avant l'ouverture », « après la
        // fermeture », « doit être dans le futur » n'appellent pas la même
        // correction. La saisie reste à l'écran.
        onErreur(d?.error ?? 'Demande refusée.')
        return
      }
      onFait()
    } catch {
      onErreur('Serveur injoignable.')
    } finally {
      setEnvoi(false)
    }
  }

  const champ = 'w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/60'
  const pret = motif.trim().length > 0 && date.length > 0 && heure.length > 0 && !envoi

  return (
    <div className="mt-6 space-y-3 rounded-2xl border border-white/[0.08] bg-[#111827]/95 p-5">
      <h2 className="text-base font-bold text-white">
        {existant ? 'Déplacer mon rendez-vous' : 'Demander un rendez-vous'}
      </h2>
      <p className="text-[11px] text-slate-500">
        Atelier ouvert de {horaires.ouverture} h à {horaires.fermeture} h. Votre demande sera confirmée par le garage.
      </p>

      <input
        value={motif} onChange={(e) => setMotif(e.target.value)}
        placeholder="Motif (ex. révision annuelle, bruit au freinage)"
        aria-label="Motif" maxLength={200} className={champ}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="date" className="mb-1 block text-[11px] text-slate-500">Date</label>
          <input id="date" type="date" value={date} min={aujourdhui}
            onChange={(e) => setDate(e.target.value)} className={champ} />
        </div>
        <div>
          <label htmlFor="heure" className="mb-1 block text-[11px] text-slate-500">Heure</label>
          <input id="heure" type="time" value={heure} min={heureMin} max={heureMax} step={900}
            onChange={(e) => setHeure(e.target.value)} className={champ} />
        </div>
        <div>
          <label htmlFor="duree" className="mb-1 block text-[11px] text-slate-500">Durée estimée</label>
          <select id="duree" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={champ}>
            {DUREES.map((m) => (
              <option key={m} value={m} className="bg-[#111827]">{duree(m)}</option>
            ))}
          </select>
        </div>
      </div>

      {!existant && vehicules.length > 0 && (
        <select
          value={vehiculeId} onChange={(e) => setVehiculeId(e.target.value)}
          aria-label="Véhicule concerné" className={champ}
        >
          <option value="" className="bg-[#111827]">Aucun véhicule précis</option>
          {vehicules.map((v) => (
            <option key={v.id} value={v.id} className="bg-[#111827]">
              {v.make} {v.model} — {v.licensePlate}
            </option>
          ))}
        </select>
      )}

      <textarea
        value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
        placeholder="Précisions (facultatif)" aria-label="Précisions"
        className={cn(champ, 'resize-none')}
      />

      <div className="flex items-center gap-2">
        <button
          onClick={envoyer} disabled={!pret}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {existant ? 'Proposer ce nouveau créneau' : 'Envoyer ma demande'}
        </button>
        <button onClick={onAnnuler} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-400 hover:bg-white/[0.06]">
          Annuler
        </button>
      </div>
    </div>
  )
}
