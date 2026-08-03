'use client'

/**
 * OCR automobile — paste recognised document text, get structured fields with a
 * per-field confidence and a VIN cross-decode. Over /api/ocr. Read-only: the
 * extraction never writes; the user confirms before pre-filling any record.
 */
import { useState } from 'react'
import { X, ScanLine, Sparkles, Car } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'

interface Field { key: string; label: string; value: string; confidence: number; valid?: boolean }
interface Result {
  type: string; fields: Field[]; confidence: number; warnings: string[]
  vinDecoded?: { vin?: string; manufacturer?: string | null; country?: string | null; region?: string | null } | null
}

const SAMPLE = "CERTIFICAT D'IMMATRICULATION\nA   AB-123-CD\nB   15/03/2018\nD.1 PEUGEOT\nD.3 308\nE   VF3LBHYBWFS123456\nP.3 GO"

export default function OcrPanel({ onClose, onUseVehicle }: { onClose: () => void; onUseVehicle?: (preset: { licensePlate?: string; vehicleModel?: string }) => void }) {
  const { t, lang } = useTranslation()
  const TYPE_LABEL: Record<string, string> = {
    carte_grise: t.ocrTypeCarteGrise, invoice: t.ocrTypeInvoice, plate: t.ocrTypePlate, vin_plate: t.ocrTypeVinPlate, odometer: t.ocrTypeOdometer, unknown: t.ocrTypeUnknown,
  }
  const [text, setText] = useState(SAMPLE)
  const [res, setRes] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function analyze() {
    if (!text.trim() || busy) return
    setBusy(true); setError(null); setRes(null)
    try {
      const r = await fetch('/api/ocr', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, ocrConfidence: 0.9 }) })
      const d = await r.json()
      if (!r.ok) { setError(d?.error ?? t.ocrError); return }
      setRes(d)
    } catch { setError(t.ocrCommError) } finally { setBusy(false) }
  }

  return (
    <div style={overlay}>
      <div style={bar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={logo}><ScanLine size={16} color="#fff" /></div>
          <div><p style={{ color: '#fff', fontSize: 14, fontWeight: 700, lineHeight: 1 }}>{t.ocrTitle}</p><p style={{ color: '#475569', fontSize: 11 }}>{t.ocrSubtitle}</p></div>
        </div>
        <button onClick={onClose} style={closeBtn} aria-label={t.uiClose}><X size={16} /></button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: 16 }}>
          {/* Input */}
          <div style={card}>
            <p style={hdr}>{t.ocrInputLabel}</p>
            <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
              style={{ width: '100%', height: 240, resize: 'vertical', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#cbd5e1', fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12.5, lineHeight: 1.7, padding: 12, outline: 'none' }} />
            <button onClick={analyze} disabled={busy} style={{ ...analyzeBtn, opacity: busy ? 0.6 : 1 }}><Sparkles size={15} /> {busy ? t.ocrAnalyzing : t.ocrAnalyze}</button>
          </div>

          {/* Result */}
          <div style={card}>
            <p style={hdr}>{t.ocrFieldsLabel}</p>
            {!res && !error && <p style={{ color: '#64748b', fontSize: 13, padding: '8px 2px' }}>{t.ocrRunHint}</p>}
            {error && <p style={{ color: '#f87171', fontSize: 13 }}>{error}</p>}
            {res && (
              <>
                <span style={typePill}>🪪 {TYPE_LABEL[res.type] ?? res.type} · {t.ocrConfidence} {res.confidence.toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <div style={{ marginTop: 6 }}>
                  {res.fields.length === 0 && <p style={{ color: '#64748b', fontSize: 13, paddingTop: 8 }}>{t.ocrNoFields}</p>}
                  {res.fields.map((f) => {
                    const pct = Math.round(f.confidence * 100)
                    const col = pct >= 75 ? '#4ade80' : '#fbbf24'
                    return (
                      <div key={f.key} style={{ padding: '11px 2px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{f.label}</span>
                          <span style={{ fontSize: 15, fontWeight: 700, color: '#e8edf4' }}>{f.value}{f.valid && <span style={{ color: '#4ade80', fontSize: 12, marginLeft: 6 }}>✓ {t.ocrValid}</span>}</span>
                        </div>
                        <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.07)', marginTop: 7, overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: 3, width: `${pct}%`, background: col }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {res?.vinDecoded && (
          <div style={{ maxWidth: 960, margin: '16px auto 0', ...card, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(96,165,250,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Car size={20} color="#60a5fa" /></div>
            <div>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#e8edf4' }}>{t.ocrVinDecoded} — {[res.vinDecoded.manufacturer, res.vinDecoded.country, res.vinDecoded.region].filter(Boolean).join(' · ')}</p>
              <p style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>{t.ocrVinHint}</p>
            </div>
          </div>
        )}

        {/* Confirmation-gated hand-off: pre-fill a new job with the decoded vehicle. */}
        {res && onUseVehicle && (() => {
          const g = (k: string) => res.fields.find((f) => f.key === k)?.value?.trim() || ''
          const plate = g('plate')
          const vehicleModel = [g('make'), g('model')].filter(Boolean).join(' ')
          if (!plate && !vehicleModel) return null
          return (
            <div style={{ maxWidth: 960, margin: '12px auto 0', ...card, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#e8edf4' }}>{t.ocrPrefillTitle}</p>
                <p style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>{[plate, vehicleModel].filter(Boolean).join(' · ')} — {t.ocrPrefillHint}</p>
              </div>
              <button onClick={() => onUseVehicle({ licensePlate: plate || undefined, vehicleModel: vehicleModel || undefined })} style={prefillBtn}><Car size={15} /> {t.ocrCreateJob}</button>
            </div>
          )
        })()}
      </div>
    </div>
  )
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', background: '#070d1b', paddingBottom: 'env(safe-area-inset-bottom)' }
const bar: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', paddingTop: 'calc(14px + env(safe-area-inset-top))', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)', flexShrink: 0 }
const logo: React.CSSProperties = { width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#3b82f6,#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
const closeBtn: React.CSSProperties = { width: 34, height: 34, borderRadius: 9, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center' }
const card: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: 16 }
const hdr: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }
const analyzeBtn: React.CSSProperties = { marginTop: 12, width: '100%', padding: '10px', borderRadius: 10, border: 'none', background: '#3b82f6', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }
const typePill: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, color: '#93c5fd', background: 'rgba(59,130,246,0.12)', padding: '3px 9px', borderRadius: 7 }
const prefillBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 16px', borderRadius: 10, border: 'none', background: '#3b82f6', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }
