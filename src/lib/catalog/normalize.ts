/**
 * Normalisation helpers shared across the catalogue. Pure & deterministic.
 */

import { plierApostrophes } from '@/lib/text/apostrophes'

/** Accent- & case-insensitive text key (for name/brand/model matching). */
export function normalizeText(s: string | null | undefined): string {
  // Apostrophes pliées sur une forme unique : sans cela, un libellé saisi avec
  // l'apostrophe typographique ne correspond jamais au même libellé stocké avec
  // l'apostrophe droite.
  return plierApostrophes(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Canonical form of a part reference for equality: uppercased with every
 * non-alphanumeric character removed, so « BRK-100 », « brk 100 » and
 * « BRK.100 » all collapse to « BRK100 ».
 */
export function normalizeRef(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}
