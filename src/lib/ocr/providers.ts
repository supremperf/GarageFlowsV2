/**
 * OCR providers — the pluggable boundary to a real OCR engine. The offline
 * providers keep the classification/extraction pipeline fully testable; a real
 * provider (Tesseract, a cloud vision API) implements the same interface.
 */
import { normalizeLines } from './normalize'
import type { OcrInput, OcrProvider, OcrResult } from './types'

/**
 * Passthrough provider: OCR was performed upstream and the recognised text is
 * handed in directly via { text }. Blocks are the text lines at full confidence.
 */
export class TextOcrProvider implements OcrProvider {
  readonly id = 'text'
  readonly name = 'Texte fourni'

  async recognize(input: OcrInput): Promise<OcrResult> {
    if (!('text' in input)) throw new Error('TextOcrProvider ne gère que les entrées { text }.')
    const blocks = normalizeLines(input.text).map((t) => ({ text: t, confidence: 1 }))
    return { text: input.text, blocks, providerId: this.id }
  }
}

/**
 * Fixed-map provider for tests/demos: an input (text/url/imageBase64 used as the
 * key) resolves to predefined OCR text at a configurable confidence.
 */
export class MockOcrProvider implements OcrProvider {
  readonly id: string
  readonly name = 'OCR simulé'

  constructor(
    private readonly samples: Record<string, string>,
    id = 'mock',
    private readonly confidence = 0.9,
  ) {
    this.id = id
  }

  async recognize(input: OcrInput): Promise<OcrResult> {
    const key = 'text' in input ? input.text : 'url' in input ? input.url : 'imageBase64' in input ? input.imageBase64 : ''
    const text = this.samples[key] ?? ''
    const blocks = normalizeLines(text).map((t) => ({ text: t, confidence: this.confidence }))
    return { text, blocks, providerId: this.id }
  }
}
