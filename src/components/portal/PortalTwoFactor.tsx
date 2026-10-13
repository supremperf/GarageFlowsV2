'use client'

/**
 * « Double authentification » — enrôlement et désactivation (GF-DUR-026).
 *
 * ─── Pourquoi ce panneau existe ─────────────────────────────────────────────
 * Le second facteur du portail était COMPLET côté serveur : `2fa/setup`,
 * `2fa/enable`, `2fa/disable`, `2fa/verify`, secrets TOTP chiffrés au repos,
 * codes de secours hachés et à usage unique, limitation de débit, challenge
 * signé. La page de connexion savait même déjà présenter l'étape « code à six
 * chiffres ».
 *
 * Il manquait la seule chose qui rende tout cela utile : un écran pour
 * l'ACTIVER. Aucune des pages du portail n'appelait `setup` ni `enable`. La
 * protection existait, était testée, et n'a jamais protégé personne — un client
 * ne pouvait pas l'atteindre, quoi qu'il fasse. C'est la forme la plus coûteuse
 * du défaut : tout le travail est fait, et le bénéfice est nul.
 *
 * ─── Les codes de secours ne sont montrés QU'UNE FOIS ───────────────────────
 * `enable` rend dix codes en clair ; le serveur n'en garde que les empreintes.
 * Rechargez la page, et ils sont perdus pour toujours. L'écran doit donc traiter
 * ce moment comme un point de non-retour : il les affiche seuls, propose de les
 * copier ou de les télécharger, et exige une confirmation explicite avant de
 * refermer. Un simple « OK » discret suffirait à enfermer dehors un client qui
 * perd ensuite son téléphone.
 *
 * ─── Ce que l'écran refuse de taire ─────────────────────────────────────────
 * · Sans `GF_TOTP_ENC_KEY`, `setup` répond 503 `TWOFA_UNAVAILABLE`. C'est un
 *   refus VOLONTAIRE (un secret non chiffrable ne doit pas être écrit), pas une
 *   panne : le texte le dit, plutôt que d'afficher « erreur » et laisser le
 *   client réessayer indéfiniment.
 * · Le nombre de codes restants est affiché en permanence. Ils s'épuisent
 *   silencieusement à chaque usage, et c'est le seul moyen de rentrer quand on
 *   n'a plus son téléphone.
 * · La désactivation exige le mot de passe du compte : le formulaire le demande
 *   d'emblée, au lieu de faire cliquer puis d'annoncer un refus.
 */

import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, ShieldOff, Loader2, Copy, Check, Download, KeyRound } from 'lucide-react'

/** Ce que `GET /api/portal/auth/me` dit de l'état du second facteur. */
interface EtatDeuxFacteurs {
  actif: boolean
  codesRestants: number
}

/** Ce que `POST /2fa/setup` rend pour configurer l'application. */
interface Configuration {
  secret: string
  otpauth: string
  qrDataUrl: string
}

/** En dessous, on alerte : c'est la seule porte de secours restante. */
const SEUIL_CODES_BAS = 3

