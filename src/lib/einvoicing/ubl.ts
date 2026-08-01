/**
 * Génération UBL 2.1 (profil EN 16931) depuis le document normalisé.
 *
 * Produit un XML `<Invoice>` déterministe couvrant le cœur EN 16931 : parties
 * (SIRET/TVA), lignes, ventilation TVA, totaux légaux. Les montants proviennent
 * des centimes entiers (formatage exact). Ce n'est pas un document signé ni
 * transmis à une PDP — voir docs/E_INVOICING_LIMITATIONS.md.
 */
import type { EInvoiceDocument, Party } from './types'
import { escapeXml, formatCents, formatQuantity } from './xml'

const EN16931_CUSTOMIZATION = 'urn:cen.eu:en16931:2017'
const PROFILE = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0'

function partyXml(tag: string, p: Party): string {
  const lines: string[] = []
  lines.push(`  <cac:${tag}>`)
  lines.push('    <cac:Party>')
  lines.push('      <cac:PartyName>')
  lines.push(`        <cbc:Name>${escapeXml(p.name)}</cbc:Name>`)
  lines.push('      </cac:PartyName>')
  lines.push('      <cac:PostalAddress>')
  if (p.address) lines.push(`        <cbc:StreetName>${escapeXml(p.address)}</cbc:StreetName>`)
  if (p.city) lines.push(`        <cbc:CityName>${escapeXml(p.city)}</cbc:CityName>`)
  if (p.postalCode) lines.push(`        <cbc:PostalZone>${escapeXml(p.postalCode)}</cbc:PostalZone>`)
  lines.push('        <cac:Country>')
  lines.push(`          <cbc:IdentificationCode>${escapeXml(p.country)}</cbc:IdentificationCode>`)
  lines.push('        </cac:Country>')
  lines.push('      </cac:PostalAddress>')
  if (p.vatNumber) {
    lines.push('      <cac:PartyTaxScheme>')
    lines.push(`        <cbc:CompanyID>${escapeXml(p.vatNumber)}</cbc:CompanyID>`)
    lines.push('        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>')
    lines.push('      </cac:PartyTaxScheme>')
  }
  lines.push('      <cac:PartyLegalEntity>')
  lines.push(`        <cbc:RegistrationName>${escapeXml(p.name)}</cbc:RegistrationName>`)
  if (p.siret) lines.push(`        <cbc:CompanyID schemeID="0009">${escapeXml(p.siret)}</cbc:CompanyID>`)
  lines.push('      </cac:PartyLegalEntity>')
  if (p.email || p.phone) {
    lines.push('      <cac:Contact>')
    if (p.phone) lines.push(`        <cbc:Telephone>${escapeXml(p.phone)}</cbc:Telephone>`)
    if (p.email) lines.push(`        <cbc:ElectronicMail>${escapeXml(p.email)}</cbc:ElectronicMail>`)
    lines.push('      </cac:Contact>')
  }
  lines.push('    </cac:Party>')
  lines.push(`  </cac:${tag}>`)
  return lines.join('\n')
}

