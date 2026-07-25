'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Plus, Trash2, Printer, PenLine, Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n'

interface WorkLine { description: string; durationMin: number; unitPrice: number }
interface PartLine  { name: string; reference: string; qty: number; unitPrice: number }

interface LaborOp { id: string; name: string; category: string | null; durationMin: number; unitPrice: number }

interface Props {
  jobId?: string
  workOrderId?: string
  prefill?: {
    clientName?: string; clientPhone?: string; clientEmail?: string; clientAddress?: string
    vehicleMake?: string; vehicleModel?: string; licensePlate?: string; mileage?: number; vin?: string
    mechanicId?: string; taxRate?: number
  }
  onClose: () => void
  onSaved?: (wo: { id: string; number: string }) => void
}

function fmt(n: number) {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}
function fmtDuration(min: number) {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60), m = min % 60
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
}

// ── Signature Canvas ──────────────────────────────────────────────────────────
function SignatureCanvas({ onSign, existingSig }: { onSign: (b64: string) => void; existingSig?: string | null }) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  function getPos(e: { clientX: number; clientY: number }, rect: DOMRect) {
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.strokeStyle = '#1e40af'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'

    const onDown = (e: MouseEvent) => { drawing.current = true; const r = canvas.getBoundingClientRect(); const p = getPos(e, r); ctx.beginPath(); ctx.moveTo(p.x, p.y) }
    const onMove = (e: MouseEvent) => { if (!drawing.current) return; const r = canvas.getBoundingClientRect(); const p = getPos(e, r); ctx.lineTo(p.x, p.y); ctx.stroke() }
    const onUp   = () => { drawing.current = false }

    const onTouchDown = (e: TouchEvent) => { e.preventDefault(); drawing.current = true; const r = canvas.getBoundingClientRect(); const p = getPos(e.touches[0], r); ctx.beginPath(); ctx.moveTo(p.x, p.y) }
    const onTouchMove = (e: TouchEvent) => { e.preventDefault(); if (!drawing.current) return; const r = canvas.getBoundingClientRect(); const p = getPos(e.touches[0], r); ctx.lineTo(p.x, p.y); ctx.stroke() }

    canvas.addEventListener('mousedown', onDown)
    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mouseup',   onUp)
    canvas.addEventListener('touchstart', onTouchDown, { passive: false })
    canvas.addEventListener('touchmove',  onTouchMove, { passive: false })
    canvas.addEventListener('touchend',   onUp)
    return () => {
      canvas.removeEventListener('mousedown', onDown)
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mouseup',   onUp)
      canvas.removeEventListener('touchstart', onTouchDown)
      canvas.removeEventListener('touchmove',  onTouchMove)
      canvas.removeEventListener('touchend',   onUp)
    }
  }, [])

  function clear() {
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
  }
  function sign() {
    if (canvasRef.current) onSign(canvasRef.current.toDataURL('image/png'))
  }

  if (existingSig) return (
    <div className="space-y-3">
      <p className="text-xs text-emerald-400 font-medium flex items-center gap-1"><Check className="w-3.5 h-3.5" /> {t.woDocSigned}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={existingSig} alt={t.woClientSignature} className="border border-white/10 rounded-lg bg-white p-2 max-h-24" />
    </div>
  )

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">{t.woSignHint}</p>
      <canvas ref={canvasRef} width={560} height={160}
        className="w-full border-2 border-dashed border-white/20 rounded-lg bg-white cursor-crosshair touch-none" />
      <div className="flex gap-2">
        <button onClick={clear} className="px-3 py-1.5 text-xs rounded-lg border border-white/10 text-slate-400 hover:bg-white/[0.05]">{t.woClear}</button>
        <button onClick={sign} className="px-4 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium flex items-center gap-1.5">
          <PenLine className="w-3.5 h-3.5" /> {t.woValidateSign}
        </button>
      </div>
    </div>
  )
}

