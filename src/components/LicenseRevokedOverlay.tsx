'use client'

import { useEffect, useState } from 'react'
import { ShieldOff, XCircle, Clock } from 'lucide-react'

interface RevokedInfo {
  reason: string
  status: 'revoked' | 'suspended' | 'tampered' | string
}

const STATUS_CONFIG: Record<string, { icon: typeof XCircle; color: string; title: string }> = {
  revoked:   { icon: XCircle,   color: 'text-red-400',    title: 'Licence révoquée' },
  suspended: { icon: Clock,     color: 'text-amber-400',  title: 'Licence suspendue' },
  tampered:  { icon: ShieldOff, color: 'text-red-500',    title: 'Sécurité compromise' },
}

export default function LicenseRevokedOverlay() {
  const [info, setInfo] = useState<RevokedInfo | null>(null)

  useEffect(() => {
    const electronAPI = (window as any).electronAPI
    if (!electronAPI?.onLicenseRevoked) return
    const cleanup = electronAPI.onLicenseRevoked((data: RevokedInfo) => {
      setInfo(data)
    })
    return cleanup
  }, [])

  if (!info) return null

  const cfg = STATUS_CONFIG[info.status] ?? STATUS_CONFIG.revoked
  const Icon = cfg.icon

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-md">
      <div className="text-center max-w-sm px-6">
        <div className={`w-20 h-20 rounded-full bg-current/10 flex items-center justify-center mx-auto mb-6 ${cfg.color}`}
          style={{ background: 'rgba(255,59,48,0.15)' }}>
          <Icon className={`w-10 h-10 ${cfg.color}`} />
        </div>
        <h1 className={`text-2xl font-black mb-3 ${cfg.color}`}>{cfg.title}</h1>
        <p className="text-slate-300 text-sm leading-relaxed mb-4">{info.reason}</p>
        <p className="text-slate-600 text-xs">L&apos;application va se fermer automatiquement…</p>
        <div className="mt-6 w-full h-1 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full bg-red-500 rounded-full animate-[shrink_3s_linear_forwards]"
            style={{ animation: 'width 3s linear forwards', width: '100%',
              animationName: 'licenseCountdown' }} />
        </div>
      </div>
    </div>
  )
}
