'use client'

import { ClipboardList, FileText, Receipt, TrendingUp, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Job } from '@/lib/types'
import { JobQRCode, usePortalUrl } from '@/components/JobQRCode'
import { useState } from 'react'
import { useTranslation } from '@/lib/i18n'
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
  onQuote: () => void
  onInvoice: () => void
  onCancel: () => void
  onSubmit: () => void
}

function PortalLinkSection({ jobId, t }: { jobId: string; t: T }) {
  const portalUrl = usePortalUrl(jobId)
  const [copied, setCopied] = useState(false)

  function copy() {
    if (!portalUrl) return
    navigator.clipboard.writeText(portalUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="mt-4 flex items-start gap-4">
      <JobQRCode jobId={jobId} size={80} />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-slate-500 mb-1 uppercase tracking-wide">
          {t.jmPortalLink}
        </p>
        <p className="text-[11px] text-slate-400 font-mono break-all leading-relaxed">
          {portalUrl ?? t.jmGenerating}
        </p>
        {portalUrl && (
          <button
            onClick={copy}
            className="mt-1.5 flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? t.jmCopied : t.jmCopyLink}
          </button>
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
  onDelete, onInspection, onQuote, onInvoice, onCancel, onSubmit,
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
              { label: t.jmLabor, value: `+${jobProfit.laborRevenue.toFixed(2)} €`, color: 'text-blue-400' },
              { label: t.jmPartsSale, value: `+${jobProfit.partsRevenue.toFixed(2)} €`, color: 'text-cyan-400' },
              { label: t.jmPartsCost, value: `-${jobProfit.partsCost.toFixed(2)} €`, color: 'text-red-400' },
              {
                label: t.jmNetProfit,
                value: `${jobProfit.profit >= 0 ? '+' : ''}${jobProfit.profit.toFixed(2)} €`,
                color: jobProfit.profit >= 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold',
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
