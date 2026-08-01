'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CLIENT_BRAND } from '@/config/brand.client'
import { ShieldOff, XCircle, Clock, CheckCircle2 } from 'lucide-react'

interface StatusResult {
  allowed?: boolean
  status?:  'active' | 'revoked' | 'suspended' | 'tampered' | 'unknown' | string
  reason?:  string
}

interface BlockedInfo {
  status: string
  reason: string
}

// How often the running app re-checks its own license status. Kept short so a
// revoke / suspend / reactivate from the admin panel shows up almost instantly.
const POLL_MS = 3000

// Visual + copy for each blocked state. `hint` is the customer-facing message;
// the raw server `reason` is shown underneath as a secondary detail.
const STATUS_CONFIG: Record<
  string,
  { icon: typeof XCircle; color: string; ring: string; title: string; hint: string }
> = {
  revoked: {
    icon:  XCircle,
    color: 'text-red-400',
    ring:  'rgba(239,68,68,0.15)',
    title: 'Compte révoqué',
    hint:  `Votre licence ${CLIENT_BRAND.productName} a été révoquée. L'accès au logiciel est bloqué. Veuillez contacter votre revendeur pour rétablir votre compte.`,
  },
  suspended: {
    icon:  Clock,
    color: 'text-amber-400',
    ring:  'rgba(245,158,11,0.15)',
    title: 'Compte suspendu',
    hint:  `Votre licence ${CLIENT_BRAND.productName} est temporairement suspendue. L'accès est bloqué jusqu'à sa réactivation. Contactez votre revendeur pour plus d'informations.`,
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
  const [info,        setInfo]        = useState<BlockedInfo | null>(null)
  const [reactivated, setReactivated] = useState(false)

  // Live blocked flag — lets us fire "reactivated" only after a real block, and
  // prevents the reactivation timer from clearing a fresh re-block.
  const blockedRef = useRef(false)

  // ── Central state machine, shared by polling AND Electron IPC ────────────────
  const applyStatus = useCallback((res: StatusResult | null) => {
    if (!res) return

    if (res.allowed === false) {
      // Blocked: revoked / suspended / tampered
      const status = String(res.status ?? 'revoked')
      const reason = String(res.reason ?? '')
      blockedRef.current = true
      setReactivated(false)
      setInfo(prev =>
        prev && prev.status === status && prev.reason === reason ? prev : { status, reason }
      )
    } else if (res.status === 'active') {
      // Confirmed active — only a reactivation if we were actually blocked.
      // Never triggered by the fail-open "unknown" status.
      if (blockedRef.current) {
        blockedRef.current = false
        setReactivated(true)
      }
    }
    // status 'unknown' (no cookie / not registered / DB fail-open) → keep state
  }, [])

  // ── Continuous self-check: works in Electron AND on the web, near-instant ────
  useEffect(() => {
    let alive = true

    async function poll() {
      try {
        const r = await fetch('/api/license/status', {
          cache:       'no-store',
          credentials: 'same-origin',
        })
        if (!r.ok) return
        const data = (await r.json()) as StatusResult
        if (alive) applyStatus(data)
      } catch {
        /* offline / transient — fail-open, keep current state */
      }
    }

    poll() // immediate check on mount
    const id = setInterval(poll, POLL_MS)

    // Also re-check the moment the window/tab is focused for instant feedback.
    const onFocus = () => poll()
    const onVisible = () => { if (document.visibilityState === 'visible') poll() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      alive = false
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [applyStatus])

  // ── Electron IPC — instant triggers, also cover a remote license server ──────
  useEffect(() => {
    const electronAPI = (window as any).electronAPI
    if (!electronAPI) return
    const cleanups: Array<() => void> = []

    if (electronAPI.onLicenseRevoked) {
      cleanups.push(
        electronAPI.onLicenseRevoked((d: StatusResult) =>
          applyStatus({ allowed: false, status: d?.status ?? 'revoked', reason: d?.reason })
        )
      )
    }
    if (electronAPI.onLicenseReactivated) {
      cleanups.push(
        electronAPI.onLicenseReactivated(() => applyStatus({ allowed: true, status: 'active' }))
      )
    }

    return () => cleanups.forEach(fn => { try { fn() } catch { /* ignore */ } })
  }, [applyStatus])

  // ── While blocked, swallow keyboard input so global shortcuts (F5 reload,
  //    Ctrl+N…) can't be used behind the overlay. Lifted once reactivated. ─────
  useEffect(() => {
    if (!info || reactivated) return
    const block = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation() }
    window.addEventListener('keydown', block, true)
    return () => window.removeEventListener('keydown', block, true)
  }, [info, reactivated])

  // ── After reactivation: show confirmation briefly, then remove the overlay so
  //    the user resumes exactly where they left off (unless re-blocked meanwhile).
  useEffect(() => {
    if (!reactivated) return
    const t = setTimeout(() => {
      setReactivated(false)
      if (!blockedRef.current) setInfo(null)
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
