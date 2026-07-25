'use client'

import { useState, useRef, useCallback } from 'react'
import { useTranslation } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import {
  Building2, MapPin, Phone, Mail, Globe, FileText,
  CreditCard, Image as ImageIcon, ChevronRight, Check, Wrench, X,
} from 'lucide-react'
import toast from 'react-hot-toast'

interface CompanyData {
  name: string
  address: string
  phone: string
  email: string
  website: string
  siret: string
  vatNumber: string
  taxRate: string
  iban: string
  bic: string
  bankName: string
  currency: string
  paymentTerms: string
  invoicePrefix: string
  quotePrefix: string
  invoiceFooter: string
  logoBase64: string
  hourlyRate: string
}

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY', 'MAD', 'TND', 'DZD', 'XOF']
const PAYMENT_TERMS_PRESETS = ['À réception', '15 jours net', '30 jours net', '45 jours net', '60 jours net']

interface Props {
  onComplete: (data: CompanyData) => void
  onSkip?: () => void
  initialData?: Partial<CompanyData>
}

const STEPS = ['company', 'legal', 'billing'] as const
type Step = typeof STEPS[number]

// Downscale a raster logo to a reasonable size (keeps the stored data URL small
// even when the source file is up to 15 MB). SVG is kept as-is (already tiny).
function downscaleImage(file: File, maxSide: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = () => {
      const dataUrl = reader.result as string
      if (file.type === 'image/svg+xml') { resolve(dataUrl); return }
      const img = new window.Image()
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(dataUrl); return }
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/png'))
      }
      img.onerror = () => resolve(dataUrl)
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  })
}

