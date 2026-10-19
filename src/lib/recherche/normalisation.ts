/**
 * Normalisation COMMUNE des chaînes de recherche.
 *
 * Chaque écran normalisait à sa façon — ou pas du tout : la recherche de
 * véhicule comparait des plaques telles que saisies (« AB-123-CD » ne trouvait
 * pas « AB123CD »), l'autocomplétion client comparait des minuscules sans
 * retirer les accents (« Lefevre » ne trouvait pas « Lefèvre »). Un seul jeu de
 * règles, ici, pour toutes les recherches du produit.
 *
 * ─── Ce que ces fonctions NE font PAS ───────────────────────────────────────
 * Elles ne servent JAMAIS de clé de stockage. La plaque enregistrée reste celle
 * que le garage a saisie (en majuscules) : normaliser à l'écriture réécrirait
 * des données existantes et changerait la clé unique `[licensePlate, garageId]`.
 * Ces fonctions servent à COMPARER, pas à conserver.
 */

/**
 * Forme comparable d'un texte : minuscules, sans accents, espaces normalisés.
 *
 * `normalize('NFD')` sépare la lettre de son diacritique, que l'on retire
 * ensuite : « é » devient « e », « ç » devient « c », « œ » reste « œ » (ce
 * n'est pas un diacritique) — d'où le remplacement explicite des ligatures.
 */
export function normaliserTexte(valeur: string | null | undefined): string {
  return String(valeur ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[-–—_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Forme comparable d'une plaque : lettres et chiffres seulement, en majuscules.
 *
 * Les formats français coexistent (« AB-123-CD », « AB 123 CD », « 1234 AB 56 »)
 * et le même véhicule se saisit indifféremment de plusieurs façons. Comparer
 * sans séparateurs est la seule manière de les faire correspondre.
 */
export function normaliserPlaque(valeur: string | null | undefined): string {
  return String(valeur ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Le texte cherché apparaît-il dans la valeur, aux règles ci-dessus ?
 * Une recherche vide ne correspond à RIEN — jamais à tout : c'est ainsi qu'une
 * autocomplétion se met à proposer le début de la table.
 */
export function correspond(valeur: string | null | undefined, recherche: string | null | undefined): boolean {
  const q = normaliserTexte(recherche)
  if (!q) return false
  return normaliserTexte(valeur).includes(q)
}

/**
 * Correspondance de plaque : tolère les séparateurs des deux côtés.
 * Une saisie partielle (« AB12 ») correspond à un début de plaque.
 */
export function correspondPlaque(plaque: string | null | undefined, recherche: string | null | undefined): boolean {
  const q = normaliserPlaque(recherche)
  if (!q) return false
  return normaliserPlaque(plaque).includes(q)
}
