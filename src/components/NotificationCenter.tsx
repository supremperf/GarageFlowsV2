'use client'

/**
 * Centre de notifications GarageFlow (renderer).
 *
 * - Récupère les notifications ciblées via le pont Electron (le processus
 *   principal les obtient du serveur : /api/notifications).
 * - Cloche + panneau déroulant, badge « non lues ».
 * - Les notifications « obligatoires » non acquittées s'affichent en surimpression
 *   bloquante : l'utilisateur doit cliquer « J'ai compris » (→ ack serveur) avant
 *   de continuer à utiliser le logiciel.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, X, AlertTriangle, Info, Wrench, Gift, DownloadCloud } from 'lucide-react'

interface Notif {
  id: string
  title: string
  body: string
  level: string
  mandatory: boolean
  link: string | null
  createdAt: string
  read: boolean
  acknowledged: boolean
}

function getElectronAPI(): any {
  if (typeof window === 'undefined') return null
  return (window as any).electronAPI ?? null
}

function levelIcon(level: string) {
  switch (level) {
    case 'critical':
    case 'warning':
      return <AlertTriangle className="text-amber-400" />
    case 'maintenance':
      return <Wrench className="text-sky-400" />
    case 'promo':
      return <Gift className="text-fuchsia-400" />
    case 'release':
      return <DownloadCloud className="text-emerald-400" />
    default:
      return <Info className="text-sky-400" />
  }
}

export default function NotificationCenter() {
  const [notifs, setNotifs] = useState<Notif[]>([])
  const [open, setOpen] = useState(false)

  const api = getElectronAPI()
  const enabled = !!api?.getNotifications

  const load = useCallback(async () => {
    if (!enabled) return
    try {
      const r = await api.getNotifications()
      if (Array.isArray(r?.notifications)) setNotifs(r.notifications)
    } catch {
      /* fail-open */
    }
  }, [api, enabled])

  useEffect(() => {
    if (!enabled) return
    load()
    const unsub = api.onNotifications?.((info: { notifications?: Notif[] }) => {
      if (Array.isArray(info?.notifications)) setNotifs(info.notifications)
    })
    return () => {
      if (unsub) unsub()
    }
  }, [api, enabled, load])

  const ack = useCallback(
    async (id: string) => {
      try {
        await api?.ackNotification?.(id)
      } catch {
        /* ignore */
      }
      setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, acknowledged: true, read: true } : n)))
    },
    [api],
  )

  const unread = useMemo(() => notifs.filter((n) => !n.read).length, [notifs])
  const blocking = useMemo(() => notifs.find((n) => n.mandatory && !n.acknowledged) ?? null, [notifs])

  if (!enabled) return null

  return (
    <>
      {/* Cloche */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-slate-300 transition hover:bg-white/10 hover:text-white"
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Panneau */}
      {open && (
        <div className="fixed right-4 top-14 z-[9998] w-[360px] max-w-[92vw] overflow-hidden rounded-2xl border border-white/10 bg-slate-900/95 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <h3 className="text-sm font-semibold text-white">Notifications</h3>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white" aria-label="Fermer">
              <X size={16} />
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {notifs.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">Aucune notification.</p>
            ) : (
              notifs.map((n) => (
                <div key={n.id} className={`border-b border-white/5 px-4 py-3 ${!n.read ? 'bg-white/5' : ''}`}>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5">{levelIcon(n.level)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-white">{n.title}</p>
                        {n.mandatory && (
                          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                            Important
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 whitespace-pre-line text-xs text-slate-300">{n.body}</p>
                      {n.link && (
                        <a href={n.link} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-sky-400 hover:underline">
                          En savoir plus
                        </a>
                      )}
                      <p className="mt-1 text-[10px] text-slate-500">{new Date(n.createdAt).toLocaleString('fr-FR')}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Surimpression bloquante pour les notifications obligatoires */}
      {blocking && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-3 flex items-center gap-2 text-amber-400">
              {levelIcon(blocking.level)}
              <h2 className="text-lg font-semibold text-white">{blocking.title}</h2>
            </div>
            <p className="whitespace-pre-line text-sm text-slate-200">{blocking.body}</p>
            {blocking.link && (
              <a href={blocking.link} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-sky-400 hover:underline">
                En savoir plus
              </a>
            )}
            <button
              onClick={() => ack(blocking.id)}
              className="mt-5 w-full rounded-lg bg-amber-500 px-4 py-2.5 font-medium text-slate-900 transition hover:bg-amber-400"
            >
              J&apos;ai compris
            </button>
          </div>
        </div>
      )}
    </>
  )
}
