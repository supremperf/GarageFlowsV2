'use client'

/**
 * Error boundary RACINE (AUD-027) — capture les erreurs du layout lui-même.
 * global-error remplace tout le document (elle doit rendre <html>/<body>).
 * Elle n'intervient qu'en dernier recours ; les erreurs de segment sont gérées
 * par src/app/error.tsx.
 */
import { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[global-error-boundary]', error?.message, error?.digest ?? '')
  }, [error])

  return (
    <html lang="fr">
      <body style={{ margin: 0, background: '#070d1b', color: '#94a3b8', fontFamily: 'system-ui' }}>
        <div role="alert" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 }}>
          <div style={{ fontSize: 48 }}>⚠</div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#f87171', margin: 0 }}>Impossible de charger GarageFlows</h1>
          <p style={{ fontSize: 13, maxWidth: 420, textAlign: 'center' }}>
            Une erreur inattendue a interrompu l’application. Vos données ne sont pas perdues.
          </p>
          <button
            style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            onClick={() => reset()}
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  )
}
