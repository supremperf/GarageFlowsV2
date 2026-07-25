'use client'
import { useEffect } from 'react'

interface Handlers {
  onNewJob?:    () => void  // N key (not in input)
  onSearch?:    () => void  // F key (not in input)
  onSave?:      () => void  // Ctrl+S / Cmd+S
  onClose?:     () => void  // Escape
  onRefresh?:   () => void  // F5
  onPrevDay?:   () => void  // ArrowLeft (not in input)
  onNextDay?:   () => void  // ArrowRight (not in input)
}

export function useKeyboardShortcuts(handlers: Handlers) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      const inInput = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target as HTMLElement)?.isContentEditable

      // Ctrl/Cmd+S — save (allowed inside inputs)
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handlers.onSave?.()
        return
      }

      // F5 — refresh app data
      if (e.key === 'F5') {
        e.preventDefault()
        handlers.onRefresh?.()
        return
      }

      // Escape — close modal
      if (e.key === 'Escape') {
        handlers.onClose?.()
        return
      }

      // Single-key shortcuts only outside of inputs
      if (inInput) return

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        handlers.onNewJob?.()
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        handlers.onSearch?.()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handlers.onPrevDay?.()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        handlers.onNextDay?.()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handlers])
}
