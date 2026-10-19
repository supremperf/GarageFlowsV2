'use client'

/**
 * Onglet « Facturation électronique ».
 *
 * Affiche l'état (drapeaux de configuration), le catalogue PUBLIC des plateformes
 * (recherche insensible à la casse/accents, préfixe d'abord) et le formulaire de
 * connexion RÉEL à la plateforme du garage.
 *
 * Le statut « À venir » ne doit apparaître que si AUCUN connecteur ne permet de
 * configurer la plateforme. GarageFlows embarque un connecteur générique réel
 * (`generic-pa`) : une plateforme sans connecteur dédié est donc affichée
 * « Configuration requise », pas « À venir ». Le serveur calcule ce statut
 * (`presentIntegrationStatus`) et l'interface le rend tel quel — elle ne le
 * réinvente pas.
 *
 * AUCUN secret, AUCUNE donnée d'un autre garage : les données proviennent de
 * `GET /api/einvoicing/status`, réservé au propriétaire/responsable (OWNER/MANAGER).
 */

import { useEffect, useMemo, useState } from 'react'
import { Loader2, ReceiptText, Search, Info, Lock } from 'lucide-react'
import {
  searchPlatforms,
  type ApprovedEInvoicePlatform,
  type EInvoiceIntegrationStatus,
  type EInvoiceApprovalStatus,
} from '@/lib/einvoicing/catalog'
import type { EInvoicingFlags } from '@/lib/einvoicing/flags'
import { EInvoicingConnectionForm } from './EInvoicingConnectionForm'
import toast from 'react-hot-toast'
import { ouvrirLienExterne, messageRefusLien } from '@/lib/lien-externe'

interface StatusResponse {
  flags: EInvoicingFlags
  platforms: Array<ApprovedEInvoicePlatform & {
    connectable?: boolean
    /** Un connecteur DÉDIÉ existe pour cette plateforme (sinon : générique). */
    dedicatedAdapter?: boolean
    officialWebsite?: string | null
  }>
  /** Provenance du catalogue — affichée, jamais masquée (§82). */
  catalogSource?: {
    jeuDeDonnees: string; portail: string; licence: string
    autoriteDeReference: string; avertissement: string; importedAt: string
  }
  /** Connecteurs réellement disponibles côté serveur. */
  adapters?: Array<{ providerId: string; displayName: string }>
  connection: null
}

const INTEGRATION_STYLE: Record<EInvoiceIntegrationStatus, string> = {
  available: 'bg-emerald-500/15 text-emerald-300',
  configuration_required: 'bg-blue-500/15 text-blue-300',
  coming_soon: 'bg-amber-500/15 text-amber-300',
  not_supported: 'bg-slate-500/15 text-slate-400',
}
const INTEGRATION_LABEL: Record<EInvoiceIntegrationStatus, string> = {
  available: 'Disponible',
  configuration_required: 'Configuration requise',
  coming_soon: 'À venir',
  not_supported: 'Non pris en charge',
}
const APPROVAL_LABEL: Record<EInvoiceApprovalStatus, string> = {
  approved: 'Agréée',
  provisionally_approved: 'Agréée à titre provisoire',
  suspended: 'Suspendue',
  withdrawn: 'Retirée',
}

