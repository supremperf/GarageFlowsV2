/**
 * Repli d'avatar mécanicien — pur et testable.
 *
 * ─── Le défaut corrigé (GF-PLAN-003) ────────────────────────────────────────
 * `Mechanic.avatar` est une colonne TEXTE contenant des initiales, remplie à la
 * création par `name.slice(0, 2).toUpperCase()` (`src/app/api/mechanics/route.ts`).
 * Deux conséquences :
 *
 *  1. « Jean Dupont » donnait « JE » — les deux premières lettres du PRÉNOM, et
 *     non les initiales du prénom et du nom. Les mécaniciens dont le prénom
 *     commence pareil (« Jean Dupont », « Jean Martin », « Jeanne Roux »)
 *     partageaient tous le même avatar « JE » dans le planning.
 *  2. Une valeur saisie à la main pouvait être n'importe quoi — « M1 », « M2 »,
 *     une chaîne vide, un texte de dix caractères qui déborde du cercle.
 *
 * Ce module calcule un repli correct et borné, utilisé dès qu'aucune photo
 * n'est disponible. Il ne remplace pas la photo : il garantit qu'il y a
 * TOUJOURS quelque chose de lisible à afficher, y compris si le chargement de
 * l'image échoue.
 */

/**
 * Initiales d'un nom : première lettre du premier mot + première lettre du
 * dernier mot, en majuscules, deux caractères au plus.
 *
 *   « Jean Dupont »        → « JD »
 *   « Jean-Pierre Martin » → « JM »
 *   « Madonna »            → « MA »
 *
 * Les diacritiques sont CONSERVÉS (« Éric Ålund » → « ÉÅ ») : un mécanicien doit
 * se reconnaître dans son propre avatar, et rien ici n'est comparé ni indexé.
 */
export function initialesDe(nom: string | null | undefined): string {
  const propre = String(nom ?? '').replace(/[\s\-_]+/g, ' ').trim()
  if (!propre) return '?'

  const mots = propre.split(' ').filter(Boolean)
  // `Array.from` et non `slice` : découpage par POINT DE CODE, pour ne pas
  // couper en deux un caractère accentué ou un emoji dans un nom.
  if (mots.length === 1) {
    // Un seul mot : ses deux premières lettres, faute de nom de famille.
    return Array.from(mots[0]).slice(0, 2).join('').toLocaleUpperCase('fr-FR')
  }
  const premiere = Array.from(mots[0])[0] ?? ''
  const derniere = Array.from(mots[mots.length - 1])[0] ?? ''
  return (premiere + derniere).toLocaleUpperCase('fr-FR')
}

/**
 * Texte réellement affiché dans la pastille quand il n'y a pas de photo.
 *
 * Une valeur `avatar` explicitement saisie est respectée — c'est une donnée du
 * garage — mais BORNÉE à deux caractères pour ne pas déborder du cercle, et
 * ignorée si elle est vide ou si elle ressemble à un ancien libellé de position
 * (`M1`, `M2`…), qui n'a jamais été une identité mais un simple numéro de
 * colonne hérité.
 */
export function texteAvatar(mechanic: { name?: string | null; avatar?: string | null }): string {
  const brut = String(mechanic.avatar ?? '').trim()
  const estAncienLibellePosition = /^M\d{1,2}$/i.test(brut)
  if (brut && !estAncienLibellePosition) {
    return Array.from(brut).slice(0, 2).join('').toLocaleUpperCase('fr-FR')
  }
  return initialesDe(mechanic.name)
}

/**
 * Texte alternatif de l'image d'avatar (accessibilité, §59).
 * Jamais « photo » ou « avatar » seul : un lecteur d'écran doit annoncer QUI.
 */
export function texteAlternatifAvatar(nom: string | null | undefined): string {
  const propre = String(nom ?? '').trim()
  return propre ? `Photo de ${propre}` : 'Photo du mécanicien'
}
