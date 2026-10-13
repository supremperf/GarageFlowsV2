'use client'

import { useState, useEffect } from 'react'
import { useTranslation } from '@/lib/i18n'
import { Save, Send, Eye, EyeOff, Mail, ChevronDown, Info } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'

type ProviderId = 'gmail' | 'outlook' | 'yahoo' | 'custom'

const PROVIDERS: Record<Exclude<ProviderId, 'custom'>, { label: string; host: string; port: number; secure: boolean }> = {
  gmail:   { label: 'Gmail',           host: 'smtp.gmail.com',      port: 465, secure: true  },
  outlook: { label: 'Outlook / Hotmail', host: 'smtp.office365.com', port: 587, secure: false },
  yahoo:   { label: 'Yahoo',           host: 'smtp.mail.yahoo.com', port: 465, secure: true  },
}

function providerFromHost(host: string | null | undefined): ProviderId {
  if (!host) return 'gmail'
  const entry = (Object.entries(PROVIDERS) as [Exclude<ProviderId, 'custom'>, typeof PROVIDERS.gmail][])
    .find(([, v]) => v.host === host)
  return entry ? entry[0] : 'custom'
}

export function EmailTab() {
  const { t } = useTranslation()
  const [provider, setProvider] = useState<ProviderId>('gmail')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [from, setFrom]         = useState('')
  const [hasSavedPass, setHasSavedPass] = useState(false)

  // Advanced (custom provider)
  const [host, setHost]     = useState('')
  const [port, setPort]     = useState('587')
  const [secure, setSecure] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [testing, setTesting]   = useState(false)
  const [showPass, setShowPass] = useState(false)

  useEffect(() => {
    fetch('/api/email')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          const prov = providerFromHost(data.smtpHost)
          setProvider(prov)
          setEmail(data.smtpUser ?? '')
          setFrom(data.smtpFrom ?? '')
          setHost(data.smtpHost ?? '')
          setPort(String(data.smtpPort ?? 587))
          setSecure(data.smtpSecure ?? false)
          // Fait rapporté par le serveur, jamais déduit : un garage peut avoir
          // une adresse enregistrée SANS mot de passe (le champ affichait alors
          // « déjà enregistré » à tort, et le test échouait ensuite).
          setHasSavedPass(Boolean(data.smtpPassConfigured))
          if (prov === 'custom' && data.smtpHost) setShowAdvanced(true)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  function resolvedSmtp() {
    if (provider === 'custom') {
      return { smtpHost: host.trim(), smtpPort: Number(port) || 587, smtpSecure: secure }
    }
    const p = PROVIDERS[provider]
    return { smtpHost: p.host, smtpPort: p.port, smtpSecure: p.secure }
  }

  async function handleSave() {
    if (!email.trim()) { toast.error('Renseignez votre adresse email'); return }
    if (!hasSavedPass && !password.trim()) { toast.error('Renseignez votre mot de passe'); return }
    if (provider === 'custom' && !host.trim()) { toast.error('Renseignez le serveur SMTP'); return }

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        ...resolvedSmtp(),
        smtpUser: email.trim(),
        smtpFrom: (from.trim() || email.trim()),
      }
      if (password.trim()) body.smtpPass = password.trim()

      const res = await fetch('/api/email', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.error || 'Échec de l\'enregistrement')
      }
      if (password.trim()) { setHasSavedPass(true); setPassword('') }
      toast.success(t.emailConfigSaved ?? 'Configuration email enregistrée')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : (t.error ?? 'Erreur'))
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    if (!email.trim()) { toast.error('Renseignez votre adresse email'); return }
    if (!hasSavedPass && !password.trim()) { toast.error('Renseignez votre mot de passe'); return }

    setTesting(true)
    try {
      // On teste LES VALEURS À L'ÉCRAN, pas d'anciennes données enregistrées.
      // Le mot de passe n'est transmis que s'il vient d'être saisi ; sinon le
      // serveur réutilise le secret chiffré qu'il détient déjà.
      const body: Record<string, unknown> = {
        action: 'test',
        ...resolvedSmtp(),
        smtpUser: email.trim(),
        smtpFrom: (from.trim() || email.trim()),
      }
      if (password.trim()) body.smtpPass = password.trim()

      const res = await fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Échec du test')
      toast.success(t.emailTestOk ?? 'Email de test envoyé !')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : (t.error ?? 'Erreur'))
    } finally {
      setTesting(false)
    }
  }

  if (loading) return <div className="text-slate-500 text-sm">{t.loading ?? 'Chargement…'}</div>

  const inputCls = 'w-full rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/60 transition-all'

  return (
    <div className="space-y-5">
      {/* Intro */}
      <div className="flex items-start gap-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 px-3.5 py-3">
        <Mail className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-slate-300 leading-relaxed">
          Connectez simplement votre boîte email avec votre <strong>adresse</strong> et votre <strong>mot de passe</strong>.
          Aucune configuration technique n&apos;est nécessaire — choisissez votre fournisseur ci-dessous.
        </p>
      </div>

      {/* Provider chooser */}
      <div>
        <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wide">{t.emailProvider ?? 'Fournisseur email'}</p>
        <div className="grid grid-cols-2 gap-2">
          {(['gmail', 'outlook', 'yahoo', 'custom'] as ProviderId[]).map(id => (
            <button
              key={id}
              onClick={() => { setProvider(id); if (id === 'custom') setShowAdvanced(true) }}
              className={cn(
                'px-3 py-2 rounded-xl text-sm font-medium border transition-colors text-left',
                provider === id
                  ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                  : 'border-white/10 text-slate-300 hover:bg-white/[0.05]'
              )}
            >
              {id === 'custom' ? 'Autre fournisseur' : PROVIDERS[id].label}
            </button>
          ))}
        </div>
      </div>

      {/* Email + password */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">Adresse email</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="votre@email.com"
          className={inputCls}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">Mot de passe</label>
        <div className="relative">
          <input
            type={showPass ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder={hasSavedPass ? '•••••••• (déjà enregistré — laisser vide pour conserver)' : '••••••••••••'}
            className={cn(inputCls, 'pr-10')}
          />
          <button
            type="button"
            onClick={() => setShowPass(v => !v)}
            // Cible tactile de 44 px, icône inchangée (GF-042).
            className="absolute right-1 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center text-slate-500 hover:text-slate-300"
            aria-label={showPass ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          >
            {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expéditeur (optionnel) */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">
          Nom / adresse d&apos;expéditeur <span className="text-slate-500 font-normal">(optionnel)</span>
        </label>
        <input
          type="text"
          value={from}
          onChange={e => setFrom(e.target.value)}
          placeholder="Garage Dupont <votre@email.com>"
          className={inputCls}
        />
      </div>

      {/* Gmail / Yahoo app-password notice */}
      {(provider === 'gmail' || provider === 'yahoo') && (
        <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3.5 py-3 leading-relaxed">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            {provider === 'gmail' ? 'Gmail' : 'Yahoo'} exige un <strong>mot de passe d&apos;application</strong> (et non votre mot de passe habituel).
            Activez la validation en 2 étapes sur votre compte {provider === 'gmail' ? 'Google' : 'Yahoo'},
            puis générez un mot de passe d&apos;application dédié et collez-le ci-dessus.
          </span>
        </div>
      )}

      {/* Advanced / custom SMTP */}
      {(provider === 'custom' || showAdvanced) && (
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <button
            onClick={() => setShowAdvanced(v => !v)}
            className="w-full flex items-center justify-between px-3.5 py-2.5 text-sm text-slate-300 hover:bg-white/[0.03]"
          >
            <span className="font-medium">Paramètres avancés (serveur SMTP)</span>
            <ChevronDown className={cn('w-4 h-4 transition-transform', showAdvanced && 'rotate-180')} />
          </button>
          {showAdvanced && (
            <div className="px-3.5 pb-3.5 pt-1 space-y-3 border-t border-white/[0.05]">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Serveur SMTP</label>
                <input value={host} onChange={e => setHost(e.target.value)} placeholder="smtp.exemple.com"
                  disabled={provider !== 'custom'}
                  className={cn(inputCls, provider !== 'custom' && 'opacity-60')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Port</label>
                  <input value={port} onChange={e => setPort(e.target.value)} type="number" placeholder="587"
                    disabled={provider !== 'custom'}
                    className={cn(inputCls, provider !== 'custom' && 'opacity-60')} />
                </div>
                <label className="flex items-end gap-2 text-sm text-slate-300 cursor-pointer pb-2.5">
                  <input type="checkbox" checked={secure} disabled={provider !== 'custom'}
                    onChange={e => setSecure(e.target.checked)} className="w-4 h-4 rounded" />
                  SSL/TLS
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50 transition-all"
        >
          <Save className="w-4 h-4" />
          {saving ? (t.loading ?? 'Enregistrement…') : (t.save ?? 'Enregistrer')}
        </button>
        <button
          onClick={handleTest}
          disabled={testing}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 text-slate-300 text-sm font-medium hover:bg-white/[0.05] disabled:opacity-50 transition-all"
        >
          <Send className="w-4 h-4" />
          {testing ? (t.loading ?? 'Test…') : (t.emailTest ?? 'Tester')}
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        « Tester » envoie un vrai email de vérification à {email.trim() || 'votre adresse'} en utilisant
        les valeurs affichées ci-dessus. Pensez à enregistrer pour les conserver.
      </p>
    </div>
  )
}
