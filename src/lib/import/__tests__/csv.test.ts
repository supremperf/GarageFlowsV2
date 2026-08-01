/**
 * Analyseur CSV (RFC 4180) + protection anti-injection de formules.
 */
import { describe, it, expect } from 'vitest'
import { parseCsv, splitHeader } from '../csv'
import { neutralizeFormula, isFormulaInjection } from '../sanitize'

describe('parseCsv', () => {
  it('analyse un CSV simple', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
  })
  it('gère les champs entre guillemets avec virgules et guillemets échappés', () => {
    expect(parseCsv('name,note\n"Dupont, Jean","dit ""JD"""')).toEqual([
      ['name', 'note'], ['Dupont, Jean', 'dit "JD"'],
    ])
  })
  it('gère les sauts de ligne dans un champ et les CRLF', () => {
    expect(parseCsv('a,b\r\n"ligne1\nligne2",x\r\n')).toEqual([['a', 'b'], ['ligne1\nligne2', 'x']])
  })
  it('retire le BOM UTF-8', () => {
    expect(parseCsv('﻿a,b')).toEqual([['a', 'b']])
  })
})

describe('splitHeader', () => {
  it('sépare en-tête et lignes, ignore les lignes vides', () => {
    const { header, rows } = splitHeader(parseCsv('nom,tel\nJean,01\n\n,\nPaul,02'))
    expect(header).toEqual(['nom', 'tel'])
    expect(rows).toEqual([['Jean', '01'], ['Paul', '02']])
  })
})

describe('neutralizeFormula (anti-injection)', () => {
  it('neutralise = @ et caractères de contrôle en tête', () => {
    expect(neutralizeFormula('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(neutralizeFormula('@cmd')).toBe("'@cmd")
    expect(neutralizeFormula('\tfoo')).toBe("'\tfoo")
    expect(neutralizeFormula('=1+1')).toBe("'=1+1")
  })
  it('neutralise +/- SEULEMENT si la valeur contient une lettre (charge utile)', () => {
    expect(neutralizeFormula('+HYPERLINK("http://x")')).toBe('\'+HYPERLINK("http://x")')
    expect(neutralizeFormula('-2+cmd|calc')).toBe("'-2+cmd|calc")
  })
  it('préserve les numéros de téléphone et les nombres', () => {
    expect(neutralizeFormula('+33 1 23 45 67 89')).toBe('+33 1 23 45 67 89')
    expect(neutralizeFormula('-5.00')).toBe('-5.00')
    expect(neutralizeFormula('Jean Dupont')).toBe('Jean Dupont')
    expect(neutralizeFormula('')).toBe('')
  })
  it('isFormulaInjection détecte le besoin de neutralisation', () => {
    expect(isFormulaInjection('=X')).toBe(true)
    expect(isFormulaInjection('+33 1')).toBe(false)
    expect(isFormulaInjection('Renault')).toBe(false)
  })
})
