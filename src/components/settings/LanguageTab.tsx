'use client'

import { cn } from '@/lib/utils'
import { Check } from 'lucide-react'
import { LANGUAGES, type LangCode } from '@/lib/i18n'

interface Props {
  lang: LangCode
  setLang: (l: LangCode) => void
  languageHint?: string
}

export function LanguageTab({ lang, setLang, languageHint }: Props) {
  return (
    <div>
      <p className="text-sm text-slate-400 mb-4">{languageHint}</p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {LANGUAGES.map(l => {
          const active = lang === l.code
          return (
            <button
              key={l.code}
              onClick={() => setLang(l.code as LangCode)}
              className={cn(
                'flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-center transition-all',
                active
                  ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                  : 'border-white/10 text-slate-400 hover:border-white/20 hover:bg-white/[0.05]'
              )}
            >
              <span className="text-2xl">{l.flag}</span>
              <span className="text-xs font-medium leading-tight">{l.name}</span>
              {active && <Check className="w-3 h-3 text-blue-400" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
