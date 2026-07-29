'use client'

import { useEffect, useState } from 'react'

/**
 * Invite à l'installation de la PWA :
 *  - Android / Chrome / Edge / desktop : capture `beforeinstallprompt` et affiche
 *    un bouton « Installer l'application » qui déclenche l'invite native.
 *  - iOS (Safari) : pas d'API d'installation → affiche des instructions
 *    « Partager → Sur l'écran d'accueil ».
 *  - Masqué si l'app est déjà installée (mode standalone) ou récemment rejeté.
 */

const DISMISS_KEY = 'gf_install_dismissed_at'
const DISMISS_DAYS = 14

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    // @ts-expect-error — propriété non standard iOS Safari
    window.navigator.standalone === true
  )
}

function isIos(): boolean {
  if (typeof window === 'undefined') return false
  const ua = window.navigator.userAgent
  const iOS = /iphone|ipad|ipod/i.test(ua)
  // iPad iPadOS 13+ se présente comme un Mac tactile.
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return iOS || iPadOS
}

function recentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const then = Number(raw)
    if (!Number.isFinite(then)) return false
    return Date.now() - then < DISMISS_DAYS * 24 * 60 * 60 * 1000
  } catch {
    return false
  }
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosHint, setShowIosHint] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return

    // Android / desktop
    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    // iOS : pas d'événement → on affiche l'aide manuelle sur Safari mobile.
    const isSafari = /^((?!chrome|crios|fxios|edgios).)*safari/i.test(navigator.userAgent)
    if (isIos() && isSafari) {
      setShowIosHint(true)
      setVisible(true)
    }

    const onInstalled = () => {
      setVisible(false)
      setDeferred(null)
      try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch {}
    }
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const dismiss = () => {
    setVisible(false)
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch {}
  }

  const install = async () => {
    if (!deferred) return
    await deferred.prompt()
    try { await deferred.userChoice } catch {}
    setDeferred(null)
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-[9998] flex justify-center p-4 pointer-events-none">
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-white/10 bg-[#161f38]/95 px-4 py-3 shadow-2xl backdrop-blur">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="GarageFlow" width={40} height={40} className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-100">Installer GarageFlow</p>
          {showIosHint ? (
            <p className="text-xs leading-snug text-slate-400">
              Appuyez sur <span className="font-semibold text-slate-200">Partager</span>{' '}
              <span aria-hidden>⬆️</span> puis{' '}
              <span className="font-semibold text-slate-200">« Sur l’écran d’accueil »</span>.
            </p>
          ) : (
            <p className="truncate text-xs text-slate-400">
              Accès plein écran, plus rapide, depuis votre écran d’accueil.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-slate-200"
        >
          {showIosHint ? 'Compris' : 'Plus tard'}
        </button>
        {!showIosHint && (
          <button
            type="button"
            onClick={install}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-500"
          >
            Installer
          </button>
        )}
      </div>
    </div>
  )
}
