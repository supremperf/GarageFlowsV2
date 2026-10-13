/**
 * Applique lang + dir (LTR/RTL) sur <html> pour une langue donnée (AUD-026).
 * Pur (aucune dépendance React/JSX) → testable en environnement node.
 */
import { LANGUAGES, type LangCode } from './translations'

export function applyLangAttributes(code: LangCode): void {
  const langDef = LANGUAGES.find((l) => l.code === code)
  if (!langDef) return
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('lang', code)
  document.documentElement.setAttribute('dir', langDef.dir)
}
