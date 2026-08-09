'use client'

import { useState, FormEvent } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Mail, Lock, User, Building2, Phone, MapPin, AlertCircle, Loader2, Check, Eye, EyeOff, ChevronRight, ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import GarageFlowLogo, { GarageFlowIcon } from '@/components/GarageFlowLogo'

type Step = 1 | 2

export default function RegisterPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Step 1 — account
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [userPassword, setUserPassword] = useState('')

  // Step 2 — garage
  const [garageName, setGarageName] = useState('')
  const [garageAddress, setGarageAddress] = useState('')
  const [garagePhone, setGaragePhone] = useState('')

  const step1Valid = userName.trim().length >= 2 && /\S+@\S+\.\S+/.test(userEmail) && userPassword.length >= 8
  const step2Valid = garageName.trim().length >= 2

  const handleStep1 = (e: FormEvent) => {
    e.preventDefault()
    if (step1Valid) setStep(2)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!step2Valid) return
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/garages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName,
          userEmail: userEmail.toLowerCase(),
          userPassword,
          garageName,
          garageAddress,
          garagePhone,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Erreur lors de la création du compte.')
        setLoading(false)
        return
      }

      // Auto-login after registration
      const login = await signIn('credentials', {
        email: userEmail.toLowerCase(),
        password: userPassword,
        redirect: false,
      })

      if (login?.error) {
        setError('Compte créé mais connexion impossible. Connectez-vous manuellement.')
        router.push('/login')
        return
      }

      router.push('/')
      router.refresh()
    } catch {
      setError('Erreur réseau. Veuillez réessayer.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/3 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/3 w-80 h-80 bg-orange-500/6 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <GarageFlowLogo size={64} />
          </div>
          <h1 className="text-2xl font-black text-white">
            Garage<span className="text-blue-400">Flows</span>
          </h1>
          <p className="text-slate-500 text-xs mt-1 tracking-widest uppercase">Créer votre espace</p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-6">
          {([1, 2] as Step[]).map(s => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div
                className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all',
                  step > s
                    ? 'bg-green-500 border-green-500 text-white'
                    : step === s
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white/5 border-white/20 text-slate-500'
                )}
              >
                {step > s ? <Check className="w-3.5 h-3.5" /> : s}
              </div>
              <span
                className={cn(
                  'text-xs font-medium flex-1',
                  step >= s ? 'text-white' : 'text-slate-500'
                )}
              >
                {s === 1 ? 'Votre compte' : 'Votre garage'}
              </span>
              {s < 2 && <div className="w-8 h-px bg-white/10" />}
            </div>
          ))}
        </div>

        <div className="bg-[#111827]/90 backdrop-blur-xl border border-white/[0.08] rounded-2xl p-8 shadow-2xl shadow-black/50">
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* ── Step 1: Account ── */}
          {step === 1 && (
            <form onSubmit={handleStep1} className="space-y-4">
              <div>
                <h2 className="text-xl font-bold text-white mb-1">Créez votre compte</h2>
                <p className="text-slate-400 text-sm mb-5">Vous serez le propriétaire du garage</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Votre nom complet
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    value={userName}
                    onChange={e => setUserName(e.target.value)}
                    required
                    placeholder="Jean Dupont"
                    className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Adresse email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="email"
                    value={userEmail}
                    onChange={e => setUserEmail(e.target.value)}
                    required
                    placeholder="jean@mongarage.fr"
                    className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Mot de passe <span className="text-slate-500 font-normal">(8 caractères min)</span>
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={userPassword}
                    onChange={e => setUserPassword(e.target.value)}
                    required
                    minLength={8}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-10 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {/* Password strength */}
                {userPassword.length > 0 && (
                  <div className="flex gap-1 mt-1.5">
                    {[1, 2, 3, 4].map(i => (
                      <div
                        key={i}
                        className={cn(
                          'h-1 flex-1 rounded-full transition-all',
                          userPassword.length >= i * 3
                            ? i <= 1 ? 'bg-red-500' : i <= 2 ? 'bg-amber-500' : i <= 3 ? 'bg-yellow-500' : 'bg-green-500'
                            : 'bg-white/10'
                        )}
                      />
                    ))}
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={!step1Valid}
                className={cn(
                  'w-full py-3 px-4 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all',
                  step1Valid
                    ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-500/25'
                    : 'bg-blue-600/30 text-blue-400/50 cursor-not-allowed'
                )}
              >
                Continuer
                <ChevronRight className="w-4 h-4" />
              </button>
            </form>
          )}

          {/* ── Step 2: Garage ── */}
          {step === 2 && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <h2 className="text-xl font-bold text-white mb-1">Votre garage</h2>
                <p className="text-slate-400 text-sm mb-5">Informations de votre atelier</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Nom du garage *
                </label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    value={garageName}
                    onChange={e => setGarageName(e.target.value)}
                    required
                    placeholder="Garage Martin"
                    className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Adresse <span className="text-slate-500 font-normal">(optionnel)</span>
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    value={garageAddress}
                    onChange={e => setGarageAddress(e.target.value)}
                    placeholder="12 rue de la Mécanique, Paris"
                    className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Téléphone <span className="text-slate-500 font-normal">(optionnel)</span>
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="tel"
                    value={garagePhone}
                    onChange={e => setGaragePhone(e.target.value)}
                    placeholder="01 23 45 67 89"
                    className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                </div>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-xs text-blue-300">
                4 mécaniciens par défaut seront créés. Vous pourrez les renommer et personnaliser leur profil depuis l&apos;application.
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-4 py-3 rounded-xl border border-white/10 text-slate-400 text-sm font-medium hover:bg-white/5 transition-colors flex items-center gap-1"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Retour
                </button>
                <button
                  type="submit"
                  disabled={loading || !step2Valid}
                  className={cn(
                    'flex-1 py-3 px-4 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all',
                    step2Valid && !loading
                      ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-500/25'
                      : 'bg-blue-600/30 text-blue-400/50 cursor-not-allowed'
                  )}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Création...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Créer mon garage
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          <p className="mt-5 text-center text-sm text-slate-500">
            Déjà un compte ?{' '}
            <Link href="/login" className="text-blue-400 hover:text-blue-300 font-medium">
              Se connecter
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
