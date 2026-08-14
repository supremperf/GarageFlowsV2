'use client'

/**
 * « Mes connexions » — appareils connectés à l'espace client (GF-DUR-012).
 *
 * ─── Pourquoi ce panneau existe ─────────────────────────────────────────────
 * `GET` et `POST /api/portal/auth/devices` existaient, éprouvés, et aucune des
 * cinq pages du portail ne les appelait. Le client ne pouvait donc ni voir où
 * son compte était ouvert, ni fermer une session — pas même après avoir prêté
 * son téléphone ou s'être connecté depuis un poste public.
 *
 * C'est la seule action qu'un client peut entreprendre seul quand il craint que
 * son compte soit ouvert ailleurs : sans elle, il ne lui reste qu'à changer de
 * mot de passe en espérant que cela suffise.
 *
 * ─── Ce que l'écran doit dire, et qu'il serait facile de taire ──────────────
 * Fermer SA PROPRE session déconnecte immédiatement — le serveur efface le
 * cookie. L'écran le dit AVANT, et redirige lui-même vers la connexion : laisser
 * le client cliquer puis découvrir qu'il est dehors le ferait passer pour une
 * panne.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MonitorSmartphone, Loader2, LogOut } from 'lucide-react'
import { lienPortail } from '@/lib/portal/garage-slug'
import { cheminPortail } from '@/lib/portal/routes'

interface Session {
  id: string
  userAgent: string | null
  ipAddress: string | null
  lastSeenAt: string
  createdAt: string
  revoked: boolean
  current: boolean
}

/**
 * Description lisible d'un appareil à partir de son en-tête `User-Agent`.
 *
 * Volontairement grossière : il ne s'agit pas d'identifier un navigateur avec
 * exactitude, mais de permettre à quelqu'un de reconnaître SES appareils. « Un
 * iPhone, Safari » suffit à cela ; la chaîne brute, non.
 */
function appareil(ua: string | null): string {
  if (!ua) return 'Appareil inconnu'
  const systeme = /iPhone|iPad/i.test(ua) ? 'iPhone / iPad'
    : /Android/i.test(ua) ? 'Android'
    : /Mac OS X/i.test(ua) ? 'Mac'
    : /Windows/i.test(ua) ? 'Windows'
    : /Linux/i.test(ua) ? 'Linux'
    : 'Appareil inconnu'
  // L'ordre compte : Edge et Chrome se déclarent aussi « Safari », Chrome se
  // déclare « Edg » sur Edge. Du plus spécifique au plus générique.
  const navigateur = /Edg\//i.test(ua) ? 'Edge'
    : /OPR\//i.test(ua) ? 'Opera'
    : /Firefox\//i.test(ua) ? 'Firefox'
    : /Chrome\//i.test(ua) ? 'Chrome'
    : /Safari\//i.test(ua) ? 'Safari'
    : null
  return navigateur ? `${systeme} · ${navigateur}` : systeme
}

function quand(v: string): string {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-FR')
}

export function PortalSessions() {
  const router = useRouter()
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [occupe, setOccupe] = useState<string | null>(null)

  const charger = useCallback(async () => {
    try {
      const r = await fetch('/api/portal/auth/devices', { cache: 'no-store' })
      const d = await r.json().catch(() => null)
      if (!r.ok || !d) { setErreur('Impossible de charger vos connexions.'); return }
      setErreur(null)
      setSessions(d.devices ?? [])
    } catch {
      setErreur('Serveur injoignable.')
    }
  }, [])

  useEffect(() => { void charger() }, [charger])

  async function fermer(s: Session) {
    if (s.current && !window.confirm(
      'Fermer cette session vous déconnectera immédiatement de cet appareil.\n\nContinuer ?',
    )) return

    setOccupe(s.id)
    try {
      const r = await fetch('/api/portal/auth/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: s.id }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErreur(d?.error ?? 'Fermeture refusée.'); return }
      // Le serveur dit LUI-MÊME si la session fermée était la courante : le
      // déduire du drapeau local se tromperait si la liste avait vieilli.
      if (d.revokedCurrent) { router.replace(lienPortail(cheminPortail('login'))); return }
      await charger()
    } catch {
      setErreur('Serveur injoignable.')
    } finally {
      setOccupe(null)
    }
  }

  if (!sessions && !erreur) {
    return <Loader2 className="h-4 w-4 animate-spin text-slate-600" />
  }
  if (erreur) return <p className="text-xs text-red-400">{erreur}</p>

  const actives = (sessions ?? []).filter((s) => !s.revoked)

  return (
    <div className="space-y-2">
      {actives.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/[0.06] px-3 py-4 text-center text-xs text-slate-600">
          Aucune connexion active.
        </div>
      ) : actives.map((s) => (
        <div key={s.id} className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2">
          <MonitorSmartphone className="h-4 w-4 shrink-0 text-slate-600" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-slate-200">{appareil(s.userAgent)}</span>
              {s.current && (
                <span className="shrink-0 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-bold text-blue-300">
                  cet appareil
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500">
              Vu le {quand(s.lastSeenAt)}
              {/* L'adresse IP aide à reconnaître « chez moi » de « ailleurs ».
                  Elle n'identifie rien à elle seule, et c'est la sienne. */}
              {s.ipAddress ? ` · ${s.ipAddress}` : ''}
            </div>
          </div>
          <button
            onClick={() => fermer(s)}
            disabled={occupe !== null}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
          >
            {occupe === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
            Fermer
          </button>
        </div>
      ))}
    </div>
  )
}
