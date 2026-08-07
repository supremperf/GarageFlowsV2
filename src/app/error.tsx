'use client'

/**
 * Error boundary de segment (AUD-027).
 *
 * Sans elle, une exception de rendu dans l'un des ~25 panneaux/modales montés
 * dans src/app/page.tsx fait tomber TOUTE l'application sur l'écran d'erreur
 * générique de Next, sans message métier ni reprise. Cette frontière capture
 * l'erreur, la journalise (remontée d'instrumentation), et propose de réessayer
 * (reset) sans recharger toute la page.
 */
import { useEffect } from 'react'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Journalisation (visible en console + captée par l'instrumentation serveur
    // via les Server Actions/RSC ; côté client, au moins tracée).
    // eslint-disable-next-line no-console
    console.error('[app-error-boundary]', error?.message, error?.digest ?? '')
  }, [error])

  return (
    <div role="alert" style={wrap}>
      <div style={{ fontSize: 44 }}>⚠</div>
      <h1 style={{ fontSize: 18, fontWeight: 700, color: '#f87171', margin: 0 }}>
        Une erreur est survenue
      </h1>
      <p style={{ fontSize: 13, color: '#94a3b8', maxWidth: 420, textAlign: 'center' }}>
        Cette section n’a pas pu s’afficher. Vos données ne sont pas perdues. Vous
        pouvez réessayer ; si le problème persiste, rechargez l’application.
      </p>
      <div style={{ display: 'flex', gap: 10 }}>
        <button style={btnPrimary} onClick={() => reset()}>Réessayer</button>
        <button style={btnGhost} onClick={() => { if (typeof window !== 'undefined') window.location.reload() }}>
          Recharger
        </button>
      </div>
    </div>
  )
}

const wrap: React.CSSProperties = {
  minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', gap: 14, padding: 24, background: 'var(--bg, #070d1b)',
}
const btnPrimary: React.CSSProperties = {
  background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8,
  padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
}
const btnGhost: React.CSSProperties = {
  background: 'transparent', color: '#cbd5e1', border: '1px solid #334155',
  borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
}
