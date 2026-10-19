/**
 * Garde SSRF des connecteurs de facturation électronique.
 *
 * ─── Le défaut corrigé (GF-FINAL-019) ───────────────────────────────────────
 * L'URL de la plateforme agréée est CONFIGURABLE par le garage. La seule
 * vérification était `u.protocol === 'https:'`. Deux conséquences :
 *
 *  1. `https://127.0.0.1:8080/…`, `https://10.0.0.5/…`,
 *     `https://169.254.169.254/latest/meta-data/…` étaient acceptées. Sur le
 *     déploiement mutualisé, le serveur GarageFlows devenait un relais vers le
 *     réseau interne de l'hébergeur et vers son service de métadonnées — avec
 *     les identifiants de la configuration joints à la requête.
 *
 *  2. `fetch` suit les redirections par DÉFAUT. Une URL parfaitement légitime
 *     pouvait répondre `302 Location: http://169.254.169.254/…` : la garantie
 *     « HTTPS obligatoire » ne portait que sur le PREMIER saut. Les en-têtes
 *     personnalisés (`apiKeyHeader`, `extraHeaderName`) ne sont pas retirés par
 *     `undici` lors d'une redirection de même origine, et le corps — la facture
 *     complète — est réémis.
 *
 * ─── Ce que cette garde fait, et ce qu'elle ne fait pas ─────────────────────
 * Elle refuse : les protocoles autres que HTTPS, les adresses littérales non
 * routables (boucle locale, RFC 1918, lien-local, CGNAT, multicast, IPv6
 * uniques-locales et adresses mappées IPv4), les noms réservés (`localhost`,
 * `*.local`, `*.internal`, `*.home.arpa`), et — après résolution DNS — tout nom
 * dont AU MOINS une adresse est non routable.
 *
 * Elle ne supprime pas entièrement le « DNS rebinding » : entre le contrôle et
 * la connexion réelle, un enregistrement à durée de vie très courte peut
 * changer. L'éliminer demanderait d'épingler l'adresse contrôlée jusqu'à
 * l'établissement de la connexion (dispatcher `undici` sur mesure). Le risque
 * résiduel est consigné plutôt que passé sous silence ; il suppose un attaquant
 * qui contrôle déjà une zone DNS ET la configuration du garage.
 */

import { lookup } from 'node:dns/promises'

/** Motif d'un refus — remonté tel quel à l'exploitant, sans détail technique. */
export type MotifRefus =
  | 'url_invalide'
  | 'protocole_non_https'
  | 'hote_absent'
  | 'nom_reserve'
  | 'adresse_non_routable'
  | 'resolution_impossible'

export interface VerdictDestination {
  ok: boolean
  motif?: MotifRefus
  message?: string
}

const MESSAGES: Record<MotifRefus, string> = {
  url_invalide:          'URL de plateforme invalide.',
  protocole_non_https:   'L’URL de la plateforme doit être en HTTPS.',
  hote_absent:           'URL de plateforme sans nom d’hôte.',
  nom_reserve:           'Cette destination désigne un hôte local ou réservé : refusée.',
  adresse_non_routable:  'Cette destination pointe vers une adresse interne non routable : refusée.',
  resolution_impossible: 'Le nom d’hôte de la plateforme est introuvable.',
}

const refus = (motif: MotifRefus): VerdictDestination => ({ ok: false, motif, message: MESSAGES[motif] })

/** Noms d'hôtes réservés — jamais une plateforme agréée. */
const NOMS_RESERVES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback'])
const SUFFIXES_RESERVES = ['.localhost', '.local', '.internal', '.intranet', '.home.arpa', '.lan']

/** Le nom d'hôte est-il réservé (indépendamment de toute résolution) ? */
export function estNomReserve(hote: string): boolean {
  const h = hote.trim().toLowerCase().replace(/\.$/, '')
  if (!h) return true
  if (NOMS_RESERVES.has(h)) return true
  return SUFFIXES_RESERVES.some((s) => h.endsWith(s))
}

/** Analyse une adresse IPv4 pointée en quatre octets, ou `null`. */
function octetsIpv4(v: string): number[] | null {
  const parties = v.split('.')
  if (parties.length !== 4) return null
  const octets: number[] = []
  for (const p of parties) {
    // Refuse « 010 » et « 0x7f » : les formes non canoniques sont un moyen
    // classique de faire passer une adresse locale pour autre chose.
    if (!/^\d{1,3}$/.test(p)) return null
    const n = Number(p)
    if (n > 255) return null
    if (p.length > 1 && p[0] === '0') return null
    octets.push(n)
  }
  return octets
}

