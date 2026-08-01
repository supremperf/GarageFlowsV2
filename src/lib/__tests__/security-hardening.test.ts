/**
 * Tests de non-régression pour les durcissements de l'audit de production.
 *  - coercePartField : refuse les opérateurs Prisma / NaN / hors-bornes (parts).
 *  - parsePhotoDataUrl : liste blanche MIME + rejet des formats non-image.
 *  - computeTotals (money) : invariant TTC = HT + TVA sur des lignes d'OR.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { coercePartField } from '@/lib/schemas'
import { parsePhotoDataUrl } from '@/lib/photo-store'
import { computeTotals } from '@/lib/money'
import { resolveSignatureKey } from '@/lib/signature/key'

/** Réplique le filtre d'open-redirect du login (src/app/login/page.tsx) — contrat. */
function safeCallback(raw: string): string {
  return /^\/(?![/\\])/.test(raw) ? raw : '/'
}

describe('coercePartField — anti-injection d’opérateur Prisma & validation numérique', () => {
  it('accepte un nombre valide', () => {
    expect(coercePartField('quantity', 5)).toBe(5)
    expect(coercePartField('unitPrice', 12.5)).toBe(12.5)
  })
  it('accepte une chaîne numérique', () => {
    expect(coercePartField('quantity', '7')).toBe(7)
  })
  it('REFUSE un objet opérateur Prisma ({ increment })', () => {
    expect(coercePartField('quantity', { increment: 1000 })).toBeInstanceOf(Error)
    expect(coercePartField('unitPrice', { multiply: 999 })).toBeInstanceOf(Error)
  })
  it('REFUSE NaN / Infinity / négatif / hors-borne', () => {
    expect(coercePartField('quantity', 'abc')).toBeInstanceOf(Error)
    expect(coercePartField('quantity', Number.POSITIVE_INFINITY)).toBeInstanceOf(Error)
    expect(coercePartField('unitPrice', -1)).toBeInstanceOf(Error)
    expect(coercePartField('quantity', 10_000_000)).toBeInstanceOf(Error)
  })
  it('exige un nom non vide, borne les textes', () => {
    expect(coercePartField('name', '  ')).toBeInstanceOf(Error)
    expect(coercePartField('name', ' Plaquette ')).toBe('Plaquette')
    expect(coercePartField('reference', null)).toBeNull()
    expect(coercePartField('description', { a: 1 })).toBeInstanceOf(Error)
  })
})

describe('parsePhotoDataUrl — liste blanche MIME & rejet des non-images', () => {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  it('accepte une data URL PNG valide', () => {
    const r = parsePhotoDataUrl(tinyPng)
    expect(r).not.toBeNull()
    expect(r?.ext).toBe('png')
    expect(r?.buffer.length).toBeGreaterThan(0)
  })
  it('mappe jpeg → jpg', () => {
    const jpg = 'data:image/jpeg;base64,' + Buffer.from('hello-jpeg').toString('base64')
    expect(parsePhotoDataUrl(jpg)?.ext).toBe('jpg')
  })
  it('REFUSE un MIME hors liste blanche (svg, html, octet-stream)', () => {
    expect(parsePhotoDataUrl('data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64'))).toBeNull()
    expect(parsePhotoDataUrl('data:text/html;base64,' + Buffer.from('<h1>x</h1>').toString('base64'))).toBeNull()
    expect(parsePhotoDataUrl('data:application/octet-stream;base64,AAAA')).toBeNull()
  })
  it('REFUSE une entrée non-string / non data-URL / vide', () => {
    expect(parsePhotoDataUrl(12345 as unknown)).toBeNull()
    expect(parsePhotoDataUrl({} as unknown)).toBeNull()
    expect(parsePhotoDataUrl('not-a-data-url')).toBeNull()
    expect(parsePhotoDataUrl('data:image/png;base64,')).toBeNull()
  })
})

describe('login callbackUrl — anti open-redirect', () => {
  it('accepte les chemins internes relatifs', () => {
    expect(safeCallback('/')).toBe('/')
    expect(safeCallback('/dashboard')).toBe('/dashboard')
    expect(safeCallback('/clients?page=2')).toBe('/clients?page=2')
  })
  it('REFUSE les cibles externes / protocol-relative / backslash', () => {
    expect(safeCallback('https://evil.com')).toBe('/')
    expect(safeCallback('//evil.com')).toBe('/')
    expect(safeCallback('/\\evil.com')).toBe('/')
    expect(safeCallback('http://127.0.0.1:4028@evil.com')).toBe('/')
  })
})

describe('resolveSignatureKey — refus d’un GF_SIGNATURE_SECRET faible (fail-closed)', () => {
  const prev = process.env.GF_SIGNATURE_SECRET
  afterEach(() => {
    if (prev === undefined) delete process.env.GF_SIGNATURE_SECRET
    else process.env.GF_SIGNATURE_SECRET = prev
  })
  it('LÈVE si le secret dédié est trop court / générique', () => {
    process.env.GF_SIGNATURE_SECRET = 'sig'
    expect(() => resolveSignatureKey()).toThrow()
  })
  it('accepte un secret dédié fort et dérive une clé de 32 octets', () => {
    process.env.GF_SIGNATURE_SECRET = 'kQ7v2Zt9wP1sX4rB6nJ0aL3eH8cU5yD2mF7gK9pQ1s='
    const key = resolveSignatureKey()
    expect(key).toBeInstanceOf(Buffer)
    expect(key.length).toBe(32)
  })
})

describe('work-orders totals via money.ts — invariant exact', () => {
  it('TTC = HT + TVA (centimes), robuste au bruit float', () => {
    // 3 lignes à 0,10 € + une pièce 3 × 0,10 € → HT = 0,60 €, TVA 20 % = 0,12 €.
    const lines = [
      { quantity: 1, unitPrice: 0.1 },
      { quantity: 1, unitPrice: 0.1 },
      { quantity: 1, unitPrice: 0.1 },
      { quantity: 3, unitPrice: 0.1 },
    ]
    const t = computeTotals(lines, 20)
    expect(t.totalHT).toBe(0.6)
    expect(t.taxAmount).toBe(0.12)
    expect(t.totalTTC).toBe(0.72)
    // Invariant strict en centimes.
    expect(t.totalTTCCents).toBe(t.totalHTCents + t.taxCents)
  })
})
