/**
 * Analyseur CSV (RFC 4180) sans dépendance externe.
 *
 * Gère : champs entre guillemets, guillemets échappés (`""`), délimiteurs et
 * sauts de ligne à l'intérieur des champs, fins de ligne CRLF/LF, BOM UTF-8.
 * Renvoie une matrice de chaînes (lignes × colonnes). Le premier élément est en
 * général la ligne d'en-têtes (voir `splitHeader`).
 */

/** Retire un BOM UTF-8 éventuel en tête de fichier. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Analyse un texte CSV en matrice de chaînes. `delimiter` par défaut « , ». */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const src = stripBom(text)
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let i = 0

  const pushField = () => { row.push(field); field = '' }
  const pushRow = () => { pushField(); rows.push(row); row = [] }

  while (i < src.length) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue } // guillemet échappé
        inQuotes = false; i++; continue
      }
      field += c; i++; continue
    }
    if (c === '"') { inQuotes = true; i++; continue }
    if (c === delimiter) { pushField(); i++; continue }
    if (c === '\r') { // CRLF ou CR seul
      pushRow()
      if (src[i + 1] === '\n') i++
      i++
      continue
    }
    if (c === '\n') { pushRow(); i++; continue }
    field += c; i++
  }
  // Dernier champ / dernière ligne (sauf fichier terminé par un saut de ligne).
  if (field.length > 0 || row.length > 0) pushRow()
  return rows
}

/** Sépare une matrice CSV en { header, rows } (lignes vides ignorées). */
export function splitHeader(matrix: string[][]): { header: string[]; rows: string[][] } {
  const nonEmpty = matrix.filter(r => r.some(c => c.trim() !== ''))
  if (nonEmpty.length === 0) return { header: [], rows: [] }
  const [header, ...rows] = nonEmpty
  return { header: header.map(h => h.trim()), rows }
}
