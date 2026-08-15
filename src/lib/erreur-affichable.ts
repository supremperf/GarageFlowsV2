/**
 * Message d'erreur MONTRABLE à l'utilisateur (§83).
 *
 * Une réponse d'API refusée porte deux natures très différentes :
 *   · un message métier écrit pour l'utilisateur (« Stock insuffisant pour
 *     cette pièce ») — à afficher tel quel ;
 *   · une page d'erreur, une trace, un identifiant de connexion à la base — à
 *     ne JAMAIS afficher, même tronqué.
 *
 * `e.message.slice(0, 300)` ne fait pas la différence : sur un 500, il colle
 * les trois cents premiers caractères d'une pile d'appels dans un bandeau. Ce
 * module tranche : il ne rend le message du serveur que s'il en a la forme —
 * court, sans balisage, sans marqueur technique — et retombe sinon sur un texte
 * neutre fourni par l'appelant.
 */

/** Longueur au-delà de laquelle un « message » n'en est plus un. */
const LONGUEUR_MAX = 200

/**
 * Marqueurs qui trahissent un contenu technique. La liste vise ce qui ne doit
 * jamais atteindre un écran : traces, pages HTML, URL de connexion, jetons.
 */
const TECHNIQUE = [
  /<[a-z!/]/i,                 // HTML : page d'erreur du serveur
  /\bat\s+[\w$.]+\s*\(/,       // trace : « at Object.foo (…) »
  /\b\w+Error\b/,              // « PrismaClientKnownRequestError », « TypeError »
  /\b[a-z+]+:\/\//i,           // toute URL, dont postgres:// et file:
  /\b(?:stack|trace)\b/i,
  /\bP\d{4}\b/,                // codes Prisma (P2002, P2025…)
  /\beyJ[\w-]{10,}/,           // JWT
  /GF2\.[\w-]+\./,             // jeton de licence GarageFlows
  /-----BEGIN /,               // clé PEM
]

/**
 * @param e      ce qui a été attrapé — jamais typé, souvent pas une `Error`
 * @param defaut message neutre affiché quand rien de montrable n'en sort
 */
export function messageErreur(e: unknown, defaut: string): string {
  const brut = e instanceof Error ? e.message
    : typeof e === 'string' ? e
    : ''
  const texte = brut.trim()

  if (!texte || texte.length > LONGUEUR_MAX) return defaut
  if (TECHNIQUE.some((r) => r.test(texte))) return defaut

  // Une réponse JSON `{"error":"…"}` reste lisible : on en extrait le champ.
  if (texte.startsWith('{')) {
    try {
      const objet = JSON.parse(texte) as { error?: unknown }
      const message = typeof objet.error === 'string' ? objet.error.trim() : ''
      return message && message.length <= LONGUEUR_MAX && !TECHNIQUE.some((r) => r.test(message))
        ? message
        : defaut
    } catch {
      return defaut
    }
  }

  return texte
}
