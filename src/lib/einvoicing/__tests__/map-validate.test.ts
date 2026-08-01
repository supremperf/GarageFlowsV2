import { describe, it, expect } from 'vitest'
import { mapInvoiceToDocument, normalizeDate, type InvoiceInput, type GarageInput } from '../map'
import { validateDocument } from '../validate'

const garage: GarageInput = {
  name: 'Garage Demo',
  siret: '73282932000074',
  vatNumber: 'FR40303265045',
  address: '12 rue de la Mécanique, 75001 Paris',
  email: 'contact@garage-demo.fr',
  iban: 'FR7630006000011234567890189',
  bic: 'AGRIFRPP',
  currency: 'EUR',
  paymentTerms: '30 jours net',
}

const invoice: InvoiceInput = {
  number: 'FAC-2026-001',
  issueDate: '2026-01-15',
  dueDate: '15/02/2026',
  taxRate: 20,
  clientName: 'Client Test',
  clientAddress: '5 avenue des Clients, 75002 Paris',
  clientEmail: 'client@test.fr',
  lines: [
    { description: 'Vidange', quantity: 1, unitPrice: 100.0 },
    { description: 'Plaquettes', quantity: 2, unitPrice: 49.99 },
  ],
}

describe('mapInvoiceToDocument — cents entiers exacts', () => {
  it('calcule les totaux en centimes (invariant TTC = HT + TVA)', () => {
    const doc = mapInvoiceToDocument(invoice, garage)
    // L1 = 10000 ; L2 = round(4999*2)=9998 ; HT = 19998
    expect(doc.totals.lineTotalCents).toBe(19998)
    expect(doc.totals.taxExclusiveCents).toBe(19998)
    expect(doc.totals.taxAmountCents).toBe(4000) // round(19998*20/100)=round(3999.6)
    expect(doc.totals.taxInclusiveCents).toBe(23998)
    expect(doc.totals.taxInclusiveCents).toBe(doc.totals.taxExclusiveCents + doc.totals.taxAmountCents)
  })
  it('produit une ventilation TVA à un taux', () => {
    const doc = mapInvoiceToDocument(invoice, garage)
    expect(doc.vatBreakdown).toHaveLength(1)
    expect(doc.vatBreakdown[0].vatRatePercent).toBe(20)
    expect(doc.vatBreakdown[0].vatCategory).toBe('S')
    expect(doc.vatBreakdown[0].taxAmountCents).toBe(4000)
  })
  it('normalise la date FR DD/MM/YYYY → ISO', () => {
    expect(normalizeDate('15/02/2026')).toBe('2026-02-15')
    const doc = mapInvoiceToDocument(invoice, garage)
    expect(doc.issueDate).toBe('2026-01-15')
    expect(doc.dueDate).toBe('2026-02-15')
  })
  it('taux 0 → catégorie TVA Z', () => {
    const doc = mapInvoiceToDocument({ ...invoice, taxRate: 0 }, garage)
    expect(doc.vatBreakdown[0].vatCategory).toBe('Z')
    expect(doc.totals.taxAmountCents).toBe(0)
  })
  it('reporte les identifiants légaux du vendeur', () => {
    const doc = mapInvoiceToDocument(invoice, garage)
    expect(doc.seller.siret).toBe('73282932000074')
    expect(doc.seller.vatNumber).toBe('FR40303265045')
    expect(doc.payment?.iban).toBe('FR7630006000011234567890189')
  })
})

describe('validateDocument — EN 16931 cœur', () => {
  it('valide un document conforme (sans erreurs)', () => {
    const doc = mapInvoiceToDocument(invoice, garage)
    const r = validateDocument(doc)
    expect(r.valid).toBe(true)
    expect(r.errors).toHaveLength(0)
  })
  it('avertit sur le SIRET acheteur absent (B2B)', () => {
    const doc = mapInvoiceToDocument(invoice, garage)
    const r = validateDocument(doc)
    expect(r.warnings.some((w) => w.code === 'GF-BUYER-ID')).toBe(true)
  })
  it('ERREUR si le vendeur n’a ni SIRET ni TVA', () => {
    const doc = mapInvoiceToDocument(invoice, { ...garage, siret: null, vatNumber: null })
    const r = validateDocument(doc)
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => e.code === 'GF-SELLER-ID')).toBe(true)
  })
  it('ERREUR sur un SIRET vendeur au mauvais format', () => {
    const doc = mapInvoiceToDocument(invoice, { ...garage, siret: '123' })
    const r = validateDocument(doc)
    expect(r.errors.some((e) => e.code === 'GF-SIRET-FMT')).toBe(true)
  })
  it('ERREUR si les totaux sont incohérents (falsification)', () => {
    const doc = mapInvoiceToDocument(invoice, garage)
    doc.totals.taxInclusiveCents = 99999 // rompt TTC = HT + TVA
    const r = validateDocument(doc)
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => e.code === 'BR-CO-15')).toBe(true)
  })
  it('ERREUR si une date n’est pas ISO', () => {
    const doc = mapInvoiceToDocument({ ...invoice, issueDate: 'pas-une-date' }, garage)
    const r = validateDocument(doc)
    expect(r.errors.some((e) => e.code === 'BR-02')).toBe(true)
  })
  it('avoir (381) sans référence → avertissement', () => {
    const doc = mapInvoiceToDocument(invoice, garage, { typeCode: '381' })
    const r = validateDocument(doc)
    expect(r.warnings.some((w) => w.code === 'GF-CN-REF')).toBe(true)
  })

  // ── Couplages ajoutés (revue adversariale) ──────────────────────────────
  it('ERREUR si HT ≠ somme des lignes (aucune remise modélisée)', () => {
    const doc = mapInvoiceToDocument(invoice, garage)
    doc.totals.taxExclusiveCents = doc.totals.lineTotalCents + 1000 // découple HT des lignes
    const r = validateDocument(doc)
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => e.code === 'GF-EXCL-LINES')).toBe(true)
  })
  it('ERREUR si une ligne porte une TVA absente de la ventilation', () => {
    const doc = mapInvoiceToDocument(invoice, garage)
    // La ligne reste à 20% mais on falsifie la ventilation en 0% (Z).
    doc.vatBreakdown = [{ vatCategory: 'Z', vatRatePercent: 0, taxableAmountCents: doc.totals.lineTotalCents, taxAmountCents: 0 }]
    doc.totals.taxAmountCents = 0
    doc.totals.taxInclusiveCents = doc.totals.taxExclusiveCents
    doc.totals.payableCents = doc.totals.taxExclusiveCents
    const r = validateDocument(doc)
    expect(r.valid).toBe(false)
    // La ligne 20% n'a pas d'entrée de ventilation correspondante + base incohérente.
    expect(r.errors.some((e) => e.code === 'BR-CO-18' || e.code === 'BR-S-08')).toBe(true)
  })
})
