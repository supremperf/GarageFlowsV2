'use client'

import { ClipboardList, FileText, Receipt, TrendingUp, Copy, Check, AlertTriangle, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Job } from '@/lib/types'
import { JobQRCode, usePortalLink } from '@/components/JobQRCode'
import { useState } from 'react'
import { useTranslation } from '@/lib/i18n'
import { formatEuros, roundEurosForDisplay } from '@/lib/money'
import type { T } from '@/lib/i18n'

interface JobProfit {
  laborRevenue: number
  partsRevenue: number
  partsCost: number
  profit: number
}

interface Props {
  mode: 'create' | 'edit'
  editingJob: Job | null | undefined
  isValid: boolean
  jobProfit: JobProfit | null
  onDelete: () => void
  onInspection: () => void
  /**
   * Ouvre l'ORDRE DE RÉPARATION.
   *
   * Le module existait entièrement — routes, signature, impression, préfixe
   * réglable dans les paramètres — mais `WorkOrderModal` n'était importé nulle
   * part : aucun écran ne pouvait l'ouvrir (GF-040). Le barème main-d'œuvre,
   * dont il est le seul consommateur, restait par ricochet une saisie sans
   * débouché.
   */
  onWorkOrder: () => void
  onQuote: () => void
  onInvoice: () => void
  onCancel: () => void
  onSubmit: () => void
}

/**
 * Lien portail client.
 *
 * Un SEUL appel de génération alimente à la fois le QR code et le lien texte —
 * ils affichent donc forcément la même URL. Et tant que la publication n'est pas
 * confirmée, ni le QR code ni le bouton « copier » ne sont proposés : remettre
 * au client un lien qui affichera « Lien invalide ou expiré » est pire que de
 * lui dire d'attendre.
 */
function PortalLinkSection({ jobId, t }: { jobId: string; t: T }) {
  const { etat, url } = usePortalLink(jobId)
  const [copied, setCopied] = useState(false)
  const utilisable = etat === 'pret' && !!url

  function copy() {
    if (!utilisable || !url) return
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="mt-4 flex items-start gap-4">
      <JobQRCode url={utilisable ? url : null} size={80} />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-slate-500 mb-1 uppercase tracking-wide">
          {t.jmPortalLink}
        </p>
        <p className="text-[11px] text-slate-400 font-mono break-all leading-relaxed">
          {utilisable ? url : t.jmGenerating}
        </p>
        {utilisable && (
          <button
            onClick={copy}
            className="mt-1.5 flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? t.jmCopied : t.jmCopyLink}
          </button>
        )}
        {(etat === 'nonPublie' || etat === 'echec') && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[10px] text-amber-300">
            <AlertTriangle className="w-3 h-3 mt-px shrink-0" />
            <span>{t.jmPortalNotPublished}</span>
          </p>
        )}
        <p className="text-[9px] text-slate-600 mt-1">
          {t.jmPortalShareHint}
        </p>
      </div>
    </div>
  )
}

export function JobModalFooter({
  mode, editingJob, isValid, jobProfit,
  onDelete, onInspection, onWorkOrder, onQuote, onInvoice, onCancel, onSubmit,
}: Props) {
  const { t } = useTranslation()
  return (
    <>
      {/* Profitability card */}
      {mode === 'edit' && jobProfit !== null && (
        <div className="mx-6 mb-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
            {t.jmProfitability}
          </p>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: t.jmLabor, value: formatEuros(jobProfit.laborRevenue, 'always'), color: 'text-blue-400' },
              { label: t.jmPartsSale, value: formatEuros(jobProfit.partsRevenue, 'always'), color: 'text-cyan-400' },
              // Poste de coût : le signe vient de `formatEuros`, jamais d'un « - »
              // codé en dur — sinon un coût nul s'affiche « -0.00 € ».
              { label: t.jmPartsCost, value: formatEuros(jobProfit.partsCost, 'negative'), color: 'text-red-400' },
              {
                // ── « Profit net » promettait ce qu'aucune donnée ne permet ──
                // Le chiffre affiché est (main-d'œuvre + pièces vendues −
                // pièces achetées) : c'est une MARGE BRUTE. Aucun coût de
                // main-d'œuvre n'existe dans le modèle — `Mechanic` ne porte ni
                // salaire ni taux de revient, et `hourlyRate` est un tarif de
                // VENTE. Le mot « net » annonçait donc un résultat après
                // charges qui n'a jamais été calculé, et l'écran devis nomme
                // déjà « marge brute » exactement la même construction.
                label: t.qiGrossMargin,
                value: formatEuros(jobProfit.profit, 'always'),
                color: roundEurosForDisplay(jobProfit.profit) >= 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold',
              },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center">
                <p className="text-[10px] text-slate-500 mb-0.5">{label}</p>
                <p className={`text-sm ${color}`}>{value}</p>
              </div>
            ))}
          </div>
          {/* Portal QR code + link */}
          {editingJob && <PortalLinkSection jobId={editingJob.id} t={t} />}
        </div>
      )}

      {/* Footer buttons */}
      <div className="sticky bottom-0 bg-[#111827] border-t border-white/[0.07] px-6 py-4 rounded-b-2xl flex items-center gap-2 flex-wrap">
        {mode === 'edit' && (
          <button
            onClick={onDelete}
            className="px-4 py-2.5 rounded-lg border border-red-500/30 text-red-400 text-sm font-medium hover:bg-red-500/10 transition-colors"
          >
            {t.uiDelete}
          </button>
        )}
        <div className="flex-1" />

        {mode === 'edit' && editingJob && (
          <>
            <button
              onClick={onInspection}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-teal-500/15 border border-teal-500/30 text-teal-300 text-sm font-medium hover:bg-teal-500/25 transition-colors"
            >
              <ClipboardList className="w-3.5 h-3.5" />
              {t.jmInspection}
            </button>
            <button
              onClick={onWorkOrder}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-sm font-medium hover:bg-amber-500/25 transition-colors"
            >
              <Wrench className="w-3.5 h-3.5" />
              {t.woTitle}
            </button>
            <button
              onClick={onQuote}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-300 text-sm font-medium hover:bg-purple-500/25 transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              {t.jmQuote}
            </button>
            <button
              onClick={onInvoice}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-300 text-sm font-medium hover:bg-blue-500/25 transition-colors"
            >
              <Receipt className="w-3.5 h-3.5" />
              {t.jmInvoice}
            </button>
          </>
        )}

        <button
          onClick={onCancel}
          className="px-4 py-2.5 rounded-lg border border-white/15 text-slate-400 text-sm font-medium hover:bg-white/[0.07] transition-colors"
        >
          {t.uiCancel}
        </button>
        <button
          onClick={onSubmit}
          disabled={!isValid}
          className={cn(
            'px-5 py-2.5 rounded-lg text-white text-sm font-semibold transition-all',
            isValid ? 'bg-blue-600 hover:bg-blue-500 shadow-md shadow-blue-600/30' : 'bg-slate-700 cursor-not-allowed text-slate-500'
          )}
        >
          {mode === 'edit' ? t.uiSave : t.jmSchedule}
        </button>
      </div>
    </>
  )
}
