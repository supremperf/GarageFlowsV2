/** References are user hints, never business facts or authority. */
export function dossierReference(query: string): string | null {
  const plate = query.toUpperCase().match(/\b[A-Z]{2}[- ]?\d{3}[- ]?[A-Z]{2}\b/)
  if (plate) return plate[0].replace(/[- ]/g, '').replace(/^([A-Z]{2})(\d{3})([A-Z]{2})$/, '$1-$2-$3')
  const named = query.match(/\b(?:client(?:e)?|nom|dossier(?:\s+(?:de|du|pour))?)\s+([\p{L}][\p{L}'’ -]{1,59})$/iu)
  if (!named) return null
  const ref = named[1].trim()
  if (/^(ce |cette |le |la |les |du |de |client$|intervention$)/i.test(ref)) return null
  return ref.length >= 2 ? ref : null
}
