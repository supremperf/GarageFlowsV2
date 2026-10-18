/**
 * Facturation électronique — couche FORMATS (lot D résiduel).
 *
 * Couvre : identifiants français (SIREN/SIRET Luhn, clé TVA FR), construction
 * du modèle canonique (montants 100 % entiers via la couche financière),
 * validation de profil MINIMUM (chaque règle de cohérence déclenchée), et
 * sérialisation CII fail-closed (échappement XML, refus des documents
 * invalides, formatage entier des montants).
 *
 * Identifiants de test PRÉ-CALCULÉS (Luhn) : SIREN 123456782 (somme 40),
 * SIRET 12345678200010 (somme 40), clé TVA = (12 + 3×(123456782 mod 97)) mod
 * 97 = (12 + 3×32) mod 97 = 11 → FR11123456782.
 */
import { describe, it, expect } from 'vitest'
import { taxCentsFromBasis, lineTotalCentsFromScaled, MAX_SCALED } from '@/lib/money'
import { buildCanonicalInvoice, type CanonicalEInvoice } from '@/lib/einvoicing/document-model'
import { isValidSiren, isValidSiret, isValidFrVatNumber, validateForProfile } from '@/lib/einvoicing/validate'
import {
  generateFacturXMinimumXml,
  escapeXml,
  centsToDecimalString,
  ratePercentToString,
  EInvoiceValidationError,
} from '@/lib/einvoicing/cii-xml'

const garage = {
  name: 'Garage Demo',
  siret: '123 456 782 00010'.replace(/ /g, ' '), // espaces volontaires : normalisés par le builder
  vatNumber: 'FR11 123 456 782',
  address: '12 rue de la Mécanique, 75001 Paris',
}
const invoice = {
  number: 'FAC-2026-001',
  issueDate: '2026-08-01',
  dueDate: '2026-08-31',
  taxRate: 20,
  clientName: 'Martin Dupont',
  clientAddress: '3 rue des Clients, 75011 Paris',
}
const lines = [
  { description: 'Filtre à huile', quantityTenThousandths: 10000, unitPriceTenThousandths: 89000 }, // 8,90 €
  { description: 'Huile moteur 5W30 (5 L)', quantityTenThousandths: 10000, unitPriceTenThousandths: 399000 }, // 39,90 €
  { description: 'Main-dœuvre vidange (0,5 h)', quantityTenThousandths: 5000, unitPriceTenThousandths: 650000 }, // 0,5 × 65 €
]

const build = () => buildCanonicalInvoice(garage, invoice, lines)

describe('identifiants français', () => {
  it('SIREN : Luhn valide accepté, invalide refusé, format contrôlé', () => {
    expect(isValidSiren('123456782')).toBe(true)
    expect(isValidSiren('123 456 782')).toBe(true) // espaces tolérés
    expect(isValidSiren('123456789')).toBe(false) // mauvaise clé
    expect(isValidSiren('12345678')).toBe(false) // 8 chiffres
    expect(isValidSiren('12345678a')).toBe(false)
    expect(isValidSiren('000000000')).toBe(false) // sentinelle tout-zéros (Luhn-valide) rejetée
    expect(isValidSiret('00000000000000')).toBe(false)
  })
  it('SIRET : Luhn 14 chiffres', () => {
    expect(isValidSiret('12345678200010')).toBe(true)
    expect(isValidSiret('12345678200011')).toBe(false)
    expect(isValidSiret('1234567820001')).toBe(false)
  })
  it('TVA FR : clé (12 + 3×(SIREN mod 97)) mod 97 vérifiée', () => {
    expect(isValidFrVatNumber('FR11123456782')).toBe(true)
    expect(isValidFrVatNumber('fr11 123 456 782')).toBe(true) // casse/espaces tolérées
    expect(isValidFrVatNumber('FR12123456782')).toBe(false) // mauvaise clé
    expect(isValidFrVatNumber('FR11123456789')).toBe(false) // SIREN Luhn-invalide
    expect(isValidFrVatNumber('DE11123456782')).toBe(false) // pays non géré ici
  })
})

