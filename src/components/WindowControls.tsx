'use client'

import { useEffect, useState } from 'react'
import { Minus, Maximize2, Minimize2, X } from 'lucide-react'
import { useElectronApi } from '@/lib/use-electron-api'

export default function WindowControls() {
  const [isMaximized,   setIsMaximized]   = useState(false)
  const [isFullscreen,  setIsFullscreen]  = useState(false)

  // Lu APRÈS montage (voir useElectronApi) : `winAPI` pilote un `return null`,
  // donc le lire pendant le rendu faisait diverger le premier rendu client du
  // HTML serveur — le Header étant présent sur toutes les pages authentifiées.
  const winAPI = useElectronApi<any>()?.windowAPI

  useEffect(() => {
    if (!winAPI) return

    // Sync initial maximized state
    winAPI.isMaximized().then((v: boolean) => setIsMaximized(v))

    const unsubMax  = winAPI.onMaximizedChange((v: boolean)  => setIsMaximized(v))
    const unsubFull = winAPI.onFullscreenChange((v: boolean) => setIsFullscreen(v))

    return () => {
      unsubMax?.()
      unsubFull?.()
    }
  }, [winAPI])

  if (!winAPI) return null

  const btnBase =
    'w-8 h-8 flex items-center justify-center rounded-md text-slate-400 hover:text-white transition-colors'

  return (
    <div
      className="flex items-center gap-1"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* Minimize */}
      <button
        onClick={() => winAPI.minimize()}
        className={`${btnBase} hover:bg-slate-700`}
        title="Réduire"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>

      {/* Maximize / Restore */}
      <button
        onClick={() => winAPI.maximizeToggle()}
        className={`${btnBase} hover:bg-slate-700`}
        title={isMaximized || isFullscreen ? 'Restaurer' : 'Agrandir'}
      >
        {isMaximized || isFullscreen
          ? <Minimize2 className="w-3.5 h-3.5" />
          : <Maximize2 className="w-3.5 h-3.5" />}
      </button>

      {/* Close */}
      <button
        onClick={() => winAPI.close()}
        className={`${btnBase} hover:bg-red-600`}
        title="Fermer"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
