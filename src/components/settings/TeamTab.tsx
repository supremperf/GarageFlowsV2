'use client'

/**
 * Onglet « Équipe » — comptes du personnel du garage (GF-DUR-021).
 *
 * ─── Pourquoi cet onglet existe ─────────────────────────────────────────────
 * `/api/users` liste et crée les comptes du garage depuis longtemps. Aucun écran
 * ne l'appelait. Tout le modèle de rôles du produit — OWNER, MANAGER,
 * RECEPTIONIST — reposait donc sur des comptes que personne ne pouvait créer :
 * un garage restait à l'unique compte né de son installation. Chaque contrôle de
 * permission écrit dans ce produit protégeait une distinction inatteignable.
 *
 * ─── Ce que l'écran doit dire, et qu'il serait facile de taire ──────────────
 * Le rôle n'est pas un intitulé décoratif : il décide de ce que la personne
 * pourra voir et faire. Chaque option porte donc sa conséquence en clair, plutôt
 * qu'un nom de rôle que seul l'auteur du code sait interpréter.
 *
 * Le mot de passe est choisi par le propriétaire et affiché UNE FOIS, comme pour
 * l'accès portail d'un client : seul son haché est conservé. Il n'y a pas de
 * courriel d'invitation — en inventer un donnerait l'illusion que le collègue
 * sera prévenu.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, UserPlus, Users, Copy, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'

interface Membre {
  id: string
  name: string
  email: string
  role: string
  createdAt: string
}

/** Ce que chaque rôle PEUT — jamais son seul intitulé. */
const ROLES = [
  { valeur: 'RECEPTIONIST', libelle: 'Comptoir', effet: 'Planning, clients, véhicules, devis. Ni facturation ni finances.' },
  { valeur: 'MANAGER', libelle: 'Responsable', effet: 'Tout le comptoir, plus la facturation, le stock et les finances.' },
  { valeur: 'OWNER', libelle: 'Propriétaire', effet: 'Tout, y compris les réglages, la licence et la gestion de l’équipe.' },
] as const

const TEINTE: Record<string, string> = {
  OWNER: 'text-amber-300 bg-amber-500/15',
  MANAGER: 'text-blue-300 bg-blue-500/15',
  RECEPTIONIST: 'text-emerald-300 bg-emerald-500/15',
  MECHANIC: 'text-slate-300 bg-slate-500/15',
}

const CHAMP = 'w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/60'