// ── Labor op picker ────────────────────────────────────────────────────────────
function LaborPicker({ onSelect }: { onSelect: (op: LaborOp) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [ops, setOps]   = useState<LaborOp[]>([])
  const [q, setQ]       = useState('')

  useEffect(() => {
    if (!open) return
    fetch('/api/labor-operations?active=true').then(r => r.json()).then(d => setOps(d.operations ?? [])).catch(() => {})
  }, [open])

  const filtered = ops.filter(o => o.name.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)} className="px-2 py-1 text-xs rounded border border-white/10 text-slate-400 hover:bg-white/[0.05] flex items-center gap-1">
        {t.woScale} <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute left-0 top-7 z-50 w-72 bg-[#111827] border border-white/10 rounded-xl shadow-2xl p-2 space-y-1">
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={t.woSearch}
            className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <div className="max-h-52 overflow-y-auto space-y-0.5">
            {filtered.length === 0 && <p className="text-xs text-slate-500 px-2 py-1">{t.woNoResult}</p>}
            {filtered.map(op => (
              <button key={op.id} onClick={() => { onSelect(op); setOpen(false); setQ('') }}
                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-white/[0.07] text-sm">
                <span className="text-white">{op.name}</span>
                <span className="text-slate-500 ml-2 text-xs">{fmtDuration(op.durationMin)} · {fmt(op.unitPrice)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export default function WorkOrderModal({ jobId, workOrderId: initialId, prefill, onClose, onSaved }: Props) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'info' | 'works' | 'parts' | 'sign'>('info')
  const [saving, setSaving] = useState(false)
  const [signing, setSigning] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(initialId ?? null)
  const [savedNumber, setSavedNumber] = useState('')
  const [existingSig, setExistingSig] = useState<string | null>(null)
  const [taxRate, setTaxRate] = useState(prefill?.taxRate ?? 20)

  // Info fields
  const [clientName,    setClientName]    = useState(prefill?.clientName ?? '')
  const [clientPhone,   setClientPhone]   = useState(prefill?.clientPhone ?? '')
  const [clientEmail,   setClientEmail]   = useState(prefill?.clientEmail ?? '')
  const [clientAddress, setClientAddress] = useState(prefill?.clientAddress ?? '')
  const [vehicleMake,   setVehicleMake]   = useState(prefill?.vehicleMake ?? '')
  const [vehicleModel,  setVehicleModel]  = useState(prefill?.vehicleModel ?? '')
  const [licensePlate,  setLicensePlate]  = useState(prefill?.licensePlate ?? '')
  const [mileage,       setMileage]       = useState(prefill?.mileage?.toString() ?? '')
  const [vin,           setVin]           = useState('')
  const [notes,         setNotes]         = useState('')

  // Works & parts
  const [works, setWorks] = useState<WorkLine[]>([{ description: '', durationMin: 30, unitPrice: 0 }])
  const [parts, setParts] = useState<PartLine[]>([])

  const totalWorksHT = works.reduce((s, w) => s + (w.unitPrice || 0), 0)
  const totalPartsHT = parts.reduce((s, p) => s + (p.qty || 0) * (p.unitPrice || 0), 0)
  const totalHT  = Math.round((totalWorksHT + totalPartsHT) * 100) / 100
  const totalTTC = Math.round(totalHT * (1 + taxRate / 100) * 100) / 100

  // Load existing if editing
  useEffect(() => {
    if (!initialId) return
    fetch(`/api/work-orders/${initialId}`).then(r => r.json()).then(wo => {
      setClientName(wo.clientName ?? ''); setClientPhone(wo.clientPhone ?? '')
      setClientEmail(wo.clientEmail ?? ''); setClientAddress(wo.clientAddress ?? '')
      setVehicleMake(wo.vehicleMake ?? ''); setVehicleModel(wo.vehicleModel ?? '')
      setLicensePlate(wo.licensePlate ?? ''); setMileage(wo.mileage?.toString() ?? '')
      setVin(wo.vin ?? ''); setNotes(wo.notes ?? ''); setTaxRate(wo.taxRate ?? 20)
      setWorks(JSON.parse(wo.worksJson || '[]'))
      setParts(JSON.parse(wo.partsJson || '[]'))
      setSavedNumber(wo.number); setExistingSig(wo.signatureData ?? null)
    }).catch(() => {})
  }, [initialId])

  const buildPayload = useCallback(() => ({
    jobId: jobId ?? null,
    clientName, clientPhone: clientPhone || null, clientEmail: clientEmail || null,
    clientAddress: clientAddress || null, vehicleMake: vehicleMake || null,
    vehicleModel: vehicleModel || null, licensePlate: licensePlate || null,
    mileage: mileage ? Number(mileage) : null, vin: vin || null,
    worksJson: JSON.stringify(works), partsJson: JSON.stringify(parts),
    taxRate, notes: notes || null,
    mechanicId: prefill?.mechanicId ?? null,
  }), [clientName, clientPhone, clientEmail, clientAddress, vehicleMake, vehicleModel,
       licensePlate, mileage, vin, works, parts, taxRate, notes, jobId, prefill?.mechanicId])

  async function save(): Promise<string | null> {
    if (!clientName.trim()) { alert(t.woNameRequired); return null }
    setSaving(true)
    try {
      const method = savedId ? 'PATCH' : 'POST'
      const url    = savedId ? `/api/work-orders/${savedId}` : '/api/work-orders'
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildPayload()) })
      if (!res.ok) throw new Error(await res.text())
      const wo = await res.json()
      setSavedId(wo.id); setSavedNumber(wo.number)
      onSaved?.({ id: wo.id, number: wo.number })
      return wo.id
    } finally { setSaving(false) }
  }

  async function handleSign(sig: string) {
    // Use existing ID or get it from save() — never read savedId after save() call
    // because React state updates are async and the closure would see the old value.
    const id = savedId ?? await save()
    if (!id) return
    setSigning(true)
    try {
      const res = await fetch(`/api/work-orders/${id}/sign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signatureData: sig }) })
      if (!res.ok) throw new Error(await res.text())
      setExistingSig(sig)
    } finally { setSigning(false) }
  }

  function handlePrint() {
    const style = `
      <style>
        *{margin:0;padding:0;box-sizing:border-box;font-family:Arial,sans-serif}
        body{background:#fff;color:#000;padding:20mm;font-size:10pt}
        h1{font-size:16pt;margin-bottom:4px}
        h2{font-size:11pt;margin:14px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}
        .row{display:flex;gap:20px;margin-bottom:12px}
        .box{flex:1;border:1px solid #ddd;border-radius:6px;padding:10px}
        .label{font-size:8pt;color:#666;text-transform:uppercase;letter-spacing:.5px}
        .val{font-size:10pt;margin-top:2px}
        table{width:100%;border-collapse:collapse;margin-bottom:10px}
        th{text-align:left;font-size:8pt;color:#666;padding:5px 8px;border-bottom:2px solid #ddd;text-transform:uppercase}
        td{padding:6px 8px;border-bottom:1px solid #eee;font-size:10pt}
        .total-row{border-top:2px solid #000;font-weight:bold}
        .sig-box{border:2px dashed #ccc;border-radius:8px;padding:20px;min-height:100px;margin-top:10px}
        .footer{margin-top:20px;font-size:8pt;color:#666;border-top:1px solid #eee;padding-top:10px}
        @media print{body{padding:10mm}}
      </style>`
    const worksRows = works.map(w => `<tr><td>${w.description}</td><td>${fmtDuration(w.durationMin)}</td><td>${fmt(w.unitPrice)}</td></tr>`).join('')
    const partsRows = parts.map(p => `<tr><td>${p.name}</td><td>${p.reference}</td><td>${p.qty}</td><td>${fmt(p.unitPrice)}</td><td>${fmt(p.qty * p.unitPrice)}</td></tr>`).join('')
    const sigHtml = existingSig ? `<img src="${existingSig}" style="max-height:80px" />` : '<div style="height:60px"></div>'

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${t.woTitle} ${savedNumber}</title>${style}</head><body>
      <h1>${t.woPrintTitle} — ${savedNumber || t.woDraft}</h1>
      <p style="color:#666;font-size:9pt">${t.woIssuedOn} ${new Date().toLocaleDateString('fr-FR')}</p>
      <div class="row" style="margin-top:12px">
        <div class="box"><div class="label">${t.vmClient}</div><div class="val">${clientName}<br>${clientPhone || ''}<br>${clientAddress || ''}</div></div>
        <div class="box"><div class="label">${t.jmVehicle}</div><div class="val">${vehicleMake} ${vehicleModel}<br>${t.woPlateShort} ${licensePlate || '—'}<br>${t.woMileageLabel} ${mileage ? Number(mileage).toLocaleString() + ' km' : '—'}</div></div>
      </div>
      <h2>${t.woWorksPlanned}</h2>
      <table><thead><tr><th>${t.woColDesc}</th><th>${t.woDuration}</th><th>${t.woColUnitHT}</th></tr></thead><tbody>${worksRows}</tbody></table>
      ${parts.length > 0 ? `<h2>${t.woPartsNeeded}</h2><table><thead><tr><th>${t.woColPart}</th><th>${t.stkReference}</th><th>${t.woColQty}</th><th>${t.woColUnitHT}</th><th>${t.woTotalHT}</th></tr></thead><tbody>${partsRows}</tbody></table>` : ''}
      <table style="width:200px;margin-left:auto">
        <tr><td>${t.woTotalHT}</td><td style="text-align:right">${fmt(totalHT)}</td></tr>
        <tr><td>${t.woVAT} ${taxRate}%</td><td style="text-align:right">${fmt(totalTTC - totalHT)}</td></tr>
        <tr class="total-row"><td>${t.woTotalTTC}</td><td style="text-align:right">${fmt(totalTTC)}</td></tr>
      </table>
      ${notes ? `<h2>${t.uiNotes}</h2><p>${notes}</p>` : ''}
      <h2>${t.woClientSignature}</h2>
      <p style="font-size:9pt">${t.woReadApproved}</p>
      <div class="sig-box">${sigHtml}</div>
      <div class="footer">${t.woAgreementFooter}</div>
    </body></html>`

    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); w.print() }
  }

  const tabs = [
    { key: 'info',  label: t.woTabInfo },
    { key: 'works', label: `${t.woTabWorks} (${works.length})` },
    { key: 'parts', label: `${t.woTabParts} (${parts.length})` },
    { key: 'sign',  label: existingSig ? `✓ ${t.woSignedShort}` : t.woTabSign },
  ] as const

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0f1629] rounded-2xl shadow-2xl border border-white/[0.07] w-full max-w-3xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07]">
          <div>
            <h2 className="text-lg font-bold text-white">{t.woTitle}</h2>
            {savedNumber && <p className="text-xs text-blue-400">{savedNumber}</p>}
          </div>
          <div className="flex items-center gap-2">
            {savedId && <button onClick={handlePrint} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-slate-300 hover:bg-white/[0.07] text-sm"><Printer className="w-4 h-4" /> {t.woPrint}</button>}
            <button onClick={onClose} className="gf-close p-1.5 rounded-lg hover:bg-white/[0.07] text-slate-400"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-3 border-b border-white/[0.07] pb-0">
          {tabs.map(tb => (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              className={cn('px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors',
                tab === tb.key ? 'text-blue-400 border-blue-500 bg-blue-500/10' : 'text-slate-500 border-transparent hover:text-slate-300')}>
              {tb.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">

          {/* INFO TAB */}
          {tab === 'info' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t.vmClient}</h3>
                {([[`${t.woName} *`, clientName, setClientName], [t.uiPhone, clientPhone, setClientPhone], [t.uiEmail, clientEmail, setClientEmail], [t.woAddress, clientAddress, setClientAddress]] as const).map(([lbl, val, set]) => (
                  <div key={lbl}>
                    <label className="text-xs text-slate-500 mb-1 block">{lbl}</label>
                    <input value={val} onChange={e => (set as (v: string) => void)(e.target.value)}
                      className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                ))}
              </div>
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t.jmVehicle}</h3>
                {([[t.lnMake, vehicleMake, setVehicleMake, 'text'], [t.lnModel, vehicleModel, setVehicleModel, 'text'], [t.woPlate, licensePlate, setLicensePlate, 'text'], ['VIN', vin, setVin, 'text'], [t.vmMileage, mileage, setMileage, 'number']] as const).map(([lbl, val, set, inputType]) => (
                  <div key={lbl}>
                    <label className="text-xs text-slate-500 mb-1 block">{lbl}</label>
                    <input value={val} onChange={e => (set as (v: string) => void)(e.target.value)}
                      type={inputType}
                      className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                ))}
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">{t.woTax}</label>
                  <input type="number" value={taxRate} onChange={e => setTaxRate(Number(e.target.value))}
                    className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-500 mb-1 block">{t.uiNotes}</label>
                <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
            </div>
          )}

          {/* WORKS TAB */}
          {tab === 'works' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">{t.woWorksPlanned}</h3>
                <button onClick={() => setWorks(w => [...w, { description: '', durationMin: 30, unitPrice: 0 }])}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/30">
                  <Plus className="w-3.5 h-3.5" /> {t.uiAdd}
                </button>
              </div>
              {works.map((w, i) => (
                <div key={i} className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input value={w.description} onChange={e => setWorks(ws => ws.map((x, j) => j === i ? { ...x, description: e.target.value } : x))}
                      placeholder={t.woWorkDesc} className="flex-1 bg-white/[0.05] border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <LaborPicker onSelect={op => setWorks(ws => ws.map((x, j) => j === i ? { ...x, description: op.name, durationMin: op.durationMin, unitPrice: op.unitPrice } : x))} />
                    <button onClick={() => setWorks(ws => ws.filter((_, j) => j !== i))} className="text-slate-600 hover:text-red-400 p-1"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="text-xs text-slate-500">{t.woDurationMin}</label>
                      <input type="number" min={1} value={w.durationMin} onChange={e => setWorks(ws => ws.map((x, j) => j === i ? { ...x, durationMin: Number(e.target.value) } : x))}
                        className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 mt-1" />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-slate-500">{t.woPriceHT}</label>
                      <input type="number" min={0} step={0.01} value={w.unitPrice} onChange={e => setWorks(ws => ws.map((x, j) => j === i ? { ...x, unitPrice: Number(e.target.value) } : x))}
                        className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 mt-1" />
                    </div>
                    <div className="flex-1 flex flex-col justify-end">
                      <span className="text-xs text-slate-500">{t.woDuration}</span>
                      <span className="text-sm text-slate-300 mt-1">{fmtDuration(w.durationMin)}</span>
                    </div>
                  </div>
                </div>
              ))}
              {works.length === 0 && <p className="text-slate-500 text-sm text-center py-6">{t.woNoWorks}</p>}
            </div>
          )}

          {/* PARTS TAB */}
          {tab === 'parts' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">{t.woPartsNeeded}</h3>
                <button onClick={() => setParts(p => [...p, { name: '', reference: '', qty: 1, unitPrice: 0 }])}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/30">
                  <Plus className="w-3.5 h-3.5" /> {t.uiAdd}
                </button>
              </div>
              {parts.map((p, i) => (
                <div key={i} className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-3 space-y-2">
                  <div className="flex gap-2">
                    <input value={p.name} onChange={e => setParts(ps => ps.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                      placeholder={t.woPartName} className="flex-1 bg-white/[0.05] border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <input value={p.reference} onChange={e => setParts(ps => ps.map((x, j) => j === i ? { ...x, reference: e.target.value } : x))}
                      placeholder={t.stkReference} className="w-32 bg-white/[0.05] border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <button onClick={() => setParts(ps => ps.filter((_, j) => j !== i))} className="text-slate-600 hover:text-red-400 p-1"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <div className="flex gap-3">
                    <div>
                      <label className="text-xs text-slate-500">{t.woQty}</label>
                      <input type="number" min={1} value={p.qty} onChange={e => setParts(ps => ps.map((x, j) => j === i ? { ...x, qty: Number(e.target.value) } : x))}
                        className="w-24 bg-white/[0.05] border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 mt-1 block" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">{t.woUnitPriceHT}</label>
                      <input type="number" min={0} step={0.01} value={p.unitPrice} onChange={e => setParts(ps => ps.map((x, j) => j === i ? { ...x, unitPrice: Number(e.target.value) } : x))}
                        className="w-36 bg-white/[0.05] border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 mt-1 block" />
                    </div>
                    <div className="flex flex-col justify-end">
                      <span className="text-xs text-slate-500">{t.woTotal}</span>
                      <span className="text-sm text-white font-medium">{fmt(p.qty * p.unitPrice)}</span>
                    </div>
                  </div>
                </div>
              ))}
              {parts.length === 0 && <p className="text-slate-500 text-sm text-center py-6">{t.woNoParts}</p>}
            </div>
          )}

          {/* SIGN TAB */}
          {tab === 'sign' && (
            <div className="space-y-6">
              {/* Totals */}
              <div className="bg-white/[0.04] rounded-xl border border-white/[0.07] p-4 space-y-2">
                <div className="flex justify-between text-sm"><span className="text-slate-400">{t.woTotalHT}</span><span className="text-white font-medium">{fmt(totalHT)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-400">{t.woVAT} {taxRate}%</span><span className="text-slate-300">{fmt(totalTTC - totalHT)}</span></div>
                <div className="flex justify-between text-sm border-t border-white/10 pt-2"><span className="text-white font-bold">{t.woTotalTTC}</span><span className="text-white font-bold text-lg">{fmt(totalTTC)}</span></div>
              </div>

              {!savedId && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
                  {t.woSignFirst}
                </div>
              )}

              {savedId && (
                <div>
                  <h3 className="text-sm font-semibold text-white mb-3">{t.woClientSignature}</h3>
                  <SignatureCanvas onSign={handleSign} existingSig={existingSig} />
                  {signing && <p className="text-xs text-blue-400 mt-2">{t.woSavingSignature}</p>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/[0.07]">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-white/10 text-slate-400 hover:bg-white/[0.05]">{t.uiCancel}</button>
          <div className="flex gap-2">
            {savedId && <button onClick={handlePrint} className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border border-white/10 text-slate-300 hover:bg-white/[0.07]"><Printer className="w-4 h-4" /> {t.woPrint}</button>}
            <button onClick={save} disabled={saving}
              className="px-5 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50 flex items-center gap-2">
              {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
              {savedId ? t.woUpdate : t.woCreate}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