/** Sérialise le document en UBL 2.1 Invoice (chaîne XML). */
export function toUBL(doc: EInvoiceDocument): string {
  const cur = escapeXml(doc.currency)
  const amt = (cents: number) => `${formatCents(cents)}`
  const out: string[] = []
  out.push('<?xml version="1.0" encoding="UTF-8"?>')
  out.push('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"')
  out.push('         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"')
  out.push('         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">')
  out.push(`  <cbc:CustomizationID>${EN16931_CUSTOMIZATION}</cbc:CustomizationID>`)
  out.push(`  <cbc:ProfileID>${PROFILE}</cbc:ProfileID>`)
  out.push(`  <cbc:ID>${escapeXml(doc.id)}</cbc:ID>`)
  out.push(`  <cbc:IssueDate>${escapeXml(doc.issueDate)}</cbc:IssueDate>`)
  if (doc.dueDate) out.push(`  <cbc:DueDate>${escapeXml(doc.dueDate)}</cbc:DueDate>`)
  out.push(`  <cbc:InvoiceTypeCode>${escapeXml(doc.typeCode)}</cbc:InvoiceTypeCode>`)
  if (doc.note) out.push(`  <cbc:Note>${escapeXml(doc.note)}</cbc:Note>`)
  out.push(`  <cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>`)
  if (doc.precedingInvoiceRef) {
    out.push('  <cac:BillingReference>')
    out.push('    <cac:InvoiceDocumentReference>')
    out.push(`      <cbc:ID>${escapeXml(doc.precedingInvoiceRef)}</cbc:ID>`)
    out.push('    </cac:InvoiceDocumentReference>')
    out.push('  </cac:BillingReference>')
  }
  out.push(partyXml('AccountingSupplierParty', doc.seller))
  out.push(partyXml('AccountingCustomerParty', doc.buyer))
  if (doc.payment?.iban) {
    out.push('  <cac:PaymentMeans>')
    out.push('    <cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>')
    out.push('    <cac:PayeeFinancialAccount>')
    out.push(`      <cbc:ID>${escapeXml(doc.payment.iban)}</cbc:ID>`)
    if (doc.payment.bic) {
      out.push('      <cac:FinancialInstitutionBranch><cac:FinancialInstitution>')
      out.push(`        <cbc:ID>${escapeXml(doc.payment.bic)}</cbc:ID>`)
      out.push('      </cac:FinancialInstitution></cac:FinancialInstitutionBranch>')
    }
    out.push('    </cac:PayeeFinancialAccount>')
    out.push('  </cac:PaymentMeans>')
  }
  if (doc.payment?.terms) {
    out.push('  <cac:PaymentTerms>')
    out.push(`    <cbc:Note>${escapeXml(doc.payment.terms)}</cbc:Note>`)
    out.push('  </cac:PaymentTerms>')
  }
  // TaxTotal
  out.push('  <cac:TaxTotal>')
  out.push(`    <cbc:TaxAmount currencyID="${cur}">${amt(doc.totals.taxAmountCents)}</cbc:TaxAmount>`)
  for (const v of doc.vatBreakdown) {
    out.push('    <cac:TaxSubtotal>')
    out.push(`      <cbc:TaxableAmount currencyID="${cur}">${amt(v.taxableAmountCents)}</cbc:TaxableAmount>`)
    out.push(`      <cbc:TaxAmount currencyID="${cur}">${amt(v.taxAmountCents)}</cbc:TaxAmount>`)
    out.push('      <cac:TaxCategory>')
    out.push(`        <cbc:ID>${escapeXml(v.vatCategory)}</cbc:ID>`)
    out.push(`        <cbc:Percent>${escapeXml(v.vatRatePercent)}</cbc:Percent>`)
    out.push('        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>')
    out.push('      </cac:TaxCategory>')
    out.push('    </cac:TaxSubtotal>')
  }
  out.push('  </cac:TaxTotal>')
  // LegalMonetaryTotal
  out.push('  <cac:LegalMonetaryTotal>')
  out.push(`    <cbc:LineExtensionAmount currencyID="${cur}">${amt(doc.totals.lineTotalCents)}</cbc:LineExtensionAmount>`)
  out.push(`    <cbc:TaxExclusiveAmount currencyID="${cur}">${amt(doc.totals.taxExclusiveCents)}</cbc:TaxExclusiveAmount>`)
  out.push(`    <cbc:TaxInclusiveAmount currencyID="${cur}">${amt(doc.totals.taxInclusiveCents)}</cbc:TaxInclusiveAmount>`)
  out.push(`    <cbc:PayableAmount currencyID="${cur}">${amt(doc.totals.payableCents)}</cbc:PayableAmount>`)
  out.push('  </cac:LegalMonetaryTotal>')
  // Lines
  for (const l of doc.lines) {
    out.push('  <cac:InvoiceLine>')
    out.push(`    <cbc:ID>${escapeXml(l.id)}</cbc:ID>`)
    out.push(`    <cbc:InvoicedQuantity unitCode="C62">${formatQuantity(l.quantity)}</cbc:InvoicedQuantity>`)
    out.push(`    <cbc:LineExtensionAmount currencyID="${cur}">${amt(l.netAmountCents)}</cbc:LineExtensionAmount>`)
    out.push('    <cac:Item>')
    out.push(`      <cbc:Name>${escapeXml(l.description)}</cbc:Name>`)
    out.push('      <cac:ClassifiedTaxCategory>')
    out.push(`        <cbc:ID>${escapeXml(l.vatCategory)}</cbc:ID>`)
    out.push(`        <cbc:Percent>${escapeXml(l.vatRatePercent)}</cbc:Percent>`)
    out.push('        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>')
    out.push('      </cac:ClassifiedTaxCategory>')
    out.push('    </cac:Item>')
    out.push('    <cac:Price>')
    out.push(`      <cbc:PriceAmount currencyID="${cur}">${amt(l.unitPriceCents)}</cbc:PriceAmount>`)
    out.push('    </cac:Price>')
    out.push('  </cac:InvoiceLine>')
  }
  out.push('</Invoice>')
  return out.join('\n')
}
