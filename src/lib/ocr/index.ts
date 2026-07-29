/**
 * Automotive OCR — public entry point.
 *
 *   import { OcrEngine, TextOcrProvider, extractDocument } from '@/lib/ocr'
 *
 *   // OCR done upstream, text handed in:
 *   const doc = extractDocument({ text, blocks: [] })          // classify + extract
 *
 *   // or drive a provider:
 *   const engine = new OcrEngine(new TextOcrProvider())
 *   const res = await engine.analyze({ text })                 // + ocr passthrough
 *
 * The image→text step lives behind `OcrProvider`; classification and field
 * extraction (carte grise, facture, plaque, plaque VIN, compteur) are
 * deterministic and offline-testable.
 */
export * from './types'
export {
  stripAccents,
  accentInsensitive,
  normalizeLines,
  parseFrAmount,
  parseFrDate,
  ocrFixVin,
} from './normalize'
export { findVin } from './vin-scan'
export type { VinHit } from './vin-scan'
export { findPlate } from './plate-scan'
export type { PlateHit, PlateFormat } from './plate-scan'
export { classifyDocument } from './classify'
export { extractByType } from './extract'
export { TextOcrProvider, MockOcrProvider } from './providers'
export { OcrEngine, extractDocument } from './engine'
export type { AnalyzeOptions } from './engine'
