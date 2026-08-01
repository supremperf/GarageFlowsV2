/**
 * Facturation électronique (France / EN 16931) — modèle de document normalisé.
 *
 * Ce module définit une représentation *pivot* d'une facture, indépendante du
 * schéma Prisma et des formats de sortie (UBL 2.1, CII/Factur-X). Tous les
 * montants sont en **centimes entiers** (voir src/lib/money.ts) pour éviter toute
 * dérive flottante. La cartographie depuis le modèle Prisma se fait dans `map.ts`.
 *
 * IMPORTANT (honnêteté) : ce module produit et valide des documents conformes au
 * cœur EN 16931 et les transmet à un **fournisseur simulé** (sandbox). Il ne
 * constitue PAS une plateforme agréée (PDP) et n'effectue AUCUNE transmission
 * officielle vers Chorus Pro / une PDP réelle. Voir docs/E_INVOICING_LIMITATIONS.md.
 */

/** Catégorie de TVA EN 16931 (UNCL5305). S = taux normal/réduit ; Z = 0 % ; E = exonéré. */
export type VatCategory = 'S' | 'Z' | 'E' | 'AE' | 'G' | 'O'

/** Type de document (UNCL1001). 380 = facture ; 381 = avoir (note de crédit). */
export type InvoiceTypeCode = '380' | '381'

export interface Party {
  /** Raison sociale. */
  name: string
  /** SIRET (14 chiffres) — identifiant légal du vendeur (obligatoire) / acheteur B2B. */
  siret?: string
  /** N° TVA intracommunautaire (ex. FR + clé + SIREN). */
  vatNumber?: string
  /** Adresse postale (ligne libre). */
  address?: string
  /** Ville. */
  city?: string
  /** Code postal. */
  postalCode?: string
  /** Code pays ISO 3166-1 alpha-2 (défaut FR). */
  country: string
  email?: string
  phone?: string
}

export interface DocumentLine {
  /** Identifiant de ligne (1..n). */
  id: string
  description: string
  /** Quantité (peut être décimale, ex. heures de main d'œuvre). */
  quantity: number
  /** Prix unitaire HT en centimes. */
  unitPriceCents: number
  /** Montant net de ligne HT en centimes = round(quantité × unitPriceCents). */
  netAmountCents: number
  /** Taux de TVA en pourcentage (ex. 20). */
  vatRatePercent: number
  /** Catégorie de TVA EN 16931. */
  vatCategory: VatCategory
}

export interface VatBreakdownEntry {
  vatCategory: VatCategory
  vatRatePercent: number
  /** Base imposable HT en centimes. */
  taxableAmountCents: number
  /** Montant de TVA en centimes. */
  taxAmountCents: number
}

export interface DocumentTotals {
  /** Somme des montants nets de ligne HT (centimes). */
  lineTotalCents: number
  /** Total HT (centimes) = lineTotal − remises + charges (ici = lineTotal). */
  taxExclusiveCents: number
  /** Total TVA (centimes). */
  taxAmountCents: number
  /** Total TTC (centimes) = taxExclusive + taxAmount. */
  taxInclusiveCents: number
  /** Net à payer (centimes) = TTC − acomptes (ici = TTC). */
  payableCents: number
}

export interface Payment {
  iban?: string
  bic?: string
  /** Conditions de paiement (ex. « 30 jours net »). */
  terms?: string
}

export interface EInvoiceDocument {
  /** Profil de conformité visé. */
  profile: 'EN16931'
  /** Numéro de facture (BT-1). */
  id: string
  /** Type (380 facture / 381 avoir). */
  typeCode: InvoiceTypeCode
  /** Date d'émission au format ISO `YYYY-MM-DD` (BT-2). */
  issueDate: string
  /** Date d'échéance ISO (BT-9), optionnelle. */
  dueDate?: string
  /** Devise ISO 4217 (BT-5). */
  currency: string
  seller: Party
  buyer: Party
  lines: DocumentLine[]
  vatBreakdown: VatBreakdownEntry[]
  totals: DocumentTotals
  payment?: Payment
  /** Note libre (BT-22). */
  note?: string
  /** Référence de la facture d'origine (pour un avoir 381). */
  precedingInvoiceRef?: string
}

/** Formats de sérialisation supportés. */
export type EInvoiceFormat = 'UBL' | 'CII'

/**
 * Statuts du cycle de vie d'une facture électronique (alignés sur les statuts du
 * flux français : émission → dépôt → prise en charge → décision → paiement).
 */
export type LifecycleStatus =
  | 'DRAFT'          // brouillon local
  | 'SUBMITTED'      // déposée auprès du fournisseur/PDP
  | 'RECEIVED'       // reçue par la plateforme destinataire
  | 'ACCEPTED'       // acceptée (approuvée) par l'acheteur/plateforme
  | 'REJECTED'       // rejetée (erreur de format/contenu)
  | 'REFUSED'        // refusée par l'acheteur (litige)
  | 'PAID'           // encaissée
  | 'CANCELLED'      // annulée

export interface ValidationIssue {
  /** Code stable (ex. `BR-06`, `GF-TOTALS`). */
  code: string
  /** Chemin/champ concerné. */
  field: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}
