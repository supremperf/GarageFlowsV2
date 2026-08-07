/**
 * Sérialisation CII (UN/CEFACT Cross Industry Invoice) — profil Factur-X
 * MINIMUM (urn:factur-x.eu:1p0:minimum).
 *
 * FAIL-CLOSED : la sérialisation REFUSE tout document qui ne passe pas
 * `validateForProfile` — il est impossible d'émettre un XML incohérent ou
 * incomplet par ce chemin. Montants formatés depuis les CENTIMES ENTIERS par
 * arithmétique entière exclusivement (aucun flottant).
 *
 * Honnêteté (docs/EINVOICING_FORMATS.md) : ce module produit le XML CII du
 * profil MINIMUM. Il ne produit PAS un « Factur-X » complet au sens strict
 * (PDF/A-3 avec XML embarqué), n'exécute pas les XSD/Schematron officiels et
 * n'émet rien vers une plateforme (registre d'adaptateurs volontairement vide).
 */

import type { CanonicalEInvoice } from './document-model'
import { validateForProfile, type ValidationIssue } from './validate'

export class EInvoiceValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(
      `Document non conforme au profil minimum : ${issues.map((i) => i.ruleId).join(', ')}. ` +
        'Corrigez la facture avant génération.',
    )
  }
}

/** Échappement XML des 5 caractères réservés (contenu texte et attributs). */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Centimes entiers → chaîne décimale « 1234.56 » par arithmétique ENTIÈRE
 * (troncature + reste absolu, signe géré séparément). Jamais de flottant.
 */
export function centsToDecimalString(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new EInvoiceValidationError([
    { ruleId: 'GF-EI-090', severity: 'error', message: `Montant non entier : ${cents}.` },
  ])
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const euros = Math.trunc(abs / 100)
  const rest = abs - euros * 100
  return `${sign}${euros}.${String(rest).padStart(2, '0')}`
}

/** Taux de TVA (pourcent) → chaîne « 20.00 » (2 décimales, format EN 16931). */
export function ratePercentToString(rate: number): string {
  // Le taux vient de la base (Float Prisma hérité) : on le fige à 2 décimales
  // par la représentation en CENTIÈMES DE POINT entiers.
  const hundredths = Math.round(rate * 100)
  const sign = hundredths < 0 ? '-' : ''
  const abs = Math.abs(hundredths)
  const whole = Math.trunc(abs / 100)
  const rest = abs - whole * 100
  return `${sign}${whole}.${String(rest).padStart(2, '0')}`
}

/** YYYY-MM-DD → YYYYMMDD (format CII 102). La validité est déjà garantie. */
function toFormat102(isoDate: string): string {
  return isoDate.replace(/-/g, '')
}

const XMLNS =
  'xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" ' +
  'xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" ' +
  'xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"'

/**
 * Génère le XML CII du profil Factur-X MINIMUM pour un document canonique
 * VALIDE (sinon EInvoiceValidationError, fail-closed).
 */
export function generateFacturXMinimumXml(doc: CanonicalEInvoice): string {
  const result = validateForProfile(doc, 'minimum')
  if (!result.valid) throw new EInvoiceValidationError(result.errors)

  const seller = doc.seller
  const buyer = doc.buyer
  // CII : LegalOrganizationType n'admet qu'UN SEUL ram:ID (cardinalité 0..1 —
  // deux ID font échouer le XSD officiel Factur-X, démontré en revue). SIREN
  // (schemeID 0002) prioritaire, SIRET (0009) en repli.
  const sellerLegalId = seller.siren
    ? `<ram:ID schemeID="0002">${escapeXml(seller.siren)}</ram:ID>`
    : `<ram:ID schemeID="0009">${escapeXml(seller.siret ?? '')}</ram:ID>`

  // Profil MINIMUM : en-tête, identification des parties, totaux. Les lignes
  // détaillées relèvent des profils BASIC et supérieurs.
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<rsm:CrossIndustryInvoice ${XMLNS}>`,
    '  <rsm:ExchangedDocumentContext>',
    '    <ram:GuidelineSpecifiedDocumentContextParameter>',
    '      <ram:ID>urn:factur-x.eu:1p0:minimum</ram:ID>',
    '    </ram:GuidelineSpecifiedDocumentContextParameter>',
    '  </rsm:ExchangedDocumentContext>',
    '  <rsm:ExchangedDocument>',
    `    <ram:ID>${escapeXml(doc.invoiceNumber)}</ram:ID>`,
    `    <ram:TypeCode>${doc.typeCode}</ram:TypeCode>`,
    '    <ram:IssueDateTime>',
    `      <udt:DateTimeString format="102">${toFormat102(doc.issueDate)}</udt:DateTimeString>`,
    '    </ram:IssueDateTime>',
    '  </rsm:ExchangedDocument>',
    '  <rsm:SupplyChainTradeTransaction>',
    '    <ram:ApplicableHeaderTradeAgreement>',
    '      <ram:SellerTradeParty>',
    `        <ram:Name>${escapeXml(seller.name)}</ram:Name>`,
    '        <ram:SpecifiedLegalOrganization>',
    `          ${sellerLegalId}`,
    '        </ram:SpecifiedLegalOrganization>',
    '        <ram:PostalTradeAddress>',
    `          <ram:CountryID>${escapeXml(seller.countryCode)}</ram:CountryID>`,
    '        </ram:PostalTradeAddress>',
    '        <ram:SpecifiedTaxRegistration>',
    `          <ram:ID schemeID="VA">${escapeXml(seller.vatNumber ?? '')}</ram:ID>`,
    '        </ram:SpecifiedTaxRegistration>',
    '      </ram:SellerTradeParty>',
    '      <ram:BuyerTradeParty>',
    `        <ram:Name>${escapeXml(buyer.name)}</ram:Name>`,
    '      </ram:BuyerTradeParty>',
    '    </ram:ApplicableHeaderTradeAgreement>',
    '    <ram:ApplicableHeaderTradeDelivery/>',
    '    <ram:ApplicableHeaderTradeSettlement>',
    `      <ram:InvoiceCurrencyCode>${doc.currency}</ram:InvoiceCurrencyCode>`,
    '      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>',
    `        <ram:TaxBasisTotalAmount>${centsToDecimalString(doc.taxBasisCents)}</ram:TaxBasisTotalAmount>`,
    `        <ram:TaxTotalAmount currencyID="${doc.currency}">${centsToDecimalString(doc.taxCents)}</ram:TaxTotalAmount>`,
    `        <ram:GrandTotalAmount>${centsToDecimalString(doc.grandTotalCents)}</ram:GrandTotalAmount>`,
    `        <ram:DuePayableAmount>${centsToDecimalString(doc.grandTotalCents)}</ram:DuePayableAmount>`,
    '      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>',
    '    </ram:ApplicableHeaderTradeSettlement>',
    '  </rsm:SupplyChainTradeTransaction>',
    '</rsm:CrossIndustryInvoice>',
    '',
  ].join('\n')
}
