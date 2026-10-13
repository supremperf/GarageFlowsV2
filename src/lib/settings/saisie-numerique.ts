/**
 * Lecture d'un champ numérique de réglages — sans jamais inventer de valeur.
 *
 * ─── Le défaut que ce module remplace ───────────────────────────────────────
 * Les réglages du garage étaient envoyés ainsi :
 *
 *     hourlyRate: parseFloat(s.hourlyRate) || 60,
 *     taxRate:    parseFloat(s.taxRate)    || 20,
 *
 * `||` ne distingue pas « rien saisi » de « zéro saisi ». Or zéro est une valeur
 * de gestion parfaitement ordinaire :
 *
 *   · un garage en franchise en base de TVA (art. 293 B du CGI) facture à 0 % —
 *     et c'est le cas d'une bonne partie des ateliers indépendants. L'écran
 *     réécrivait 20 %, et chaque facture réclamait alors au client une taxe que
 *     le garage n'a pas le droit de collecter — et qu'il devrait au Trésor s'il
 *     l'encaissait ;
 *   · un atelier qui ne facture pas la main-d'œuvre à l'heure saisit 0 €/h. Le
 *     serveur l'accepte explicitement ; l'écran écrivait 60 €/h ;
 *   · un dépannage ouvert dès minuit saisit 0 h. L'écran écrivait 8 h.
 *
 * Dans les trois cas, la valeur fautive était écrite EN SILENCE, avec un message
 * « Enregistré ». Le serveur, lui, n'a jamais eu son mot à dire : il recevait
 * une valeur déjà falsifiée.
 *
 * ─── La règle retenue ───────────────────────────────────────────────────────
 * Un champ vide ou illisible ne dit RIEN — le champ n'est alors pas envoyé du
 * tout, et le serveur conserve la valeur qu'il détient. C'est la seule conduite
 * qui ne fabrique aucune donnée : un logiciel de facturation n'a pas à décider
 * à la place du garage ce qu'il facture.
 */

/**
 * Nombre saisi, ou `undefined` si le champ ne dit rien d'exploitable.
 *
 * La virgule décimale est acceptée : c'est ce que produit un clavier français,
 * et un `parseFloat('49,90')` valant 49 est exactement le genre de silence qui a
 * motivé ce module.
 */
export function nombreSaisi(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v !== 'string') return undefined

  const t = v.trim().replace(',', '.')
  if (t === '') return undefined
  // Contrôle STRICT : `parseFloat` accepterait « 49abc » et rendrait 49.
  if (!/^-?\d*\.?\d+$/.test(t)) return undefined

  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/** Idem, pour un champ qui n'a de sens qu'en nombre entier (heures d'atelier). */
export function entierSaisi(v: unknown): number | undefined {
  const n = nombreSaisi(v)
  return n !== undefined && Number.isInteger(n) ? n : undefined
}
