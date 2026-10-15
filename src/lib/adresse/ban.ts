/**
 * Recherche d'adresses françaises — Base Adresse Nationale (GF-022).
 *
 * ─── Pourquoi CE service ────────────────────────────────────────────────────
 * `https://api-adresse.data.gouv.fr` est le service PUBLIC de l'État (Etalab)
 * adossé à la Base Adresse Nationale. Il a été retenu contre les alternatives
 * commerciales pour quatre raisons vérifiables :
 *
 *  · aucune clé d'API — donc aucun secret à distribuer dans un installateur,
 *    aucune clé à faire fuir côté navigateur, aucune rotation à gérer ;
 *  · gratuit et sans quota contractuel — la seule limite documentée est
 *    technique : 50 requêtes/seconde par IP, très au-dessus de l'usage d'un
 *    garage ;
 *  · données officielles et françaises, hébergées en France : l'adresse d'un
 *    client ne part pas chez un tiers commercial ;
 *  · réponse structurée (numéro, voie, code postal, commune, département,
 *    coordonnées), ce qui permet de remplir de VRAIS champs plutôt que de
 *    recopier une chaîne.
 *
 * ─── Ce qui NE traverse PAS ─────────────────────────────────────────────────
 * Seul le texte tapé dans le champ est transmis. Aucun identifiant de garage,
 * de client ou d'appareil. L'appel part du SERVEUR (le poste ou la PWA), jamais
 * du navigateur du garage : le service ne voit ni les postes individuels ni
 * l'origine des requêtes au-delà de l'instance.
 */

/** Adresse normalisée — la forme que le produit manipule. */
export interface AdresseTrouvee {
  /** Identifiant BAN — stable, sert de clé de rendu. */
  id: string
  /** Libellé complet prêt à afficher et à enregistrer. */
  libelle: string
  numero?: string
  voie?: string
  codePostal?: string
  ville?: string
  /** Code INSEE de la commune. */
  codeCommune?: string
  departement?: string
  region?: string
  latitude?: number
  longitude?: number
  /** Score de pertinence rendu par le service (0 à 1). */
  score?: number
}

export const BAN_URL = 'https://api-adresse.data.gouv.fr/search/'

/** Nombre de propositions rendues — au-delà, une liste devient un annuaire. */
export const MAX_RESULTATS = 8

/** En deçà, le service lui-même refuse la requête (400). */
export const MIN_CARACTERES = 3

interface TraitBan {
  properties?: {
    id?: string; label?: string; housenumber?: string; street?: string; name?: string
    postcode?: string; city?: string; citycode?: string; context?: string; score?: number
  }
  geometry?: { coordinates?: [number, number] }
}

/**
 * `context` vaut « 75, Paris, Île-de-France » : code de département, nom de
 * département, région. Le troisième élément manque pour l'outre-mer.
 */
function departementEtRegion(context: string | undefined): { departement?: string; region?: string } {
  const parts = String(context ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length < 2) return {}
  return { departement: parts[1], region: parts[2] }
}

/** Convertit une réponse GeoJSON de la BAN en adresses normalisées. */
export function normaliserReponseBan(brut: unknown): AdresseTrouvee[] {
  const traits = (brut as { features?: TraitBan[] })?.features
  if (!Array.isArray(traits)) return []
  return traits.flatMap((t) => {
    const p = t.properties
    if (!p?.label) return []
    const { departement, region } = departementEtRegion(p.context)
    const [lon, lat] = t.geometry?.coordinates ?? []
    return [{
      id: p.id ?? p.label,
      libelle: p.label,
      numero: p.housenumber,
      voie: p.street ?? (p.housenumber ? undefined : p.name),
      codePostal: p.postcode,
      ville: p.city,
      codeCommune: p.citycode,
      departement,
      region,
      latitude: typeof lat === 'number' ? lat : undefined,
      longitude: typeof lon === 'number' ? lon : undefined,
      score: p.score,
    }]
  }).slice(0, MAX_RESULTATS)
}

export interface ResultatRecherche {
  ok: boolean
  adresses: AdresseTrouvee[]
  /** `HORS_LIGNE`, `SERVICE_INDISPONIBLE`, `TROP_COURT` — jamais un message brut. */
  code?: string
}

/**
 * Interroge la BAN. Ne lève JAMAIS : une panne du service ne doit pas empêcher
 * de saisir une adresse à la main.
 */
export async function rechercherAdresse(
  recherche: string,
  opts: { limite?: number; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<ResultatRecherche> {
  const q = String(recherche ?? '').trim()
  if (q.length < MIN_CARACTERES) return { ok: false, adresses: [], code: 'TROP_COURT' }

  const limite = Math.min(MAX_RESULTATS, Math.max(1, opts.limite ?? MAX_RESULTATS))
  const controleur = new AbortController()
  const minuteur = setTimeout(() => controleur.abort(), opts.timeoutMs ?? 4_000)
  const appel = opts.fetchImpl ?? fetch

  try {
    const url = `${BAN_URL}?q=${encodeURIComponent(q)}&limit=${limite}&autocomplete=1`
    const res = await appel(url, { signal: controleur.signal, cache: 'no-store' })
    if (!res.ok) return { ok: false, adresses: [], code: 'SERVICE_INDISPONIBLE' }
    return { ok: true, adresses: normaliserReponseBan(await res.json()) }
  } catch {
    // Poste hors ligne, DNS coupé, service en panne : on le DIT, l'écran
    // laissera saisir librement.
    return { ok: false, adresses: [], code: 'HORS_LIGNE' }
  } finally {
    clearTimeout(minuteur)
  }
}