describe('modèle canonique — arithmétique entière', () => {
  it('totaux exacts : lignes 890 + 3990 + 3250 c, TVA 20 %, identité TTC', () => {
    const doc = build()
    expect(doc.lines.map((l) => l.lineTotalCents)).toEqual([890, 3990, 3250])
    expect(doc.taxBasisCents).toBe(8130)
    expect(doc.taxCents).toBe(1626) // 8130 × 20 % — exact
    expect(doc.grandTotalCents).toBe(8130 + 1626)
    expect(doc.taxCents).toBe(taxCentsFromBasis(doc.taxBasisCents, 20)) // même formule centrale
  })
  it('SIREN dérivé du SIRET normalisé ; TVA normalisée', () => {
    const doc = build()
    expect(doc.seller.siret).toBe('12345678200010')
    expect(doc.seller.siren).toBe('123456782')
    expect(doc.seller.vatNumber).toBe('FR11123456782')
  })
  it('arrondi de TVA demi-éloigné-de-zéro appliqué une fois sur l’assiette', () => {
    // 25 c à 10 % → 2,5 c → 3 c (jamais 2).
    expect(taxCentsFromBasis(25, 10)).toBe(3)
    // 8130 c à 5,5 % → 447,15 c → 447 c.
    expect(taxCentsFromBasis(8130, 5.5)).toBe(447)
  })
  it('TVA exacte sur taux exotiques — régressions du bruit IEEE-754 (revue adversariale)', () => {
    // Chaque cas : le produit flottant historique arrondissait le demi-centime
    // exact vers le bas (38,4999… → 38) ; le chemin en centièmes de point
    // entiers donne la valeur fiscale demi-éloignée-de-zéro correcte.
    expect(taxCentsFromBasis(5500, 0.7)).toBe(39) // 38,50 c exact
    expect(taxCentsFromBasis(11000, 0.35)).toBe(39) // 38,50 c exact
    expect(taxCentsFromBasis(5000, 0.57)).toBe(29) // 28,50 c exact
    expect(taxCentsFromBasis(12500, 0.58)).toBe(73) // 72,50 c exact
    // Taux français standard : inchangés.
    expect(taxCentsFromBasis(8130, 20)).toBe(1626)
    expect(taxCentsFromBasis(8130, 10)).toBe(813)
    expect(taxCentsFromBasis(8130, 2.1)).toBe(171) // 170,73 c → 171
  })
  it('repli grands montants de lineTotalCentsFromScaled : arrondi unique exact (régressions revue)', () => {
    // Produits ≥ 2^53 : l'ancien repli arrondissait deux fois (±1 c d'écart).
    // Valeurs exactes calculées par oracle BigInt en revue adversariale.
    expect(lineTotalCentsFromScaled(1470875893, 27920598)).toBe(41067734516)
    expect(lineTotalCentsFromScaled(1834380654, 37620431)).toBe(69010190822)
    expect(lineTotalCentsFromScaled(MAX_SCALED, MAX_SCALED)).toBe(4611686014132)
  })
})

describe('validation de profil MINIMUM', () => {
  it('document complet valide : 0 erreur', () => {
    const r = validateForProfile(build())
    expect(r.errors).toEqual([])
    expect(r.valid).toBe(true)
  })
  const cases: Array<[string, (d: CanonicalEInvoice) => void, string]> = [
    ['numéro absent', (d) => { d.invoiceNumber = ' ' }, 'GF-EI-001'],
    ['date d’émission invalide (2026-02-30)', (d) => { d.issueDate = '2026-02-30' }, 'GF-EI-003'],
    ['devise non EUR', (d) => { (d as { currency: string }).currency = 'USD' }, 'GF-EI-005'],
    ['SIRET vendeur absent', (d) => { d.seller.siret = undefined; d.seller.siren = undefined }, 'GF-EI-011'],
    ['SIRET vendeur Luhn-invalide', (d) => { d.seller.siret = '12345678200011' }, 'GF-EI-012'],
    ['incohérence SIREN/SIRET', (d) => { d.seller.siren = '123456782'; d.seller.siret = '99999999900066' }, 'GF-EI-014'],
    ['TVA vendeur absente', (d) => { d.seller.vatNumber = undefined }, 'GF-EI-015'],
    ['TVA vendeur mauvaise clé', (d) => { d.seller.vatNumber = 'FR12123456782' }, 'GF-EI-016'],
    ['acheteur sans nom', (d) => { d.buyer.name = '' }, 'GF-EI-020'],
    ['aucune ligne', (d) => { d.lines = []; d.taxBasisCents = 0; d.taxCents = 0; d.grandTotalCents = 0 }, 'GF-EI-030'],
    ['quantité nulle', (d) => { d.lines[0].quantityScaled = 0 }, 'GF-EI-032'],
    ['assiette falsifiée', (d) => { d.taxBasisCents += 1 }, 'GF-EI-041'],
    ['TVA falsifiée', (d) => { d.taxCents += 1 }, 'GF-EI-042'],
    ['TTC falsifié', (d) => { d.grandTotalCents += 1 }, 'GF-EI-043'],
  ]
  for (const [label, mutate, ruleId] of cases) {
    it(`détecte : ${label} → ${ruleId}`, () => {
      const doc = build()
      mutate(doc)
      const r = validateForProfile(doc)
      expect(r.valid).toBe(false)
      expect(r.errors.map((e) => e.ruleId)).toContain(ruleId)
    })
  }
  it('falsification de TVA ET de TTC compensées → les DEUX règles se déclenchent', () => {
    const doc = build()
    doc.taxCents += 100
    doc.grandTotalCents += 100 // TTC cohérent avec la TVA falsifiée…
    const r = validateForProfile(doc)
    expect(r.errors.map((e) => e.ruleId)).toContain('GF-EI-042') // …mais la TVA ne colle plus au taux
  })
  it('durcissements issus de la revue adversariale', () => {
    // 1. Dépassement MAX_SCALED : la couche financière renvoie 0 — la règle
    //    GF-EI-035 empêche la facture « 0,00 € validée » (fail-open démontré).
    const over = build()
    over.lines[0].unitPriceScaled = MAX_SCALED + 1
    over.lines[0].lineTotalCents = lineTotalCentsFromScaled(MAX_SCALED + 1, over.lines[0].quantityScaled)
    let r = validateForProfile(over)
    expect(r.valid).toBe(false)
    expect(r.errors.map((e) => e.ruleId)).toContain('GF-EI-035')

    // 2. lineTotalCents falsifié avec totaux recohérés : recalcul de ligne.
    const forged = build()
    forged.lines[0].lineTotalCents += 100000
    forged.taxBasisCents += 100000
    forged.taxCents = taxCentsFromBasis(forged.taxBasisCents, 20)
    forged.grandTotalCents = forged.taxBasisCents + forged.taxCents
    r = validateForProfile(forged)
    expect(r.valid).toBe(false)
    expect(r.errors.map((e) => e.ruleId)).toContain('GF-EI-036')

    // 3. taxRate NaN : plus jamais blanchi en 0 % — rejeté (GF-EI-040) et la
    //    sérialisation refuse.
    const nan = buildCanonicalInvoice(garage, { ...invoice, taxRate: Number.NaN }, lines)
    expect(Number.isNaN(nan.taxRatePercent)).toBe(true)
    r = validateForProfile(nan)
    expect(r.errors.map((e) => e.ruleId)).toContain('GF-EI-040')
    expect(() => generateFacturXMinimumXml(nan)).toThrowError(EInvoiceValidationError)

    // 4. Caractère de contrôle XML 1.0 interdit dans un champ texte.
    const ctrl = build()
    ctrl.buyer.name = 'Client\u0007 Fils'
    r = validateForProfile(ctrl)
    expect(r.errors.map((e) => e.ruleId)).toContain('GF-EI-050')

    // 5. Nom « invisiblement vide » (U+200B) = vide.
    const zw = build()
    zw.buyer.name = '\u200B\u200B'
    r = validateForProfile(zw)
    expect(r.errors.map((e) => e.ruleId)).toContain('GF-EI-020')

    // 6. Code pays invalide.
    const cc = build()
    ;(cc.seller as { countryCode: string }).countryCode = 'fr'
    r = validateForProfile(cc)
    expect(r.errors.map((e) => e.ruleId)).toContain('GF-EI-019')
  })
})

