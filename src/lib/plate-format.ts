/**
 * Immatriculations françaises — normalisation ET validation.
 *
 * Séparé de la route parce que c'est un contrôle de VÉRITÉ, pas de transport :
 * il décide si une chaîne est une plaque, et il doit pouvoir être éprouvé seul.
 *
 * Motif : la reconnaissance de plaque interroge un modèle de langage, qui rend du
 * texte libre. Sans ce filtre, une réponse comme « je ne distingue pas la
 * plaque » devenait une immatriculation : recopiée dans le champ, elle
 * déclenchait la recherche véhicule et finissait dans l'intervention, le devis et
 * la facture. C'est le défaut GF-FINAL-020 par une autre porte — une sortie de
 * modèle présentée comme une LECTURE.
 *
 * Deux formats ont cours en France, et les deux doivent être acceptés :
 *   · SIV, depuis 2009            — AB-123-CD
 *   · FNI, véhicules antérieurs   — 1234-AB-75  (encore très présents en atelier)
 *
 * Le doute profite au refus : rendre `null` fait afficher « plaque non détectée »,
 * ce qui invite à ressaisir. Rendre une valeur douteuse la ferait circuler sans
 * que personne ne la relise.
 */

/** SIV : deux lettres, trois chiffres, deux lettres. */
const SIV = /^([A-Z]{2})-?([0-9]{3})-?([A-Z]{2})$/
/** FNI : 1 à 4 chiffres, 1 à 3 lettres, 2 ou 3 chiffres (le département). */
const FNI = /^([0-9]{1,4})-?([A-Z]{1,3})-?([0-9]{2,3})$/

/**
 * Rend l'immatriculation normalisée, ou `null` si le texte n'en est pas une.
 *
 * La normalisation (majuscules, séparateurs) est une mise en forme fidèle de ce
 * qui a été lu — jamais une correction de contenu : aucune lettre n'est
 * remplacée, aucun chiffre deviné.
 */
export function normaliserPlaque(brut: string): string | null {
  if (typeof brut !== 'string') return null

  // Espaces, points et tirets longs deviennent des tirets simples ; tout autre
  // caractère est écarté. Une phrase entière survit à ce nettoyage — c'est le
  // contrôle de forme qui la rejettera, pas celui-ci.
  const nettoye = brut
    .toUpperCase()
    .replace(/[\s.–—_]+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')

  if (!nettoye) return null

  const siv = nettoye.match(SIV)
  if (siv) return `${siv[1]}-${siv[2]}-${siv[3]}`

  const fni = nettoye.match(FNI)
  if (fni) return `${fni[1]}-${fni[2]}-${fni[3]}`

  return null
}
