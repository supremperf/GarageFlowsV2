'use client'

import { useState } from 'react'
import { X, KeyRound, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

interface Props {
  onClose: () => void
}

export default function LicenseChangeModal({ onClose }: Props) {
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string; licenseType?: string } | null>(null)

  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI

  async function handleSubmit() {
    const t = token.trim()
    if (!t) return
    setLoading(true)
    setResult(null)

    try {
      if (isElectron) {
        const res = await (window as any).electronAPI.updateLicense(t)
        if (res.ok) {
          setResult({ ok: true, message: `Licence activée (${res.licenseType})`, licenseType: res.licenseType })
          setTimeout(() => { onClose(); window.location.reload() }, 1500)
        } else {
          setResult({ ok: false, message: res.reason ?? 'Licence invalide' })
        }
      } else {
        const res = await fetch('/api/license/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: t }),
        })
        const data = await res.json()
        if (res.ok && data.licenseType) {
          setResult({ ok: true, message: `Licence activée (${data.licenseType})`, licenseType: data.licenseType })
          setTimeout(() => { onClose(); window.location.reload() }, 1500)
        } else {
          setResult({ ok: false, message: data.error ?? 'Licence invalide' })
        }
      }
    } catch {
      setResult({ ok: false, message: 'Erreur réseau' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className="relative w-full max-w-md rounded-2xl border shadow-2xl p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain"
        style={{ background: 'var(--card-bg, #1a2235)', borderColor: 'var(--border-color, rgba(255,255,255,0.1))' }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-blue-500/20 flex items-center justify-center">
            <KeyRound className="w-4.5 h-4.5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary, #f1f5f9)' }}>
              Changer de licence
            </h2>
            <p className="text-xs" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
              Entrez votre nouvelle clé pour passer de Trial → Pro → Admin
            </p>
          </div>
        </div>

        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
          Clé de licence
        </label>
        <textarea
          value={token}
          onChange={e => setToken(e.target.value)}
          placeholder="GF2.eyJ..."
          rows={4}
          className="w-full rounded-lg border px-3 py-2 text-xs font-mono resize-none outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
          style={{
            background: 'var(--input-bg, #0d1724)',
            borderColor: 'var(--border-color, rgba(255,255,255,0.1))',
            color: 'var(--text-primary, #f1f5f9)',
          }}
          disabled={loading}
        />

        {result && (
          <div
            className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${
              result.ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
            }`}
          >
            {result.ok
              ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
              : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}
            {result.message}
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg text-xs font-medium border transition-colors"
            style={{
              borderColor: 'var(--border-color, rgba(255,255,255,0.1))',
              color: 'var(--text-secondary, #94a3b8)',
            }}
          >
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !token.trim()}
            className="flex-1 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
            {loading ? 'Activation...' : 'Activer la licence'}
          </button>
        </div>
      </div>
    </div>
  )
}
