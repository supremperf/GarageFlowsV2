'use client'

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

let openCount = 0
function lockScroll() {
  openCount += 1
  document.documentElement.classList.add('gf-scroll-locked')
  document.body.classList.add('gf-scroll-locked')
}
function unlockScroll() {
  openCount = Math.max(0, openCount - 1)
  if (openCount === 0) {
    document.documentElement.classList.remove('gf-scroll-locked')
    document.body.classList.remove('gf-scroll-locked')
  }
}

interface GfDrawerProps {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  /** `bottom` = bottom-sheet (mobile portrait) · `right` = drawer latéral. */
  side?: 'bottom' | 'right'
  /** Largeur du drawer latéral (desktop/tablette). Plein écran en dessous de sm. */
  widthClass?: string
  /** Hauteur max du bottom-sheet. */
  heightClass?: string
  headerRight?: React.ReactNode
  children: React.ReactNode
  /** Padding safe-area + interne appliqué à la zone de contenu. */
  bodyClassName?: string
  ariaLabel?: string
}

/**
 * Panneau superposé mobile réutilisable (bottom-sheet ou drawer latéral).
 *
 * - Fond bloqué à l'ouverture, restauré à la fermeture.
 * - Fermeture par Échap (desktop), clic sur le fond, bouton ✕ toujours visible.
 * - Restaure le focus sur l'élément déclencheur à la fermeture.
 * - Respecte les zones sûres iOS (encoche, barre d'accueil).
 */
export default function GfDrawer({
  open,
  onClose,
  title,
  side = 'bottom',
  widthClass = 'sm:w-[420px]',
  heightClass = 'max-h-[88dvh]',
  headerRight,
  children,
  bodyClassName,
  ariaLabel,
}: GfDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = (document.activeElement as HTMLElement) ?? null
    lockScroll()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    // Focus le panneau pour capter le clavier / lecteurs d'écran.
    requestAnimationFrame(() => panelRef.current?.focus())
    return () => {
      document.removeEventListener('keydown', onKey)
      unlockScroll()
      restoreFocusRef.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  const isBottom = side === 'bottom'

  return (
    <div
      className="fixed inset-0 z-[95] flex"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? (typeof title === 'string' ? title : 'Panneau')}
    >
      {/* Fond */}
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-backdrop"
        tabIndex={-1}
      />

      {/* Panneau */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          'relative z-[1] bg-[#0f1629] border-white/[0.08] flex flex-col outline-none shadow-2xl shadow-black/50',
          isBottom
            ? cn('mt-auto w-full rounded-t-2xl border-t animate-sheet-up', heightClass)
            : cn('ml-auto h-full w-full border-l animate-drawer-right', widthClass),
        )}
      >
        {/* En-tête fixe */}
        {(title || headerRight) && (
          <div className={cn(
            'flex items-center gap-2 px-4 py-3 border-b border-white/[0.07] flex-shrink-0',
            isBottom ? 'pt-3' : 'pt-safe',
          )}>
            {isBottom && (
              <span className="absolute left-1/2 -translate-x-1/2 top-1.5 h-1 w-10 rounded-full bg-white/15" aria-hidden />
            )}
            <div className="flex-1 min-w-0 font-semibold text-slate-200 text-sm truncate">
              {title}
            </div>
            {headerRight}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer le panneau"
              className="gf-touch gf-close flex items-center justify-center w-9 h-9 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/[0.08] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Corps défilant */}
        <div className={cn(
          'flex-1 overflow-y-auto overscroll-contain',
          isBottom ? 'pb-safe-3' : 'pb-safe',
          bodyClassName ?? 'p-3',
        )}>
          {children}
        </div>
      </div>
    </div>
  )
}