describe('sérialisation CII (Factur-X MINIMUM) — fail-closed', () => {
  it('formatage entier des montants et du taux', () => {
    expect(centsToDecimalString(0)).toBe('0.00')
    expect(centsToDecimalString(5)).toBe('0.05')
    expect(centsToDecimalString(9756)).toBe('97.56')
    expect(centsToDecimalString(-150)).toBe('-1.50')
    expect(ratePercentToString(20)).toBe('20.00')
    expect(ratePercentToString(5.5)).toBe('5.50')
  })
  it('XML complet : guideline MINIMUM, identités, dates 102, totaux exacts', () => {
    const xml = generateFacturXMinimumXml(build())
    expect(xml).toContain('<ram:ID>urn:factur-x.eu:1p0:minimum</ram:ID>')
    expect(xml).toContain('<ram:ID>FAC-2026-001</ram:ID>')
    expect(xml).toContain('<ram:TypeCode>380</ram:TypeCode>')
    expect(xml).toContain('<udt:DateTimeString format="102">20260801</udt:DateTimeString>')
    // UN SEUL ram:ID sous SpecifiedLegalOrganization (cardinalité XSD 0..1 —
    // le double ID SIREN+SIRET faisait échouer le XSD officiel, corrigé).
    expect(xml).toContain('<ram:ID schemeID="0002">123456782</ram:ID>')
    expect(xml).not.toContain('schemeID="0009"')
    expect(xml).toContain('<ram:ID schemeID="VA">FR11123456782</ram:ID>')
    expect(xml).toContain('<ram:TaxBasisTotalAmount>81.30</ram:TaxBasisTotalAmount>')
    expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">16.26</ram:TaxTotalAmount>')
    expect(xml).toContain('<ram:GrandTotalAmount>97.56</ram:GrandTotalAmount>')
    expect(xml).toContain('<ram:DuePayableAmount>97.56</ram:DuePayableAmount>')
  })
  it('échappe les caractères XML réservés (aucune injection de balise)', () => {
    expect(escapeXml(`A & B <SARL> "l'atelier"`)).toBe('A &amp; B &lt;SARL&gt; &quot;l&apos;atelier&quot;')
    const doc = build()
    doc.buyer.name = 'Client <script> & Fils'
    const xml = generateFacturXMinimumXml(doc)
    expect(xml).toContain('Client &lt;script&gt; &amp; Fils')
    expect(xml).not.toContain('<script>')
  })
  it('REFUSE de sérialiser un document invalide (fail-closed, règles citées)', () => {
    const doc = build()
    doc.taxCents += 1
    expect(() => generateFacturXMinimumXml(doc)).toThrowError(EInvoiceValidationError)
    try {
      generateFacturXMinimumXml(doc)
    } catch (e) {
      expect((e as EInvoiceValidationError).issues.map((i) => i.ruleId)).toContain('GF-EI-042')
    }
  })
})
