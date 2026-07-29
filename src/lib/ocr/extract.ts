/**
 * Per-document-type field extraction. Pure & deterministic.
 *
 * Each extractor turns raw OCR text into structured `ExtractedField`s with a
 * per-field confidence and the source snippet (auditability). Extraction never
 * throws — an unrecognised field is simply omitted.
 */
import { accentInsensitive, normalizeLines, parseFrAmount, parseFrDate } from './normalize'
import { findVin } from './vin-scan'
import { findPlate } from './plate-scan'
import type { DocumentType, ExtractedField } from './types'

// ── Small helpers ──────────────────────────────────────────────────────────────

/** Find the value following a carte-grise field code (e.g. "D.1 PEUGEOT"). */
function lineByCode(lines: string[], code: string): { value: string; raw: string } | null {
  const esc = code.replace(/\./g, '\\.?')
  const re = new RegExp(`^${esc}\\b\\s*[:\\-]?\\s*(.+)$`, 'i')
  for (const line of lines) {
    const m = line.match(re)
    if (m && m[1].trim()) return { value: m[1].trim(), raw: line }
  }
  return null
}

/** Parse the LAST monetary amount on a line (avoids grabbing a VAT rate first). */
function lastAmount(line: string): number | null {
  const matches = line.match(/-?\d[\d.,\s]*\d|\d/g)
  if (!matches) return null
  return parseFrAmount(matches[matches.length - 1])
}

const ENERGY: Record<string, string> = {
  GO: 'Diesel', GA: 'Diesel', ES: 'Essence', EG: 'Essence', EL: 'Électrique', EE: 'Électrique',
  EH: 'Hybride', GH: 'Hybride', GL: 'Hybride', GP: 'GPL', GN: 'GNV', FE: 'Superéthanol',
}

// ── Extractors ───────────────────────────────────────────────────────────────

function extractCarteGrise(text: string): ExtractedField[] {
  const lines = normalizeLines(text)
  const out: ExtractedField[] = []

  const plate = findPlate(text)
  if (plate) out.push({ key: 'plate', label: 'Plaque (A)', value: plate.plate, confidence: plate.confidence, raw: plate.raw })

  const vin = findVin(text)
  if (vin) out.push({ key: 'vin', label: "Numéro d'identification (E)", value: vin.vin, confidence: vin.confidence, raw: vin.raw, valid: vin.validFormat })

  const make = lineByCode(lines, 'D.1')
  if (make) out.push({ key: 'make', label: 'Marque (D.1)', value: make.value, confidence: 0.8, raw: make.raw })

  const model = lineByCode(lines, 'D.3') ?? lineByCode(lines, 'D.2')
  if (model) out.push({ key: 'model', label: 'Dénomination (D.3)', value: model.value, confidence: 0.7, raw: model.raw })

  const b = lineByCode(lines, 'B')
  const date1 = b ? parseFrDate(b.value) : null
  if (date1) out.push({ key: 'firstRegistration', label: '1re immatriculation (B)', value: date1, confidence: 0.8, raw: b!.raw })

  const p3 = lineByCode(lines, 'P.3')
  if (p3) {
    const code = p3.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2)
    out.push({ key: 'energy', label: 'Énergie (P.3)', value: ENERGY[code] ?? p3.value, confidence: ENERGY[code] ? 0.8 : 0.5, raw: p3.raw })
  }

  return out
}

function extractInvoice(text: string): ExtractedField[] {
  const lines = normalizeLines(text)
  const out: ExtractedField[] = []

  // Supplier: first line that reads like a name (letters, not a label/date/amount).
  const supplier = lines.find((l) => {
    const a = accentInsensitive(l)
    if (/\d{2}[/.\-]\d{2}/.test(l)) return false
    if (/^(facture|total|tva|date|n[°ºo]|montant|bon de commande|siret|tel|email)/.test(a)) return false
    return /[a-z]{3,}/.test(a)
  })
  if (supplier) out.push({ key: 'supplier', label: 'Fournisseur', value: supplier.trim(), confidence: 0.5, raw: supplier })

  const numMatch = text.match(/facture\s*(?:n[°ºo]?[:.\s]*)?([A-Z0-9][\w\-/]{2,})/i)
  if (numMatch) out.push({ key: 'invoiceNumber', label: 'N° de facture', value: numMatch[1], confidence: 0.75, raw: numMatch[0] })

  for (const line of lines) {
    const date = parseFrDate(line)
    if (date) { out.push({ key: 'date', label: 'Date', value: date, confidence: 0.7, raw: line }); break }
  }

  for (const line of lines) {
    const a = accentInsensitive(line)
    if (/total\s*t\.?\s*t\.?\s*c/.test(a) || a.includes('net a payer')) {
      const amt = lastAmount(line)
      if (amt != null) { out.push({ key: 'totalTTC', label: 'Total TTC', value: String(amt), confidence: 0.8, raw: line }); break }
    }
  }
  for (const line of lines) {
    const a = accentInsensitive(line)
    if (/total\s*h\.?\s*t/.test(a) || a.includes('montant ht')) {
      const amt = lastAmount(line)
      if (amt != null) { out.push({ key: 'totalHT', label: 'Total HT', value: String(amt), confidence: 0.8, raw: line }); break }
    }
  }

  return out
}

function extractPlate(text: string): ExtractedField[] {
  const plate = findPlate(text)
  return plate ? [{ key: 'plate', label: 'Plaque', value: plate.plate, confidence: plate.confidence, raw: plate.raw, valid: true }] : []
}

function extractVinPlate(text: string): ExtractedField[] {
  const out: ExtractedField[] = []
  const vin = findVin(text)
  if (vin) out.push({ key: 'vin', label: 'VIN', value: vin.vin, confidence: vin.confidence, raw: vin.raw, valid: vin.validFormat })
  const plate = findPlate(text)
  if (plate) out.push({ key: 'plate', label: 'Plaque', value: plate.plate, confidence: plate.confidence, raw: plate.raw })
  return out
}

function extractOdometer(text: string): ExtractedField[] {
  const m = text.match(/(\d[\d.,\s]*)\s*km\b/i)
  if (!m) return []
  const km = parseFrAmount(m[1])
  if (km == null) return []
  return [{ key: 'mileage', label: 'Kilométrage', value: String(Math.round(km)), confidence: 0.75, raw: m[0].trim() }]
}

/** Dispatch to the extractor for a given document type. */
export function extractByType(type: DocumentType, text: string): ExtractedField[] {
  switch (type) {
    case 'carte_grise': return extractCarteGrise(text)
    case 'invoice': return extractInvoice(text)
    case 'plate': return extractPlate(text)
    case 'vin_plate': return extractVinPlate(text)
    case 'odometer': return extractOdometer(text)
    default: return []
  }
}
