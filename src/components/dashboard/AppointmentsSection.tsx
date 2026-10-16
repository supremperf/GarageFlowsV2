'use client'

/**
 * Tableau de bord — VUE GLOBALE DES RENDEZ-VOUS (GF-DUR-054).
 *
 * ─── Pourquoi cette section ──────────────────────────────────────────────────
 *
 * Le garage n'avait qu'un tiroir « Rendez-vous », qui montrait le planning d'UN
 * jour et ne servait que les demandes en attente. La question du lundi matin —
 * « qu'est-ce qui m'attend cette semaine, et chez qui ? » — n'avait aucune
 * réponse à l'écran : il fallait ouvrir les jours un par un, en espérant ne pas
 * en oublier.
 *
 * Cette section liste TOUS les rendez-vous du garage, toutes dates confondues,
 * par ordre chronologique, avec le jour de la semaine et la date complète, le
 * client, le véhicule (marque, modèle, plaque), la prestation, l'heure et le
 * statut. Elle lit `/api/appointments` — la route existante, étendue de filtres
 * serveur — donc les mêmes lignes que le tiroir et l'espace client : il n'y a
 * pas deux vérités.
 *
 * ─── Les filtres sont appliqués PAR LE SERVEUR ───────────────────────────────
 *
 * Filtrer les 200 lignes déjà chargées donnerait une liste fausse dès que le
 * garage en compte davantage : elle afficherait « aucun rendez-vous » alors que
 * le rendez-vous cherché existe, simplement hors de la page. Chaque filtre part
 * donc dans la requête, avec le total renvoyé par le serveur.
 *
 * ─── Actions ─────────────────────────────────────────────────────────────────
 *
 *   • ouvrir le rendez-vous  → détail déplié (notes, durée, créneau, statut) ;
 *   • fiche CLIENT           → panneau Clients, sur la fiche concernée ;
 *   • fiche VÉHICULE         → historique du véhicule ;
 *   • modifier               → date, heure, durée, motif, notes (PATCH) ;
 *   • confirmer / terminer / annuler → machine à états du serveur, réservée à
 *     `job:manage` ; les boutons n'apparaissent que si la transition est
 *     réellement possible, car proposer une transition interdite mène à un 409
 *     incompréhensible.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, parseISO, addDays } from 'date-fns'
import { fr } from 'date-fns/locale'
import { useSession } from 'next-auth/react'
import toast from 'react-hot-toast'
import {
  CalendarClock, Search, Loader2, RefreshCw, ChevronDown, ChevronUp,
  User, Car, Pencil, XCircle, Check, Flag, Save, X, AlertCircle, ListFilter,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { can } from '@/lib/authz'
import { useTranslation } from '@/lib/i18n'
import { canModifyAppointment, type AppointmentStatus, type AppointmentAction } from '@/lib/portal/appointments'

/** Un rendez-vous tel que `/api/appointments` le renvoie. */
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
  portalUserId: string | null
  clientId: string | null
  vehicleId: string | null
  clientFiche:   { id: string; name: string; phone: string | null; email: string | null } | null
  vehiculeFiche: { id: string; make: string | null; model: string | null; licensePlate: string | null; year: number | null } | null
}

interface FicheClient { id: string; name: string; vehicles?: Array<{ id: string; make: string | null; model: string | null; licensePlate: string | null }> }

