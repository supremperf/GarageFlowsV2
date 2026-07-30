/**
 * Automotive OCR — domain types. Framework-free & serialisable.
 *
 * The image→text step is inherently external (Tesseract, a cloud vision API);
 * it lives behind the `OcrProvider` interface. Everything downstream — document
 * classification and structured field extraction — is deterministic and fully
 * testable from raw OCR text.
 */

export type DocumentType =
  | 'carte_grise' // certificat d'immatriculation
  | 'invoice'     // facture / bon de commande fournisseur
  | 'plate'       // plaque d'immatriculation
  | 'vin_plate'   // plaque / étiquette VIN
  | 'odometer'    // relevé compteur kilométrique
  | 'unknown'

/** A recognised text block with an OCR confidence in [0,1]. */
export interface OcrBlock {
  text: string
  confidence: number
}

/** The raw output of an OCR provider. */
export interface OcrResult {
  text: string
  blocks: OcrBlock[]
  providerId?: string
}

/** What we hand an OCR provider. Text is the passthrough case (OCR done upstream). */
export type OcrInput =
  | { text: string }
  | { imageBase64: string; mimeType?: string }
  | { url: string }

/**
 * An OCR back-end. Passthrough/offline providers resolve immediately; real
 * providers hit an engine/API. A provider must throw only for transport/engine
 * failures, not for "nothing recognised" (return empty text instead).
 */
export interface OcrProvider {
  readonly id: string
  readonly name: string
  recognize(input: OcrInput): Promise<OcrResult>
}

/** One structured field extracted from a document. */
export interface ExtractedField {
  key: string
  label: string
  value: string
  /** 0..1 — how confident the extraction is. */
  confidence: number
  /** The source line/snippet the value came from (auditability). */
  raw?: string
  /** Set when a validator ran (e.g. VIN check, plate format). */
  valid?: boolean
}

/** The result of classifying + extracting a document. */
export interface ExtractedDocument {
  type: DocumentType
  fields: ExtractedField[]
  /** Mean field confidence, scaled by the OCR confidence. */
  confidence: number
  /** Non-fatal issues (low OCR confidence, failed validation, missing field). */
  warnings: string[]
  /** Per-type classification scores (for transparency). */
  typeScores?: Partial<Record<DocumentType, number>>
}

export interface ClassifyResult {
  type: DocumentType
  confidence: number
  scores: Partial<Record<DocumentType, number>>
}
