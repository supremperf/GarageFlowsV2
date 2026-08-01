import { describe, it, expect } from 'vitest'
import { mapInvoiceToDocument, type InvoiceInput, type GarageInput } from '../map'
import { toUBL } from '../ubl'
import { toCII } from '../cii'
import { formatCents } from '../xml'

const garage: GarageInput = {
  name: 'Garage & Fils', // ampersand → doit être échappé
  siret: '73282932000074',
  vatNumber: 'FR40303265045',
  currency: 'EUR',
}
const invoice: InvoiceInput = {
  number: 'FAC-2026-002',
  issueDate: '2026-03-10',
  taxRate: 20,
  clientName: 'Client <B2B>',
  lines: [{ description: 'Réparation', quantity: 1, unitPrice: 100.0 }],
}

describe('formatCents — exact depuis centimes', () => {
  it('formate sans flottant', () => {
    expect(formatCents(10000)).toBe('100.00')
    expect(formatCents(12345)).toBe('123.45')
    expect(formatCents(5)).toBe('0.05')
    expect(formatCents(-101)).toBe('-1.01')
  })
})

describe('toUBL — UBL 2.1 EN 16931', () => {
  const doc = mapInvoiceToDocument(invoice, garage)
  const xml = toUBL(doc)
  it('contient l’en-tête et le profil EN 16931', () => {
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('urn:cen.eu:en16931:2017')
    expect(xml).toContain('<cbc:ID>FAC-2026-002</cbc:ID>')
    expect(xml).toContain('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>')
  })
  it('porte le SIRET vendeur et les totaux exacts', () => {
    expect(xml).toContain('schemeID="0009">73282932000074')
    expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="EUR">120.00</cbc:TaxInclusiveAmount>')
    expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount>')
  })
  it('échappe les caractères XML', () => {
    expect(xml).toContain('Garage &amp; Fils')
    expect(xml).toContain('Client &lt;B2B&gt;')
    expect(xml).not.toContain('Garage & Fils')
  })
})

describe('toCII — Cross-Industry Invoice (Factur-X)', () => {
  const doc = mapInvoiceToDocument(invoice, garage)
  const xml = toCII(doc)
  it('contient la racine CII et le guideline EN 16931', () => {
    expect(xml).toContain('<rsm:CrossIndustryInvoice')
    expect(xml).toContain('urn:cen.eu:en16931:2017')
    expect(xml).toContain('<ram:TypeCode>380</ram:TypeCode>')
  })
  it('utilise le format de date 102 (YYYYMMDD)', () => {
    expect(xml).toContain('format="102">20260310</udt:DateTimeString>')
  })
  it('porte le total TTC (GrandTotal) exact', () => {
    expect(xml).toContain('<ram:GrandTotalAmount>120.00</ram:GrandTotalAmount>')
    expect(xml).toContain('<ram:TaxBasisTotalAmount>100.00</ram:TaxBasisTotalAmount>')
  })
})
