'use client'

import { useState, FormEvent, Suspense, useEffect } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  Mail, Lock, AlertCircle, Loader2, Eye, EyeOff,
  ShieldCheck, Wrench, CalendarDays, BarChart3, Package,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import GarageFlowLogo from '@/components/GarageFlowLogo'

// Feature pills shown beneath the logo
const FEATURES = [
  { icon: CalendarDays, label: 'Planning intelligent' },
  { icon: Wrench,       label: 'Gestion atelier' },
  { icon: BarChart3,    label: 'Statistiques live' },
  { icon: Package,      label: 'Suivi des stocks' },
]

// ── License badge (Electron only) ────────────────────────────────────────────
function LicenseBadge() {
  const [info, setInfo] = useState<{ expiryYear: number; customerId: number } | null | 'loading'>('loading')

  useEffect(() => {
    const api = (window as any).electronAPI
    if (!api?.isElectron) { setInfo(null); return }
    api.getLicenseInfo()
      .then((data: any) => setInfo(data))
      .catch(() => setInfo(null))
  }, [])

  // Not in Electron or no data
  if (info === 'loading' || !info) return null

  return (
    <div className="flex items-center justify-center gap-2 mb-5 px-4 py-2 bg-emerald-500/10 border border-emerald-500/25 rounded-xl">
      <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
      <div className="text-left">
        <p className="text-xs font-semibold text-emerald-400 leading-tight">
          Licence GarageFlow Pro · Active
        </p>
        <p className="text-[10px] text-emerald-600 leading-tight">
          Valide jusqu&apos;au 31/12/{info.expiryYear} · Client #{String(info.customerId).padStart(4, '0')}
        </p>
      </div>
    </div>
  )
}

// ── Login form ────────────────────────────────────────────────────────────────
function LoginForm() {
  const router     = useRouter()
  const params     = useSearchParams()
  const callbackUrl = params.get('callbackUrl') || '/'
  const errorParam = params.get('error')

  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error,        setError]        = useState(
    errorParam === 'CredentialsSignin' ? 'Email ou mot de passe incorrect.' : ''
  )
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const result = await signIn('credentials', {
      email:    email.trim().toLowerCase(),
      password,
      redirect: false,
    })

    setLoading(false)

    if (result?.error) {
      setError('Email ou mot de passe incorrect.')
      return
    }

    router.push(callbackUrl)
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center p-4 relative overflow-hidden">

      {/* Ambient glows */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/3 w-[500px] h-[500px] bg-blue-600/8 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-orange-500/5 rounded-full blur-3xl" />
        <div className="absolute top-0 right-0 w-72 h-72 bg-blue-900/15 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-56 h-56 bg-indigo-900/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">

        {/* ── Branding ─────────────────────────────────────────────────────── */}
        <div className="text-center mb-7">
          <div className="flex justify-center mb-4">
            <div className="relative">
              <GarageFlowLogo size={76} />
              {/* Glow ring */}
              <div className="absolute inset-0 rounded-[22px] ring-1 ring-blue-500/20 shadow-lg shadow-blue-500/20" />
            </div>
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">
            Garage<span className="text-blue-400">Flow</span>
          </h1>
          <p className="text-slate-500 text-xs mt-1.5 tracking-[0.2em] uppercase font-medium">
            Le planning intelligent pour garages
          </p>
          {/* PRO badge */}
          <div className="flex items-center justify-center gap-2.5 mt-2.5">
            <div className="h-px w-10 bg-gradient-to-r from-transparent to-orange-500/60" />
            <span className="text-orange-400 text-[10px] font-black tracking-[0.25em] uppercase">Pro</span>
            <div className="h-px w-10 bg-gradient-to-l from-transparent to-orange-500/60" />
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap justify-center gap-1.5 mt-4">
            {FEATURES.map(({ icon: Icon, label }) => (
              <span key={label} className="flex items-center gap-1 px-2 py-0.5 bg-white/[0.04] border border-white/[0.07] rounded-full text-[10px] text-slate-500 font-medium">
                <Icon className="w-2.5 h-2.5 text-slate-600" />
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* ── License badge (Electron only) ────────────────────────────────── */}
        <LicenseBadge />

        {/* ── Card ─────────────────────────────────────────────────────────── */}
        <div className="bg-[#111827]/95 backdrop-blur-xl border border-white/[0.08] rounded-2xl p-7 shadow-2xl shadow-black/60">

          <div className="mb-5">
            <h2 className="text-lg font-bold text-white">Connexion</h2>
            <p className="text-slate-500 text-xs mt-0.5">Accédez à votre espace de gestion atelier</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/25 rounded-xl flex items-center gap-2.5 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5 tracking-wide">
                Adresse email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  autoFocus
                  placeholder="jean@mongarage.fr"
                  className="w-full pl-9 pr-4 py-2.5 bg-white/[0.05] border border-white/[0.10] rounded-xl text-white placeholder-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/60 focus:border-blue-500/40 transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5 tracking-wide">
                Mot de passe
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full pl-9 pr-10 py-2.5 bg-white/[0.05] border border-white/[0.10] rounded-xl text-white placeholder-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/60 focus:border-blue-500/40 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !email || !password}
              className={cn(
                'w-full py-2.5 px-4 rounded-xl font-semibold text-sm transition-all mt-1',
                loading || !email || !password
                  ? 'bg-blue-600/20 text-blue-400/40 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-600/25 active:scale-[0.98]'
              )}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Connexion en cours…
                </span>
              ) : (
                'Se connecter'
              )}
            </button>
          </form>

          {/* Register link */}
          <div className="mt-5 pt-4 border-t border-white/[0.07] text-center">
            <p className="text-xs text-slate-600">
              Pas encore de compte ?{' '}
              <Link
                href="/register"
                className="text-blue-400 hover:text-blue-300 font-semibold transition-colors"
              >
                Créer votre garage →
              </Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-4 text-center text-[10px] text-slate-800">
          © {new Date().getFullYear()} GarageFlow · Tous droits réservés
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
