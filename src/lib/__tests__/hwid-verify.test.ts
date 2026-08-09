import { describe, it, expect } from 'vitest'
import { verifyHwid, isValidHwidFormat, normalizeHwid, hwidVersionOf } from '../license/verify'

const A = 'a'.repeat(64)                       // HWID bien formé
const B = 'b'.repeat(64)                       // HWID différent
const A_UPPER = 'A'.repeat(64)                 // même valeur, casse différente
const V1  = 'HWID1-' + 'a'.repeat(64)          // HWID V1 canonique bien formé
const V1B = 'HWID1-' + 'b'.repeat(64)          // HWID V1 d'une autre machine
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

// ── AUD-036 : le vérificateur accepte le format V1 canonique « HWID1-<64hex> » ──
describe('HWID V1 — accepté par verify (v0 et v1 coexistent, sans confusion)', () => {
  it('isValidHwidFormat accepte v0 (64 hex) ET v1 (HWID1-<64hex>)', () => {
    expect(isValidHwidFormat(A)).toBe(true)               // v0
    expect(isValidHwidFormat(V1)).toBe(true)              // v1
    expect(isValidHwidFormat(`  ${V1}  `)).toBe(true)     // v1 + espaces de bord
    expect(isValidHwidFormat(V1.toLowerCase())).toBe(true) // préfixe insensible à la casse
  })

  it('rejette les faux v1 (mauvaise longueur, non-hex, préfixe partiel)', () => {
    expect(isValidHwidFormat('HWID1-' + 'a'.repeat(63))).toBe(false) // 63 hex
    expect(isValidHwidFormat('HWID1-' + 'z'.repeat(64))).toBe(false) // non-hex
    expect(isValidHwidFormat('HWID2-' + 'a'.repeat(64))).toBe(false) // préfixe inconnu
    expect(isValidHwidFormat('HWID1-')).toBe(false)                  // vide
  })

  it('verifyHwid v1↔v1 : exact → true, autre machine → false', () => {
    expect(verifyHwid(V1, V1)).toBe(true)
    expect(verifyHwid(V1, V1.toUpperCase())).toBe(true) // casse normalisée
    expect(verifyHwid(V1, V1B)).toBe(false)
    expect(verifyHwid(V1, 'HWID1-' + 'a'.repeat(63) + 'b')).toBe(false) // 1 caractère diffère
  })

  it('AUCUNE confusion v0↔v1 : longueurs 64 vs 70 → toujours false', () => {
    expect(verifyHwid(A, V1)).toBe(false)
    expect(verifyHwid(V1, A)).toBe(false)
  })

  it('hwidVersionOf distingue v0 (0), v1 (1) et invalide (null)', () => {
    expect(hwidVersionOf(A)).toBe(0)
    expect(hwidVersionOf(V1)).toBe(1)
    expect(hwidVersionOf(V1.toLowerCase())).toBe(1)
    expect(hwidVersionOf('pas-un-hwid')).toBe(null)
    expect(hwidVersionOf('')).toBe(null)
    expect(hwidVersionOf(null)).toBe(null)
  })
})
