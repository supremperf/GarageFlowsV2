import { describe, it, expect } from 'vitest'
import { verifyHwid, isValidHwidFormat, normalizeHwid } from '../license/verify'

const A = 'a'.repeat(64)                       // HWID bien formé
const B = 'b'.repeat(64)                       // HWID différent
const A_UPPER = 'A'.repeat(64)                 // même valeur, casse différente
// A avec 16 caractères différents (25 %) — devait passer avec l'ancienne
// tolérance à 75 %, doit désormais ÉCHOUER (comparaison stricte).
const A_25PCT_DIFF = 'b'.repeat(16) + 'a'.repeat(48)

describe('verifyHwid — comparaison STRICTE (aucune tolérance partielle)', () => {
  it('accepte une correspondance exacte', () => {
    expect(verifyHwid(A, A)).toBe(true)
  })

  it('normalise la casse et les espaces de bord', () => {
    expect(verifyHwid(A, A_UPPER)).toBe(true)
    expect(verifyHwid(A, `  ${A}\n`)).toBe(true)
  })

  it('refuse un HWID différent', () => {
    expect(verifyHwid(A, B)).toBe(false)
  })

  it('refuse une correspondance PARTIELLE (25 % de différence) — plus de seuil 75 %', () => {
    expect(verifyHwid(A, A_25PCT_DIFF)).toBe(false)
    // Même un seul caractère de différence doit échouer.
    expect(verifyHwid(A, 'b' + 'a'.repeat(63))).toBe(false)
  })

  it('refuse un HWID vide / absent (une licence liée n’est jamais « ouverte »)', () => {
    expect(verifyHwid(A, '')).toBe(false)
    expect(verifyHwid('', A)).toBe(false)
    expect(verifyHwid('', '')).toBe(false)
    // @ts-expect-error test de robustesse sur entrées non conformes
    expect(verifyHwid(A, null)).toBe(false)
    // @ts-expect-error test de robustesse sur entrées non conformes
    expect(verifyHwid(A, undefined)).toBe(false)
  })

  it('refuse un HWID mal formé (mauvaise longueur / caractères non hex)', () => {
    expect(verifyHwid(A, 'a'.repeat(63))).toBe(false)   // trop court
    expect(verifyHwid(A, 'a'.repeat(65))).toBe(false)   // trop long
    expect(verifyHwid(A, 'z'.repeat(64))).toBe(false)   // non hexadécimal
    expect(verifyHwid('not-a-hash', 'not-a-hash')).toBe(false)
  })
})

describe('isValidHwidFormat / normalizeHwid', () => {
  it('valide un SHA-256 hex de 64 caractères (insensible à la casse)', () => {
    expect(isValidHwidFormat(A)).toBe(true)
    expect(isValidHwidFormat(A_UPPER)).toBe(true)
    expect(isValidHwidFormat(`  ${A}  `)).toBe(true)
  })

  it('rejette les formats invalides', () => {
    expect(isValidHwidFormat('')).toBe(false)
    expect(isValidHwidFormat(null)).toBe(false)
    expect(isValidHwidFormat(undefined)).toBe(false)
    expect(isValidHwidFormat('a'.repeat(63))).toBe(false)
    expect(isValidHwidFormat('g'.repeat(64))).toBe(false)
  })

  it('normalise en minuscules sans espaces de bord', () => {
    expect(normalizeHwid(`  ${A_UPPER}\t`)).toBe(A)
    expect(normalizeHwid(null)).toBe('')
  })
})
