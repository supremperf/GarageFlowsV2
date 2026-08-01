/**
 * Génération UN/CEFACT CII (Cross-Industry Invoice) — le XML embarqué par
 * Factur-X (profil EN 16931). Déterministe, montants exacts en centimes.
 *
 * NB : Factur-X = ce XML `factur-x.xml` intégré dans un PDF/A-3. La génération du
 * PDF/A-3 et l'incorporation du XML nécessitent une bibliothèque PDF et ne sont
 * PAS réalisées ici (voir docs/E_INVOICING_LIMITATIONS.md) — ce module fournit le
 * XML CII conforme, réutilisable tel quel par une étape d'incorporation PDF.
 */
import type { EInvoiceDocument, Party } from './types'
import { escapeXml, formatCents, formatQuantity, toFacturXDate } from './xml'

const EN16931_GUIDELINE = 'urn:cen.eu:en16931:2017'

function tradePartyXml(tag: string, p: Party): string {
  const o: string[] = []
  o.push(`      <ram:${tag}>`)
  o.push(`        <ram:Name>${escapeXml(p.name)}</ram:Name>`)
  if (p.siret) {
    o.push('        <ram:SpecifiedLegalOrganization>')
    o.push(`          <ram:ID schemeID="0009">${escapeXml(p.siret)}</ram:ID>`)
    o.push('        </ram:SpecifiedLegalOrganization>')
  }
  o.push('        <ram:PostalTradeAddress>')
  if (p.postalCode) o.push(`          <ram:PostcodeCode>${escapeXml(p.postalCode)}</ram:PostcodeCode>`)
  if (p.address) o.push(`          <ram:LineOne>${escapeXml(p.address)}</ram:LineOne>`)
  if (p.city) o.push(`          <ram:CityName>${escapeXml(p.city)}</ram:CityName>`)
  o.push(`          <ram:CountryID>${escapeXml(p.country)}</ram:CountryID>`)
  o.push('        </ram:PostalTradeAddress>')
  if (p.vatNumber) {
    o.push('        <ram:SpecifiedTaxRegistration>')
    o.push(`          <ram:ID schemeID="VA">${escapeXml(p.vatNumber)}</ram:ID>`)
    o.push('        </ram:SpecifiedTaxRegistration>')
  }
  o.push(`      </ram:${tag}>`)
  return o.join('\n')
}

