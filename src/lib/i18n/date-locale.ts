// Mappe chaque langue de l'interface vers la locale date-fns correspondante,
// afin que les dates (jours, mois) s'affichent dans la langue choisie.
import {
  fr, enUS, es, de, it, pt, nl, pl, ru, arSA, zhCN, ja, tr, ko,
} from 'date-fns/locale'
import type { Locale } from 'date-fns'
import type { LangCode } from './translations'

const MAP: Record<LangCode, Locale> = {
  fr, en: enUS, es, de, it, pt, nl, pl, ru, ar: arSA, zh: zhCN, ja, tr, ko,
}

export function dateLocale(lang: LangCode): Locale {
  return MAP[lang] ?? enUS
}
