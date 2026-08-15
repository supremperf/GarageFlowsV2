'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Save, Check, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import type { Theme } from '@/lib/i18n'

interface TranslationSlice {
  themeTab?: string
  themeDarkDesc?: string
  themeDark?: string
  themeLight?: string
  themeLightDesc?: string
  themeNightShift?: string
  themeNightShiftDesc?: string
  themeTrueTone?: string
  themeTrueToneDesc?: string
  exportDone?: string
  exportNow?: string
}

interface Props {
  theme: Theme
  setTheme: (t: Theme) => void
  t: TranslationSlice
  exporting: boolean
  setExporting: (v: boolean) => void
}

export function ThemeTab({ theme, setTheme, t, exporting, setExporting }: Props) {
  const [fecYear, setFecYear] = useState(new Date().getFullYear())
  const [exportingFec, setExportingFec] = useState(false)

  async function handleFecExport() {
    setExportingFec(true)
    try {
      const res = await fetch(`/api/export/fec?year=${fecYear}`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = disposition.match(/filename="([^"]+)"/)
      const filename = match?.[1] ?? `FEC_${fecYear}.txt`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Export FEC téléchargé')
    } catch {
      toast.error("Erreur lors de l'export FEC")
    } finally {
      setExportingFec(false)
    }
  }

  const THEMES = [
    { id: 'dark'        as Theme, icon: '🌙', name: t.themeDark,       desc: t.themeDarkDesc       },
    { id: 'light'       as Theme, icon: '☀️', name: t.themeLight,      desc: t.themeLightDesc      },
    { id: 'night-shift' as Theme, icon: '🟠', name: t.themeNightShift, desc: t.themeNightShiftDesc },
    { id: 'true-tone'   as Theme, icon: '🔵', name: t.themeTrueTone,   desc: t.themeTrueToneDesc   },
  ] as const

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-400">{t.themeTab} — {t.themeDarkDesc?.split(' —')[0]}</p>

      <div className="grid grid-cols-2 gap-3">
        {THEMES.map(th => {
          const active = theme === th.id
          return (
            <button key={th.id} onClick={() => setTheme(th.id)}
              className={cn(
                'flex flex-col items-start gap-2 p-4 rounded-xl border text-left transition-all',
                active
                  ? 'border-blue-500 bg-blue-500/10 text-blue-300'
                  : 'border-white/10 text-slate-400 hover:border-white/20 hover:bg-white/[0.05]'
              )}
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-xl">{th.icon}</span>
                {active && <Check className="w-3.5 h-3.5 text-blue-400" />}
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{th.name}</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-snug">{th.desc}</p>
              </div>
            </button>
          )
        })}
      </div>

      <div className="mt-4 pt-4 border-t border-white/[0.07]">
        <p className="text-xs font-semibold text-slate-400 mb-3 uppercase tracking-wider">Sauvegarde données</p>
        <p className="text-xs text-slate-500 mb-3">
          Export automatique chaque jour à 20h sur le bureau. Vous pouvez aussi déclencher manuellement.
        </p>
        <button
          onClick={async () => {
            const api = (window as any).electronAPI
            if (!api?.exportToDesktop) { toast.error("Disponible uniquement dans l'application"); return }
            setExporting(true)
            try {
              // ── Le verdict de l'export est LU (GF-024) ────────────────────
              // Le retour était ignoré, et il valait de toute façon `{ok:true}`
              // en toutes circonstances : « Export terminé — vérifiez votre
              // bureau » s'affichait sur un dossier vide, l'API d'export ayant
              // pu répondre en erreur sans que rien ne le dise.
              const r = await api.exportToDesktop()
              if (!r?.ok) {
                toast.error(`Export échoué : ${r?.raison ?? 'aucun fichier écrit'}`)
                return
              }
              toast.success(
                typeof r.fichiers === 'number'
                  ? `Export terminé — ${r.fichiers} fichier${r.fichiers > 1 ? 's' : ''} sur votre bureau`
                  : (t.exportDone ?? 'Export terminé — vérifiez votre bureau'),
              )
            } catch { toast.error("Erreur lors de l'export") }
            finally { setExporting(false) }
          }}
          disabled={exporting}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 text-sm font-medium hover:bg-emerald-600/30 transition-all disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" />
          {exporting ? 'Export en cours…' : (t.exportNow ?? 'Exporter vers le bureau')}
        </button>
      </div>

      {/* FEC Export */}
      <div className="mt-4 pt-4 border-t border-white/[0.07]">
        <p className="text-xs font-semibold text-slate-400 mb-3 uppercase tracking-wider">Export comptable (FEC)</p>
        <p className="text-xs text-slate-500 mb-3">
          Fichier des Écritures Comptables — format officiel requis par l&apos;administration fiscale française.
        </p>
        <div className="flex items-center gap-3">
          <select
            value={fecYear}
            onChange={e => setFecYear(Number(e.target.value))}
            className="rounded-lg border border-white/10 bg-white/[0.05] text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {[0, 1, 2].map(offset => {
              const y = new Date().getFullYear() - offset
              return <option key={y} value={y} className="bg-[#111827]">{y}</option>
            })}
          </select>
          <button
            onClick={handleFecExport}
            disabled={exportingFec}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600/20 border border-blue-500/30 text-blue-400 text-sm font-medium hover:bg-blue-600/30 transition-all disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            {exportingFec ? 'Export…' : 'Exporter FEC'}
          </button>
        </div>
      </div>
    </div>
  )
}