/** Sérialise le document en CII (chaîne XML factur-x.xml). */
export function toCII(doc: EInvoiceDocument): string {
  const cur = escapeXml(doc.currency)
  const amt = (c: number) => formatCents(c)
  const o: string[] = []
  o.push('<?xml version="1.0" encoding="UTF-8"?>')
  o.push('<rsm:CrossIndustryInvoice')
  o.push('    xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"')
  o.push('    xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"')
  o.push('    xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">')
  // Contexte
  o.push('  <rsm:ExchangedDocumentContext>')
  o.push('    <ram:GuidelineSpecifiedDocumentContextParameter>')
  o.push(`      <ram:ID>${EN16931_GUIDELINE}</ram:ID>`)
  o.push('    </ram:GuidelineSpecifiedDocumentContextParameter>')
  o.push('  </rsm:ExchangedDocumentContext>')
  // En-tête document
  o.push('  <rsm:ExchangedDocument>')
  o.push(`    <ram:ID>${escapeXml(doc.id)}</ram:ID>`)
  o.push(`    <ram:TypeCode>${escapeXml(doc.typeCode)}</ram:TypeCode>`)
  o.push('    <ram:IssueDateTime>')
  o.push(`      <udt:DateTimeString format="102">${toFacturXDate(doc.issueDate)}</udt:DateTimeString>`)
  o.push('    </ram:IssueDateTime>')
  if (doc.note) {
    o.push('    <ram:IncludedNote>')
    o.push(`      <ram:Content>${escapeXml(doc.note)}</ram:Content>`)
    o.push('    </ram:IncludedNote>')
  }
  o.push('  </rsm:ExchangedDocument>')
  // Transaction
  o.push('  <rsm:SupplyChainTradeTransaction>')
  for (const l of doc.lines) {
    o.push('    <ram:IncludedSupplyChainTradeLineItem>')
    o.push('      <ram:AssociatedDocumentLineDocument>')
    o.push(`        <ram:LineID>${escapeXml(l.id)}</ram:LineID>`)
    o.push('      </ram:AssociatedDocumentLineDocument>')
    o.push('      <ram:SpecifiedTradeProduct>')
    o.push(`        <ram:Name>${escapeXml(l.description)}</ram:Name>`)
    o.push('      </ram:SpecifiedTradeProduct>')
    o.push('      <ram:SpecifiedLineTradeAgreement>')
    o.push('        <ram:NetPriceProductTradePrice>')
    o.push(`          <ram:ChargeAmount>${amt(l.unitPriceCents)}</ram:ChargeAmount>`)
    o.push('        </ram:NetPriceProductTradePrice>')
    o.push('      </ram:SpecifiedLineTradeAgreement>')
    o.push('      <ram:SpecifiedLineTradeDelivery>')
    o.push(`        <ram:BilledQuantity unitCode="C62">${formatQuantity(l.quantity)}</ram:BilledQuantity>`)
    o.push('      </ram:SpecifiedLineTradeDelivery>')
    o.push('      <ram:SpecifiedLineTradeSettlement>')
    o.push('        <ram:ApplicableTradeTax>')
    o.push('          <ram:TypeCode>VAT</ram:TypeCode>')
    o.push(`          <ram:CategoryCode>${escapeXml(l.vatCategory)}</ram:CategoryCode>`)
    o.push(`          <ram:RateApplicablePercent>${escapeXml(l.vatRatePercent)}</ram:RateApplicablePercent>`)
    o.push('        </ram:ApplicableTradeTax>')
    o.push('        <ram:SpecifiedTradeSettlementLineMonetarySummation>')
    o.push(`          <ram:LineTotalAmount>${amt(l.netAmountCents)}</ram:LineTotalAmount>`)
    o.push('        </ram:SpecifiedTradeSettlementLineMonetarySummation>')
    o.push('      </ram:SpecifiedLineTradeSettlement>')
    o.push('    </ram:IncludedSupplyChainTradeLineItem>')
  }
  // Accord d'en-tête (parties)
  o.push('    <ram:ApplicableHeaderTradeAgreement>')
  o.push(tradePartyXml('SellerTradeParty', doc.seller))
  o.push(tradePartyXml('BuyerTradeParty', doc.buyer))
  if (doc.precedingInvoiceRef) {
    o.push('      <ram:SpecifiedProcuringProject/>')
  }
  o.push('    </ram:ApplicableHeaderTradeAgreement>')
  o.push('    <ram:ApplicableHeaderTradeDelivery/>')
  // Règlement d'en-tête
  o.push('    <ram:ApplicableHeaderTradeSettlement>')
  o.push(`      <ram:InvoiceCurrencyCode>${cur}</ram:InvoiceCurrencyCode>`)
  if (doc.payment?.iban) {
    o.push('      <ram:SpecifiedTradeSettlementPaymentMeans>')
    o.push('        <ram:TypeCode>58</ram:TypeCode>')
    o.push('        <ram:PayeePartyCreditorFinancialAccount>')
    o.push(`          <ram:IBANID>${escapeXml(doc.payment.iban)}</ram:IBANID>`)
    o.push('        </ram:PayeePartyCreditorFinancialAccount>')
    o.push('      </ram:SpecifiedTradeSettlementPaymentMeans>')
  }
  for (const v of doc.vatBreakdown) {
    o.push('      <ram:ApplicableTradeTax>')
    o.push(`        <ram:CalculatedAmount>${amt(v.taxAmountCents)}</ram:CalculatedAmount>`)
    o.push('        <ram:TypeCode>VAT</ram:TypeCode>')
    o.push(`        <ram:BasisAmount>${amt(v.taxableAmountCents)}</ram:BasisAmount>`)
    o.push(`        <ram:CategoryCode>${escapeXml(v.vatCategory)}</ram:CategoryCode>`)
    o.push(`        <ram:RateApplicablePercent>${escapeXml(v.vatRatePercent)}</ram:RateApplicablePercent>`)
    o.push('      </ram:ApplicableTradeTax>')
  }
  if (doc.payment?.terms || doc.dueDate) {
    o.push('      <ram:SpecifiedTradePaymentTerms>')
    if (doc.payment?.terms) o.push(`        <ram:Description>${escapeXml(doc.payment.terms)}</ram:Description>`)
    if (doc.dueDate) {
      o.push('        <ram:DueDateDateTime>')
      o.push(`          <udt:DateTimeString format="102">${toFacturXDate(doc.dueDate)}</udt:DateTimeString>`)
      o.push('        </ram:DueDateDateTime>')
    }
    o.push('      </ram:SpecifiedTradePaymentTerms>')
  }
  o.push('      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>')
  o.push(`        <ram:LineTotalAmount>${amt(doc.totals.lineTotalCents)}</ram:LineTotalAmount>`)
  o.push(`        <ram:TaxBasisTotalAmount>${amt(doc.totals.taxExclusiveCents)}</ram:TaxBasisTotalAmount>`)
  o.push(`        <ram:TaxTotalAmount currencyID="${cur}">${amt(doc.totals.taxAmountCents)}</ram:TaxTotalAmount>`)
  o.push(`        <ram:GrandTotalAmount>${amt(doc.totals.taxInclusiveCents)}</ram:GrandTotalAmount>`)
  o.push(`        <ram:DuePayableAmount>${amt(doc.totals.payableCents)}</ram:DuePayableAmount>`)
  o.push('      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>')
  o.push('    </ram:ApplicableHeaderTradeSettlement>')
  o.push('  </rsm:SupplyChainTradeTransaction>')
  o.push('</rsm:CrossIndustryInvoice>')
  return o.join('\n')
}
