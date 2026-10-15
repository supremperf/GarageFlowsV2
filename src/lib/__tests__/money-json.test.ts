/**
 * JSON monétaires versionnés (lib/money-json) — preuve :
 * v1 valide, v2 valide, invalide/incomplet rejetés, 4 décimales, quantité
 * fractionnaire, négatif (avoir), NaN/Infinity refusés, artefact flottant
 * historique normalisé, conversion v1→v2, idempotence, totaux exacts.
 */
import { describe, it, expect } from 'vitest'
import {
  parseWorksJson,
  parsePartsJson,
  parsePoLinesJson,
  serializeWorksJsonV2,
  serializePartsJsonV2,
  serializePoLinesJsonV2,
  workOrderTotalHtCents,
  poTotalHtCents,
  workLinesToEuros,
  partLinesToEuros,
  MoneyJsonError,
} from '@/lib/money-json'

describe('money-json — parsing v1 (historique, euros flottants)', () => {
  it('worksJson v1 : conversion exacte vers dix-millièmes + total centimes', () => {
    const p = parseWorksJson('[{"description":"Vidange","durationMin":30,"unitPrice":49.9}]')
    expect(p.version).toBe(1)
    expect(p.lines[0].unitPriceTenThousandths).toBe(499000)
    expect(p.lines[0].lineTotalCents).toBe(4990)
  })

  it('partsJson v1 : prix 4 décimales × quantité fractionnaire = total correct', () => {
    // 12,3456 € × 1,5 = 18,5184 → 18,52 € (1852 c)
    const p = parsePartsJson('[{"name":"Filtre","qty":1.5,"unitPrice":12.3456}]')
    expect(p.lines[0].qtyTenThousandths).toBe(15000)
    expect(p.lines[0].unitPriceTenThousandths).toBe(123456)
    expect(p.lines[0].lineTotalCents).toBe(1852)
  })

  it('linesJson v1 (PO) : conversion + total', () => {
    const p = parsePoLinesJson('[{"partId":"p1","partName":"Plaquettes","qty":8,"unitCost":20}]')
    expect(p.lines[0].qtyTenThousandths).toBe(80000)
    expect(p.lines[0].unitCostTenThousandths).toBe(200000)
    expect(p.lines[0].lineTotalCents).toBe(16000)
    expect(poTotalHtCents(p.lines)).toBe(16000)
  })

  it('valeur négative (avoir / remise) acceptée et exacte', () => {
    const p = parsePartsJson('[{"name":"Remise","qty":1,"unitPrice":-49.9}]')
    expect(p.lines[0].lineTotalCents).toBe(-4990)
  })

  it('artefact binaire historique (12.345599999999999) normalisé à 4 décimales', () => {
    const p = parsePartsJson(`[{"name":"X","qty":3,"unitPrice":12.345599999999999}]`)
    expect(p.lines[0].unitPriceTenThousandths).toBe(123456) // politique : round(x×10000)
    expect(p.lines[0].lineTotalCents).toBe(3704) // 12,3456 × 3 = 37,04 €
  })

  it('clés inconnues v1 tolérées (strip), valeurs validées', () => {
    const p = parseWorksJson('[{"description":"a","durationMin":10,"unitPrice":5,"legacyField":"x"}]')
    expect(p.lines[0].unitPriceTenThousandths).toBe(50000)
  })
})

describe('money-json — rejets STRICTS', () => {
  it('JSON illisible → MoneyJsonError INVALID_JSON', () => {
    expect(() => parseWorksJson('{not json')).toThrowError(MoneyJsonError)
  })
  it('NaN / Infinity refusés', () => {
    expect(() => parsePartsJson('[{"name":"x","qty":1,"unitPrice":null}]')).toThrow()
    // JSON ne représente pas NaN/Infinity nativement — une chaîne est refusée aussi :
    expect(() => parsePartsJson('[{"name":"x","qty":"1","unitPrice":5}]')).toThrow()
  })
  it('plus de 4 décimales réelles refusées', () => {
    expect(() => parsePartsJson('[{"name":"x","qty":1,"unitPrice":1.00001}]')).toThrow()
  })
  it('objet incomplet v2 refusé (schemaVersion sans lignes)', () => {
    expect(() => parseWorksJson('{"schemaVersion":2}')).toThrow()
  })
  it('v2 avec flottant refusé (entiers exigés)', () => {
    expect(() =>
      parseWorksJson('{"schemaVersion":2,"works":[{"description":"a","durationMin":10,"unitPriceTenThousandths":12.5,"lineTotalCents":1}]}'),
    ).toThrow()
  })
  it('v2 avec clé inconnue refusé (strict)', () => {
    expect(() =>
      parseWorksJson('{"schemaVersion":2,"works":[{"description":"a","durationMin":10,"unitPriceTenThousandths":100,"lineTotalCents":1,"unitPrice":0.01}]}'),
    ).toThrow()
  })
})

describe('money-json — v2 round-trip & migration v1→v2', () => {
  it('sérialisation v2 → re-parse identique (round-trip)', () => {
    const v1 = parsePartsJson('[{"name":"Filtre","reference":"OIL-9","qty":2.375,"unitPrice":12.3456}]')
    const raw2 = serializePartsJsonV2(v1.lines)
    expect(raw2).toContain('"schemaVersion":2')
    expect(raw2).not.toMatch(/"unitPrice"|"qty"/) // plus AUCUN champ euro flottant
    const v2 = parsePartsJson(raw2)
    expect(v2.version).toBe(2)
    expect(v2.lines).toEqual(v1.lines)
  })

  it('migration = relisible + totaux conservés (worksJson + partsJson)', () => {
    const works = parseWorksJson('[{"description":"MO","durationMin":60,"unitPrice":80}]').lines
    const parts = parsePartsJson('[{"name":"P","qty":2,"unitPrice":19.99}]').lines
    const total = workOrderTotalHtCents(works, parts)
    expect(total).toBe(8000 + 3998)
    // ré-écriture v2 puis relecture : total identique (aucune dérive)
    const works2 = parseWorksJson(serializeWorksJsonV2(works)).lines
    const parts2 = parsePartsJson(serializePartsJsonV2(parts)).lines
    expect(workOrderTotalHtCents(works2, parts2)).toBe(total)
  })

  it('vue euros dérivée bit-exacte pour l’UI', () => {
    const works = parseWorksJson('[{"description":"MO","durationMin":30,"unitPrice":49.9}]').lines
    expect(workLinesToEuros(works)[0].unitPrice).toBe(49.9)
    const parts = parsePartsJson('[{"name":"P","qty":1.5,"unitPrice":12.3456}]').lines
    expect(partLinesToEuros(parts)[0].unitPrice).toBe(12.3456)
    expect(partLinesToEuros(parts)[0].qty).toBe(1.5)
  })

  it('PO v2 : sérialisation sans flottant + total exact', () => {
    const lines = parsePoLinesJson('[{"partName":"Courroie","qty":5,"unitCost":60}]').lines
    const raw = serializePoLinesJsonV2(lines)
    expect(raw).not.toMatch(/"unitCost"|"qty"/)
    expect(poTotalHtCents(parsePoLinesJson(raw).lines)).toBe(30000)
  })
})
