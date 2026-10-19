/**
 * Identification du GARAGE côté portail client (navigateur).
 *
 * ─── Le défaut corrigé (GF31-AUD-019) ───────────────────────────────────────
 * `/api/portal/auth/login` et `/api/portal/auth/register` résolvent le garage
 * ainsi (`lib/portal/auth-helpers.ts::resolveGarageId`) :
 *
 *   - `garageSlug` fourni → recherche par slug ;
 *   - sinon → l'unique garage de la base, et `null` dès qu'il y en a deux.
 *
 * Or les pages `/portal/login` et `/portal/register` n'envoyaient JAMAIS
 * `garageSlug`. Sur le déploiement PWA — multi-tenant par construction, chaque
 * attribution de clé mécanicien y créant un garage miroir — la connexion et
 * l'inscription échouaient donc systématiquement sur « Garage introuvable ou
 * ambigu (garageSlug requis) », sans que le client puisse rien y faire.
 *
 * ─── La convention retenue ──────────────────────────────────────────────────
 * Le garage se transmet par la query string du lien que le garage communique à
 * ses clients : `?garage=<slug>` (alias court `?g=`). Il est ensuite MÉMORISÉ
 * dans `sessionStorage` pour survivre à la navigation interne du portail
 * (étape 2FA, aller-retour connexion ↔ inscription) sans réécrire chaque lien.
 *
 * Aucun secret : un slug de garage est un identifiant public, déjà présent dans
 * les URL de portail. La mémorisation est volontairement de SESSION — elle ne
 * survit pas à la fermeture de l'onglet, pour qu'un poste partagé ne colle pas
 * un garage à un visiteur suivant.
 */

const CLE = 'gf_portal_garage'

/** Un slug plausible : minuscules, chiffres et tirets (cf. `mirrorSlug`). */
function estSlugPlausible(v: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(v)
}

/**
 * Slug du garage pour la requête courante, ou `null`.
 * Ordre : query string (`?garage=` puis `?g=`), puis mémoire de session.
 */
export function garageSlugCourant(search?: string): string | null {
  if (typeof window === 'undefined') return null

  const params = new URLSearchParams(search ?? window.location.search)
  const depuisUrl = (params.get('garage') ?? params.get('g') ?? '').trim().toLowerCase()
  if (depuisUrl && estSlugPlausible(depuisUrl)) {
    try { window.sessionStorage.setItem(CLE, depuisUrl) } catch { /* mode privé */ }
    return depuisUrl
  }

  try {
    const memorise = (window.sessionStorage.getItem(CLE) ?? '').trim().toLowerCase()
    if (memorise && estSlugPlausible(memorise)) return memorise
  } catch { /* sessionStorage indisponible */ }

  return null
}

/**
 * Ajoute `garageSlug` au corps d'une requête d'authentification portail quand il
 * est connu. Ne l'invente jamais : sans slug et avec un seul garage en base, le
 * serveur sait déjà répondre — c'est le cas d'une installation mono-garage.
 */
export function avecGarageSlug<T extends Record<string, unknown>>(corps: T): T & { garageSlug?: string } {
  const slug = garageSlugCourant()
  return slug ? { ...corps, garageSlug: slug } : corps
}

/** Conserve le garage courant dans un lien interne du portail. */
export function lienPortail(chemin: string): string {
  const slug = garageSlugCourant()
  if (!slug) return chemin
  const separateur = chemin.includes('?') ? '&' : '?'
  return `${chemin}${separateur}garage=${encodeURIComponent(slug)}`
}
