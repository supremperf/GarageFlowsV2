'use client'

/**
 * Commande automatique fournisseurs — reorder plan over /api/suppliers.
 * Low-stock parts grouped into one draft order per supplier; order creation is
 * confirmation-gated (nothing is persisted until the user confirms).
 */
import { useEffect, useState } from 'react'
import { X, Truck, PackageCheck, Loader2 } from 'lucide-react'

interface Line { partId: string; name: string; reference?: string | null; quantity: number; unitPrice: number; lineTotal: number }
interface Order { supplierId: string; supplierName: string; lines: Line[]; totalHT: number; maxLeadTimeDays: number }
interface Plan { orders: Order[]; unfulfillable: { name: string }[]; summary: { parts: number; suppliers: number; totalHT: number } }

export default function SuppliersPanel({ onClose }: { onClose: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ok'>('loading')
  const [confirming, setConfirming] = useState(false)
  const [created, setCreated] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/suppliers')
      .then(async (r) => { const d = await r.json().catch(() => null); if (!alive) return; if (!r.ok || !d) { setState('error'); return } setPlan(d); setState('ok') })
      .catch(() => { if (alive) setState('error') })
    return () => { alive = false }
  }, [])

  async function confirmOrders() {
    setBusy(true)
    try {
      const r = await fetch('/api/suppliers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'create-orders', confirm: true }) })
      const d = await r.json()
      if (r.ok) setCreated(d.created?.length ?? 0)
    } finally { setBusy(false); setConfirming(false) }
  }

  return (
    <div style={overlay}>
      <div style={bar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={logo}><Truck size={16} color="#fff" /></div>
          <div><p style={{ color: '#fff', fontSize: 14, fontWeight: 700, lineHeight: 1 }}>Commande fournisseurs</p><p style={{ color: '#475569', fontSize: 11 }}>Réappro. groupé par fournisseur</p></div>
        </div>
        <button onClick={onClose} style={closeBtn} aria-label="Fermer"><X size={16} /></button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 920, margin: '0 auto' }}>
          {state === 'loading' && <Center><Loader2 size={26} color="#3b82f6" className="spin" /><p style={{ color: '#475569', fontSize: 13, marginTop: 10 }}>Analyse des stocks…</p></Center>}
          {state === 'error' && <Center><p style={{ color: '#f87171', fontSize: 14 }}>Impossible de charger le plan de réapprovisionnement.</p></Center>}
          {state === 'ok' && plan && (
            <>
              {/* Summary + gated action */}
              <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 18, padding: '16px 20px', marginBottom: 16 }}>
                <Stat label="Pièces sous seuil" value={String(plan.summary.parts)} />
                <Stat label="Fournisseurs" value={String(plan.summary.suppliers)} />
                <Stat label="Total estimé HT" value={`${plan.summary.totalHT.toLocaleString('fr-FR')} €`} accent />
                <div style={{ flex: 1 }} />
                {created != null ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#4ade80', fontWeight: 700, fontSize: 14 }}><PackageCheck size={18} /> {created} commande(s) créée(s)</span>
                ) : confirming ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ color: '#fbbf24', fontSize: 12.5, fontWeight: 600 }}>Créer {plan.summary.suppliers} bon(s) de commande ?</span>
                    <button onClick={confirmOrders} disabled={busy} style={btnPri}>{busy ? '…' : '✓ Confirmer'}</button>
                    <button onClick={() => setConfirming(false)} style={btnSec}>Annuler</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirming(true)} disabled={plan.orders.length === 0} style={{ ...btnPri, opacity: plan.orders.length === 0 ? 0.5 : 1 }}>Préparer les commandes</button>
                )}
              </div>

              {created == null && plan.orders.length === 0 && <div style={{ ...card, padding: 24, textAlign: 'center', color: '#64748b', fontSize: 14 }}>Aucune pièce à commander — stocks suffisants.</div>}

              {created == null && plan.orders.map((o) => (
                <div key={o.supplierId} style={{ ...card, marginBottom: 14, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: '#e8edf4' }}>{o.supplierName}</span>
                      <span style={{ fontSize: 11.5, color: '#64748b' }}>livraison ~{o.maxLeadTimeDays} j · {o.lines.length} réf.</span>
                    </div>
                    <span style={{ fontSize: 15, fontWeight: 750, color: '#93c5fd' }}>{o.totalHT.toLocaleString('fr-FR')} € HT</span>
                  </div>
                  {o.lines.map((l) => (
                    <div key={l.partId} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 18px', fontSize: 13, borderTop: '1px solid rgba(255,255,255,0.04)', color: '#94a3b8' }}>
                      <span><b style={{ color: '#cbd5e1', fontWeight: 600 }}>{l.quantity}×</b> {l.name}{l.reference ? <span style={{ color: '#475569' }}> · {l.reference}</span> : null}</span>
                      <span style={{ color: '#cbd5e1' }}>{l.lineTotal.toLocaleString('fr-FR')} €</span>
                    </div>
                  ))}
                </div>
              ))}
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

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', background: '#070d1b' }
const bar: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)', flexShrink: 0 }
const logo: React.CSSProperties = { width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#3b82f6,#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
const closeBtn: React.CSSProperties = { width: 34, height: 34, borderRadius: 9, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center' }
const card: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14 }
const btnPri: React.CSSProperties = { fontSize: 13, fontWeight: 700, padding: '9px 16px', borderRadius: 9, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer' }
const btnSec: React.CSSProperties = { fontSize: 13, fontWeight: 700, padding: '9px 14px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }
