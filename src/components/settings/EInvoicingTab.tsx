'use client'

/**
 * Onglet « Facturation électronique » — Phase 2, LECTURE SEULE.
 *
 * Affiche l'état (drapeaux de configuration) et le catalogue PUBLIC des
 * plateformes, avec une recherche insensible à la casse/accents (préfixe d'abord).
 * AUCUN secret, AUCUNE donnée d'un autre garage : les données proviennent de
 * `GET /api/einvoicing/status`, réservé au propriétaire/responsable (OWNER/MANAGER).
 *
 * IMPORTANT — rien n'est « connectable » ici : aucune plateforme n'expose de bouton
 * de connexion/envoi tant qu'un adaptateur réel et testé n'existe pas (Phase 3+).
 * Les statuts affichés sont ceux du catalogue (`coming_soon` par défaut) — on ne
 * feint aucune connexion ni aucun envoi.
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

interface StatusResponse {
  flags: EInvoicingFlags
  platforms: ApprovedEInvoicePlatform[]
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

  const results = useMemo(
    () => (data ? searchPlatforms(query, data.platforms) : []),
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
          {"Catalogue des plateformes agréées (lecture seule). La connexion et l'envoi arrivent prochainement."}
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

              {/* Aucune action de connexion tant qu'aucun adaptateur réel n'existe. */}
              <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                <Lock className="w-3.5 h-3.5" />
                {"Connexion indisponible pour l'instant (connecteur en préparation)."}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* État de connexion du garage (placeholder honnête, Phase 3) */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-3">
        <h4 className="text-xs font-semibold text-slate-300">Connexion de ce garage</h4>
        <p className="text-[11px] text-slate-500 mt-1">Aucune connexion configurée. La gestion des connexions (test réel, envoi) arrive prochainement.</p>
      </div>
    </div>
  )
}
