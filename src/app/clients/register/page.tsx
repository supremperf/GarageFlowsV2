'use client'

/**
 * Phase 2 — Client portal registration. Wired to POST /api/portal/auth/register.
 */

import { useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { User, Mail, Lock, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { avecGarageSlug, lienPortail } from '@/lib/portal/garage-slug'
import { cheminPortail } from '@/lib/portal/routes'

export default function PortalRegisterPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [courrielEnvoye, setCourrielEnvoye] = useState(true)
  const [loading, setLoading] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/portal/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `garageSlug` : idem connexion — obligatoire dès qu'il y a plus d'un
        // garage en base, ce qui est la norme sur le déploiement PWA
        // (GF31-AUD-019).
        body: JSON.stringify(avecGarageSlug({ name: name.trim(), email: email.trim().toLowerCase(), password })),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Inscription impossible'); return }
      setDone(true)
      // Le serveur dit s'il a RÉELLEMENT envoyé le lien de vérification. Sans
      // ce report, un envoi raté (garage sans SMTP configuré) s'affichait
      // « Compte créé » et le client attendait indéfiniment un courriel qui
      // n'existait pas.
      setCourrielEnvoye(data.verificationEmailSent !== false)
      // On ne précipite pas la redirection quand il y a un message à lire.
      setTimeout(() => router.push(lienPortail(cheminPortail('login'))), data.verificationEmailSent === false ? 6000 : 1500)
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
          <h1 className="text-2xl font-black text-white">Créer un compte <span className="text-blue-400">client</span></h1>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-[#111827]/95 p-7 shadow-2xl">
          {error && <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-400" role="alert"><AlertCircle className="h-4 w-4" /> {error}</div>}
          {done ? (
            <div className="flex flex-col items-center gap-2 py-6 text-emerald-400">
              <CheckCircle2 className="h-10 w-10" />
              {/* La réponse du serveur est VOLONTAIREMENT indifférenciable :
                  une adresse déjà inscrite reçoit la même réponse qu'une
                  nouvelle, pour ne pas révéler qui possède un compte. Annoncer
                  « Compte créé » trahissait cette prudence dans l'autre sens :
                  le client qui en avait déjà un repartait persuadé d'en avoir
                  créé un second, et attendait un courriel de vérification qui
                  ne viendrait jamais — celui qu'il reçoit lui dit l'inverse.
                  On dit donc ce qui est vrai dans les DEUX cas. */}
              <p className="text-sm">Vérifiez votre boîte mail</p>
              {courrielEnvoye ? (
                <p className="text-center text-xs text-slate-400">
                  Un lien de vérification vient de vous être envoyé par courriel.
                </p>
              ) : (
                <p className="text-center text-xs text-amber-400" role="status">
                  Le lien de vérification n’a pas pu être envoyé. Contactez votre garage
                  pour le recevoir : tant que votre adresse n’est pas vérifiée, vos
                  documents ne s’affichent pas.
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <Field icon={<User className="h-4 w-4 text-slate-600" />} label="Nom">
                <input value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="Jean Dupont" autoFocus />
              </Field>
              <Field icon={<Mail className="h-4 w-4 text-slate-600" />} label="Adresse email">
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" className={inputCls} placeholder="vous@email.fr" />
              </Field>
              <Field icon={<Lock className="h-4 w-4 text-slate-600" />} label="Mot de passe (min. 8 caractères)">
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" className={inputCls} placeholder="••••••••" />
              </Field>
              <button type="submit" disabled={loading || !email || password.length < 8}
                className={cn('mt-1 w-full rounded-xl px-4 py-3 text-sm font-semibold transition-all',
                  loading || !email || password.length < 8 ? 'gf-btn-inactif' : 'bg-blue-600 text-white shadow-lg shadow-blue-600/25 hover:bg-blue-500 active:scale-[0.98]')}>
                {loading ? <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Création…</span> : 'Créer mon compte'}
              </button>
              <p className="pt-2 text-center text-xs text-slate-600">
                Déjà inscrit ? <Link href={lienPortail(cheminPortail('login'))} className="font-semibold text-blue-400 hover:text-blue-300">Se connecter</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

const inputCls = 'w-full rounded-xl border border-white/[0.10] bg-white/[0.05] py-3 pl-9 pr-4 text-sm text-white placeholder-slate-600 transition-all focus:border-blue-500/40 focus:outline-none focus:ring-2 focus:ring-blue-500/60'

function Field({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    // Le champ est ENGLOBÉ par l'étiquette : l'association est alors implicite,
    // sans identifiant à propager. Auparavant `<label>` et `<input>` étaient
    // frères, sans `htmlFor` ni `id` — un client qui utilise le retour vocal de
    // son téléphone ne savait pas quel champ il remplissait, sur les deux
    // premiers écrans du portail. Toucher l'étiquette ne donnait pas non plus
    // le focus au champ.
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold tracking-wide text-slate-300">{label}</span>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2">{icon}</span>
        {children}
      </div>
    </label>
  )
}
