'use client'

/**
 * Supplier-order status and receipt. Automatic quotes/orders stay disabled until
 * a real supplier integration can verify prices, availability and lead times.
 */
import { useCallback, useEffect, useState } from 'react'
import { X, Truck } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'

/** Bon de commande persisted by the garage (never a generated quote). */
interface BonDeCommande {
  id: string
  number: string
  supplierName: string | null
  status: string
  totalHT: number
  createdAt: string
}

/** Statuts depuis lesquels une réception est encore possible. */
const RECEPTIONNABLES = new Set(['draft', 'sent', 'confirmed'])

const LIBELLE_STATUT: Record<string, string> = {
  draft: 'Brouillon', sent: 'Envoyée', confirmed: 'Confirmée',
  received: 'Réceptionnée', returned: 'Retournée', cancelled: 'Annulée',
}

export default function SuppliersPanel({ onClose }: { onClose: () => void }) {
  const { t, lang } = useTranslation()
  const [bons, setBons] = useState<BonDeCommande[]>([])
  const [chargement, setChargement] = useState(true)
  const [erreurChargement, setErreurChargement] = useState<string | null>(null)
  const [receptionEnCours, setReceptionEnCours] = useState<string | null>(null)
  const [erreurReception, setErreurReception] = useState<string | null>(null)

  const chargerBons = useCallback(async (signal?: AbortSignal) => {
    setChargement(true)
    setErreurChargement(null)
    try {
      const r = await fetch('/api/purchase-orders', { signal })
      const d = await r.json().catch(() => null)
      if (!r.ok || !Array.isArray(d)) {
        setErreurChargement(t.supLoadError)
        return
      }
      setBons(d)
    } catch {
      if (!signal?.aborted) setErreurChargement(t.supLoadError)
    } finally {
      if (!signal?.aborted) setChargement(false)
    }
  }, [t.supLoadError])

  useEffect(() => {
    const controller = new AbortController()
    void chargerBons(controller.signal)
    return () => controller.abort()
  }, [chargerBons])

  /** Réception réelle et confirmée : cette action incrémente le stock. */
  async function receptionner(bon: BonDeCommande) {
    setErreurReception(null)
    setReceptionEnCours(bon.id)
    try {
      const r = await fetch(`/api/purchase-orders/${bon.id}/receive`, { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErreurReception(d?.error ?? 'Réception refusée.')
        return
      }
      await chargerBons()
    } catch {
      setErreurReception('Réception impossible — vérifiez votre connexion.')
    } finally {
      setReceptionEnCours(null)
    }
  }

  return (
    <div style={overlay}>
      <div style={bar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={logo}><Truck size={16} color="#fff" /></div>
          <div>
            <p style={{ color: '#fff', fontSize: 14, fontWeight: 700, lineHeight: 1 }}>{t.supTitle}</p>
            <p style={{ color: '#475569', fontSize: 11 }}>{t.supSubtitle}</p>
          </div>
        </div>
        <button onClick={onClose} style={closeBtn} aria-label={t.uiClose}><X size={16} /></button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 920, margin: '0 auto' }}>
          <section
            role="status"
            style={{ ...card, padding: 20, marginBottom: 18, borderColor: 'rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.06)' }}
          >
            <p style={{ color: '#fbbf24', fontSize: 14, fontWeight: 700, margin: '0 0 7px' }}>
              {t.supIntegrationTitle}
            </p>
            <p style={{ color: '#cbd5e1', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
              {t.supIntegrationBody}
            </p>
          </section>

          <section style={{ marginTop: 8 }} aria-labelledby="supplier-orders-title">
            <p id="supplier-orders-title" style={{ color: '#e8edf4', fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>
              {t.supSavedOrders}
            </p>

            {erreurReception && (
              <div role="alert" style={{ ...card, padding: '10px 14px', marginBottom: 10, color: '#fca5a5', fontSize: 12.5, borderColor: 'rgba(239,68,68,0.3)' }}>
                {erreurReception}
              </div>
            )}
            {erreurChargement && (
              <div role="alert" style={{ ...card, padding: '10px 14px', marginBottom: 10, color: '#fca5a5', fontSize: 12.5, borderColor: 'rgba(239,68,68,0.3)' }}>
                {erreurChargement}
              </div>
            )}

            {chargement ? (
              <div style={{ ...card, padding: 18, textAlign: 'center', color: '#94a3b8', fontSize: 13 }} aria-live="polite">
                {t.supLoadingOrders}
              </div>
            ) : !erreurChargement && bons.length === 0 ? (
              <div style={{ ...card, padding: 18, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                {t.supNoOrders}
              </div>
            ) : !erreurChargement && bons.map((b) => {
              const receptionnable = RECEPTIONNABLES.has(b.status)
              const enCours = receptionEnCours === b.id
              return (
                <div key={b.id} style={{ ...card, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ color: '#e8edf4', fontSize: 13.5, fontWeight: 650, margin: 0 }}>
                      {b.number}
                      <span style={{ color: '#64748b', fontWeight: 500 }}> · {b.supplierName ?? '—'}</span>
                    </p>
                    <p style={{ color: '#64748b', fontSize: 11.5, margin: '2px 0 0' }}>
                      {LIBELLE_STATUT[b.status] ?? b.status} · {b.totalHT.toLocaleString(lang)} € {t.supHT}
                    </p>
                  </div>

                  {receptionnable ? (
                    <button
                      onClick={() => receptionner(b)}
                      disabled={enCours}
                      style={{ ...btnPri, opacity: enCours ? 0.6 : 1 }}
                      title="Réceptionner : les quantités entrent en stock"
                    >
                      {enCours ? '…' : 'Réceptionner'}
                    </button>
                  ) : (
                    <span
                      style={{
                        fontSize: 11.5, fontWeight: 700, padding: '5px 10px', borderRadius: 999,
                        color: b.status === 'received' ? '#4ade80' : '#94a3b8',
                        background: b.status === 'received' ? 'rgba(74,222,128,0.12)' : 'rgba(148,163,184,0.12)',
                      }}
                    >
                      {LIBELLE_STATUT[b.status] ?? b.status}
                    </span>
                  )}
                </div>
              )
            })}
          </section>
        </div>
      </div>
    </div>
  )
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', background: '#070d1b', paddingBottom: 'env(safe-area-inset-bottom)' }
const bar: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', paddingTop: 'calc(14px + env(safe-area-inset-top))', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)', flexShrink: 0 }
const logo: React.CSSProperties = { width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#3b82f6,#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
const closeBtn: React.CSSProperties = { width: 34, height: 34, borderRadius: 9, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center' }
const card: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14 }
const btnPri: React.CSSProperties = { fontSize: 13, fontWeight: 700, padding: '9px 16px', borderRadius: 9, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer' }