export function PortalTwoFactor() {
  const [etat, setEtat] = useState<EtatDeuxFacteurs | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  /** Refus de service explicite : la clé de chiffrement manque côté serveur. */
  const [indisponible, setIndisponible] = useState(false)
  const [occupe, setOccupe] = useState(false)

  // Enrôlement en cours.
  const [config, setConfig] = useState<Configuration | null>(null)
  const [code, setCode] = useState('')
  const [codesSecours, setCodesSecours] = useState<string[] | null>(null)

  // Désactivation.
  const [desactivation, setDesactivation] = useState(false)
  const [motDePasse, setMotDePasse] = useState('')

  const charger = useCallback(async () => {
    try {
      const r = await fetch('/api/portal/auth/me', { cache: 'no-store' })
      const d = await r.json().catch(() => null)
      if (!r.ok || !d) { setErreur('Impossible de lire l’état de votre compte.'); return }
      setErreur(null)
      setEtat({
        actif: Boolean(d.user?.twoFactorEnabled),
        codesRestants: Number(d.backupCodesRemaining ?? 0),
      })
    } catch {
      setErreur('Serveur injoignable.')
    }
  }, [])

  useEffect(() => { void charger() }, [charger])

  async function commencer() {
    setOccupe(true)
    setErreur(null)
    try {
      const r = await fetch('/api/portal/auth/2fa/setup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      const d = await r.json().catch(() => ({}))
      if (r.status === 503 && d?.code === 'TWOFA_UNAVAILABLE') { setIndisponible(true); return }
      if (!r.ok) { setErreur(d?.error ?? 'Configuration impossible.'); return }
      setConfig({ secret: d.secret, otpauth: d.otpauth, qrDataUrl: d.qrDataUrl })
      setCode('')
    } catch {
      setErreur('Serveur injoignable.')
    } finally {
      setOccupe(false)
    }
  }

  async function activer(e: React.FormEvent) {
    e.preventDefault()
    setOccupe(true)
    setErreur(null)
    try {
      const r = await fetch('/api/portal/auth/2fa/enable', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: code.trim() }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErreur(d?.error ?? 'Code invalide.'); return }
      // Point de non-retour : ces dix codes ne seront JAMAIS réaffichés. On
      // quitte l'écran de configuration pour n'exposer qu'eux.
      setConfig(null)
      setCodesSecours(Array.isArray(d.backupCodes) ? d.backupCodes : [])
      await charger()
    } catch {
      setErreur('Serveur injoignable.')
    } finally {
      setOccupe(false)
    }
  }

  async function desactiver(e: React.FormEvent) {
    e.preventDefault()
    setOccupe(true)
    setErreur(null)
    try {
      const r = await fetch('/api/portal/auth/2fa/disable', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: motDePasse }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErreur(d?.error ?? 'Désactivation refusée.'); return }
      setDesactivation(false)
      setMotDePasse('')
      await charger()
    } catch {
      setErreur('Serveur injoignable.')
    } finally {
      setOccupe(false)
    }
  }

  if (!etat && !erreur) return <Loader2 className="h-4 w-4 animate-spin text-slate-600" />

  // ── Refus de service assumé : dire lequel, et ne pas proposer de réessayer ──
  if (indisponible) {
    return (
      <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-3 text-xs text-amber-300" role="status">
        <p className="font-semibold">La double authentification n’est pas disponible sur ce service.</p>
        <p className="mt-1 text-amber-300/80">
          Votre garage doit d’abord activer le chiffrement des secrets. Ce n’est pas une panne :
          tant que ce n’est pas fait, votre second facteur ne pourrait pas être protégé
          correctement, et il vaut mieux ne pas l’activer du tout.
        </p>
      </div>
    )
  }

  // ── Les codes de secours, montrés une seule fois ────────────────────────────
  if (codesSecours) {
    return <CodesSecours codes={codesSecours} onTermine={() => setCodesSecours(null)} />
  }

  // ── Configuration en cours ──────────────────────────────────────────────────
  if (config) {
    return (
      <form onSubmit={activer} className="space-y-3">
        <p className="text-[11px] text-slate-500">
          Scannez ce QR code avec votre application d’authentification (Google Authenticator,
          Authy, le gestionnaire de mots de passe de votre téléphone…), puis saisissez le code
          à six chiffres qu’elle affiche.
        </p>
        <div className="flex flex-col items-center gap-3 rounded-lg border border-white/[0.05] bg-white/[0.02] p-4 sm:flex-row sm:items-start">
          {/* Le QR est rendu par le serveur (data URL) : aucune dépendance
              cliente, et le secret ne transite pas par un service tiers. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={config.qrDataUrl} alt="QR code de configuration de la double authentification" className="h-40 w-40 shrink-0 rounded-lg bg-white p-2" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[11px] text-slate-500">
              Impossible de scanner ? Saisissez cette clé à la main dans votre application :
            </p>
            <ClePartagee valeur={config.secret} />
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-slate-400">Code affiché par l’application</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={6}
            required
            className="w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm tracking-[0.3em] text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
          />
        </label>

        {erreur && <p role="alert" className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">{erreur}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={occupe}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {occupe ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Activer
          </button>
          <button
            type="button"
            onClick={() => { setConfig(null); setErreur(null) }}
            disabled={occupe}
            className="rounded-lg border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-white/[0.06] disabled:opacity-50"
          >
            Annuler
          </button>
        </div>
      </form>
    )
  }

  // ── Second facteur ACTIF ────────────────────────────────────────────────────
  if (etat?.actif) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-2.5">
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-emerald-200">Activée</div>
            <div className="text-[11px] text-emerald-300/70">
              Un code de votre application vous sera demandé à chaque connexion.
            </div>
          </div>
        </div>

        {/* Les codes s'épuisent sans bruit. C'est la seule porte de secours si
            le téléphone est perdu : le compte s'affiche, il ne se devine pas. */}
        <div className={etat.codesRestants <= SEUIL_CODES_BAS
          ? 'rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300'
          : 'rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2.5 text-xs text-slate-400'}
        >
          <span className="font-semibold">
            {etat.codesRestants} code{etat.codesRestants > 1 ? 's' : ''} de secours restant{etat.codesRestants > 1 ? 's' : ''}.
          </span>{' '}
          {etat.codesRestants === 0
            ? 'Vous n’en avez plus : si vous perdez votre téléphone, vous ne pourrez plus vous connecter sans l’aide de votre garage. Désactivez puis réactivez la double authentification pour en obtenir de nouveaux.'
            : 'Chacun ne sert qu’une fois. Gardez-les hors de votre téléphone — ils servent précisément quand vous ne l’avez plus.'}
        </div>

        {!desactivation ? (
          <button
            onClick={() => { setDesactivation(true); setErreur(null) }}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition-colors hover:bg-red-500/10 hover:text-red-300"
          >
            <ShieldOff className="h-3.5 w-3.5" /> Désactiver
          </button>
        ) : (
          <form onSubmit={desactiver} className="space-y-2 rounded-lg border border-white/[0.05] bg-white/[0.02] p-3">
            <p className="text-[11px] text-slate-400">
              Votre compte ne sera plus protégé que par son mot de passe. Confirmez avec ce
              mot de passe pour continuer.
            </p>
            <input
              type="password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              autoComplete="current-password"
              placeholder="Votre mot de passe"
              required
              className="w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
            />
            {erreur && <p role="alert" className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">{erreur}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={occupe}
                className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-50"
              >
                {occupe ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldOff className="h-3.5 w-3.5" />}
                Confirmer la désactivation
              </button>
              <button
                type="button"
                onClick={() => { setDesactivation(false); setMotDePasse(''); setErreur(null) }}
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

  // ── Second facteur INACTIF ──────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-slate-500">
        Ajoutez un code à usage unique, généré par votre téléphone, en plus de votre mot de
        passe. Même si quelqu’un apprend votre mot de passe, il ne pourra pas entrer.
      </p>
      {erreur && <p role="alert" className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">{erreur}</p>}
      <button
        onClick={commencer}
        disabled={occupe}
        className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {occupe ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
        Activer la double authentification
      </button>
    </div>
  )
}

/** Clé partagée en clair, avec copie — l'écrire à la main est pénible et fautif. */
function ClePartagee({ valeur }: { valeur: string }) {
  const [copie, setCopie] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 break-all rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] tracking-wider text-slate-300">
        {valeur}
      </code>
      <button
        type="button"
        onClick={() => { void copier(valeur).then((ok) => { if (ok) { setCopie(true); setTimeout(() => setCopie(false), 1500) } }) }}
        aria-label="Copier la clé"
        className="shrink-0 rounded-lg border border-white/10 p-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
      >
        {copie ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

/**
 * Les dix codes de secours — affichés UNE SEULE FOIS.
 *
 * Le bouton de fermeture reste désactivé tant que le client n'a pas coché la
 * case : c'est le seul instant où il peut les mettre à l'abri, et il n'aura
 * aucun moyen de revenir en arrière. Le télécharger produit un fichier local,
 * jamais un envoi — ces codes ne doivent pas repartir sur le réseau.
 */
function CodesSecours({ codes, onTermine }: { codes: string[]; onTermine: () => void }) {
  const [copie, setCopie] = useState(false)
  const [compris, setCompris] = useState(false)
  const texte = codes.join('\n')

  function telecharger() {
    const url = URL.createObjectURL(new Blob([
      'Codes de secours GarageFlows\n',
      'Chacun ne peut servir qu’une seule fois.\n\n',
      texte,
      '\n',
    ], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'garageflows-codes-de-secours.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300" role="alert">
        <p className="font-semibold">Double authentification activée. Voici vos codes de secours.</p>
        <p className="mt-1 text-amber-300/80">
          Ils ne seront plus jamais affichés. Notez-les ou téléchargez-les maintenant : ce sont
          eux qui vous permettront de vous connecter si vous perdez votre téléphone. Chacun ne
          sert qu’une fois.
        </p>
      </div>

      <ul className="grid grid-cols-2 gap-2 rounded-lg border border-white/[0.05] bg-black/30 p-3 sm:grid-cols-3">
        {codes.map((c) => (
          <li key={c} className="text-center font-mono text-sm tracking-wider text-slate-200">{c}</li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => { void copier(texte).then((ok) => { if (ok) { setCopie(true); setTimeout(() => setCopie(false), 1500) } }) }}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-white/[0.06]"
        >
          {copie ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          {copie ? 'Copiés' : 'Copier'}
        </button>
        <button
          type="button"
          onClick={telecharger}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-white/[0.06]"
        >
          <Download className="h-3.5 w-3.5" /> Télécharger
        </button>
      </div>

      <label className="flex items-start gap-2 text-[11px] text-slate-400">
        <input
          type="checkbox"
          checked={compris}
          onChange={(e) => setCompris(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-white/20 bg-white/[0.05]"
        />
        <span>J’ai mis ces codes en lieu sûr et je comprends qu’ils ne seront pas réaffichés.</span>
      </label>

      <button
        type="button"
        onClick={onTermine}
        disabled={!compris}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
      >
        <KeyRound className="h-4 w-4" /> Terminer
      </button>
    </div>
  )
}

/** Copie dans le presse-papiers — indisponible hors HTTPS, d'où le booléen. */
async function copier(valeur: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(valeur)
    return true
  } catch {
    return false
  }
}
