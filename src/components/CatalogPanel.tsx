'use client'

/**
 * Catalogue de pièces (type TecDoc) — search over /api/catalog. Ranked results
 * with category path, cross-reference matching, and an in-stock annotation from
 * the garage's own inventory. Read-only.
 */
import { useEffect, useState } from 'react'
import { X, Search, Boxes, CheckCircle2 } from 'lucide-react'

interface Article { id: string; reference: string; brand: string; name: string; listPrice?: number | null }
interface Result { article: Article; matched: string[]; inStock?: boolean; stockQuantity?: number; categoryPath?: { id: string; label: string }[] }

export default function CatalogPanel({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('plaquettes')
  const [results, setResults] = useState<Result[]>([])
  const [total, setTotal] = useState(0)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')

  async function search(text: string) {
    const term = text.trim()
    if (!term) { setResults([]); setTotal(0); setState('idle'); return }
    setState('loading')
    try {
      const r = await fetch(`/api/catalog?text=${encodeURIComponent(term)}`)
      const d = await r.json()
      if (!r.ok) { setState('error'); return }
      setResults(d.results ?? []); setTotal(d.total ?? 0); setState('idle')
    } catch { setState('error') }
  }
  useEffect(() => { search('plaquettes') }, [])

  return (
    <div style={overlay}>
      <div style={bar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={logo}><Boxes size={16} color="#fff" /></div>
          <div><p style={{ color: '#fff', fontSize: 14, fontWeight: 700, lineHeight: 1 }}>Catalogue de pièces</p><p style={{ color: '#475569', fontSize: 11 }}>Recherche · références croisées · stock</p></div>
        </div>
        <button onClick={onClose} style={closeBtn} aria-label="Fermer"><X size={16} /></button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <form onSubmit={(e) => { e.preventDefault(); search(q) }} style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 11, padding: '0 14px' }}>
              <Search size={16} color="#64748b" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, référence (OE ou adaptable)…" style={{ flex: 1, background: 'transparent', border: 'none', color: '#fff', fontSize: 14, padding: '11px 0', outline: 'none' }} />
            </div>
            <button type="submit" style={btnPri}>Rechercher</button>
          </form>

          {state === 'loading' && <p style={{ color: '#64748b', fontSize: 13 }}>Recherche…</p>}
          {state === 'error' && <p style={{ color: '#f87171', fontSize: 13 }}>Erreur de recherche.</p>}
          {state === 'idle' && total > 0 && <p style={{ color: '#475569', fontSize: 12.5, marginBottom: 10 }}>{total} résultat(s)</p>}
          {state === 'idle' && total === 0 && q.trim() && <p style={{ color: '#64748b', fontSize: 13 }}>Aucune pièce trouvée.</p>}

          {results.map((r) => (
            <div key={r.article.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', marginBottom: 9 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14.5, fontWeight: 650, color: '#e8edf4' }}>{r.article.name}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#93c5fd', background: 'rgba(59,130,246,0.12)', padding: '2px 8px', borderRadius: 6 }}>{r.article.brand}</span>
                  {r.matched?.includes('crossref') && <span style={{ fontSize: 10.5, fontWeight: 700, color: '#a78bfa', background: 'rgba(167,139,250,0.12)', padding: '2px 7px', borderRadius: 6 }}>réf. croisée</span>}
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                  Réf. {r.article.reference}
                  {r.categoryPath?.length ? <span> · {r.categoryPath.map((c) => c.label).join(' › ')}</span> : null}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {r.article.listPrice != null && <div style={{ fontSize: 15, fontWeight: 700, color: '#e8edf4' }}>{r.article.listPrice.toLocaleString('fr-FR')} €</div>}
                {r.inStock
                  ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: '#4ade80', marginTop: 3 }}><CheckCircle2 size={13} /> En stock ({r.stockQuantity})</span>
                  : <span style={{ fontSize: 11.5, fontWeight: 600, color: '#64748b', marginTop: 3, display: 'inline-block' }}>À commander</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', background: '#070d1b' }
const bar: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)', flexShrink: 0 }
const logo: React.CSSProperties = { width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#3b82f6,#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
const closeBtn: React.CSSProperties = { width: 34, height: 34, borderRadius: 9, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center' }
const card: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12 }
const btnPri: React.CSSProperties = { fontSize: 13.5, fontWeight: 700, padding: '0 18px', borderRadius: 11, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer' }
