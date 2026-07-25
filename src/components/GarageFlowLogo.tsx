'use client'

/**
 * GarageFlow official logo — identité officielle.
 * Marque hexagonale métallique argentée formant un « G » traversé par une
 * flèche bleue « Flow ». On utilise directement l'image officielle de la marque
 * (rendu métallique fidèle) plutôt qu'une recréation vectorielle approximative.
 */

import logoMark from './brand/logo-mark.png'

interface Props {
  size?: number
  showText?: boolean
  className?: string
}

export default function GarageFlowLogo({ size = 40, showText = false, className = '' }: Props) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <GarageFlowIcon size={size} />
      {showText && (
        <div className="flex items-baseline font-black tracking-tight leading-none"
          style={{ fontSize: Math.max(14, size * 0.5) }}>
          <span style={{
            background: 'linear-gradient(135deg,#f8fafc,#cbd5e1 45%,#94a3b8)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>GARAGE</span>
          <span style={{
            background: 'linear-gradient(135deg,#60a5fa,#2563eb)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>FLOW</span>
        </div>
      )}
    </div>
  )
}

/** Icône seule — marque officielle (badge sombre + hexagone « G » + flèche bleue). */
export function GarageFlowIcon({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoMark.src}
      alt="GarageFlow"
      width={size}
      height={size}
      draggable={false}
      className={`flex-shrink-0 select-none object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  )
}

/** Lockup en-tête : icône + nom. */
export function GarageFlowLockup({ iconSize = 28 }: { iconSize?: number }) {
  return (
    <div className="flex items-center gap-2">
      <GarageFlowIcon size={iconSize} />
      <span className="font-black tracking-tight leading-none" style={{ fontSize: Math.max(12, iconSize * 0.5) }}>
        <span className="text-slate-100">Garage</span><span className="text-blue-400">Flow</span>
      </span>
    </div>
  )
}