const STATUTS: Array<{ valeur: string; texte: string; teinte: string }> = [
  { valeur: '',          texte: 'Tous les statuts', teinte: '' },
  { valeur: 'requested', texte: 'À confirmer',       teinte: 'text-amber-300 bg-amber-500/15 border-amber-500/25' },
  { valeur: 'confirmed', texte: 'Confirmé',          teinte: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/25' },
  { valeur: 'completed', texte: 'Terminé',           teinte: 'text-blue-300 bg-blue-500/15 border-blue-500/25' },
  { valeur: 'cancelled', texte: 'Annulé',            teinte: 'text-slate-400 bg-slate-500/15 border-slate-500/25' },
]

const TEINTE_STATUT = (statut: string) => STATUTS.find(s => s.valeur === statut)?.teinte
  ?? 'text-slate-400 bg-slate-500/15 border-slate-500/25'
const TEXTE_STATUT = (statut: string) => STATUTS.find(s => s.valeur === statut)?.texte ?? statut

const PERIODES = [
  { id: 'tout',   label: 'Toutes les dates' },
  { id: 'avenir', label: 'À venir' },
  { id: 'jour',   label: 'Aujourd’hui' },
  { id: '7j',     label: '7 prochains jours' },
  { id: '30j',    label: '30 prochains jours' },
  { id: 'passe',  label: 'Déjà passés' },
] as const

type PeriodeId = typeof PERIODES[number]['id']

/** Bornes `YYYY-MM-DD` d'une période, calculées sur le jour courant. */
function bornesPeriode(p: PeriodeId): { from?: string; to?: string } {
  const aujourdhui = format(new Date(), 'yyyy-MM-dd')
  switch (p) {
    case 'avenir': return { from: aujourdhui }
    case 'jour':   return { from: aujourdhui, to: aujourdhui }
    case '7j':     return { from: aujourdhui, to: format(addDays(new Date(), 7), 'yyyy-MM-dd') }
    case '30j':    return { from: aujourdhui, to: format(addDays(new Date(), 30), 'yyyy-MM-dd') }
    case 'passe':  return { to: aujourdhui }
    default:       return {}
  }
}

const CHAMP = 'px-2.5 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/60'

export interface AppointmentsSectionProps {
  /** Ouvre la fiche client (panneau Clients). */
  onOpenClient?: (clientId: string) => void
  /** Ouvre l'historique du véhicule. */
  onOpenVehicle?: (vehicleId: string) => void
  /** Ouvre le tiroir de gestion des rendez-vous (décisions, détails). */
  onOpenAppointments?: () => void
  /** Rendez-vous à mettre en évidence à l'ouverture (venu du planning). */
  rdvACibler?: string | null
}

export default function AppointmentsSection({
  onOpenClient, onOpenVehicle, onOpenAppointments, rdvACibler = null,
}: AppointmentsSectionProps) {
  const { t, lang } = useTranslation()
  const { data: session } = useSession()
  const role = session?.user?.role ?? 'RECEPTIONIST'
  const peutDecider = can(role, 'job:manage')

  // ── Filtres ────────────────────────────────────────────────────────────────
  const [recherche, setRecherche] = useState('')
  const [rechercheDifferee, setRechercheDifferee] = useState('')
  const [plaque, setPlaque] = useState('')
  const [jour, setJour] = useState('')
  const [periode, setPeriode] = useState<PeriodeId>('tout')
  const [statut, setStatut] = useState('')
  const [clientId, setClientId] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [ordreDesc, setOrdreDesc] = useState(false)

  // ── Données ────────────────────────────────────────────────────────────────
  const [rdvs, setRdvs] = useState<Rdv[]>([])
  const [total, setTotal] = useState(0)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [clients, setClients] = useState<FicheClient[]>([])
  const [ouvert, setOuvert] = useState<string | null>(null)
  const [enEdition, setEnEdition] = useState<string | null>(null)
  const [brouillon, setBrouillon] = useState({ date: '', startTime: '', durationMin: 60, reason: '', notes: '' })
  const [occupe, setOccupe] = useState<string | null>(null)

  /** La « date » exacte et la « période » se contredisent : la date gagne. */
  const periodeActive: PeriodeId = jour ? 'tout' : periode

  useEffect(() => {
    const id = setTimeout(() => setRechercheDifferee(recherche.trim()), 250)
    return () => clearTimeout(id)
  }, [recherche])

  // Liste des clients pour le FILTRE : route existante, bornée à 100.
  useEffect(() => {
    fetch('/api/clients?limit=100')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (Array.isArray(d?.data)) setClients(d.data) })
      .catch(() => { /* filtre client indisponible : le champ reste vide */ })
  }, [])

  const charger = useCallback(async () => {
    setChargement(true)
    setErreur(null)
    const p = new URLSearchParams()
    if (rechercheDifferee) p.set('q', rechercheDifferee)
    if (plaque.trim()) p.set('plate', plaque.trim())
    if (statut) p.set('status', statut)
    if (clientId) p.set('clientId', clientId)
    if (vehicleId) p.set('vehicleId', vehicleId)
    if (jour) p.set('date', jour)
    else {
      const { from, to } = bornesPeriode(periodeActive)
      if (from) p.set('from', from)
      if (to) p.set('to', to)
    }
    if (ordreDesc) p.set('order', 'desc')
    p.set('limit', '200')

    try {
      const r = await fetch(`/api/appointments?${p.toString()}`)
      if (!r.ok) {
        setErreur(r.status === 403
          ? 'Votre compte n’a pas accès aux rendez-vous.'
          : `Chargement impossible (erreur ${r.status}).`)
        setRdvs([])
        setTotal(0)
        return
      }
      const d = await r.json().catch(() => null)
      setRdvs(Array.isArray(d?.appointments) ? d.appointments : [])
      setTotal(typeof d?.total === 'number' ? d.total : (d?.appointments?.length ?? 0))
    } catch {
      setErreur('Serveur injoignable.')
      setRdvs([])
      setTotal(0)
    } finally {
      setChargement(false)
    }
  }, [rechercheDifferee, plaque, statut, clientId, vehicleId, jour, periodeActive, ordreDesc])

  useEffect(() => { void charger() }, [charger])
  // Le planning (JobModal) peut créer ou déplacer une intervention : on relit
  // quand la fenêtre reprend le focus, comme le reste de l'application.
  useEffect(() => {
    function surFocus() { if (document.visibilityState === 'visible') void charger() }
    document.addEventListener('visibilitychange', surFocus)
    return () => document.removeEventListener('visibilitychange', surFocus)
  }, [charger])

  // Rendez-vous désigné par l'appelant : on le déplie.
  useEffect(() => { if (rdvACibler) setOuvert(rdvACibler) }, [rdvACibler])

  const vehiculesDuClient = useMemo(
    () => (clientId ? (clients.find(c => c.id === clientId)?.vehicles ?? []) : []),
    [clientId, clients],
  )

  const filtresActifs = !!rechercheDifferee || !!plaque.trim() || !!jour || periode !== 'tout' || !!statut || !!clientId || !!vehicleId

  function reinitialiserFiltres() {
    setRecherche(''); setPlaque(''); setJour(''); setPeriode('tout')
    setStatut(''); setClientId(''); setVehicleId(''); setOrdreDesc(false)
  }

  function ouvrirEdition(rdv: Rdv) {
    setEnEdition(rdv.id)
    setOuvert(rdv.id)
    setBrouillon({
      date: rdv.date,
      startTime: rdv.startTime,
      durationMin: rdv.durationMin,
      reason: rdv.reason,
      notes: rdv.notes ?? '',
    })
  }

  async function enregistrer(rdv: Rdv) {
    setOccupe(rdv.id)
    try {
      const r = await fetch(`/api/appointments/${rdv.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: brouillon.date,
          startTime: brouillon.startTime,
          durationMin: brouillon.durationMin,
          reason: brouillon.reason.trim(),
          notes: brouillon.notes.trim() || null,
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d?.error ?? 'Modification refusée par le serveur.'); return }
      setEnEdition(null)
      toast.success('Rendez-vous modifié')
      // Le client n'est pas prévenu automatiquement d'un déplacement : le dire,
      // plutôt que de laisser croire qu'il l'est.
      if (d?.avertissement) toast(d.avertissement, { duration: 9000, icon: '⚠️' })
      await charger()
    } catch {
      toast.error('Serveur injoignable.')
    } finally {
      setOccupe(null)
    }
  }

  async function decider(rdv: Rdv, action: AppointmentAction) {
    setOccupe(rdv.id)
    try {
      const r = await fetch(`/api/appointments/${rdv.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d?.error ?? 'Action refusée par le serveur.'); return }
      toast.success(action === 'confirm' ? 'Rendez-vous confirmé'
        : action === 'complete' ? 'Rendez-vous terminé'
        : 'Rendez-vous annulé')
      // La remontée vers l'espace client est BEST-EFFORT : on annonce son issue
      // réelle au comptoir au lieu de la supposer.
      if (d?.clientPrevenu === false) {
        toast('Le client n’a PAS pu être prévenu dans son espace : contactez-le.', { duration: 9000, icon: '⚠️' })
      }
      await charger()
    } catch {
      toast.error('Serveur injoignable.')
    } finally {
      setOccupe(null)
    }
  }

  const libelleDate = (date: string) => {
    const d = parseISO(date)
    if (Number.isNaN(d.getTime())) return date
    return format(d, 'EEEE d MMMM yyyy', { locale: lang === 'fr' ? fr : undefined })
  }

  const vehiculeTexte = (rdv: Rdv) => {
    const v = rdv.vehiculeFiche
    if (v) return [v.make, v.model].filter(Boolean).join(' ') || rdv.vehicleModel || 'Véhicule'
    return rdv.vehicleModel || '—'
  }
  const plaqueTexte = (rdv: Rdv) => rdv.vehiculeFiche?.licensePlate || rdv.licensePlate || '—'
  const nomClient  = (rdv: Rdv) => rdv.clientFiche?.name || rdv.clientName

  return (
    <div className="p-6 flex flex-col gap-5">
      {/* ── Titre + action de gestion ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-white font-semibold flex items-center gap-2">
            <CalendarClock size={18} className="text-blue-400" />
            {t.navAppointments}
            <span className="text-[11px] font-normal text-slate-500">
              {total} au total{filtresActifs ? ' (filtres actifs)' : ''}
            </span>
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">{t.ttAppointments}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void charger()}
            disabled={chargement}
            aria-label="Rafraîchir les rendez-vous"
            title="Rafraîchir"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-100 hover:bg-white/[0.07] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', chargement && 'animate-spin')} />
            Rafraîchir
          </button>
          {onOpenAppointments && (
            <button
              type="button"
              onClick={onOpenAppointments}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            >
              Gérer les demandes
            </button>
          )}
        </div>
      </div>

      {/* ── Filtres ───────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 text-slate-600 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={recherche}
              onChange={e => setRecherche(e.target.value)}
              placeholder="Client, véhicule, plaque, motif…"
              aria-label="Rechercher un rendez-vous"
              className={cn(CHAMP, 'w-full pl-8')}
            />
          </div>
          <input
            value={plaque}
            onChange={e => setPlaque(e.target.value)}
            placeholder="Plaque"
            aria-label="Filtrer par plaque"
            className={cn(CHAMP, 'w-28')}
          />
          <input
            type="date"
            value={jour}
            onChange={e => setJour(e.target.value)}
            aria-label="Filtrer par date exacte"
            className={cn(CHAMP, 'w-[9.5rem]')}
          />
          <select
            value={periodeActive}
            onChange={e => { setJour(''); setPeriode(e.target.value as PeriodeId) }}
            aria-label="Période"
            disabled={!!jour}
            className={cn(CHAMP, 'disabled:opacity-50')}
          >
            {PERIODES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <select
            value={statut}
            onChange={e => setStatut(e.target.value)}
            aria-label="Statut"
            className={CHAMP}
          >
            {STATUTS.map(s => <option key={s.valeur || 'tous'} value={s.valeur}>{s.texte}</option>)}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={clientId}
            onChange={e => { setClientId(e.target.value); setVehicleId('') }}
            aria-label="Client"
            className={cn(CHAMP, 'max-w-[16rem]')}
          >
            <option value="">Tous les clients</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select
            value={vehicleId}
            onChange={e => setVehicleId(e.target.value)}
            aria-label="Véhicule"
            disabled={!clientId || vehiculesDuClient.length === 0}
            className={cn(CHAMP, 'max-w-[16rem] disabled:opacity-50')}
          >
            <option value="">
              {!clientId ? 'Véhicule (choisir un client)'
                : vehiculesDuClient.length === 0 ? 'Aucun véhicule pour ce client'
                : 'Tous les véhicules de ce client'}
            </option>
            {vehiculesDuClient.map(v => (
              <option key={v.id} value={v.id}>
                {[v.make, v.model].filter(Boolean).join(' ') || 'Véhicule'} — {v.licensePlate ?? 'sans plaque'}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setOrdreDesc(d => !d)}
            aria-pressed={ordreDesc}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors',
              ordreDesc
                ? 'bg-blue-600/20 text-blue-300 border-blue-500/30'
                : 'text-slate-400 border-white/10 hover:bg-white/[0.05]',
            )}
            title="Inverser l’ordre chronologique"
          >
            <ListFilter className="w-3.5 h-3.5" />
            {ordreDesc ? 'Plus récents d’abord' : 'Chronologique'}
          </button>
          {filtresActifs && (
            <button
              type="button"
              onClick={reinitialiserFiltres}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-100 hover:bg-white/[0.07] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Effacer les filtres
            </button>
          )}
        </div>
      </div>

      {/* ── États ─────────────────────────────────────────────────────────── */}
      {erreur && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
          <span>{erreur}</span>
        </div>
      )}

      {chargement ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
        </div>
      ) : rdvs.length === 0 ? (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-10 text-center">
          <CalendarClock className="w-6 h-6 text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-400">
            {filtresActifs ? 'Aucun rendez-vous ne correspond à ces filtres.' : 'Aucun rendez-vous enregistré.'}
          </p>
          {!filtresActifs && (
            <p className="text-[11px] text-slate-600 mt-1">
              Les demandes de vos clients apparaissent ici dès qu’elles arrivent de leur espace.
            </p>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rdvs.map(rdv => {
            const etatOuvert = ouvert === rdv.id
            const edition = enEdition === rdv.id
            const enCours = occupe === rdv.id
            const modifiable = canModifyAppointment(rdv.status as AppointmentStatus)
            return (
              <li
                key={rdv.id}
                className={cn(
                  'rounded-xl border bg-white/[0.02] transition-colors',
                  rdvACibler === rdv.id ? 'border-blue-500/50' : 'border-white/[0.08]',
                )}
              >
                {/* Ligne principale */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                  <div className="w-[13.5rem] flex-shrink-0">
                    <p className="text-xs font-semibold text-white first-letter:uppercase">{libelleDate(rdv.date)}</p>
                    <p className="text-[11px] text-slate-500">
                      {rdv.startTime} · {rdv.durationMin} min
                    </p>
                  </div>

                  <div className="w-[13rem] flex-shrink-0 min-w-0">
                    <p className="text-xs text-slate-200 truncate">{nomClient(rdv)}</p>
                    <p className="text-[11px] text-slate-500 truncate">
                      {vehiculeTexte(rdv)} · {plaqueTexte(rdv)}
                    </p>
                  </div>

                  <p className="flex-1 min-w-[10rem] text-xs text-slate-400 truncate">{rdv.reason}</p>

                  <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold border flex-shrink-0', TEINTE_STATUT(rdv.status))}>
                    {TEXTE_STATUT(rdv.status)}
                  </span>

                  <button
                    type="button"
                    onClick={() => setOuvert(etatOuvert ? null : rdv.id)}
                    aria-expanded={etatOuvert}
                    className="gf-touch flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-slate-400 hover:text-slate-100 hover:bg-white/[0.07] transition-colors"
                  >
                    {etatOuvert ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    Détails
                  </button>
                </div>

                {/* Détail + actions */}
                {etatOuvert && (
                  <div className="border-t border-white/[0.07] px-3 py-3 flex flex-col gap-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px] text-slate-400">
                      <div className="flex flex-col gap-1">
                        <span className="text-slate-500">Client</span>
                        <span className="text-slate-200">{nomClient(rdv)}</span>
                        {rdv.clientFiche?.phone && <span>{rdv.clientFiche.phone}</span>}
                        {rdv.clientFiche?.email && <span>{rdv.clientFiche.email}</span>}
                        {!rdv.clientFiche && <span className="text-slate-600">Aucune fiche client rattachée</span>}
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-slate-500">Véhicule</span>
                        <span className="text-slate-200">{vehiculeTexte(rdv)}{rdv.vehiculeFiche?.year ? ` (${rdv.vehiculeFiche.year})` : ''}</span>
                        <span>Plaque : {plaqueTexte(rdv)}</span>
                        {!rdv.vehiculeFiche && <span className="text-slate-600">Aucune fiche véhicule rattachée</span>}
                      </div>
                    </div>

                    {rdv.notes && (
                      <div className="text-[11px] text-slate-400">
                        <span className="text-slate-500">Notes : </span>{rdv.notes}
                      </div>
                    )}

                    {rdv.portalUserId && (
                      <p className="text-[11px] text-amber-300/90">
                        Demande reçue depuis l’espace client.
                      </p>
                    )}

                    {/* Actions de fiche */}
                    <div className="flex flex-wrap items-center gap-2">
                      {rdv.clientId && onOpenClient && (
                        <button
                          type="button"
                          onClick={() => onOpenClient(rdv.clientId as string)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] border border-white/10 text-slate-300 hover:bg-white/[0.07] transition-colors"
                        >
                          <User className="w-3.5 h-3.5" /> Fiche client
                        </button>
                      )}
                      {rdv.vehicleId && onOpenVehicle && (
                        <button
                          type="button"
                          onClick={() => onOpenVehicle(rdv.vehicleId as string)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] border border-white/10 text-slate-300 hover:bg-white/[0.07] transition-colors"
                        >
                          <Car className="w-3.5 h-3.5" /> Fiche véhicule
                        </button>
                      )}

                      {peutDecider && !edition && (
                        <button
                          type="button"
                          onClick={() => ouvrirEdition(rdv)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] border border-white/10 text-slate-300 hover:bg-white/[0.07] transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" /> Modifier
                        </button>
                      )}

                      {/* Transitions autorisées par la machine à états */}
                      {peutDecider && rdv.status === 'requested' && (
                        <button
                          type="button"
                          disabled={enCours}
                          onClick={() => void decider(rdv, 'confirm')}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" /> Confirmer
                        </button>
                      )}
                      {peutDecider && rdv.status === 'confirmed' && (
                        <button
                          type="button"
                          disabled={enCours}
                          onClick={() => void decider(rdv, 'complete')}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] border border-blue-500/25 text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-50"
                        >
                          <Flag className="w-3.5 h-3.5" /> Terminé
                        </button>
                      )}
                      {peutDecider && modifiable && (
                        <button
                          type="button"
                          disabled={enCours}
                          onClick={() => void decider(rdv, 'cancel')}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] border border-red-500/25 text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                        >
                          <XCircle className="w-3.5 h-3.5" /> Annuler
                        </button>
                      )}
                      {!peutDecider && (
                        <span className="text-[11px] text-slate-600">
                          Consultation seule : décider d’un rendez-vous demande le droit de gérer les interventions.
                        </span>
                      )}
                    </div>

                    {/* Formulaire de modification */}
                    {edition && (
                      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="text-[11px] text-slate-500 flex items-center gap-1.5">
                            Date
                            <input
                              type="date"
                              value={brouillon.date}
                              onChange={e => setBrouillon(b => ({ ...b, date: e.target.value }))}
                              className={CHAMP}
                            />
                          </label>
                          <label className="text-[11px] text-slate-500 flex items-center gap-1.5">
                            Heure
                            <input
                              type="time"
                              value={brouillon.startTime}
                              onChange={e => setBrouillon(b => ({ ...b, startTime: e.target.value }))}
                              className={CHAMP}
                            />
                          </label>
                          <label className="text-[11px] text-slate-500 flex items-center gap-1.5">
                            Durée (min)
                            <input
                              type="number"
                              min={15}
                              max={600}
                              step={15}
                              value={brouillon.durationMin}
                              onChange={e => setBrouillon(b => ({ ...b, durationMin: Number(e.target.value) }))}
                              className={cn(CHAMP, 'w-20')}
                            />
                          </label>
                        </div>
                        <label className="text-[11px] text-slate-500 flex flex-col gap-1">
                          Motif
                          <input
                            value={brouillon.reason}
                            onChange={e => setBrouillon(b => ({ ...b, reason: e.target.value }))}
                            className={cn(CHAMP, 'w-full')}
                          />
                        </label>
                        <label className="text-[11px] text-slate-500 flex flex-col gap-1">
                          Notes internes
                          <textarea
                            value={brouillon.notes}
                            onChange={e => setBrouillon(b => ({ ...b, notes: e.target.value }))}
                            rows={2}
                            className={cn(CHAMP, 'w-full resize-y')}
                          />
                        </label>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={enCours}
                            onClick={() => void enregistrer(rdv)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50"
                          >
                            <Save className="w-3.5 h-3.5" /> Enregistrer
                          </button>
                          <button
                            type="button"
                            onClick={() => setEnEdition(null)}
                            className="px-3 py-1.5 rounded-lg text-[11px] text-slate-400 hover:text-slate-100 hover:bg-white/[0.07] transition-colors"
                          >
                            Annuler la modification
                          </button>
                          {rdv.portalUserId && (
                            <span className="text-[11px] text-amber-300/90">
                              Rendez-vous venu de l’espace client : prévenez-le du nouveau créneau.
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {!chargement && rdvs.length > 0 && total > rdvs.length && (
        <p className="text-[11px] text-slate-500 text-center">
          {rdvs.length} rendez-vous affichés sur {total}. Affinez les filtres pour voir les autres.
        </p>
      )}
    </div>
  )
}
