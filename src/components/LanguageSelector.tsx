'use client'

import { LANGUAGES, LangCode, useTranslation } from '@/lib/i18n'
import { Globe, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  /** full-screen first-launch modal vs compact inline picker */
  mode?: 'modal' | 'compact'
  onDone?: () => void
}

export default function LanguageSelector({ mode = 'compact', onDone }: Props) {
  const { lang, setLang, t } = useTranslation()

  function pick(code: LangCode) {
    setLang(code)
    if (mode === 'modal' && onDone) onDone()
  }

  if (mode === 'modal') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg, #060d1b 0%, #0f1e35 100%)' }}>
        {/* Decorative glow */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)' }} />

        <div className="relative z-10 w-full max-w-2xl px-6">
          {/* Header */}
          <div className="text-center mb-10">
            <div className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}>
              <Globe className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">{t.chooseLanguage}</h1>
            <p className="text-slate-400">{t.languageHint}</p>
          </div>

          {/* Language grid */}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
            {LANGUAGES.map(l => {
              const active = lang === l.code
              return (
                <button
                  key={l.code}
                  onClick={() => pick(l.code as LangCode)}
                  className={cn(
                    'flex flex-col items-center gap-2 py-4 px-3 rounded-xl border transition-all duration-200',
                    active
                      ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                      : 'border-white/10 text-slate-400 hover:border-white/20 hover:bg-white/5 hover:text-white'
                  )}
                >
                  <span className="text-2xl">{l.flag}</span>
                  <span className="text-xs font-medium text-center leading-tight">{l.name}</span>
                  {active && <Check className="w-3.5 h-3.5 text-blue-400 absolute top-2 right-2" />}
                </button>
              )
            })}
          </div>

          <p className="text-center text-slate-500 text-xs mt-6">{t.languageHint}</p>
        </div>
      </div>
    )
  }

  // Compact dropdown
  return (
    <div className="relative group">
      <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-slate-300 hover:border-white/20 hover:text-white text-sm transition-all">
        <Globe className="w-3.5 h-3.5" />
        <span>{LANGUAGES.find(l => l.code === lang)?.flag}</span>
        <span className="hidden sm:inline text-xs">{LANGUAGES.find(l => l.code === lang)?.name}</span>
      </button>
      <div className="absolute right-0 top-full mt-1 w-52 bg-slate-900 border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden
                      opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150">
        <div className="max-h-80 overflow-y-auto p-1">
          {LANGUAGES.map(l => {
            const active = lang === l.code
            return (
              <button
                key={l.code}
                onClick={() => pick(l.code as LangCode)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm transition-colors',
                  active ? 'bg-blue-600/20 text-blue-300' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                )}
              >
                <span className="text-lg">{l.flag}</span>
                <span className="flex-1">{l.name}</span>
                {active && <Check className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
