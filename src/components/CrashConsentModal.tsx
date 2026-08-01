'use client'

import { useEffect, useState } from 'react'
import { CLIENT_BRAND } from '@/config/brand.client'

/**
 * Écran de consentement (RGPD) pour les rapports de crash — OPT-IN explicite.
 *
 * Ne s'affiche QUE sous Electron et UNIQUEMENT si l'utilisateur n'a pas encore
 * fait de choix (`decided === false`). Aucun rapport n'est envoyé tant que
 * « Autoriser » n'a pas été cliqué. Le choix reste modifiable dans les paramètres.
 */
type ConsentApi = {
  getCrashConsent?: () => Promise<{ consent: boolean; decided: boolean }>
  setCrashConsent?: (value: boolean) => Promise<{ consent: boolean; decided: boolean }>
}

function api(): ConsentApi | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { electronAPI?: ConsentApi }).electronAPI ?? null
}

export default function CrashConsentModal() {
  const [show, setShow] = useState(false)
  const [details, setDetails] = useState(false)

  useEffect(() => {
    const a = api()
    if (!a?.getCrashConsent) return
    a.getCrashConsent()
      .then((r) => { if (r && r.decided === false) setShow(true) })
      .catch(() => {})
  }, [])

  if (!show) return null

  const decide = async (value: boolean) => {
    try { await api()?.setCrashConsent?.(value) } catch { /* ignore */ }
    setShow(false)
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-labelledby="cc-title">
      <div style={card}>
        <h2 id="cc-title" style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>
          Aider à améliorer {CLIENT_BRAND.productName} ?
        </h2>
        <p style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.5, color: '#cbd5e1' }}>
          Avec votre accord, {CLIENT_BRAND.productName} peut envoyer des <strong>rapports de crash techniques</strong>
          {' '}pour corriger les bugs. C&apos;est <strong>facultatif</strong> et désactivé par défaut.
        </p>

        {details && (
          <div style={{ ...box, marginBottom: 12 }}>
            <p style={{ margin: '0 0 6px', fontSize: 13, color: '#e2e8f0' }}>Données transmises (nettoyées) :</p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6 }}>
              <li>message et trace technique de l&apos;erreur</li>
              <li>version de l&apos;app, OS, architecture, CPU/RAM</li>
              <li>identifiant de licence, empreinte machine <em>hachée</em></li>
            </ul>
            <p style={{ margin: '8px 0 0', fontSize: 12.5, color: '#94a3b8' }}>
              Retirés avant envoi : mots de passe, jetons, clés, cookies, URLs de base de données,
              et le nom d&apos;utilisateur dans les chemins de fichiers. <strong>Aucune donnée client
              du garage</strong> n&apos;est transmise.
            </p>
          </div>
        )}

        <button onClick={() => setDetails((d) => !d)} style={linkBtn}>
          {details ? 'Masquer les détails' : 'Voir les détails'}
        </button>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={() => decide(false)} style={btnGhost}>Refuser</button>
          <button onClick={() => decide(true)} style={btnPrimary}>Autoriser</button>
        </div>
      </div>
    </div>
  )
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.72)', backdropFilter: 'blur(2px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16,
}
const card: React.CSSProperties = {
  width: '100%', maxWidth: 460, background: '#0f172a', border: '1px solid #1e293b',
  borderRadius: 14, padding: 22, color: '#f8fafc', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
}
const box: React.CSSProperties = { background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: 12 }
const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#60a5fa', fontSize: 13, cursor: 'pointer', padding: 0, textDecoration: 'underline',
}
const btnBase: React.CSSProperties = { flex: 1, padding: '10px 14px', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' }
const btnPrimary: React.CSSProperties = { ...btnBase, background: '#2563eb', color: '#fff', border: '1px solid #2563eb' }
const btnGhost: React.CSSProperties = { ...btnBase, background: 'transparent', color: '#cbd5e1', border: '1px solid #334155' }
