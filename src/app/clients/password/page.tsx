'use client'

/**
 * Définition du mot de passe du client (GF-DUR-016).
 *
 * ─── Le défaut, et pourquoi il était terminal ───────────────────────────────
 * Quand le garage ouvre un accès, il remet un mot de passe TEMPORAIRE et
 * `mustChangePassword` est levé. Tant qu'il l'est, `withPortalAuth` refuse
 * TOUTES les routes du portail avec `PASSWORD_CHANGE_REQUIRED` — sauf celle qui
 * permet précisément de le changer. C'est correct, et c'est exactement ce qu'il
 * faut… à condition qu'un écran l'appelle.
 *
 * Aucun ne l'appelait. Le client se connectait, son tableau de bord recevait un
 * 403, la page traitait tout échec non-401 comme un état vide — et il voyait un
 * espace client BLANC, sans explication et sans issue. Autrement dit : chaque
 * accès ouvert par le garage produisait un client enfermé dehors, définitivement.
 *
 * ─── Deux situations, un seul écran ─────────────────────────────────────────
 * La page sert la première définition (imposée, arrivée par redirection) et le
 * changement volontaire. Le texte le dit, parce que l'attente n'est pas la
 * même : dans le premier cas le client subit une obligation qu'il n'a pas
 * demandée, et doit comprendre pourquoi.
 */

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { lienPortail } from '@/lib/portal/garage-slug'
import { cheminPortail } from '@/lib/portal/routes'

/** Même minimum que le serveur — il refuserait de toute façon en dessous. */
const MINIMUM = 10

/**
 * Frontière Suspense obligatoire autour de `useSearchParams` (GF-DUR-027).
 *
 * Sans elle, `next build` échoue au prérendu de cette page :
 *
 *     useSearchParams() should be wrapped in a suspense boundary
 *     at page "/clients/password"
 *
 * Ce qui bloquait le build de TOUTE l'application — donc le paquet Electron et
 * le déploiement PWA — à cause de la page qui sert précisément à débloquer un
 * client enfermé dehors. Aucun test ne le voyait : la suite monte le composant
 * directement, sans jamais passer par le prérendu.
 */
export default function PortalPasswordPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#0a0f1e]"><Loader2 className="h-8 w-8 animate-spin text-slate-600" /></div>}>
      <FormulaireMotDePasse />
    </Suspense>
  )
}

function FormulaireMotDePasse() {
  const router = useRouter()
  const params = useSearchParams()
  /** Arrivé par redirection depuis une route refusée : la définition est imposée. */
  const impose = params.get('requis') === '1'

  const [actuel, setActuel] = useState('')
  const [nouveau, setNouveau] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  // Une session expirée n'a rien à faire sur cet écran : on renvoie à la
  // connexion plutôt que de laisser saisir un mot de passe dans le vide.
  useEffect(() => {
    fetch('/api/portal/auth/me', { cache: 'no-store' })
      .then((r) => { if (r.status === 401) router.replace(lienPortail(cheminPortail('login'))) })
      .catch(() => {})
  }, [router])

  const identiques = nouveau.length > 0 && nouveau === confirmation
  const assezLong = nouveau.length >= MINIMUM
  const pret = actuel.length > 0 && assezLong && identiques && !envoi

  async function envoyer() {
    setEnvoi(true)
    setErreur(null)
    try {
      const r = await fetch('/api/portal/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: actuel, newPassword: nouveau }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        // Le motif du serveur est rendu tel quel : « mot de passe actuel
        // incorrect » et « identique à l'actuel » n'appellent pas la même
        // correction, et les confondre laisserait le client tâtonner.
        setErreur(d?.error ?? 'Changement refusé.')
        return
      }
      router.replace(lienPortail(cheminPortail('account')))
    } catch {
      setErreur('Serveur injoignable.')
    } finally {
      setEnvoi(false)
    }
  }

  const champ = 'w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/60'

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0f1e] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#111827]/95 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/15">
            <KeyRound className="h-4 w-4 text-blue-400" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white">
              {impose ? 'Définissez votre mot de passe' : 'Changer mon mot de passe'}
            </h1>
            <p className="text-[11px] text-slate-500">
              {impose
                ? 'Votre garage vous a remis un mot de passe provisoire. Choisissez le vôtre pour accéder à votre espace.'
                : 'Vos autres appareils connectés seront déconnectés.'}
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <div>
            <label htmlFor="actuel" className="mb-1 block text-xs font-medium text-slate-400">
              {impose ? 'Mot de passe provisoire' : 'Mot de passe actuel'}
            </label>
            <input
              id="actuel" type="password" autoComplete="current-password"
              value={actuel} onChange={(e) => setActuel(e.target.value)} className={champ}
            />
          </div>

          <div>
            <label htmlFor="nouveau" className="mb-1 block text-xs font-medium text-slate-400">
              Nouveau mot de passe
            </label>
            <input
              id="nouveau" type="password" autoComplete="new-password"
              value={nouveau} onChange={(e) => setNouveau(e.target.value)} className={champ}
            />
            <p className={`mt-1 text-[11px] ${assezLong || nouveau.length === 0 ? 'text-slate-600' : 'text-amber-400'}`}>
              {MINIMUM} caractères minimum. Une phrase dont vous vous souvenez vaut mieux qu’un mot compliqué.
            </p>
          </div>

          <div>
            <label htmlFor="confirmation" className="mb-1 block text-xs font-medium text-slate-400">
              Confirmez le nouveau mot de passe
            </label>
            <input
              id="confirmation" type="password" autoComplete="new-password"
              value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className={champ}
            />
            {/* La divergence est signalée à la saisie, pas au moment de l'envoi :
                le serveur ne voit qu'un seul des deux champs et ne peut donc
                jamais la détecter. */}
            {confirmation.length > 0 && !identiques && (
              <p className="mt-1 text-[11px] text-amber-400">Les deux saisies diffèrent.</p>
            )}
          </div>
        </div>

        {erreur && (
          <p role="alert" className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {erreur}
          </p>
        )}

        <button
          onClick={envoyer}
          disabled={!pret}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {envoi ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {impose ? 'Définir mon mot de passe' : 'Changer mon mot de passe'}
        </button>
      </div>
    </div>
  )
}
