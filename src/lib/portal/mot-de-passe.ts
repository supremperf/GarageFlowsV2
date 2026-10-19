/**
 * Règle d'acceptation d'un mot de passe du portail (GF-DUR-027).
 *
 * ─── Pourquoi ce module existe ──────────────────────────────────────────────
 * Ces deux symboles vivaient dans `src/app/api/portal/auth/password/route.ts`.
 * L'App Router n'autorise dans un fichier de route QUE ses verbes HTTP et une
 * courte liste d'options (`dynamic`, `revalidate`, `runtime`…) : tout autre
 * export fait échouer `next build` à la vérification de types.
 *
 * Ce n'était donc pas un détail de rangement. Le build de production
 * s'arrêtait :
 *
 *     Type error: Property 'motDePasseAcceptable' is incompatible with
 *     index signature. […] is not assignable to type 'never'.
 *
 * Or `next build` conditionne tout l'aval — le paquet Electron, le déploiement
 * PWA, la mise à jour du parc. Les tests unitaires, eux, importaient la route
 * directement et ne voyaient rien : c'est précisément le genre de défaut qu'une
 * suite verte ne rattrape pas, parce qu'elle n'exerce jamais l'étape de build.
 */

/** Longueur minimale. Voir aussi `MOT_DE_PASSE_TEMPORAIRE_LONGUEUR` côté garage. */
export const MOT_DE_PASSE_MIN = 10

/**
 * Le mot de passe est-il acceptable ?
 *
 * On borne la longueur et on refuse les valeurs manifestement inutilisables,
 * sans imposer un jeu de caractères : les règles de composition poussent aux
 * mots de passe courts et prévisibles, là où la longueur protège réellement.
 */
export function motDePasseAcceptable(v: unknown): { ok: true } | { ok: false; raison: string } {
  if (typeof v !== 'string') return { ok: false, raison: 'Mot de passe manquant.' }
  if (v.length < MOT_DE_PASSE_MIN) {
    return { ok: false, raison: `Le mot de passe doit contenir au moins ${MOT_DE_PASSE_MIN} caractères.` }
  }
  // bcrypt ne considère que les 72 premiers octets : au-delà, deux mots de passe
  // différents deviendraient équivalents. On refuse plutôt que de tronquer.
  if (Buffer.byteLength(v, 'utf8') > 72) {
    return { ok: false, raison: 'Mot de passe trop long (72 octets maximum).' }
  }
  if (v.trim().length === 0) return { ok: false, raison: 'Mot de passe invalide.' }
  return { ok: true }
}
