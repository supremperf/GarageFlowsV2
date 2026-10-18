'use client'

/**
 * Configuration de la connexion à la plateforme agréée du garage.
 *
 * L'onglet e-facturation affichait « Connexion indisponible pour l'instant
 * (connecteur en préparation) » : aucun parcours de connexion n'existait. Ce
 * formulaire réalise le parcours attendu (§85) — rechercher, configurer,
 * enregistrer, TESTER RÉELLEMENT, déconnecter.
 *
 * Deux règles tenues à l'écran :
 *  - un secret déjà enregistré n'est JAMAIS réaffiché, même tronqué ; le champ
 *    reste vide et le laisser vide CONSERVE la valeur en base ;
 *  - le résultat du test est celui du serveur, horodaté — jamais un « OK »
 *    optimiste affiché sans réponse (§86).
 */

import { useEffect, useState, type FormEvent } from 'react'
import { Loader2, PlugZap, ShieldCheck, AlertTriangle, Trash2, CheckCircle2 } from 'lucide-react'

interface Connexion {
  id: string
  providerId: string
  environment: string
  status: string
  authMethod: string | null
  lastTestedAt: string | null
  lastTestOk: boolean
  settings: Record<string, string>
  secretsPresents: string[]
}

interface Props {
  /** La gestion des connexions est-elle activée par la configuration ? */
  connectionsEnabled: boolean
  /** Connecteurs réellement disponibles côté serveur. */
  adapters: Array<{ providerId: string; displayName: string }>
}

const CHAMPS_TEXTE: Array<{ cle: string; libelle: string; aide: string; requis?: boolean }> = [
  { cle: 'apiBaseUrl', libelle: 'URL de l’API', aide: 'https://… — fournie par votre plateforme', requis: true },
  { cle: 'submitPath', libelle: 'Chemin d’envoi', aide: 'ex. /v1/invoices', requis: true },
  { cle: 'statusPath', libelle: 'Chemin de statut', aide: 'doit contenir {id}, ex. /v1/invoices/{id}', requis: true },
  { cle: 'tokenUrl', libelle: 'URL du jeton (OAuth2)', aide: 'https://… — mode OAuth2 uniquement' },
  { cle: 'clientId', libelle: 'Identifiant client (OAuth2)', aide: '' },
  { cle: 'scope', libelle: 'Portée (OAuth2)', aide: 'facultatif' },
  { cle: 'apiKeyHeader', libelle: 'En-tête de clé API', aide: 'ex. x-api-key — mode clé API' },
  { cle: 'extraHeaderName', libelle: 'En-tête supplémentaire', aide: 'facultatif' },
]

const CHAMPS_SECRETS: Array<{ cle: string; libelle: string }> = [
  { cle: 'clientSecret', libelle: 'Secret client (OAuth2)' },
  { cle: 'apiKey', libelle: 'Clé API' },
  { cle: 'extraHeaderValue', libelle: 'Valeur de l’en-tête supplémentaire' },
]

