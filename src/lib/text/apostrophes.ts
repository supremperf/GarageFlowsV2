/**
 * Pliage des apostrophes — une seule forme pour comparer du texte français.
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * Les listes de mots-clés du produit sont écrites avec l'apostrophe DROITE :
 * `"chiffre d'affaires"`, `"joint d'étanchéité"`, `"bruit d'embrayage"`. Les
 * fonctions de normalisation retiraient les accents et la casse, mais pas les
 * variantes d'apostrophe. Or presque personne ne tape l'apostrophe droite :
 *
 *   · les claviers de téléphone et la correction automatique produisent
 *     l'apostrophe TYPOGRAPHIQUE U+2019 (« ’ ») ;
 *   · un texte collé depuis un traitement de texte aussi ;
 *   · l'interface de GarageFlows elle-même l'emploie partout — un utilisateur
 *     qui recopie une expression lue à l'écran ne peut PAS tomber juste ;
 *   · certains claviers produisent l'accent aigu isolé (« ´ ») ou l'accent
 *     grave.
 *
 * Résultat : « quel est mon chiffre d’affaires ? » ne contenait pas
 * « chiffre d'affaires », le copilote répondait qu'il n'avait pas compris, et
 * une recherche de « joint d’étanchéité » ne trouvait pas la pièce en stock.
 *
 * Ce n'est pas une coquette question de typographie : c'est une comparaison de
 * chaînes qui échoue sur la saisie la PLUS probable.
 */

/**
 * Toutes les formes qu'un utilisateur peut produire pour une apostrophe.
 * L'accent aigu et l'accent grave isolés y figurent : `NFD` ne les décompose
 * pas, ils survivent donc au retrait des marques combinantes.
 */
const VARIANTES = /[‘’‛ʹʼˈ`´′]/g

/** Ramène toute apostrophe à la forme droite, celle des listes de mots-clés. */
export function plierApostrophes(s: string): string {
  return s.replace(VARIANTES, "'")
}
