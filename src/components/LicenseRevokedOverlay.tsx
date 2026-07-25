'use client'

import { useEffect, useRef, useState } from 'react'
import { ShieldOff, XCircle, Clock, CheckCircle2 } from 'lucide-react'

interface RevokedInfo {
  reason: string
  status: 'revoked' | 'suspended' | 'tampered' | string
}

// Visual + copy for each blocked state. `hint` is the customer-facing explanation;
// the raw `reason` from the server is shown underneath as a secondary detail.
const STATUS_CONFIG: Record<
  string,
  { icon: typeof XCircle; color: string; ring: string; title: string; hint: string }
> = {
  revoked: {
    icon:  XCircle,
    color: 'text-red-400',
    ring:  'rgba(239,68,68,0.15)',
    title: 'Compte révoqué',
    hint:  "Votre licence GarageFlow a été révoquée. L'accès au logiciel est bloqué. Veuillez contacter votre revendeur pour rétablir votre compte.",
  },
  suspended: {
    icon:  Clock,
    color: 'text-amber-400',
    ring:  'rgba(245,158,11,0.15)',
    title: 'Compte suspendu',
    hint:  "Votre licence GarageFlow est temporairement suspendue. L'accès est bloqué jusqu'à sa réactivation. Contactez votre revendeur pour plus d'informations.",
  },
  tampered: {
    icon:  ShieldOff,
    color: 'text-red-500',
    ring:  'rgba(239,68,68,0.15)',
    title: 'Sécurité compromise',
    hint:  "L'intégrité de la licence n'a pas pu être vérifiée. Contactez votre revendeur pour rétablir votre compte.",
  },
}

export default function LicenseRevokedOverlay() {
  const [info,        setInfo]        = useState<RevokedInfo | null>(null)
  const [reactivated, setReactivated] = useState(false)
  // Tracks the live blocked state so the reactivation event is only honoured
  // when the app was actually blocked (avoids a stray "reactivated" flash).
  const blockedRef = useRef(false)

  // ── Subscribe to Electron license events ────────────────────────────────────
  useEffect(() => {
    const electronAPI = (window as any).electronAPI
    if (!electronAPI) return

    const cleanups: Array<() => void> = []

    if (electronAPI.onLicenseRevoked) {
      cleanups.push(
        electronAPI.onLicenseRevoked((data: RevokedInfo) => {
          blockedRef.current = true
          setReactivated(false)
          setInfo(data)
        })
      )
    }

    if (electronAPI.onLicenseReactivated) {
      cleanups.push(
        electronAPI.onLicenseReactivated(() => {
          if (!blockedRef.current) return   // wasn't blocked → nothing to lift
          blockedRef.current = false
          setReactivated(true)
        })
      )
    }

    return () => cleanups.forEach(fn => { try { fn() } catch { /* ignore */ } })
  }, [])

  // ── While blocked, swallow keyboard input so global shortcuts (F5 reload,
  //    Ctrl+N…) can't be used behind the overlay. Lifted once reactivated. ─────
  useEffect(() => {
    if (!info || reactivated) return
    const block = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation() }
    window.addEventListener('keydown', block, true)
    return () => window.removeEventListener('keydown', block, true)
  }, [info, reactivated])

  // ── After reactivation, show the confirmation briefly, then let the user
  //    resume exactly where they were by removing the overlay entirely. ────────
  useEffect(() => {
    if (!reactivated) return
    const t = setTimeout(() => {
      setInfo(null)
      setReactivated(false)
    }, 3200)
    return () => clearTimeout(t)
  }, [reactivated])

  if (!info) return null

  // ── Reactivation confirmation screen ────────────────────────────────────────
  if (reactivated) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-md">
        <div className="text-center max-w-md px-6">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
            style={{ background: 'rgba(34,197,94,0.15)' }}
          >
            <CheckCircle2 className="w-10 h-10 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-black mb-3 text-emerald-400">Compte réactivé</h1>
          <p className="text-slate-300 text-sm leading-relaxed mb-2">
            Votre licence a bien été réactivée. Vous pouvez reprendre votre travail.
          </p>
          <p className="text-slate-500 text-xs">Reprise en cours…</p>
        </div>
      </div>
    )
  }

  // ── Blocked screen (revoked / suspended / tampered) — persistent ────────────
  const cfg  = STATUS_CONFIG[info.status] ?? STATUS_CONFIG.revoked
  const Icon = cfg.icon

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-md">
      <div className="text-center max-w-md px-6">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
          style={{ background: cfg.ring }}
        >
          <Icon className={`w-10 h-10 ${cfg.color}`} />
        </div>
        <h1 className={`text-2xl font-black mb-3 ${cfg.color}`}>{cfg.title}</h1>
        <p className="text-slate-300 text-sm leading-relaxed mb-3">{cfg.hint}</p>
        {info.reason && info.reason !== cfg.hint && (
          <p className="text-slate-500 text-xs mb-4">{info.reason}</p>
        )}
        <div className="mt-6 inline-flex items-center gap-2 text-slate-500 text-xs">
          <span className="w-2 h-2 rounded-full bg-slate-500 animate-pulse" />
          En attente de réactivation…
        </div>
      </div>
    </div>
  )
}
