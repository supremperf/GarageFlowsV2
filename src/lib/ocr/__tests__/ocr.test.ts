import { describe, it, expect } from 'vitest'
import {
  parseFrAmount,
  parseFrDate,
  ocrFixVin,
  findVin,
  findPlate,
  classifyDocument,
  extractByType,
  extractDocument,
  OcrEngine,
  TextOcrProvider,
  MockOcrProvider,
} from '../index'

const CARTE_GRISE = `CERTIFICAT D'IMMATRICULATION
A  AB-123-CD
B  15/03/2018
D.1 PEUGEOT
D.3 308
E  VF3LBHYBWFS123456
P.3 GO`

const INVOICE = `GARAGE PIÈCES AUTO SARL
12 rue des Ateliers, 75011 Paris
Facture N° FA-2026-001
Date : 12/02/2026
Réf   Désignation        Qté   PU
BRK1  Plaquettes avant    4     38,90
Total HT    155,60 €
TVA 20%      31,12 €
Total TTC   186,72 €`

describe('normalize', () => {
  it('parses French amounts', () => {
    expect(parseFrAmount('1 234,56 €')).toBe(1234.56)
    expect(parseFrAmount('1.234,56')).toBe(1234.56)
    expect(parseFrAmount('186,72')).toBe(186.72)
    expect(parseFrAmount('1234.56')).toBe(1234.56)
    expect(parseFrAmount('pas de montant')).toBeNull()
  })

  it('parses French dates to ISO', () => {
    expect(parseFrDate('15/03/2018')).toBe('2018-03-15')
    expect(parseFrDate('le 01.02.26')).toBe('2026-02-01')
    expect(parseFrDate('32/01/2020')).toBeNull()
    expect(parseFrDate('aucune date')).toBeNull()
  })

  it('rejects impossible calendar dates', () => {
    expect(parseFrDate('31/04/2020')).toBeNull() // April has 30 days
    expect(parseFrDate('29/02/2021')).toBeNull() // 2021 not a leap year
    expect(parseFrDate('29/02/2020')).toBe('2020-02-29') // 2020 is a leap year
  })
})

describe('findVin', () => {
  it('finds and validates a 17-char VIN', () => {
    const hit = findVin('Châssis: VF3LBHYBWFS123456 vu')!
    expect(hit).not.toBeNull()
    expect(hit.vin).toBe('VF3LBHYBWFS123456')
    expect(hit.validFormat).toBe(true)
  })

  it('corrects OCR confusions (O→0) inside a VIN context', () => {
    // Real VIN carries a 0 at position 10; OCR misread it as the letter O.
    const hit = findVin('VIN WVGZZZ5NZOW123456')!
    expect(hit.vin).toBe('WVGZZZ5NZ0W123456')
    expect(hit.validFormat).toBe(true)
  })

  it('returns null when no 17-char candidate exists', () => {
    expect(findVin('AB-123-CD only a plate')).toBeNull()
  })
})

describe('findPlate', () => {
  it('detects and canonicalises an SIV plate', () => {
    const hit = findPlate('Plaque AB 123 CD')!
    expect(hit.plate).toBe('AB-123-CD')
    expect(hit.format).toBe('SIV')
  })

  it('detects an old FNI plate', () => {
    const hit = findPlate('1234 ABC 75')!
    expect(hit.format).toBe('FNI')
    expect(hit.plate).toBe('1234-ABC-75')
  })

  it('returns null when there is no plate', () => {
    expect(findPlate('total ttc 186,72')).toBeNull()
  })
})

describe('classifyDocument', () => {
  it('classifies a registration certificate', () => {
    const c = classifyDocument(CARTE_GRISE)
    expect(c.type).toBe('carte_grise')
    expect(c.confidence).toBeGreaterThan(0.5)
  })

  it('classifies a supplier invoice', () => {
    expect(classifyDocument(INVOICE).type).toBe('invoice')
  })

  it('classifies a lone VIN sticker as vin_plate', () => {
    expect(classifyDocument('VIN WVGZZZ5NZ0W123456').type).toBe('vin_plate')
  })

  it('classifies a lone plate', () => {
    expect(classifyDocument('AB-123-CD').type).toBe('plate')
  })

  it('classifies an odometer reading', () => {
    expect(classifyDocument('Compteur: 123 456 km').type).toBe('odometer')
  })

  it('returns unknown for unrelated text', () => {
    const c = classifyDocument('bonjour le monde')
    expect(c.type).toBe('unknown')
    expect(c.confidence).toBe(0)
  })
})

describe('extractByType — carte grise', () => {
  const fields = extractByType('carte_grise', CARTE_GRISE)
  const get = (k: string) => fields.find((f) => f.key === k)

  it('extracts plate, VIN, make, model, first registration and energy', () => {
    expect(get('plate')?.value).toBe('AB-123-CD')
    expect(get('vin')?.value).toBe('VF3LBHYBWFS123456')
    expect(get('make')?.value).toBe('PEUGEOT')
    expect(get('model')?.value).toBe('308')
    expect(get('firstRegistration')?.value).toBe('2018-03-15')
    expect(get('energy')?.value).toBe('Diesel')
  })
})

