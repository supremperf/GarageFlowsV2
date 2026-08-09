'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  GarageFlow — Garde de navigation (pure, testable)
//
//  Autorise UNIQUEMENT la navigation vers l'origine locale exacte de l'app
//  (http://127.0.0.1:PORT). La comparaison se fait sur URL(...).origin, jamais
//  sur un préfixe de chaîne — un test startsWith serait contournable via le
//  userinfo (« http://127.0.0.1:PORT@evil.com/ ») ou via un port dont le préfixe
//  correspond (« http://127.0.0.1:PORT8/ »).
// ─────────────────────────────────────────────────────────────────────────────

/** Vrai uniquement si `url` a EXACTEMENT l'origine locale attendue. */
function isLocalAppUrl(url, localOrigin) {
  try {
    return new URL(url).origin === localOrigin
  } catch {
    return false
  }
}

// Noms d'hôte de bouclage équivalents (même machine, même serveur local).
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * Réécriture d'une redirection loopback vers l'origine canonique de l'app.
 *
 * Contexte (fix écran blanc desktop) : le serveur Next.js standalone construit
 * ses redirections 3xx avec l'hôte « localhost » (trustHostHeader=false — il
 * n'utilise jamais l'en-tête Host reçu), alors que la fenêtre Electron est
 * chargée sur l'origine CANONIQUE « http://127.0.0.1:PORT ». Ces deux origines
 * désignent le MÊME serveur de bouclage mais diffèrent pour isLocalAppUrl() : la
 * redirection « / → /login » serait donc bloquée et la fenêtre resterait vide.
 *
 * Renvoie l'URL RÉÉCRITE sur l'origine canonique lorsque `url` désigne le même
 * serveur loopback (hôte de bouclage + MÊME port + MÊME protocole) sous un autre
 * nom ; sinon `null`. Le chemin, la query et le fragment sont préservés.
 *
 * Sécurité : la surface N'EST PAS élargie. Seules des origines de bouclage sur le
 * port EXACT de l'app sont réécrites ; toute origine externe, tout changement de
 * port ou de protocole, et tout contournement par userinfo
 * (« http://127.0.0.1:PORT@evil.com » dont URL.hostname vaut « evil.com »)
 * renvoient `null` et restent donc bloqués par l'appelant.
 */
function canonicalizeLoopbackUrl(url, canonicalOrigin) {
  let u, c
  try { u = new URL(url); c = new URL(canonicalOrigin) } catch { return null }
  if (u.origin === c.origin) return null          // déjà canonique — rien à faire
  if (u.protocol !== c.protocol) return null       // jamais http→https, file:, etc.
  if (u.username || u.password) return null         // anti-contournement userinfo
  if (u.port !== c.port) return null                // MÊME port uniquement
  if (!LOOPBACK_HOSTS.has(u.hostname.toLowerCase())) return null
  return c.origin + u.pathname + u.search + u.hash
}

module.exports = { isLocalAppUrl, canonicalizeLoopbackUrl }