// Defined at module scope (NOT inside the component) so React keeps the same
// component type across renders — otherwise every keystroke remounts the input
// and the field loses focus after a single character.
function Field({ label, value, onChange, type = 'text', placeholder = '', optional = false, optionalText }: {
  label: string; value: string; onChange: (v: string) => void
  type?: string; placeholder?: string; optional?: boolean; optionalText?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-300 mb-1.5">
        {label}
        {optional && optionalText && <span className="ml-1 text-xs text-slate-500">({optionalText})</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500
                   px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/60
                   focus:border-blue-500/60 transition-all"
      />
    </div>
  )
}

export default function CompanySetup({ onComplete, onSkip, initialData }: Props) {
  const { t } = useTranslation()

  const [step, setStep] = useState<Step>('company')
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState<CompanyData>({
    name: '', address: '', phone: '', email: '', website: '',
    siret: '', vatNumber: '', taxRate: '20',
    iban: '', bic: '', bankName: '',
    currency: 'EUR', paymentTerms: '30 jours net',
    invoicePrefix: 'FAC', quotePrefix: 'DEV',
    invoiceFooter: '', logoBase64: '', hourlyRate: '60',
    ...initialData,
  })

  const fileRef = useRef<HTMLInputElement>(null)

  const set = useCallback(<K extends keyof CompanyData>(k: K, v: CompanyData[K]) =>
    setData(prev => ({ ...prev, [k]: v })), [])

  async function handleLogoFile(file: File) {
    if (file.size > 15 * 1024 * 1024) { toast.error('Logo trop lourd (max 15 Mo)'); return }
    try {
      const dataUrl = await downscaleImage(file, 512)
      set('logoBase64', dataUrl)
    } catch {
      toast.error(t.error)
    }
  }

  async function handleFinish() {
    setSaving(true)
    try {
      const res = await fetch('/api/garages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          hourlyRate: parseFloat(data.hourlyRate) || 60,
          taxRate: parseFloat(data.taxRate) || 20,
          onboardingComplete: true,
        }),
      })
      if (!res.ok) throw new Error('Save failed')
      toast.success(t.onboardingComplete)
      onComplete(data)
    } catch {
      toast.error(t.error)
    } finally {
      setSaving(false)
    }
  }

  const stepIdx = STEPS.indexOf(step)
  const stepLabels: Record<Step, string> = {
    company: t.companyInfo,
    legal: t.legalInfo,
    billing: t.billingPrefs,
  }
  const stepIcons: Record<Step, React.ReactNode> = {
    company: <Building2 className="w-4 h-4" />,
    legal: <FileText className="w-4 h-4" />,
    billing: <CreditCard className="w-4 h-4" />,
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(6,13,27,0.95)', backdropFilter: 'blur(8px)' }}>

      {/* Glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/3 left-1/4 w-96 h-96 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)' }} />
      </div>

      <div className="relative z-10 w-full max-w-lg mx-4">
        {/* Card */}
        <div className="rounded-2xl overflow-hidden"
          style={{ background: 'rgba(15,28,50,0.95)', border: '1px solid rgba(255,255,255,0.1)' }}>

          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b border-white/8">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}>
                  <Wrench className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-white font-bold text-sm">{t.companySetupTitle}</p>
                  <p className="text-slate-400 text-xs">{t.companySetupSubtitle}</p>
                </div>
              </div>
              {onSkip && (
                <button onClick={onSkip} className="gf-close text-slate-500 hover:text-slate-300 text-xs flex items-center gap-1 transition-colors">
                  <X className="w-3.5 h-3.5" /> {t.skip}
                </button>
              )}
            </div>

            {/* Step indicator */}
            <div className="flex gap-2">
              {STEPS.map((s, i) => (
                <button
                  key={s}
                  onClick={() => i <= stepIdx && setStep(s)}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium border transition-all',
                    step === s
                      ? 'bg-blue-600/25 border-blue-500/60 text-blue-300'
                      : i < stepIdx
                      ? 'bg-green-600/15 border-green-500/40 text-green-400 cursor-pointer'
                      : 'border-white/8 text-slate-500 cursor-default'
                  )}
                >
                  {i < stepIdx ? <Check className="w-3 h-3" /> : stepIcons[s]}
                  <span className="hidden sm:inline">{stepLabels[s]}</span>
                  <span className="sm:hidden">{i + 1}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="px-6 py-5 max-h-[60vh] overflow-y-auto space-y-4">
            {/* ── Step 1: Company ── */}
            {step === 'company' && (
              <>
                {/* Logo upload */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    {t.companyLogo} <span className="text-slate-500 text-xs">({t.optional})</span>
                  </label>
                  <div
                    className="flex items-center gap-4 p-3 rounded-xl border border-dashed border-white/20 hover:border-blue-500/50 cursor-pointer transition-all group"
                    onClick={() => fileRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault()
                      const f = e.dataTransfer.files[0]
                      if (f) handleLogoFile(f)
                    }}
                  >
                    {data.logoBase64 ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={data.logoBase64} alt="logo" className="w-12 h-12 object-contain rounded-lg" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center group-hover:bg-blue-600/10 transition-colors">
                        <ImageIcon className="w-5 h-5 text-slate-400 group-hover:text-blue-400" />
                      </div>
                    )}
                    <div>
                      <p className="text-sm text-slate-300 font-medium">{t.logoUpload}</p>
                      <p className="text-xs text-slate-500">{t.logoHint}</p>
                    </div>
                    {data.logoBase64 && (
                      <button
                        className="ml-auto text-slate-500 hover:text-red-400 transition-colors"
                        onClick={e => { e.stopPropagation(); set('logoBase64', '') }}
                      ><X className="w-4 h-4" /></button>
                    )}
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoFile(f) }} />
                </div>

                <Field label={t.companyName + ' *'} value={data.name} onChange={v => set('name', v)} placeholder="Mon Garage SARL" />
                <Field label={t.companyAddress} value={data.address} onChange={v => set('address', v)}
                  placeholder="12 rue de la Mécanique, 75001 Paris" optional optionalText={t.optional} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t.companyPhone} value={data.phone} onChange={v => set('phone', v)} type="tel" placeholder="+33 1 23 45 67 89" optional optionalText={t.optional} />
                  <Field label={t.companyEmail} value={data.email} onChange={v => set('email', v)} type="email" placeholder="contact@garage.fr" optional optionalText={t.optional} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t.companyWebsite} value={data.website} onChange={v => set('website', v)} placeholder="www.garage.fr" optional optionalText={t.optional} />
                  <Field label={`${t.hourlyRate} *`} value={data.hourlyRate} onChange={v => set('hourlyRate', v)} type="number" placeholder="60" />
                </div>
              </>
            )}

            {/* ── Step 2: Legal ── */}
            {step === 'legal' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t.siret} value={data.siret} onChange={v => set('siret', v)} placeholder="123 456 789 00012" optional optionalText={t.optional} />
                  <Field label={t.vatNumber} value={data.vatNumber} onChange={v => set('vatNumber', v)} placeholder="FR12345678901" optional optionalText={t.optional} />
                </div>
                <Field label={`${t.taxRate} (%)`} value={data.taxRate} onChange={v => set('taxRate', v)} type="number" placeholder="20" />

                <div className="border-t border-white/8 pt-4">
                  <p className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-blue-400" />
                    {t.bankingInfo}
                  </p>
                  <Field label={t.bankName} value={data.bankName} onChange={v => set('bankName', v)} placeholder="BNP Paribas" optional optionalText={t.optional} />
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <Field label={t.iban} value={data.iban} onChange={v => set('iban', v)} placeholder="FR76 3000 6000 0…" optional optionalText={t.optional} />
                    <Field label={t.bic} value={data.bic} onChange={v => set('bic', v)} placeholder="BNPAFRPP" optional optionalText={t.optional} />
                  </div>
                </div>
              </>
            )}

            {/* ── Step 3: Billing ── */}
            {step === 'billing' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">{t.currency}</label>
                    <select
                      value={data.currency}
                      onChange={e => set('currency', e.target.value)}
                      className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/60"
                    >
                      {CURRENCIES.map(c => <option key={c} value={c} className="bg-slate-800">{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">{t.paymentTerms}</label>
                    <select
                      value={data.paymentTerms}
                      onChange={e => set('paymentTerms', e.target.value)}
                      className="w-full rounded-xl bg-white/5 border border-white/10 text-white px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/60"
                    >
                      {PAYMENT_TERMS_PRESETS.map(p => <option key={p} value={p} className="bg-slate-800">{p}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label={`${t.invoicePrefix} (ex: FAC, INV…)`} value={data.invoicePrefix} onChange={v => set('invoicePrefix', v)} placeholder="FAC" />
                  <Field label={`${t.quotePrefix} (ex: DEV, QTE…)`} value={data.quotePrefix} onChange={v => set('quotePrefix', v)} placeholder="DEV" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    {t.invoiceFooter} <span className="text-slate-500 text-xs">({t.optional})</span>
                  </label>
                  <textarea
                    value={data.invoiceFooter}
                    onChange={e => set('invoiceFooter', e.target.value)}
                    placeholder="TVA non applicable, art. 293 B du CGI…"
                    rows={3}
                    className="w-full rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500
                               px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/60 resize-none"
                  />
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-white/8 flex items-center justify-between gap-3">
            {stepIdx > 0 ? (
              <button
                onClick={() => setStep(STEPS[stepIdx - 1])}
                className="px-4 py-2.5 rounded-xl border border-white/10 text-slate-300 text-sm font-medium hover:bg-white/5 transition-colors"
              >
                ← {t.back}
              </button>
            ) : <div />}

            {stepIdx < STEPS.length - 1 ? (
              <button
                onClick={() => setStep(STEPS[stepIdx + 1])}
                disabled={step === 'company' && !data.name.trim()}
                className={cn(
                  'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all',
                  data.name.trim() || step !== 'company'
                    ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/40'
                    : 'bg-white/5 text-slate-500 cursor-not-allowed'
                )}
              >
                {t.next} <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleFinish}
                disabled={saving || !data.name.trim()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/40 disabled:opacity-50 transition-all"
              >
                <Check className="w-4 h-4" />
                {saving ? t.loading : t.finish}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
