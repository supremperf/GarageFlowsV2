'use client'

/**
 * Error boundary de segment (AUD-027 + observabilité V-bugfix).
 *
 * Sans elle, une exception de rendu dans l'un des ~25 panneaux/modales montés
 * dans src/app/page.tsx fait tomber TOUTE l'application sur l'écran d'erreur
 * générique de Next, sans message métier ni reprise. Cette frontière capture
 * l'erreur, la journalise, et propose de réessayer (reset) sans recharger.
 *
 * Observabilité :
 *  - un IDENTIFIANT DE CORRÉLATION (GF-ERR-AAAAMMJJ-XXXXXX) est généré, affiché à
 *    l'utilisateur et journalisé → il permet de relier un rapport utilisateur au
 *    log correspondant.
 *  - en DÉVELOPPEMENT : message + stack + digest sont montrés (diagnostic de la
 *    vraie exception derrière l'écran générique — Phase 1).
 *  - en PRODUCTION : AUCUN détail technique n'est exposé (pas de fuite) ; seuls le
 *    message générique et l'identifiant de corrélation apparaissent.
 */
import { useEffect, useState } from 'react'

const IS_DEV = process.env.NODE_ENV !== 'production'

function makeCorrelationId(seed: string): string {
  const d = new Date()
  const day = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
  // Suffixe court, non cryptographique, stable pour CETTE erreur : dérivé du
  // seed (digest/message) + minute — sert uniquement à corréler un rapport au log.
  let h = 0
  const base = `${seed}|${d.getUTCHours()}:${d.getUTCMinutes()}`
  for (let i = 0; i < base.length; i++) h = (Math.imul(31, h) + base.charCodeAt(i)) | 0
  const suffix = (h >>> 0).toString(16).toUpperCase().padStart(6, '0').slice(0, 6)
  return `GF-ERR-${day}-${suffix}`
}

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [correlationId, setCorrelationId] = useState('')

  useEffect(() => {
    const id = makeCorrelationId(error?.digest || error?.message || 'unknown')
    setCorrelationId(id)
    // Journalisation structurée (console — captée par l'instrumentation Electron/
    // serveur). JAMAIS de secret ici : uniquement message/stack/digest de l'erreur.
    // eslint-disable-next-line no-console
    console.error('[app-error-boundary]', {
      correlationId: id,
      message: error?.message,
      digest: error?.digest ?? null,
      stack: IS_DEV ? error?.stack : undefined,
    })
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

      {correlationId && (
        <p style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
          Référence : {correlationId}
        </p>
      )}

      {/* DÉVELOPPEMENT uniquement : la vraie exception, pour diagnostiquer. */}
      {IS_DEV && (error?.message || error?.stack) && (
        <details style={devBox}>
          <summary style={{ cursor: 'pointer', color: '#f87171', fontWeight: 600 }}>
            Détails (développement uniquement)
          </summary>
          <div style={{ marginTop: 8, color: '#fca5a5', fontWeight: 600 }}>{error.message}</div>
          {error.digest && <div style={{ marginTop: 4, color: '#94a3b8' }}>digest: {error.digest}</div>}
          {error.stack && <pre style={preStack}>{error.stack}</pre>}
        </details>
      )}

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
const devBox: React.CSSProperties = {
  maxWidth: 640, width: '100%', background: '#0d1424', border: '1px solid #7f1d1d',
  borderRadius: 8, padding: 12, fontSize: 12, color: '#e2e8f0', textAlign: 'left',
}
const preStack: React.CSSProperties = {
  marginTop: 8, maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap',
  wordBreak: 'break-word', fontSize: 11, color: '#94a3b8',
}
const btnPrimary: React.CSSProperties = {
  background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8,
  padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
}
const btnGhost: React.CSSProperties = {
  background: 'transparent', color: '#cbd5e1', border: '1px solid #334155',
  borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
}