describe('extractByType — invoice', () => {
  const fields = extractByType('invoice', INVOICE)
  const get = (k: string) => fields.find((f) => f.key === k)

  it('extracts number, date, and both totals (last amount on the line)', () => {
    expect(get('invoiceNumber')?.value).toBe('FA-2026-001')
    expect(get('date')?.value).toBe('2026-02-12')
    expect(Number(get('totalTTC')?.value)).toBe(186.72)
    expect(Number(get('totalHT')?.value)).toBe(155.6)
    expect(get('supplier')?.value).toBe('GARAGE PIÈCES AUTO SARL')
  })
})

describe('extractByType — odometer', () => {
  it('extracts a mileage in km', () => {
    const f = extractByType('odometer', 'Relevé compteur 123 456 km')
    expect(f[0].key).toBe('mileage')
    expect(f[0].value).toBe('123456')
  })
})

describe('invoice extraction robustness (regression)', () => {
  it('takes the total, not a trailing VAT amount, on a flattened total line', () => {
    const text = 'Facture\nTotal HT 155,60 €\nTotal TTC 186,72 € (TVA 20% : 31,12 €)'
    const f = extractByType('invoice', text)
    expect(Number(f.find((x) => x.key === 'totalTTC')?.value)).toBe(186.72)
  })

  it('ignores a dotted phone number when picking the invoice date', () => {
    const text = [
      'GARAGE DUPONT',
      'Tel : 02.05.12.34.56',
      'Facture N° F-2026-001',
      'Date : 12/02/2026',
      'Total TTC 1 234,56 €',
    ].join('\n')
    const f = extractByType('invoice', text)
    expect(f.find((x) => x.key === 'date')?.value).toBe('2026-02-12')
  })
})

describe('classification robustness (regression)', () => {
  it('classifies a garage invoice that records mileage as invoice, not odometer', () => {
    const text = 'Facture acquittée\nRéf. 2024-0512\nKilométrage relevé au compteur : 145 230 km\nMontant réglé : 252,00 EUR'
    expect(classifyDocument(text).type).toBe('invoice')
  })

  it('still classifies a bare mileage reading as odometer', () => {
    expect(classifyDocument('Kilométrage relevé au compteur : 145 230 km').type).toBe('odometer')
  })
})

describe('extractDocument (classify + extract + assess)', () => {
  it('auto-classifies and extracts, scaling confidence by OCR quality', () => {
    const doc = extractDocument({ text: CARTE_GRISE, blocks: [{ text: CARTE_GRISE, confidence: 0.9 }] })
    expect(doc.type).toBe('carte_grise')
    expect(doc.fields.length).toBeGreaterThanOrEqual(5)
    expect(doc.confidence).toBeGreaterThan(0)
  })

  it('honours a forced type', () => {
    const doc = extractDocument({ text: 'AB-123-CD', blocks: [] }, { type: 'plate' })
    expect(doc.type).toBe('plate')
    expect(doc.fields[0].value).toBe('AB-123-CD')
  })

  it('warns on unknown documents and low OCR confidence', () => {
    const unknown = extractDocument({ text: 'xyz', blocks: [{ text: 'xyz', confidence: 0.2 }] })
    expect(unknown.type).toBe('unknown')
    expect(unknown.warnings.join(' ')).toMatch(/non reconnu/)

    const lowq = extractDocument({ text: CARTE_GRISE, blocks: [{ text: CARTE_GRISE, confidence: 0.3 }] })
    expect(lowq.warnings.some((w) => /Confiance OCR faible/.test(w))).toBe(true)
  })

  it('treats a measured OCR confidence of 0 as worst (not perfect)', () => {
    const zero = extractDocument({ text: CARTE_GRISE, blocks: [{ text: CARTE_GRISE, confidence: 0 }] })
    expect(zero.confidence).toBe(0)
    expect(zero.warnings.some((w) => /Confiance OCR faible/.test(w))).toBe(true)
  })
})

describe('OcrEngine with providers', () => {
  it('drives the pipeline through the text passthrough provider', async () => {
    const engine = new OcrEngine(new TextOcrProvider())
    const res = await engine.analyze({ text: INVOICE })
    expect(res.type).toBe('invoice')
    expect(res.ocr.blocks.length).toBeGreaterThan(0)
  })

  it('resolves a mock provider by input key', async () => {
    const engine = new OcrEngine(new MockOcrProvider({ 'doc-1': CARTE_GRISE }))
    const res = await engine.analyze({ url: 'doc-1' })
    expect(res.type).toBe('carte_grise')
    expect(res.fields.find((f) => f.key === 'make')?.value).toBe('PEUGEOT')
  })
})