export function EInvoicingConnectionForm({ connectionsEnabled, adapters }: Props) {
  const [connexion, setConnexion] = useState<Connexion | null>(null)
  const [chargement, setChargement] = useState(true)
  const [enregistrement, setEnregistrement] = useState(false)
  const [test, setTest] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null)
  const [champs, setChamps] = useState<Record<string, string>>({})
  const [authMode, setAuthMode] = useState<'oauth2' | 'api_key'>('api_key')

  useEffect(() => {
    let annule = false
    ;(async () => {
      try {
        const r = await fetch('/api/einvoicing/connection', { cache: 'no-store' })
        if (!r.ok) return
        const j = await r.json()
        if (annule) return
        setConnexion(j.connection)
        if (j.connection) {
          setChamps(j.connection.settings ?? {})
          if (j.connection.settings?.authMode === 'oauth2') setAuthMode('oauth2')
        }
      } finally {
        if (!annule) setChargement(false)
      }
    })()
    return () => { annule = true }
  }, [])

  async function enregistrer(e: FormEvent) {
    e.preventDefault()
    setEnregistrement(true)
    setMessage(null)
    try {
      const r = await fetch('/api/einvoicing/connection', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...champs, authMode, providerId: adapters[0]?.providerId }),
      })
      const j = await r.json()
      if (!r.ok) { setMessage({ ok: false, texte: j.error ?? 'Enregistrement impossible' }); return }
      setConnexion(j.connection)
      // Les champs secrets saisis ne sont pas conservés à l'écran.
      setChamps((c) => {
        const suite = { ...c }
        for (const s of CHAMPS_SECRETS) delete suite[s.cle]
        return suite
      })
      setMessage({ ok: true, texte: 'Configuration enregistrée. Testez la connexion.' })
    } catch {
      setMessage({ ok: false, texte: 'Erreur réseau' })
    } finally {
      setEnregistrement(false)
    }
  }

  async function testerConnexion() {
    setTest(true)
    setMessage(null)
    try {
      const r = await fetch('/api/einvoicing/connection/test', { method: 'POST' })
      const j = await r.json()
      // Le message vient du SERVEUR, qui a réellement appelé la plateforme.
      setMessage({ ok: Boolean(j.ok), texte: j.message ?? (j.ok ? 'Connexion établie.' : 'Échec du test.') })
      const rc = await fetch('/api/einvoicing/connection', { cache: 'no-store' })
      if (rc.ok) setConnexion((await rc.json()).connection)
    } catch {
      setMessage({ ok: false, texte: 'Erreur réseau' })
    } finally {
      setTest(false)
    }
  }

  async function deconnecter() {
    setEnregistrement(true)
    try {
      // ── Le refus du serveur était ignoré (GF-024) ─────────────────────────
      // Contrairement à `enregistrer` et `testerConnexion` juste au-dessus —
      // qui lisent tous deux la réponse — la déconnexion affirmait « Plateforme
      // déconnectée. » sans rien vérifier. Un rôle sans `settings:manage`
      // reçoit 403, un déploiement où les connexions sont désactivées reçoit
      // 409 : dans les deux cas l'écran effaçait la connexion À L'AFFICHAGE
      // seulement, et le garage la croyait coupée alors qu'elle restait active.
      const r = await fetch('/api/einvoicing/connection', { method: 'DELETE' })
      const j = await r.json().catch(() => ({} as { ok?: boolean; error?: string; disconnected?: boolean }))
      if (!r.ok || j?.ok === false) {
        setMessage({ ok: false, texte: j?.error ?? 'Déconnexion refusée par le serveur.' })
        return
      }
      setConnexion(null)
      setChamps({})
      // `disconnected` distingue « j'ai coupé la connexion » de « il n'y avait
      // rien à couper » — le champ était renvoyé par la route et jamais lu.
      setMessage({
        ok: true,
        texte: j?.disconnected === false ? 'Aucune connexion à supprimer.' : 'Plateforme déconnectée.',
      })
    } catch {
      setMessage({ ok: false, texte: 'Erreur réseau' })
    } finally {
      setEnregistrement(false)
    }
  }

  if (chargement) {
    return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-500" /></div>
  }

  if (adapters.length === 0) {
    return (
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-3">
        <h4 className="text-xs font-semibold text-slate-300">Connexion de ce garage</h4>
        <p className="text-[11px] text-slate-500 mt-1">
          Aucun connecteur n’est disponible sur ce déploiement.
        </p>
      </div>
    )
  }

  const champ = (cle: string) => champs[cle] ?? ''
  const majChamp = (cle: string, v: string) => setChamps((c) => ({ ...c, [cle]: v }))

  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
          <PlugZap className="w-3.5 h-3.5 text-blue-400" />Connexion de ce garage
        </h4>
        {connexion && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            connexion.lastTestOk ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
          }`}>
            {connexion.lastTestOk ? 'Testée' : 'Non testée'}
          </span>
        )}
      </div>

      {!connectionsEnabled && (
        <p className="text-[11px] text-amber-300/90">
          La gestion des connexions est désactivée par la configuration
          (<span className="font-mono">EINVOICING_CONNECTIONS_ENABLED</span>).
        </p>
      )}

      {connexion?.lastTestedAt && (
        <p className="text-[11px] text-slate-500">
          Dernier test : {new Date(connexion.lastTestedAt).toLocaleString('fr-FR')}
          {' · '}environnement <span className="font-mono">{connexion.environment}</span>
        </p>
      )}

      <form onSubmit={enregistrer} className="space-y-2.5">
        <div>
          <label className="text-[11px] text-slate-400">Mode d’authentification</label>
          <select
            value={authMode}
            onChange={(e) => setAuthMode(e.target.value === 'oauth2' ? 'oauth2' : 'api_key')}
            disabled={!connectionsEnabled}
            className="w-full mt-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-slate-200 disabled:opacity-50"
          >
            <option value="api_key">Clé API</option>
            <option value="oauth2">OAuth2 (client_credentials)</option>
          </select>
        </div>

        {CHAMPS_TEXTE.map((f) => (
          <div key={f.cle}>
            <label className="text-[11px] text-slate-400">
              {f.libelle}{f.requis && <span className="text-rose-400"> *</span>}
            </label>
            <input
              type="text"
              value={champ(f.cle)}
              onChange={(e) => majChamp(f.cle, e.target.value)}
              disabled={!connectionsEnabled}
              spellCheck={false}
              className="w-full mt-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50"
              placeholder={f.aide}
            />
          </div>
        ))}

        {CHAMPS_SECRETS.map((f) => {
          const dejaEnregistre = connexion?.secretsPresents?.includes(f.cle)
          return (
            <div key={f.cle}>
              <label className="text-[11px] text-slate-400">{f.libelle}</label>
              <input
                type="password"
                value={champ(f.cle)}
                onChange={(e) => majChamp(f.cle, e.target.value)}
                disabled={!connectionsEnabled}
                autoComplete="new-password"
                className="w-full mt-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50"
                placeholder={dejaEnregistre ? 'Enregistré — laisser vide pour conserver' : ''}
              />
            </div>
          )
        })}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="submit"
            disabled={!connectionsEnabled || enregistrement}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-medium flex items-center gap-1.5"
          >
            {enregistrement ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            Enregistrer
          </button>
          <button
            type="button"
            onClick={testerConnexion}
            disabled={!connexion || test}
            className="px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-40 text-slate-200 text-xs font-medium flex items-center gap-1.5"
          >
            {test ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />}
            Tester la connexion
          </button>
          {connexion && (
            <button
              type="button"
              onClick={deconnecter}
              disabled={enregistrement}
              className="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-200 text-xs font-medium flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />Déconnecter
            </button>
          )}
        </div>
      </form>

      {message && (
        <div className={`flex items-start gap-2 rounded-lg p-2.5 text-[11px] ${
          message.ok ? 'bg-emerald-500/10 text-emerald-200' : 'bg-rose-500/10 text-rose-200'
        }`}>
          {message.ok ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
          <span>{message.texte}</span>
        </div>
      )}
    </div>
  )
}
