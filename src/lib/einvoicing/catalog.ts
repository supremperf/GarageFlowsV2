/**
 * Catalogue des plateformes de facturation électronique.
 *
 * ─── Provenance (§82) ───────────────────────────────────────────────────────
 * Les entrées proviennent du registre des PLATEFORMES AGRÉÉES (PA, ex-PDP)
 * importé par `scripts/refresh-einvoicing-catalog.mjs` dans
 * `data/plateformes-agreees.json`. Ce fichier porte sa propre provenance :
 * jeu de données ouvert publié sur data.gouv.fr (licence ODbL), lui-même
 * republication ENRICHIE du registre DGFiP — seule la page impots.gouv.fr fait
 * foi, et c'est elle qui est affichée à l'utilisateur.
 *
 * Le catalogue livré auparavant contenait quatre entrées INVENTÉES (« Alpha
 * Facturation », « Axion », « Azer », « Beta Invoice ») présentées à l'écran
 * comme des plateformes agréées. Un catalogue réglementaire ne se fabrique pas.
 *
 * ─── Ce que le catalogue ne dit PAS ─────────────────────────────────────────
 * `capabilities` décrit ce que GARAGEFLOWS sait faire avec une plateforme — pas
 * ce que la plateforme annonce. Tant qu'aucun adaptateur réel n'est enregistré
 * dans `einvoiceAdapterRegistry`, aucune plateforme n'est connectable
 * (`isPlatformConnectable`). Les formats annoncés par la plateforme dans le
 * registre sont conservés à part, sous `declaredFormats`, pour que la
 * distinction reste lisible.
 *
 * Les méthodes d'authentification ne figurent PAS dans le registre : elles ne
 * sont donc pas inventées ici (`authenticationMethods` reste vide tant qu'un
 * adaptateur ne la renseigne pas).
 */


export type EInvoiceApprovalStatus =
  | 'approved'
  | 'provisionally_approved'
  | 'suspended'
  | 'withdrawn'

export type EInvoiceIntegrationStatus =
  | 'available'
  | 'configuration_required'
  | 'coming_soon'
  | 'not_supported'

export type EInvoiceAuthMethod =
  | 'oauth2'
  | 'api_key'
  | 'client_credentials'
  | 'certificate'
  | 'username_password'
  | 'manual_activation'

export interface EInvoicePlatformCapabilities {
  outgoingInvoices: boolean
  incomingInvoices: boolean
  invoiceStatuses: boolean
  webhooks: boolean
  eReporting: boolean
  paymentReporting: boolean
  sandbox: boolean
}

/** Formats ANNONCÉS par la plateforme dans le registre (déclaratif, non vérifié). */
export interface DeclaredFormats {
  facturX: boolean
  ubl: boolean
  cii: boolean
  peppolBis: boolean
}

export interface ApprovedEInvoicePlatform {
  id: string
  officialName: string
  normalizedName: string
  slug: string
  approvalStatus: EInvoiceApprovalStatus
  officialRegistrationNumber?: string
  /** Date d'immatriculation au registre (YYYY-MM-DD). */
  registeredAt?: string
  officialWebsite?: string
  adapterId?: string
  integrationStatus: EInvoiceIntegrationStatus
  authenticationMethods: EInvoiceAuthMethod[]
  capabilities: EInvoicePlatformCapabilities
  registryUpdatedAt: string
  declaredFormats?: DeclaredFormats
  declaredEReporting?: boolean
}

/** Provenance du catalogue — affichée à l'utilisateur, jamais masquée. */
export interface CatalogProvenance {
  jeuDeDonnees: string
  portail: string
  fichier: string
  licence: string
  autoriteDeReference: string
  avertissement: string
}

/**
 * Le CATALOGUE lui-même (135 entrées, ~54 Ko) vit dans `catalog-data.ts`.
 *
 * Ce fichier-ci ne contient que des TYPES et des fonctions pures : il est
 * importé par l'onglet e-facturation, donc par le navigateur. Y laisser
 * l'importation du JSON embarquait tout le registre dans le bundle client —
 * mesuré à **+78 Ko sur le plus gros chunk**, ne laissant plus que 102 octets
 * sous le budget de performance (GF31-AUD-023). Le client reçoit déjà le
 * catalogue par `/api/einvoicing/status` : il n'a aucune raison de l'embarquer
 * une seconde fois.
 */

/**
 * Normalise une saisie de recherche : insensible à la casse et aux accents,
 * espaces de bord retirés (Unicode NFD + suppression des diacritiques).
 */
export function normalizePlatformSearch(value: string): string {
  // NFD décompose « é » en « e » + accent combinant ; on retire ensuite la plage
  // des diacritiques combinants (U+0300–U+036F). Équivalent à \p{Diacritic} mais
  // sans le drapeau /u (compatible avec la cible TypeScript du projet).
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Recherche de plateformes : tri alphabétique stable, insensible casse/accents.
 *
 * Le catalogue est FOURNI par l'appelant : ce module ne charge aucune donnée,
 * pour rester utilisable côté navigateur sans y embarquer le registre
 * (GF31-AUD-023). Côté serveur, `catalog-data.ts` expose `EINVOICE_PLATFORM_CATALOG`.
 * Priorité aux entrées dont le nom COMMENCE par la requête (comportement « tapez
 * A → toutes celles en A »), puis correspondance partielle. Performant pour
 * plusieurs centaines d'entrées (filtre linéaire simple).
 */
export function searchPlatforms(
  query: string,
  catalog: ApprovedEInvoicePlatform[],
): ApprovedEInvoicePlatform[] {
  // Cette fonction accepte un catalogue FOURNI PAR L'APPELANT (l'onglet
  // e-facturation lui passe la réponse de /api/einvoicing/status). On ne peut
  // donc pas présumer que chaque entrée porte `normalizedName` : une projection
  // d'API incomplète suffisait à faire lever le tri, pendant le rendu, et à
  // détruire tout l'écran. On retombe sur le nom officiel, puis sur la chaîne
  // vide — dégrader plutôt que rompre.
  const nameOf = (p: ApprovedEInvoicePlatform): string =>
    p.normalizedName ?? normalizePlatformSearch(p.officialName ?? '')

  const sorted = [...catalog].sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'fr'))
  const q = normalizePlatformSearch(query)
  if (!q) return sorted
  // Même précaution que ci-dessus sur TOUS les champs consultés : le filtrage
  // ne doit pas lever davantage que le tri.
  const starts = sorted.filter((p) => nameOf(p).startsWith(q))
  const contains = sorted.filter(
    (p) => !nameOf(p).startsWith(q) &&
      (nameOf(p).includes(q) || (p.slug ?? '').includes(q) ||
        normalizePlatformSearch(p.officialName ?? '').includes(q)),
  )
  return [...starts, ...contains]
}

/** Une plateforme n'est réellement connectable que si un adaptateur est disponible. */
export function isPlatformConnectable(p: ApprovedEInvoicePlatform, hasAdapter: (id: string) => boolean): boolean {
  return p.integrationStatus === 'available' && typeof p.adapterId === 'string' && hasAdapter(p.adapterId)
}
