'use client'

/**
 * Identifiant d'installation PWA (navigateur).
 *
 * Un navigateur n'expose pas de HWID matériel : chaque installation/profil PWA
 * génère donc un identifiant aléatoire (256 bits, CSPRNG via Web Crypto), stocké
 * de façon persistante dans localStorage. Cet identifiant :
 *  - est cryptographiquement sûr (crypto.getRandomValues) ;
 *  - est unique par installation ou profil navigateur ;
 *  - N'EST PAS une empreinte intrusive du navigateur (aucune collecte de
 *    caractéristiques matérielles/logicielles) ;
 *  - ne repose pas sur l'IP ni le User-Agent ;
 *  - est envoyé au serveur à l'activation (et consomme un siège comme un
 *    appareil Electron) ;
 *  - est régénéré proprement si les données du navigateur sont effacées
 *    (l'ancien appareil restera visible côté serveur jusqu'à sa révocation /
 *    réinitialisation par l'administrateur, ou libéré si un siège se libère) ;
 *  - n'est JAMAIS stocké en clair côté serveur (seul son HMAC l'est).
 *
 * Le serveur valide le format (base64url, 43 caractères) et hache la valeur.
 */

const STORAGE_KEY = 'gf_pwa_install_id'
const INSTALL_ID_RE = /^[A-Za-z0-9_-]{43}$/

/** Encode 32 octets aléatoires en base64url (sans padding) — 43 caractères. */
function randomInstallId(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Retourne l'identifiant d'installation persistant, en le créant au premier
 * appel. Renvoie null hors navigateur (SSR) ou si le stockage est indisponible.
 */
export function getOrCreateInstallId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY)
    if (existing && INSTALL_ID_RE.test(existing)) return existing
    const fresh = randomInstallId()
    window.localStorage.setItem(STORAGE_KEY, fresh)
    return fresh
  } catch {
    // Mode privé strict / stockage bloqué : on renvoie un identifiant éphémère
    // (par session) plutôt que rien — l'activation restera possible.
    try {
      return randomInstallId()
    } catch {
      return null
    }
  }
}
