'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { LANGUAGES, LangCode, T, translations } from './i18n/translations'

export type { LangCode, T }
export { LANGUAGES, translations }

// ─── Theme ────────────────────────────────────────────────────────────────────

export type Theme = 'dark' | 'light' | 'night-shift' | 'true-tone'

export const THEMES: { id: Theme; icon: string }[] = [
  { id: 'dark',        icon: '🌙' },
  { id: 'light',       icon: '☀️' },
  { id: 'night-shift', icon: '🟠' },
  { id: 'true-tone',   icon: '🔵' },
]

const ALL_THEMES: Theme[] = ['dark', 'light', 'night-shift', 'true-tone']

function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t)
  document.documentElement.classList.remove('dark', 'light')
  if (t === 'light') document.documentElement.classList.add('light')
  else               document.documentElement.classList.add('dark')
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface LangCtx {
  lang: LangCode
  t: T
  setLang: (code: LangCode) => void
  dir: 'ltr' | 'rtl'
  theme: Theme
  setTheme: (t: Theme) => void
}

const Ctx = createContext<LangCtx>({
  lang: 'fr', t: translations.fr,
  setLang: () => {}, dir: 'ltr',
  theme: 'dark', setTheme: () => {},
})

const STORAGE_KEY = 'gf_lang'
const THEME_KEY   = 'gf_theme'

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState]   = useState<LangCode>('fr')
  const [theme, setThemeState] = useState<Theme>('dark')

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as LangCode | null
    if (stored && translations[stored]) setLangState(stored)

    const storedTheme = localStorage.getItem(THEME_KEY) as Theme | null
    const t: Theme = (storedTheme && ALL_THEMES.includes(storedTheme)) ? storedTheme : 'dark'
    setThemeState(t)
    applyTheme(t)
  }, [])

  const setLang = useCallback((code: LangCode) => {
    setLangState(code)
    localStorage.setItem(STORAGE_KEY, code)
    const langDef = LANGUAGES.find(l => l.code === code)
    if (langDef) {
      document.documentElement.setAttribute('lang', code)
      document.documentElement.setAttribute('dir', langDef.dir)
    }
  }, [])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    localStorage.setItem(THEME_KEY, t)
    applyTheme(t)
  }, [])

  const langDef = LANGUAGES.find(l => l.code === lang)!
  const dir = (langDef?.dir ?? 'ltr') as 'ltr' | 'rtl'

  return (
    <Ctx.Provider value={{ lang, t: translations[lang], setLang, dir, theme, setTheme }}>
      {children}
    </Ctx.Provider>
  )
}

export function useTranslation() {
  return useContext(Ctx)
}