/** L'adresse IPv4 est-elle non routable sur l'Internet public ? */
export function estIpv4NonRoutable(ip: string): boolean {
  const o = octetsIpv4(ip)
  if (!o) return false
  const [a, b] = o
  if (a === 0) return true                        // 0.0.0.0/8 — « cet hôte »
  if (a === 10) return true                       // RFC 1918
  if (a === 127) return true                      // boucle locale
  if (a === 169 && b === 254) return true         // lien-local + métadonnées cloud
  if (a === 172 && b >= 16 && b <= 31) return true // RFC 1918
  if (a === 192 && b === 168) return true         // RFC 1918
  if (a === 192 && b === 0) return true           // 192.0.0.0/24 (IETF)
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT RFC 6598
  if (a === 198 && (b === 18 || b === 19)) return true // bancs d'essai RFC 2544
  if (a >= 224) return true                       // multicast + réservé + 255.255.255.255
  return false
}

/** L'adresse IPv6 est-elle non routable (y compris les formes mappées IPv4) ? */
export function estIpv6NonRoutable(ip: string): boolean {
  const v = ip.trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0] // retire la zone
  if (!v) return true
  if (v === '::' || v === '::1') return true      // non spécifiée / boucle locale
  // Formes mappées/traduites IPv4 : ::ffff:127.0.0.1, ::ffff:7f00:1, 64:ff9b::…
  const mappee = v.match(/^(?:::ffff:|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mappee) return estIpv4NonRoutable(mappee[1])
  if (/^::ffff:/.test(v) || /^64:ff9b::/.test(v)) return true // forme hexadécimale : prudence
  if (/^f[cd]/.test(v)) return true               // fc00::/7 uniques-locales
  if (/^fe[89ab]/.test(v)) return true            // fe80::/10 lien-local
  if (/^ff/.test(v)) return true                  // multicast
  return false
}

/** Une adresse littérale (v4 ou v6) est-elle non routable ? */
export function estAdresseNonRoutable(ip: string): boolean {
  return ip.includes(':') ? estIpv6NonRoutable(ip) : estIpv4NonRoutable(ip)
}

/**
 * Contrôles SYNCHRONES : protocole, nom réservé, adresse littérale.
 * Utilisable à la validation de configuration, sans accès réseau.
 */
export function verifierDestinationSync(url: unknown): VerdictDestination {
  if (typeof url !== 'string' || !url.trim()) return refus('url_invalide')
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return refus('url_invalide')
  }
  if (u.protocol !== 'https:') return refus('protocole_non_https')

  // `URL` conserve les crochets d'un littéral IPv6 : on les retire.
  const hote = u.hostname.replace(/^\[|\]$/g, '')
  if (!hote) return refus('hote_absent')
  if (estNomReserve(hote)) return refus('nom_reserve')

  const estLitteral = /^[\d.]+$/.test(hote) || hote.includes(':')
  if (estLitteral && estAdresseNonRoutable(hote)) return refus('adresse_non_routable')

  return { ok: true }
}

/**
 * Contrôle COMPLET : ajoute la résolution DNS. Un nom dont ne serait-ce qu'UNE
 * adresse est non routable est refusé — un enregistrement multiple ne doit pas
 * permettre de tirer au sort la destination. C'est le vecteur principal quand
 * la configuration porte un NOM et non une adresse : `https://exemple.test`
 * dont l'enregistrement A vaut `127.0.0.1` passait le contrôle de protocole.
 *
 * @param bloquerSiNonResolu — que faire d'un nom qui ne se résout pas ?
 *
 *   Par défaut : NE PAS bloquer. On refuse sur la PREUVE d'une mauvaise
 *   destination, jamais sur l'absence de preuve. Un nom introuvable fera de
 *   toute façon échouer la connexion, avec le même résolveur et donc le même
 *   verdict : bloquer ici n'ajouterait aucune sécurité, mais transformerait une
 *   panne DNS passagère en « destination refusée », message qui enverrait
 *   l'exploitant chercher un problème de configuration inexistant.
 *
 *   Passer `true` à la VALIDATION de configuration, où l'on veut au contraire
 *   dire tout de suite à l'utilisateur que le nom qu'il vient de saisir
 *   n'existe pas.
 */
export async function verifierDestination(
  url: unknown,
  { bloquerSiNonResolu = false }: { bloquerSiNonResolu?: boolean } = {},
): Promise<VerdictDestination> {
  const base = verifierDestinationSync(url)
  if (!base.ok) return base

  const hote = new URL(url as string).hostname.replace(/^\[|\]$/g, '')
  if (/^[\d.]+$/.test(hote) || hote.includes(':')) return { ok: true } // littéral déjà contrôlé

  let adresses: { address: string }[]
  try {
    adresses = await lookup(hote, { all: true })
  } catch {
    return bloquerSiNonResolu ? refus('resolution_impossible') : { ok: true }
  }
  if (!adresses.length) return bloquerSiNonResolu ? refus('resolution_impossible') : { ok: true }
  if (adresses.some((a) => estAdresseNonRoutable(a.address))) return refus('adresse_non_routable')

  return { ok: true }
}
