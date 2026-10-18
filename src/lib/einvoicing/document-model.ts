/**
 * Modèle CANONIQUE de facture électronique (sous-ensemble EN 16931).
 *
 * Représentation intermédiaire unique entre les entités Prisma (Invoice +
 * InvoiceLine + Garage) et les formats de sortie (CII/Factur-X). Tous les
 * montants sont en CENTIMES ENTIERS, calculés exclusivement par la couche
 * financière centrale (`src/lib/money.ts`) : `lineTotalCentsFromScaled` pour
 * chaque ligne, `taxCentsFromBasis` pour la TVA — jamais d'arithmétique
 * flottante locale.
 *
 * Périmètre honnête : factures « simples » du logiciel (un taux de TVA par
 * document, devise EUR, type 380 — les avoirs n'existent pas encore dans le
 * modèle de données). La validation de profil est dans `validate.ts`, la
 * sérialisation CII dans `cii-xml.ts`.
 */

import { lineTotalCentsFromScaled, taxCentsFromBasis } from '@/lib/money'

/** Partie (vendeur/acheteur) au sens EN 16931 (BG-4 / BG-7). */
export interface CanonicalParty {
  /** BT-27 / BT-44 — raison sociale. */
  name: string
  /** BT-30 — identifiant légal (SIREN, 9 chiffres). */
  siren?: string
  /** Établissement (SIRET, 14 chiffres) — schéma 0009. */
  siret?: string
  /** BT-31 / BT-48 — n° TVA intracommunautaire (FRkk + SIREN). */
  vatNumber?: string
  /** BG-5 / BG-8 — adresse postale (lignes libres). */
  addressLines?: string[]
  /** BT-40 / BT-55 — code pays ISO 3166-1 alpha-2. */
  countryCode: string
}

/** Ligne de facture (BG-25) — montants exacts issus des entiers stockés. */
export interface CanonicalLine {
  /** BT-153 — libellé. */
  description: string
  /** Quantité en DIX-MILLIÈMES d'unité (10000 = 1). */
  quantityScaled: number
  /** Prix unitaire HT en DIX-MILLIÈMES d'euro. */
  unitPriceScaled: number
  /** BT-131 — montant HT de la ligne en centimes (arrondi central unique). */
  lineTotalCents: number
}

/** Type de document (BT-3) : 380 = facture commerciale, 381 = avoir. */
export type EInvoiceTypeCode = '380' | '381'

/** Facture canonique (sous-ensemble EN 16931, un seul taux de TVA). */
export interface CanonicalEInvoice {
  /** BT-1 — numéro unique (ex. FAC-2026-001). */
  invoiceNumber: string
  /** BT-3. */
  typeCode: EInvoiceTypeCode
  /** BT-2 — date d'émission YYYY-MM-DD. */
  issueDate: string
  /** BT-9 — date d'échéance YYYY-MM-DD (optionnelle). */
  dueDate?: string
  /** BT-5 — devise (EUR uniquement à ce stade). */
  currency: 'EUR'
  seller: CanonicalParty
  buyer: CanonicalParty
  /** Taux de TVA unique du document, en pourcent (BT-119). */
  taxRatePercent: number
  /** BT-109 — assiette HT en centimes = somme exacte des lignes. */
  taxBasisCents: number
  /** BT-110 — TVA en centimes (arrondi central unique sur l'assiette). */
  taxCents: number
  /** BT-112 — TTC en centimes = assiette + TVA (identité entière). */
  grandTotalCents: number
  lines: CanonicalLine[]
}

/** Formes structurelles minimales attendues des entités (indépendant de Prisma). */
export interface InvoiceLikeLine {
  description: string
  quantityTenThousandths: number
  unitPriceTenThousandths: number
}
export interface InvoiceLike {
  number: string
  issueDate: string
  dueDate?: string | null
  taxRate: number
  clientName: string
  clientAddress?: string | null
}
export interface GarageLike {
  name: string
  siret?: string | null
  vatNumber?: string | null
  address?: string | null
}

/** SIREN = 9 premiers chiffres du SIRET (si présent et plausible). */
function sirenFromSiret(siret: string | null | undefined): string | undefined {
  if (!siret) return undefined
  const digits = siret.replace(/\s+/g, '')
  return /^\d{14}$/.test(digits) ? digits.slice(0, 9) : undefined
}

/**
 * Construit la facture canonique depuis les entités persistées. AUCUN recalcul
 * flottant : chaque montant de ligne vient de `lineTotalCentsFromScaled`
 * (chemin 100 % entier), la TVA de `taxCentsFromBasis` (formule fiscale unique
 * du dépôt), et le TTC est une addition d'entiers.
 */
export function buildCanonicalInvoice(
  garage: GarageLike,
  invoice: InvoiceLike,
  lines: InvoiceLikeLine[],
): CanonicalEInvoice {
  const canonicalLines: CanonicalLine[] = lines.map((l) => ({
    description: l.description,
    quantityScaled: l.quantityTenThousandths,
    unitPriceScaled: l.unitPriceTenThousandths,
    lineTotalCents: lineTotalCentsFromScaled(l.unitPriceTenThousandths, l.quantityTenThousandths),
  }))
  const taxBasisCents = canonicalLines.reduce((s, l) => s + l.lineTotalCents, 0)
  const taxCents = taxCentsFromBasis(taxBasisCents, invoice.taxRate)

  const siretDigits = garage.siret ? garage.siret.replace(/\s+/g, '') : undefined

  return {
    invoiceNumber: invoice.number,
    typeCode: '380',
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate ?? undefined,
    currency: 'EUR',
    seller: {
      name: garage.name,
      siret: siretDigits,
      siren: sirenFromSiret(siretDigits),
      vatNumber: garage.vatNumber?.replace(/\s+/g, '') ?? undefined,
      addressLines: garage.address ? [garage.address] : undefined,
      countryCode: 'FR',
    },
    buyer: {
      name: invoice.clientName,
      addressLines: invoice.clientAddress ? [invoice.clientAddress] : undefined,
      countryCode: 'FR',
    },
    // Taux transmis BRUT (jamais blanchi en 0) : un taux non fini doit être
    // REJETÉ par la validation (GF-EI-040), pas transformé en facture à 0 % —
    // défaut démontré en revue adversariale.
    taxRatePercent: invoice.taxRate,
    taxBasisCents,
    taxCents,
    grandTotalCents: taxBasisCents + taxCents,
    lines: canonicalLines,
  }
}
