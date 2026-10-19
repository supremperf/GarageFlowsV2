'use client'

/**
 * « Mon adresse e-mail » — demande de changement par le client (GF-DUR-028).
 *
 * ─── Pourquoi ce panneau existe ─────────────────────────────────────────────
 * `PUT /api/portal/auth/email` était complète et éprouvée : mot de passe exigé,
 * mise en attente, jeton de confirmation envoyé sur la NOUVELLE adresse,
 * collision refusée d'avance, propagation vers la fiche du garage à la
 * confirmation. Aucun écran ne l'appelait.
 *
 * Le garage, lui, pouvait déjà changer l'adresse d'un client depuis sa fiche.
 * Le client, non : il devait téléphoner à son garage pour corriger sa propre
 * adresse de connexion — y compris quand c'est cette boîte-là qu'il vient de
 * perdre, c'est-à-dire précisément quand il en a besoin.
 *
 * ─── Ce que l'écran doit dire ───────────────────────────────────────────────
 * · L'adresse ne change PAS tout de suite. Le client continue de se connecter
 *   avec l'ancienne tant qu'il n'a pas cliqué le lien. Le taire produirait un
 *   client persuadé d'avoir changé d'identifiant, qui ne se reconnecte plus.
 * · Une demande en attente est affichée au retour sur la page. Sans cela, un
 *   rechargement effacerait toute trace de sa demande.
 * · L'envoi peut ÉCHOUER (garage sans SMTP configuré). Le serveur le dit
 *   (`emailEnvoye`), l'écran le répète : sans message reçu, aucun moyen de
 *   confirmer, et l'ancienne adresse reste la seule valable.
 */

import { useCallback, useEffect, useState } from 'react'
import { Mail, MailCheck, Loader2, AlertTriangle } from 'lucide-react'

interface EtatAdresse {
  actuelle: string
  verifiee: boolean
  enAttente: string | null
}

export function PortalEmail() {
  const [etat, setEtat] = useState<EtatAdresse | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [succes, setSucces] = useState<string | null>(null)
  /** Vrai quand la demande a abouti mais que le message n'est PAS parti. */
  const [envoiManque, setEnvoiManque] = useState(false)
  const [ouvert, setOuvert] = useState(false)
  const [occupe, setOccupe] = useState(false)
  const [nouvelle, setNouvelle] = useState('')
  const [motDePasse, setMotDePasse] = useState('')

  const charger = useCallback(async () => {
    try {
      const r = await fetch('/api/portal/auth/me', { cache: 'no-store' })
      const d = await r.json().catch(() => null)
      if (!r.ok || !d) { setErreur('Impossible de lire votre adresse.'); return }
      setErreur(null)
      setEtat({
        actuelle: String(d.user?.email ?? ''),
        verifiee: Boolean(d.user?.emailVerified),
        enAttente: d.user?.pendingEmail ?? null,
      })
    } catch {
      setErreur('Serveur injoignable.')
    }
  }, [])

  useEffect(() => { void charger() }, [charger])

  async function demander(e: React.FormEvent) {
    e.preventDefault()
    setOccupe(true)
    setErreur(null)
    setSucces(null)
    setEnvoiManque(false)
    try {
      const r = await fetch('/api/portal/auth/email', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: nouvelle.trim().toLowerCase(), currentPassword: motDePasse }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErreur(d?.error ?? 'Demande refusée.'); return }
      // Le serveur dit LUI-MÊME si le message est parti : le déduire du succès
      // de la requête ferait promettre un e-mail que le client n'aura jamais.
      setEnvoiManque(d.emailEnvoye === false)
      setSucces(String(d.message ?? 'Demande enregistrée.'))
      setOuvert(false)
      setNouvelle('')
      setMotDePasse('')
      await charger()
    } catch {
      setErreur('Serveur injoignable.')
    } finally {
      setOccupe(false)
    }
  }

  if (!etat && !erreur) return <Loader2 className="h-4 w-4 animate-spin text-slate-600" />
  if (!etat) return <p className="text-xs text-red-400">{erreur}</p>

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2.5">
        <Mail className="h-4 w-4 shrink-0 text-slate-600" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-200">{etat.actuelle}</div>
          <div className="text-[11px] text-slate-500">
            {etat.verifiee
              ? 'Adresse confirmée · c’est votre identifiant de connexion.'
              : 'Adresse NON confirmée · vos documents ne peuvent pas encore vous être montrés.'}
          </div>
        </div>
      </div>

      {/* Demande en cours : le rappeler au retour sur la page, sinon le client
          croit que sa demande n'a pas été prise. */}
      {etat.enAttente && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300" role="status">
          <p className="flex items-center gap-1.5 font-semibold">
            <MailCheck className="h-3.5 w-3.5" /> Changement en attente : {etat.enAttente}
          </p>
          <p className="mt-1 text-amber-300/80">
            Ouvrez le lien envoyé à cette nouvelle adresse pour la confirmer. D’ici là, vous
            continuez à vous connecter avec <strong>{etat.actuelle}</strong>.
          </p>
        </div>
      )}

      {succes && !envoiManque && (
        <p role="status" className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{succes}</p>
      )}
      {succes && envoiManque && (
        <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{succes}</span>
        </p>
      )}

      {!ouvert ? (
        <button
          onClick={() => { setOuvert(true); setErreur(null); setSucces(null) }}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-white/[0.08]"
        >
          <Mail className="h-3.5 w-3.5" /> Changer d’adresse
        </button>
      ) : (
        <form onSubmit={demander} className="space-y-2 rounded-lg border border-white/[0.05] bg-white/[0.02] p-3">
          <p className="text-[11px] text-slate-400">
            Votre adresse ne changera qu’après confirmation : un lien partira sur la
            <strong> nouvelle</strong> adresse. Jusqu’à ce que vous l’ouvriez, l’ancienne reste
            votre identifiant.
          </p>
          <input
            type="email"
            value={nouvelle}
            onChange={(e) => setNouvelle(e.target.value)}
            autoComplete="email"
            placeholder="nouvelle@adresse.fr"
            required
            className="w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
          />
          {/* Le serveur l'exige : un cookie volé suffirait sinon à s'approprier
              le compte en changeant son identifiant. */}
          <input
            type="password"
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
            autoComplete="current-password"
            placeholder="Votre mot de passe actuel"
            required
            className="w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
          />
          {erreur && <p role="alert" className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">{erreur}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={occupe}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {occupe ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MailCheck className="h-3.5 w-3.5" />}
              Envoyer la confirmation
            </button>
            <button
              type="button"
              onClick={() => { setOuvert(false); setNouvelle(''); setMotDePasse(''); setErreur(null) }}
              disabled={occupe}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-white/[0.06] disabled:opacity-50"
            >
              Annuler
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
