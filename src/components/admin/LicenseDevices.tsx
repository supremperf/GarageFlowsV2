'use client'

/**
 * Postes activés d'une licence — zone d'administration.
 *
 * ─── Pourquoi ce panneau existe (GF-DUR-010) ────────────────────────────────
 * `GET /api/admin/licenses/[id]/devices` et
 * `POST /api/admin/licenses/[id]/devices/[deviceId]` existaient, éprouvés, et
 * aucun écran ne les appelait. Conséquence concrète pour le support : quand un
 * ordinateur tombait en panne, était volé ou remplacé, **son siège restait pris
 * à vie**.
 *
 * L'auto-désactivation (`/api/license/deactivate`) ne pouvait rien y faire : elle
 * exige le `deviceToken`, que seul l'appareil détient. Une machine morte ne se
 * libère donc pas elle-même — il faut passer par ici. C'était la seule sortie,
 * et elle n'avait pas de porte.
 *
 * ─── Les deux gestes, et ce qui les sépare ──────────────────────────────────
 *   · LIBÉRER (`reset`) — le siège est rendu ET la machine pourra se réactiver.
 *     C'est le geste du SAV : poste remplacé, réinstallation, changement de
 *     matériel.
 *   · RÉVOQUER (`revoke`) — le siège reste compté et la machine est bannie : son
 *     jeton est refusé au prochain battement de cœur, elle ne peut pas revenir.
 *     C'est le geste du poste volé.
 *
 * Les confondre coûte cher dans les deux sens : libérer un poste volé le laisse
 * revenir, révoquer un poste remplacé prive le client d'un siège qu'il a payé.
 * L'écran les nomme donc par leur conséquence, jamais par leur verbe technique.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Monitor, RotateCcw, ShieldX, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'

interface Appareil {
  deviceId: string
  status: string
  name: string | null
  platform: string | null
  appVersion: string | null
  firstActivatedAt: string | null
  lastSeenAt: string | null
  revokedAt: string | null
}

interface Etat {
  seats: number
  activeCount: number
  devices: Appareil[]
}

const LIBELLE: Record<string, string> = {
  active: 'Actif',
  deactivated: 'Libéré par le poste',
  revoked: 'Révoqué',
}

const TEINTE: Record<string, string> = {
  active: 'text-emerald-400 bg-emerald-500/15',
  deactivated: 'text-slate-400 bg-slate-500/15',
  revoked: 'text-red-400 bg-red-500/15',
}

function date(v: string | null) {
  return v ? new Date(v).toLocaleString('fr-FR') : '—'
}

export function LicenseDevices({ licenseId }: { licenseId: number }) {
  const [etat, setEtat] = useState<Etat | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [occupe, setOccupe] = useState<string | null>(null)

  const charger = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/licenses/${licenseId}/devices`, { cache: 'no-store' })
      const d = await r.json().catch(() => null)
      if (!r.ok || !d?.ok) { setErreur(d?.error ?? 'Chargement impossible.'); return }
      setErreur(null)
      setEtat({ seats: d.seats, activeCount: d.activeCount, devices: d.devices ?? [] })
    } catch {
      setErreur('Serveur injoignable.')
    }
  }, [licenseId])

  useEffect(() => { void charger() }, [charger])

  async function agir(deviceId: string, action: 'reset' | 'revoke', motif?: string) {
    setOccupe(deviceId)
    try {
      const r = await fetch(`/api/admin/licenses/${licenseId}/devices/${deviceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(motif ? { reason: motif } : {}) }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d?.error ?? 'Action refusée par le serveur.'); return }
      // L'état vient du serveur, jamais d'une supposition locale : après un
      // `reset` l'appareil DISPARAÎT, après un `revoke` il reste et change de
      // statut. Deviner l'un ou l'autre finirait par mentir.
      await charger()
      toast.success(action === 'reset' ? 'Siège libéré — la machine pourra se réactiver.' : 'Poste révoqué — il ne peut plus revenir.')
    } catch {
      toast.error('Serveur injoignable.')
    } finally {
      setOccupe(null)
    }
  }

  if (erreur) return <p className="text-[11px] text-red-400 mt-3">{erreur}</p>
  if (!etat) return <Loader2 className="w-4 h-4 animate-spin text-slate-600 mt-3" />

  const complet = etat.activeCount >= etat.seats

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[9px] text-slate-600 uppercase tracking-wider font-bold">
          Postes activés
        </p>
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-[10px] font-bold px-2 py-0.5 rounded-full',
            complet ? 'text-amber-400 bg-amber-500/15' : 'text-slate-400 bg-slate-500/15',
          )}>
            {etat.activeCount} / {etat.seats} siège{etat.seats > 1 ? 's' : ''}
          </span>
          <button onClick={charger} aria-label="Actualiser la liste des postes"
            className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] transition-colors">
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {etat.devices.length === 0 ? (
        <p className="text-[11px] text-slate-600 mt-2">Aucun poste activé pour cette licence.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {etat.devices.map((a) => (
            <li key={a.deviceId} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
              <div className="flex items-start gap-2">
                <Monitor className="w-3.5 h-3.5 text-slate-600 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-300 truncate">{a.name ?? 'Poste sans nom'}</span>
                    <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full', TEINTE[a.status] ?? 'text-slate-400 bg-slate-500/15')}>
                      {LIBELLE[a.status] ?? a.status}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-600 mt-0.5">
                    {a.platform ?? 'plateforme inconnue'}
                    {a.appVersion ? ` · v${a.appVersion}` : ''}
                    {' · '}vu le {date(a.lastSeenAt)}
                  </p>
                  <p className="text-[9px] text-slate-700 mt-0.5 font-mono truncate" title={a.deviceId}>
                    {a.deviceId}
                  </p>
                </div>
              </div>

              {a.status !== 'revoked' && (
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => {
                      // Le libellé de la confirmation décrit la CONSÉQUENCE, pas
                      // l'action : « reset » ne dit rien à qui décide.
                      if (!confirm(
                        'Libérer ce siège ?\n\n'
                        + 'La machine pourra se réactiver dès qu’un siège est disponible. '
                        + 'À utiliser pour un poste remplacé ou réinstallé — PAS pour un poste volé.',
                      )) return
                      void agir(a.deviceId, 'reset')
                    }}
                    disabled={occupe !== null}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40 transition-all flex items-center gap-1.5">
                    {occupe === a.deviceId ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                    Libérer le siège
                  </button>
                  <button
                    onClick={() => {
                      const motif = prompt(
                        'Révoquer ce poste ?\n\n'
                        + 'Il sera refusé au prochain contrôle et NE POURRA PAS se réactiver. '
                        + 'Le siège reste compté.\n\nMotif (journalisé) :',
                      )
                      if (motif === null) return
                      void agir(a.deviceId, 'revoke', motif.trim() || undefined)
                    }}
                    disabled={occupe !== null}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-red-500/25 text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-all flex items-center gap-1.5">
                    <ShieldX className="w-3 h-3" />Révoquer
                  </button>
                </div>
              )}
              {a.status === 'revoked' && a.revokedAt && (
                <p className="text-[10px] text-red-400/70 mt-1.5">Révoqué le {date(a.revokedAt)}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