export function TeamTab() {
  const [membres, setMembres] = useState<Membre[] | null>(null)
  const [refus, setRefus] = useState<string | null>(null)
  const [ajout, setAjout] = useState(false)
  const [envoi, setEnvoi] = useState(false)
  const [nom, setNom] = useState('')
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [role, setRole] = useState<string>('RECEPTIONIST')
  /** Identifiants du compte créé — montrés une fois, à communiquer. */
  const [cree, setCree] = useState<{ email: string; motDePasse: string } | null>(null)

  const charger = useCallback(async () => {
    try {
      const r = await fetch('/api/users', { cache: 'no-store' })
      if (r.status === 403) {
        // La liste du personnel est réservée : le dire, plutôt que d'afficher
        // une équipe vide qui ferait croire qu'il n'y a personne.
        setRefus('La gestion de l’équipe est réservée au propriétaire et aux responsables.')
        return
      }
      const d = await r.json().catch(() => null)
      if (!r.ok || !Array.isArray(d)) { setRefus('Chargement impossible.'); return }
      setRefus(null)
      setMembres(d)
    } catch {
      setRefus('Serveur injoignable.')
    }
  }, [])

  useEffect(() => { void charger() }, [charger])

  async function creer() {
    setEnvoi(true)
    try {
      const r = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nom.trim(), email: email.trim().toLowerCase(), password: motDePasse, role }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d?.error ?? 'Création refusée par le serveur.'); return }
      // Affiché seulement APRÈS la réponse : montrer les identifiants d'un
      // compte qui n'existe pas les ferait communiquer pour rien.
      setCree({ email: email.trim().toLowerCase(), motDePasse })
      setNom(''); setEmail(''); setMotDePasse(''); setRole('RECEPTIONIST')
      setAjout(false)
      await charger()
      toast.success('Compte créé — communiquez les identifiants')
    } catch {
      toast.error('Serveur injoignable.')
    } finally {
      setEnvoi(false)
    }
  }

  const pret = nom.trim().length > 0 && email.trim().length > 0 && motDePasse.length >= 8 && !envoi

  if (refus) return <p className="py-8 text-center text-sm text-slate-500">{refus}</p>
  if (!membres) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-blue-500" /></div>

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-white">
            <Users className="h-4 w-4 text-blue-400" />Équipe du garage
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {membres.length} compte{membres.length > 1 ? 's' : ''}. Les mécaniciens se gèrent dans l’onglet dédié.
          </p>
        </div>
        {!ajout && (
          <button
            onClick={() => setAjout(true)}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
          >
            <UserPlus className="h-3.5 w-3.5" />Ajouter
          </button>
        )}
      </div>

      {ajout && (
        <div className="space-y-3 rounded-xl border border-blue-500/25 bg-white/[0.03] p-4">
          <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom et prénom" aria-label="Nom" className={CHAMP} />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Adresse e-mail (identifiant de connexion)" aria-label="Adresse e-mail" type="email" className={CHAMP} />
          <div>
            <input
              value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)}
              placeholder="Mot de passe initial" aria-label="Mot de passe initial" type="text" className={CHAMP}
            />
            <p className={cn('mt-1 text-[11px]', motDePasse.length === 0 || motDePasse.length >= 8 ? 'text-slate-600' : 'text-amber-400')}>
              8 caractères minimum. Il sera affiché une seule fois : communiquez-le à la personne.
            </p>
          </div>

          <div className="space-y-1.5">
            {ROLES.map((r) => (
              <label key={r.valeur} className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors',
                role === r.valeur ? 'border-blue-500/40 bg-blue-500/[0.08]' : 'border-white/[0.07] hover:bg-white/[0.04]',
              )}>
                <input
                  type="radio" name="role" value={r.valeur} checked={role === r.valeur}
                  onChange={() => setRole(r.valeur)} className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-sm text-slate-200">{r.libelle}</span>
                  {/* La conséquence, pas l'intitulé : c'est elle qui permet de
                      choisir sans connaître le modèle de permissions. */}
                  <span className="block text-[11px] text-slate-500">{r.effet}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={creer} disabled={!pret}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              Créer le compte
            </button>
            <button onClick={() => setAjout(false)} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-400 hover:bg-white/[0.06]">
              Annuler
            </button>
          </div>
        </div>
      )}

      {cree && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-3">
          <p className="text-[11px] font-semibold text-amber-300">
            Identifiants du nouveau compte — ils ne seront plus jamais affichés
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="flex-1 select-all rounded bg-black/30 px-2.5 py-1.5 font-mono text-xs text-white">
              {cree.email} · {cree.motDePasse}
            </code>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(`${cree.email} / ${cree.motDePasse}`)
                  .then(() => toast.success('Copié'))
                  .catch(() => toast.error('Copie impossible — sélectionnez le texte'))
              }}
              aria-label="Copier les identifiants"
              className="rounded-lg p-2 text-amber-300 transition-colors hover:bg-amber-500/15"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <ul className="space-y-2">
        {membres.map((m) => (
          <li key={m.id} className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{m.name}</p>
              <p className="truncate text-[11px] text-slate-500">{m.email}</p>
            </div>
            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold', TEINTE[m.role] ?? TEINTE.MECHANIC)}>
              {ROLES.find((r) => r.valeur === m.role)?.libelle ?? m.role}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
