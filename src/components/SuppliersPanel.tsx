'use client'

/**
 * Commande automatique fournisseurs — reorder plan over /api/suppliers.
 * Low-stock parts grouped into one draft order per supplier; order creation is
 * confirmation-gated (nothing is persisted until the user confirms).
 */
import { useEffect, useState } from 'react'
import { X, Truck, PackageCheck, Loader2 } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'

interface Line { partId: string; name: string; reference?: string | null; quantity: number; unitPrice: number; lineTotal: number }
interface Order { supplierId: string; supplierName: string; lines: Line[]; totalHT: number; maxLeadTimeDays: number }
interface Plan { orders: Order[]; unfulfillable: { name: string }[]; summary: { parts: number; suppliers: number; totalHT: number } }

/** Bon de commande PERSISTÉ (à distinguer d'une ligne du plan, non enregistrée). */
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
  const [plan, setPlan] = useState<Plan | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ok'>('loading')
  const [confirming, setConfirming] = useState(false)
  const [created, setCreated] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  // ── Commandes déjà passées ─────────────────────────────────────────────────
  // Ce panneau savait CRÉER des bons de commande et rien d'autre : aucune liste,
  // aucun bouton de réception. Le stock n'était donc jamais réapprovisionné —
  // la route `/api/purchase-orders/[id]/receive` existait et incrémentait
  // correctement le stock, mais rien dans le produit ne l'appelait.
  const [bons, setBons] = useState<BonDeCommande[]>([])
  const [receptionEnCours, setReceptionEnCours] = useState<string | null>(null)
  const [erreurReception, setErreurReception] = useState<string | null>(null)

  async function chargerBons() {
    try {
      const r = await fetch('/api/purchase-orders')
      const d = await r.json().catch(() => null)
      if (r.ok && Array.isArray(d)) setBons(d)
    } catch { /* la liste reste en l'état ; le plan fonctionne quand même */ }
  }

  useEffect(() => {
    let alive = true
    fetch('/api/suppliers')
      .then(async (r) => { const d = await r.json().catch(() => null); if (!alive) return; if (!r.ok || !d) { setState('error'); return } setPlan(d); setState('ok') })
      .catch(() => { if (alive) setState('error') })
    chargerBons()
    return () => { alive = false }
  }, [])

  async function confirmOrders() {
    setBusy(true)
    try {
      const r = await fetch('/api/suppliers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'create-orders', confirm: true }) })
      const d = await r.json()
      if (r.ok) { setCreated(d.created?.length ?? 0); await chargerBons() }
    } finally { setBusy(false); setConfirming(false) }
  }

  /**
   * Réception d'un bon : c'est CETTE action qui incrémente le stock.
   *
   * Le bouton est désactivé pendant l'appel — un double-clic enverrait deux
   * requêtes. La route les rattrape (revendication atomique du statut), mais
   * l'utilisateur verrait un message d'erreur pour une action qui a réussi.
   */
  async function receptionner(bon: BonDeCommande) {
    setErreurReception(null)
    setReceptionEnCours(bon.id)
    try {
      const r = await fetch(`/api/purchase-orders/${bon.id}/receive`, { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErreurReception(d?.error ?? 'Réception refusée.'); return }
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
          <div><p style={{ color: '#fff', fontSize: 14, fontWeight: 700, lineHeight: 1 }}>{t.supTitle}</p><p style={{ color: '#475569', fontSize: 11 }}>{t.supSubtitle}</p></div>
        </div>
        <button onClick={onClose} style={closeBtn} aria-label={t.uiClose}><X size={16} /></button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 920, margin: '0 auto' }}>
          {state === 'loading' && <Center><Loader2 size={26} color="#3b82f6" className="spin" /><p style={{ color: '#475569', fontSize: 13, marginTop: 10 }}>{t.supAnalyzing}</p></Center>}
          {state === 'error' && <Center><p style={{ color: '#f87171', fontSize: 14 }}>{t.supLoadError}</p></Center>}
          {state === 'ok' && plan && (
            <>
              {/* Summary + gated action */}
              <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 18, padding: '16px 20px', marginBottom: 16 }}>
                <Stat label={t.supPartsBelow} value={String(plan.summary.parts)} />
                <Stat label={t.supSuppliers} value={String(plan.summary.suppliers)} />
                <Stat label={t.supTotalHT} value={`${plan.summary.totalHT.toLocaleString(lang)} €`} accent />
                <div style={{ flex: 1 }} />
                {created != null ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#4ade80', fontWeight: 700, fontSize: 14 }}><PackageCheck size={18} /> {t.supCreated.replace('{n}', String(created))}</span>
                ) : confirming ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ color: '#fbbf24', fontSize: 12.5, fontWeight: 600 }}>{t.supConfirmQ.replace('{n}', String(plan.summary.suppliers))}</span>
                    <button onClick={confirmOrders} disabled={busy} style={btnPri}>{busy ? '…' : `✓ ${t.confirm}`}</button>
                    <button onClick={() => setConfirming(false)} style={btnSec}>{t.uiCancel}</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirming(true)} disabled={plan.orders.length === 0} style={{ ...btnPri, opacity: plan.orders.length === 0 ? 0.5 : 1 }}>{t.supPrepare}</button>
                )}
              </div>

              {created == null && plan.orders.length === 0 && <div style={{ ...card, padding: 24, textAlign: 'center', color: '#64748b', fontSize: 14 }}>{t.supNoParts}</div>}

              {created == null && plan.orders.map((o) => (
                <div key={o.supplierId} style={{ ...card, marginBottom: 14, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: '#e8edf4' }}>{o.supplierName}</span>
                      <span style={{ fontSize: 11.5, color: '#64748b' }}>{t.supDelivery.replace('{d}', String(o.maxLeadTimeDays))} · {t.supRefsN.replace('{n}', String(o.lines.length))}</span>
                    </div>
                    <span style={{ fontSize: 15, fontWeight: 750, color: '#93c5fd' }}>{o.totalHT.toLocaleString(lang)} € {t.supHT}</span>
                  </div>
                  {o.lines.map((l) => (
                    <div key={l.partId} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 18px', fontSize: 13, borderTop: '1px solid rgba(255,255,255,0.04)', color: '#94a3b8' }}>
                      <span><b style={{ color: '#cbd5e1', fontWeight: 600 }}>{l.quantity}×</b> {l.name}{l.reference ? <span style={{ color: '#475569' }}> · {l.reference}</span> : null}</span>
                      <span style={{ color: '#cbd5e1' }}>{l.lineTotal.toLocaleString(lang)} €</span>
                    </div>
                  ))}
                </div>
              ))}

              {/* ── Commandes passées : c'est ICI que le stock se réapprovisionne ──
                  Sans cette section, un bon de commande créé restait indéfiniment
                  au statut « brouillon » et aucune pièce n'entrait jamais en
                  stock : la route de réception existait, mais rien ne l'appelait. */}
              <div style={{ marginTop: 22 }}>
                <p style={{ color: '#e8edf4', fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>
                  Commandes fournisseur
                </p>

                {erreurReception && (
                  <div style={{ ...card, padding: '10px 14px', marginBottom: 10, color: '#fca5a5', fontSize: 12.5, borderColor: 'rgba(239,68,68,0.3)' }}>
                    {erreurReception}
                  </div>
                )}

                {bons.length === 0 ? (
                  <div style={{ ...card, padding: 18, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                    Aucune commande enregistrée.
                  </div>
                ) : bons.map((b) => {
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
              </div>
            </>
          )}
        </div>
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <div><div style={{ fontSize: 11, color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div><div style={{ fontSize: 20, fontWeight: 750, color: accent ? '#93c5fd' : '#e8edf4', marginTop: 2 }}>{value}</div></div>
}
function Center({ children }: { children: React.ReactNode }) { return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 320 }}>{children}</div> }

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', background: '#070d1b', paddingBottom: 'env(safe-area-inset-bottom)' }
const bar: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', paddingTop: 'calc(14px + env(safe-area-inset-top))', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)', flexShrink: 0 }
const logo: React.CSSProperties = { width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#3b82f6,#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
const closeBtn: React.CSSProperties = { width: 34, height: 34, borderRadius: 9, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center' }
const card: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14 }
const btnPri: React.CSSProperties = { fontSize: 13, fontWeight: 700, padding: '9px 16px', borderRadius: 9, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer' }
const btnSec: React.CSSProperties = { fontSize: 13, fontWeight: 700, padding: '9px 14px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }
