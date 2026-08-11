/**
 * RECHERCHE DE PIÈCES — logique PURE (aucun Prisma, aucun DOM).
 *
 * Partagée par le serveur (route /api/parts/search) et le client
 * (affinage local instantané quand la frappe ne fait que préciser la requête
 * précédente). Une seule implémentation ⇒ le classement affiché est exactement
 * celui calculé côté serveur, et il est testable sans base.
 *
 * Propriétés :
 *  • insensible à la CASSE ;
 *  • insensible aux ACCENTS (« filtre » trouve « Filtré », « prefiltre » trouve
 *    « préfiltre ») ;
 *  • insensible à la ponctuation de référence (« P-3312 » trouve « P3312 ») ;
 *  • cherche dans nom, référence, référence fournisseur et fournisseur ;
 *  • classement par PERTINENCE : correspondance exacte de référence, puis début
 *    de nom, puis début d'un mot du nom, puis contenu — à score égal, ordre
 *    alphabétique stable.
 */

/** Pièce telle que nécessaire au classement (sous-ensemble du modèle Part). */
export interface SearchablePart {
  id: string
  name: string
  reference?: string | null
  supplierRef?: string | null
  supplierName?: string | null
}

/**
 * Forme canonique d'une chaîne pour comparaison : minuscules, sans diacritiques,
 * espaces normalisés. `NFD` sépare la lettre de son accent, la plage Unicode
 * U+0300–U+036F retire les marques combinantes.
 */
export function normalizeSearch(input: string | null | undefined): string {
  return (input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/** Variante « référence » : on ignore aussi tirets, points et espaces. */
function normalizeRef(input: string | null | undefined): string {
  return normalizeSearch(input).replace(/[\s.\-_\/]/g, '')
}

/** Score de pertinence ; plus petit = meilleur. `null` = pas de correspondance. */
export function scorePart(part: SearchablePart, normalizedQuery: string): number | null {
  const q = normalizedQuery
  if (!q) return 100

  const name = normalizeSearch(part.name)
  const ref = normalizeRef(part.reference)
  const sref = normalizeRef(part.supplierRef)
  const supplier = normalizeSearch(part.supplierName)
  const qRef = normalizeRef(normalizedQuery)

  // Référence exacte : l'utilisateur sait ce qu'il cherche, on le met en tête.
  if (qRef && (ref === qRef || sref === qRef)) return 0
  if (name === q) return 1
  if (name.startsWith(q)) return 2
  if (qRef && (ref.startsWith(qRef) || sref.startsWith(qRef))) return 3
  // Début d'un MOT du nom : « hui » trouve « Filtre à huile ».
  if (name.split(' ').some((w) => w.startsWith(q))) return 4
  if (name.includes(q)) return 5
  if (qRef && (ref.includes(qRef) || sref.includes(qRef))) return 6
  if (supplier.includes(q)) return 7
  return null
}

/**
 * Filtre et classe une liste de pièces. `limit` borne le résultat renvoyé à
 * l'interface : on ne déverse jamais un catalogue entier dans une liste
 * déroulante.
 */
export function rankParts<T extends SearchablePart>(
  parts: T[],
  query: string,
  limit = 20,
): T[] {
  const q = normalizeSearch(query)
  const scored: Array<{ part: T; score: number; name: string }> = []
  for (const part of parts ?? []) {
    const score = scorePart(part, q)
    if (score === null) continue
    scored.push({ part, score, name: normalizeSearch(part.name) })
  }
  scored.sort((a, b) => (a.score - b.score) || a.name.localeCompare(b.name) || a.part.id.localeCompare(b.part.id))
  return scored.slice(0, Math.max(0, limit)).map((s) => s.part)
}

/**
 * La requête `next` ne fait-elle que PRÉCISER `previous` ?
 * Si oui, l'interface peut réduire le jeu de résultats déjà affiché sans
 * repasser par le réseau — c'est ce qui rend « F » → « Fil » instantané.
 */
export function isNarrowingQuery(previous: string, next: string): boolean {
  const p = normalizeSearch(previous)
  const n = normalizeSearch(next)
  return p.length > 0 && n.length > p.length && n.startsWith(p)
}
