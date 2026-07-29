/**
 * OCR engine — recognise (provider) → classify → extract → assess. The pure
 * `extractDocument` works on already-recognised OCR text; `OcrEngine` adds the
 * provider step so a real OCR back-end can drive the same pipeline.
 */
import { classifyDocument } from './classify'
import { extractByType } from './extract'
import type {
  ClassifyResult,
  DocumentType,
  ExtractedDocument,
  OcrInput,
  OcrProvider,
  OcrResult,
} from './types'

export interface AnalyzeOptions {
  /** Force a document type instead of auto-classifying. */
  type?: DocumentType
  /** OCR confidence below which a warning is emitted (default 0.5). */
  minOcrConfidence?: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function meanOcrConfidence(ocr: OcrResult): number {
  if (!ocr.blocks.length) return 1
  return ocr.blocks.reduce((s, b) => s + b.confidence, 0) / ocr.blocks.length
}

/** Extract structured data from already-recognised OCR text. Pure & deterministic. */
export function extractDocument(ocr: OcrResult, opts: AnalyzeOptions = {}): ExtractedDocument {
  const classification: ClassifyResult = opts.type
    ? { type: opts.type, confidence: 1, scores: {} }
    : classifyDocument(ocr.text)

  const type = classification.type
  const fields = extractByType(type, ocr.text)

  const ocrScale = meanOcrConfidence(ocr)
  const fieldMean = fields.length ? fields.reduce((s, f) => s + f.confidence, 0) / fields.length : 0
  const typeFactor = opts.type ? 1 : Math.max(classification.confidence, 0.5)
  const confidence = round2(fieldMean * (ocrScale || 1) * typeFactor)

  const warnings: string[] = []
  if (type === 'unknown') warnings.push('Type de document non reconnu.')
  else if (!fields.length) warnings.push('Aucun champ exploitable extrait.')
  const minOcr = opts.minOcrConfidence ?? 0.5
  if (ocrScale && ocrScale < minOcr) warnings.push(`Confiance OCR faible (${round2(ocrScale)}).`)
  for (const f of fields) if (f.valid === false) warnings.push(`Champ « ${f.label} » invalide.`)

  return { type, fields, confidence, warnings, typeScores: classification.scores }
}

export class OcrEngine {
  constructor(private readonly provider: OcrProvider) {}

  /** Recognise the input then extract a structured document. */
  async analyze(input: OcrInput, opts: AnalyzeOptions = {}): Promise<ExtractedDocument & { ocr: OcrResult }> {
    const ocr = await this.provider.recognize(input)
    const doc = extractDocument(ocr, opts)
    return { ...doc, ocr }
  }
}
