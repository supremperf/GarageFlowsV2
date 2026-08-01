/**
 * Cartographie Prisma → document e-invoice normalisé (EN 16931).
 *
 * Découplé de Prisma : accepte des formes minimales (interfaces ci-dessous) pour
 * être testable sans base. Tous les montants passent par src/lib/money.ts
 * (centimes entiers, invariant TTC = HT + TVA garanti).
 */
import { toCents, multiplyCents } from '@/lib/money'
import type {
  EInvoiceDocument,
  DocumentLine,
  VatBreakdownEntry,
  VatCategory,
  InvoiceTypeCode,
  Party,
} from './types'

export interface InvoiceLineInput {
  id?: string
  description: string
  quantity: number
  /** Prix unitaire HT en EUROS. */
  unitPrice: number
}

export interface InvoiceInput {
  number: string
  issueDate: string
  dueDate?: string | null
  taxRate: number
  notes?: string | null
  clientName: string
  clientAddress?: string | null
  clientEmail?: string | null
  clientPhone?: string | null
  lines: InvoiceLineInput[]
}

export interface GarageInput {
  name: string
  siret?: string | null
  vatNumber?: string | null
  address?: string | null
  email?: string | null
  phone?: string | null
  iban?: string | null
  bic?: string | null
  currency?: string | null
  paymentTerms?: string | null
}

export interface MapOptions {
  /** 380 = facture (défaut) ; 381 = avoir. */
  typeCode?: InvoiceTypeCode
  /** Numéro de la facture d'origine (avoir). */
  precedingInvoiceRef?: string
  /** SIRET de l'acheteur si connu (B2B). Le schéma Client ne le stocke pas encore. */
  buyerSiret?: string
  /** N° TVA intracommunautaire de l'acheteur si connu. */
  buyerVatNumber?: string
  /** Code pays du vendeur/acheteur (défaut FR). */
  country?: string
}

/**
 * Normalise une date vers `YYYY-MM-DD`. Accepte l'ISO et le format FR `DD/MM/YYYY`.
 * Renvoie la chaîne d'entrée si non reconnue (le validateur signalera l'erreur).
 */
export function normalizeDate(input: string | null | undefined): string {
  if (!input) return ''
  const s = String(input).trim()
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const fr = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`
  return s
}

function vatCategoryForRate(rate: number): VatCategory {
  return rate === 0 ? 'Z' : 'S'
}

/** Construit le document normalisé à partir de la facture + du garage émetteur. */
export function mapInvoiceToDocument(
  invoice: InvoiceInput,
  garage: GarageInput,
  options: MapOptions = {},
): EInvoiceDocument {
  const country = options.country ?? 'FR'
  const currency = (garage.currency && garage.currency.trim()) || 'EUR'
  const rate = Number.isFinite(invoice.taxRate) ? invoice.taxRate : 0

  const lines: DocumentLine[] = (invoice.lines ?? []).map((l, i) => {
    const unitPriceCents = toCents(l.unitPrice)
    const netAmountCents = multiplyCents(unitPriceCents, l.quantity ?? 0)
    return {
      id: l.id ?? String(i + 1),
      description: l.description ?? '',
      quantity: l.quantity ?? 0,
      unitPriceCents,
      netAmountCents,
      vatRatePercent: rate,
      vatCategory: vatCategoryForRate(rate),
    }
  })

  const lineTotalCents = lines.reduce((s, l) => s + l.netAmountCents, 0)
  const taxExclusiveCents = lineTotalCents
  const taxAmountCents = Math.round((taxExclusiveCents * rate) / 100)
  const taxInclusiveCents = taxExclusiveCents + taxAmountCents

  const vatBreakdown: VatBreakdownEntry[] = [
    {
      vatCategory: vatCategoryForRate(rate),
      vatRatePercent: rate,
      taxableAmountCents: taxExclusiveCents,
      taxAmountCents,
    },
  ]

  const seller: Party = {
    name: garage.name,
    siret: garage.siret ?? undefined,
    vatNumber: garage.vatNumber ?? undefined,
    address: garage.address ?? undefined,
    country,
    email: garage.email ?? undefined,
    phone: garage.phone ?? undefined,
  }

  const buyer: Party = {
    name: invoice.clientName,
    siret: options.buyerSiret,
    vatNumber: options.buyerVatNumber,
    address: invoice.clientAddress ?? undefined,
    country,
    email: invoice.clientEmail ?? undefined,
    phone: invoice.clientPhone ?? undefined,
  }

  return {
    profile: 'EN16931',
    id: invoice.number,
    typeCode: options.typeCode ?? '380',
    issueDate: normalizeDate(invoice.issueDate),
    dueDate: invoice.dueDate ? normalizeDate(invoice.dueDate) : undefined,
    currency,
    seller,
    buyer,
    lines,
    vatBreakdown,
    totals: {
      lineTotalCents,
      taxExclusiveCents,
      taxAmountCents,
      taxInclusiveCents,
      payableCents: taxInclusiveCents,
    },
    payment: (garage.iban || garage.bic || garage.paymentTerms)
      ? { iban: garage.iban ?? undefined, bic: garage.bic ?? undefined, terms: garage.paymentTerms ?? undefined }
      : undefined,
    note: invoice.notes ?? undefined,
    precedingInvoiceRef: options.precedingInvoiceRef,
  }
}