export function EInvoicingTab() {
  const [data, setData] = useState<StatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  /**
   * Ouverture d'un lien du catalogue. Sous Electron, elle passe par le pont
   * dédié ; un refus est DIT, jamais avalé — c'était tout le défaut (GF-025).
   */
  async function ouvrir(e: React.MouseEvent<HTMLAnchorElement>) {
    const r = await ouvrirLienExterne(e)
    if (!r.ouvert) toast.error(messageRefusLien(r))
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/einvoicing/status', { cache: 'no-store' })
        if (!res.ok) {
          const msg = await res.json().then((d) => (d && typeof d.error === 'string' ? d.error : null)).catch(() => null)
          if (!cancelled) setError(msg ?? 'Chargement impossible')
          return
        }
        const json = (await res.json()) as StatusResponse
        if (!cancelled) setData(json)
      } catch {
        if (!cancelled) setError('Erreur réseau')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // `searchPlatforms` est typé sur le catalogue métier ; la réponse de l'API
  // porte en plus des champs de PRÉSENTATION (connectable, site officiel) qui
  // n'ont pas leur place dans le type du catalogue. On conserve donc le type
  // enrichi en sortie plutôt que d'élargir le modèle métier.
  const results = useMemo(
    () => (data ? (searchPlatforms(query, data.platforms) as StatusResponse['platforms']) : []),
    [data, query],
  )

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>

  if (error) {
    return (
      <div className="text-center py-10 text-slate-400 text-sm">
        <ReceiptText className="w-8 h-8 mx-auto mb-3 opacity-40" />
        {error}
      </div>
    )
  }

  // Défensif : une réponse API sans `flags` (forme inattendue) ne doit pas
  // crasher l'onglet — on retombe sur un état désactivé sûr.
  const flags = data!.flags ?? { enabled: false, sandboxOnly: false, defaultEnvironment: 'sandbox' }

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div>
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <ReceiptText className="w-4 h-4 text-blue-400" />Facturation électronique
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          {"Registre officiel des plateformes agréées, et connexion de votre garage à la sienne."}
        </p>
      </div>

      {/* Bandeau d'état honnête : rien n'est encore actif */}
      <div className="flex items-start gap-2 bg-blue-500/[0.07] border border-blue-500/20 rounded-xl p-3">
        <Info className="w-4 h-4 text-blue-300 mt-0.5 shrink-0" />
        <div className="text-[11px] text-slate-300 leading-relaxed">
          {flags.enabled
            ? <>La fonctionnalité est <span className="text-emerald-300 font-medium">activée</span>{flags.sandboxOnly && <> en mode <span className="text-amber-300 font-medium">sandbox</span> (aucune transmission réelle)</>}.</>
            : <>La fonctionnalité est <span className="text-amber-300 font-medium">désactivée</span> par défaut. {"Ce catalogue reste consultable ; aucune connexion ni transmission n'est possible pour l'instant."}</>}
          <span className="block mt-1 text-slate-500">
            Environnement : <span className="font-mono">{flags.defaultEnvironment}</span>. {"Une plateforme ne devient connectable qu'avec un connecteur réel et testé."}
          </span>
        </div>
      </div>

      {/* Recherche */}
      <div>
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une plateforme (ex. tapez « A »)…"
            spellCheck={false}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>
        <p className="text-[11px] text-slate-600 mt-1.5">{results.length} plateforme(s)</p>
      </div>

      {/* Résultats */}
      {results.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-sm">Aucune plateforme ne correspond.</div>
      ) : (
        <ul className="space-y-2">
          {results.map((p) => (
            <li key={p.id} className="bg-[#0d1424] border border-white/[0.06] rounded-xl p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-white font-medium truncate">{p.officialName}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {APPROVAL_LABEL[p.approvalStatus]}
                    {p.officialRegistrationNumber ? ` · n° ${p.officialRegistrationNumber}` : ''}
                  </p>
                </div>
                <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium ${INTEGRATION_STYLE[p.integrationStatus]}`}>
                  {INTEGRATION_LABEL[p.integrationStatus]}
                </span>
              </div>

              {/* Capacités annoncées par le catalogue (informatif) */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(p.authenticationMethods ?? []).map((m) => (
                  <span key={m} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-slate-400 font-mono">{m}</span>
                ))}
              </div>

              {/* Statut RÉEL, calculé côté serveur : connecteur DÉDIÉ, sinon
                  connecteur GÉNÉRIQUE réel, sinon rien. L'API fait foi. */}
              <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                {p.dedicatedAdapter
                  ? <>{"Connecteur dédié disponible : configurez-le ci-dessous."}</>
                  : p.connectable
                    ? <>{"Configurable via le connecteur générique ci-dessous, avec les identifiants fournis par votre plateforme."}</>
                    : <><Lock className="w-3.5 h-3.5" />{"Aucun connecteur disponible : la connexion n’est pas proposée."}</>}
              </div>
              {p.officialWebsite && (
                <a
                  href={p.officialWebsite}
                  target="_blank"
                  rel="noopener noreferrer"
                  // Dans l'application packagée, ce lien ne faisait RIEN : aucun
                  // hôte du catalogue n'est dans la liste blanche d'ouverture
                  // externe (GF-025).
                  onClick={ouvrir}
                  className="mt-1 inline-block text-[11px] text-blue-400 hover:text-blue-300"
                >
                  Site de la plateforme
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Connexion RÉELLE du garage à sa plateforme. */}
      <EInvoicingConnectionForm
        connectionsEnabled={Boolean(flags.connectionsEnabled)}
        adapters={data!.adapters ?? []}
      />

      {/* Provenance du catalogue — l'utilisateur doit savoir d'où vient cette
          liste et quelle autorité fait foi (§82). */}
      {data!.catalogSource && (
        <p className="text-[10px] text-slate-600 leading-relaxed">
          Source : {data!.catalogSource.jeuDeDonnees} ({data!.catalogSource.licence}), importée le{' '}
          {data!.catalogSource.importedAt}.{' '}
          <a href={data!.catalogSource.autoriteDeReference} target="_blank" rel="noopener noreferrer" onClick={ouvrir} className="text-blue-400/80 hover:text-blue-300">
            Liste officielle impots.gouv.fr
          </a>{' '}
          — {data!.catalogSource.avertissement}
        </p>
      )}
    </div>
  )
}
