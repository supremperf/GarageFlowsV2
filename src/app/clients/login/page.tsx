'use client'

/**
 * Phase 2 — Client portal login (with 2FA step). Wired to the real
 * /api/portal/auth/login and /2fa/verify endpoints. Public route (middleware
 * skips /portal). Matches the app's dark aesthetic; responsive & accessible.
 */

import { useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Mail, Lock, ShieldCheck, AlertCircle, Loader2, KeyRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import { avecGarageSlug, lienPortail } from '@/lib/portal/garage-slug'
import { cheminPortail } from '@/lib/portal/routes'

type Step = 'password' | 'twofa'

/**
 * Où va le client une fois authentifié.
 *
 * Avec un mot de passe PROVISOIRE remis par le garage, toutes les routes du
 * portail restent fermées tant qu'il n'est pas remplacé. L'envoyer vers son
 * espace lui ferait traverser une page vide avant d'être réorienté — ce qui
 * ressemble à une panne. On l'envoie donc directement là où il peut agir.
 */
function apresConnexion(motDePasseProvisoire: unknown): string {
  if (motDePasseProvisoire !== true) return lienPortail(cheminPortail('account'))
  const cible = lienPortail(cheminPortail('password'))
  return `${cible}${cible.includes('?') ? '&' : '?'}requis=1`
}

export default function PortalLoginPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [challenge, setChallenge] = useState('')
  const [code, setCode] = useState('')
  const [useBackup, setUseBackup] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submitPassword(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/portal/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `garageSlug` : sans lui, le serveur ne sait pas de quel garage il
        // s'agit dès qu'il y en a plus d'un (GF31-AUD-019).
        body: JSON.stringify(avecGarageSlug({ email: email.trim().toLowerCase(), password })),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Connexion impossible'); return }
      if (data.requires2fa) { setChallenge(data.challenge); setStep('twofa'); return }
      router.push(apresConnexion(data.mustChangePassword))
    } catch {
      setError('Erreur réseau')
    } finally {
      setLoading(false)
    }
  }

  async function submit2fa(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const body = useBackup ? { challenge, backupCode: code } : { challenge, token: code }
      const res = await fetch('/api/portal/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Code invalide'); return }
      router.push(apresConnexion(data.mustChangePassword))
    } catch {
      setError('Erreur réseau')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0f1e] p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-black text-white">Espace client <span className="text-blue-400">GarageFlows</span></h1>
          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">Suivi de vos réparations</p>
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-[#111827]/95 p-7 shadow-2xl">
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-400" role="alert">
              <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
            </div>
          )}

          {step === 'password' ? (
            <form onSubmit={submitPassword} className="space-y-4">
              <h2 className="text-lg font-bold text-white">Connexion</h2>
              <Field icon={<Mail className="h-4 w-4 text-slate-600" />} label="Adresse email">
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" autoFocus
                  className={inputCls} placeholder="vous@email.fr" />
              </Field>
              <Field icon={<Lock className="h-4 w-4 text-slate-600" />} label="Mot de passe">
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password"
                  className={inputCls} placeholder="••••••••" />
              </Field>
              <SubmitBtn loading={loading} disabled={!email || !password}>Se connecter</SubmitBtn>
              <p className="pt-2 text-center text-xs text-slate-600">
                Pas de compte ? <Link href={lienPortail(cheminPortail('register'))} className="font-semibold text-blue-400 hover:text-blue-300">Créer un compte</Link>
              </p>
            </form>
          ) : (
            <form onSubmit={submit2fa} className="space-y-4">
              <div className="flex items-center gap-2 text-blue-300">
                <ShieldCheck className="h-5 w-5" />
                <h2 className="text-lg font-bold text-white">Double authentification</h2>
              </div>
              <p className="text-xs text-slate-500">
                {useBackup ? 'Saisissez un code de secours.' : 'Saisissez le code à 6 chiffres de votre application d’authentification.'}
              </p>
              <Field icon={<KeyRound className="h-4 w-4 text-slate-600" />} label={useBackup ? 'Code de secours' : 'Code à 6 chiffres'}>
                <input value={code} onChange={e => setCode(e.target.value)} required autoFocus inputMode={useBackup ? 'text' : 'numeric'}
                  className={inputCls} placeholder={useBackup ? 'XXXX-XXXX' : '123456'} />
              </Field>
              <SubmitBtn loading={loading} disabled={!code}>Vérifier</SubmitBtn>
              <button type="button" onClick={() => { setUseBackup(!useBackup); setCode('') }} className="w-full text-center text-xs text-slate-500 hover:text-slate-300">
                {useBackup ? 'Utiliser plutôt un code de l’application' : 'Utiliser un code de secours'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

const inputCls = 'w-full rounded-xl border border-white/[0.10] bg-white/[0.05] py-2.5 pl-9 pr-4 text-sm text-white placeholder-slate-600 transition-all focus:border-blue-500/40 focus:outline-none focus:ring-2 focus:ring-blue-500/60'

function Field({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold tracking-wide text-slate-400">{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2">{icon}</span>
        {children}
      </div>
    </div>
  )
}

function SubmitBtn({ loading, disabled, children }: { loading: boolean; disabled: boolean; children: ReactNode }) {
  return (
    <button type="submit" disabled={loading || disabled}
      className={cn('mt-1 w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition-all',
        loading || disabled ? 'cursor-not-allowed bg-blue-600/20 text-blue-400/40' : 'bg-blue-600 text-white shadow-lg shadow-blue-600/25 hover:bg-blue-500 active:scale-[0.98]')}>
      {loading ? <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Veuillez patienter…</span> : children}
    </button>
  )
}
