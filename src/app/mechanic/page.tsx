'use client'

/**
 * Espace MÉCANICIEN — planning personnel.
 *
 * Le mécanicien voit UNIQUEMENT ses interventions attribuées (l'API filtre côté
 * serveur sur garageId + mechanicId de la session signée ; aucun paramètre
 * client ne peut élargir le périmètre). Responsive mobile portrait/paysage,
 * tablette et desktop.
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Loader2, LogOut, ChevronLeft, ChevronRight, Clock, AlertTriangle, Wrench, Car, User, RefreshCw,
  WifiOff,
} from 'lucide-react'
import { mechFetch, mechanicLogout } from '@/lib/mechanic-client'
import { useMechanicLive } from '@/lib/use-mechanic-live'
import MechanicAvatar from '@/components/MechanicAvatar'

interface Job {
  id: string
  date: string
  startTime: string
  estimatedDuration: number
  actualDuration: number | null
  status: string
  repairType: string
  isUrgent: boolean
  vehicleModel: string
  licensePlate: string | null
  customerName: string
  notes: string | null
  timerStartedAt: string | null
  delayMinutes: number | null
}

interface Me {
  mechanic: {
    id: string; name: string; avatar: string; color: string
    /** URL servie de la photo de profil, ou `null` si le mécanicien n'en a pas. */
    avatarUrl?: string | null
  } | null
  garage: { name: string } | null
  license: { expiryAt: string } | null
}

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Prévu',
  in_progress: 'En cours',
  completed: 'Terminé',
  cancelled: 'Annulé',
}
const STATUS_STYLE: Record<string, string> = {
  scheduled: 'bg-slate-500/15 text-slate-300',
  in_progress: 'bg-blue-500/15 text-blue-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  cancelled: 'bg-red-500/15 text-red-300',
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

export default function MechanicPlanningPage() {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [date, setDate] = useState(todayIso())

  // Le profil était chargé UNE SEULE FOIS au montage. Une photo ajoutée par le
  // patron atteignait donc le cloud en quelques centaines de millisecondes, mais
  // le mécanicien ne la voyait qu'à la prochaine ouverture de l'application —
  // c'est-à-dire, en atelier, le lendemain. On le recharge donc au retour au
  // premier plan : pas de sondage périodique (le profil change rarement), mais
  // plus de photo bloquée sur l'écran pendant des heures.
  useEffect(() => {
    let annule = false
    const charger = () => {
      mechFetch<Me>('/api/mechanic/me').then(m => { if (!annule) setMe(m) }).catch(() => {})
    }
    charger()
    const auRetour = () => { if (document.visibilityState === 'visible') charger() }
    document.addEventListener('visibilitychange', auRetour)
    window.addEventListener('online', charger)
    return () => {
      annule = true
      document.removeEventListener('visibilitychange', auRetour)
      window.removeEventListener('online', charger)
    }
  }, [])

  // SYNCHRONISATION VIVANTE — une intervention créée ou réaffectée côté garage
  // apparaît (ou disparaît) ici en quelques secondes, sans reconnexion, sans
  // fermeture de l'application et sans vidage de cache. Cf. lib/live-sync.ts
  // pour le choix du transport et la politique de cadence/backoff.
  const { data, error, loading, lastSyncAt, refresh, echecsConsecutifs } = useMechanicLive<{
    data: Job[]
    window?: { from: string; to: string }
    outOfWindow?: boolean
  }>(
    `/api/mechanic/schedule?date=${encodeURIComponent(date)}`,
  )
  const jobs = data?.data ?? []

  // ── En dehors de la fenêtre synchronisée, on le DIT (GF-038) ───────────────
  // Le miroir cloud n'est tenu à jour que sur [J−7, J+30]. Au-delà, ce qui
  // s'afficherait serait figé — une affectation peut-être révoquée depuis des
  // semaines. Le serveur ne sert donc plus rien, et les flèches s'arrêtent aux
  // bornes plutôt que de mener à un écran vide sans explication.
  const fenetre = data?.window
  const horsFenetre = data?.outOfWindow === true
  const avantPossible = !fenetre || shiftDate(date, -1) >= fenetre.from
  const apresPossible = !fenetre || shiftDate(date, 1) <= fenetre.to

  return (
    <div className="mx-auto max-w-2xl px-4 pt-safe pb-safe-3">
      {/* En-tête */}
      <header className="flex items-center justify-between py-4 sticky top-0 bg-[#0a0f1e]/95 backdrop-blur z-10">
        <div className="flex items-center gap-3 min-w-0">
          {/* La PWA affichait un carré coloré portant les INITIALES et rien
              d'autre : la photo synchronisée depuis le poste arrivait bien
              jusqu'au cloud, mais le mécanicien ne la voyait jamais. */}
          <MechanicAvatar
            mechanic={me?.mechanic ?? { name: 'Mécanicien' }}
            size={40}
            className="rounded-xl"
          />
          <div className="min-w-0">
            <p className="font-bold text-white truncate">{me?.mechanic?.name ?? 'Mécanicien'}</p>
            <p className="text-xs text-slate-500 truncate">{me?.garage?.name ?? ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Ce qui est affiché est-il encore à jour ?
              Sans ce signal, un planning ancien s'affichait avec l'assurance
              d'un planning frais : le mécanicien ne pouvait pas savoir que le
              rafraîchissement échouait, et travaillait sur une donnée périmée
              en croyant l'inverse. */}
          {echecsConsecutifs > 0 && (
            <span
              title={lastSyncAt
                ? `Dernière synchronisation réussie à ${new Date(lastSyncAt).toLocaleTimeString('fr-FR')}`
                : 'Aucune synchronisation réussie'}
              className="flex items-center gap-1 text-[11px] font-medium text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-full px-2 py-1"
            >
              <WifiOff className="w-3 h-3" />
              {lastSyncAt
                ? `à jour à ${new Date(lastSyncAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
                : 'hors ligne'}
            </span>
          )}
          <button
            onClick={refresh}
            title={lastSyncAt ? `Synchronisé à ${new Date(lastSyncAt).toLocaleTimeString('fr-FR')}` : 'Synchroniser'}
            aria-label="Synchroniser maintenant"
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-blue-400 px-2 py-2 rounded-lg hover:bg-white/5 transition"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => mechanicLogout()}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-red-400 px-3 py-2 rounded-lg hover:bg-white/5 transition"
          >
            <LogOut className="w-4 h-4" /> Quitter
          </button>
        </div>
      </header>

      {/* Navigation date */}
      <div className="flex items-center justify-between gap-2 mb-4 bg-[#111827] rounded-xl p-2 border border-white/[0.06]">
        <button
          onClick={() => setDate(shiftDate(date, -1))}
          disabled={!avantPossible}
          className="p-2 rounded-lg hover:bg-white/5 text-slate-300 disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="Jour précédent"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold text-white capitalize">{prettyDate(date)}</p>
          {date !== todayIso() && (
            <button onClick={() => setDate(todayIso())} className="text-[11px] text-blue-400 hover:text-blue-300">Aujourd&apos;hui</button>
          )}
        </div>
        <button
          onClick={() => setDate(shiftDate(date, 1))}
          disabled={!apresPossible}
          className="p-2 rounded-lg hover:bg-white/5 text-slate-300 disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="Jour suivant"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {horsFenetre && (
        <div className="mb-3 rounded-lg border border-slate-500/25 bg-slate-500/10 px-3 py-2 text-[11px] text-slate-300">
          Cette date sort du planning synchronisé. Revenez vers aujourd&apos;hui pour
          voir vos interventions à jour.
        </div>
      )}

      {/* Bandeau d'erreur NON bloquant : si le réseau retombe, on continue
          d'afficher la dernière liste connue plutôt que de vider l'écran. */}
      {error && jobs.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          Hors ligne — dernières données connues. Reconnexion automatique.
        </div>
      )}

      {/* Liste */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>
      ) : error && jobs.length === 0 ? (
        <div className="text-center py-16 text-red-400 text-sm">{error}</div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-16 text-slate-500 text-sm">
          <Wrench className="w-8 h-8 mx-auto mb-3 opacity-40" />
          Aucune intervention prévue ce jour.
        </div>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li key={job.id}>
              <button
                onClick={() => router.push(`/mechanic/jobs/${job.id}`)}
                className="w-full text-left bg-[#111827] hover:bg-[#161f33] border border-white/[0.06] rounded-xl p-4 transition active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 text-white font-semibold">
                    <Clock className="w-4 h-4 text-blue-400" />
                    {job.startTime}
                    <span className="text-slate-500 font-normal text-sm">· {job.estimatedDuration} min</span>
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[job.status] ?? 'bg-slate-500/15 text-slate-300'}`}>
                    {STATUS_LABEL[job.status] ?? job.status}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm text-slate-200">
                  <Wrench className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="font-medium">{job.repairType}</span>
                  {job.isUrgent && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                      <AlertTriangle className="w-3 h-3" /> Urgent
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                  <span className="inline-flex items-center gap-1"><Car className="w-3.5 h-3.5" />{job.vehicleModel}{job.licensePlate ? ` · ${job.licensePlate}` : ''}</span>
                  <span className="inline-flex items-center gap-1"><User className="w-3.5 h-3.5" />{job.customerName}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
