import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Version PRODUIT injectée au build depuis package.json — l'unique source de
// vérité (scripts/check-version.js la verrouille). Sans cette injection, le
// client n'a aucun moyen de savoir quelle version il exécute, donc aucun moyen
// de détecter qu'il parle à un serveur incompatible.
const { version: GF_VERSION } = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'package.json'), 'utf8'),
)

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url))

/**
 * RACINE DE TRACING — à ne jamais retirer (cause racine du « server.js NOT found »).
 *
 * `output: 'standalone'` fait écrire par Next.js `.next/standalone/server.js` ET
 * reproduit, SOUS ce dossier, l'arborescence relative à la « racine de workspace »
 * qu'il a inférée. Cette racine n'est pas le dossier du projet : Next.js la
 * déduit en remontant les `package-lock.json`/`yarn.lock`/`pnpm-lock.yaml`.
 *
 * Sur un poste Windows réel, il suffit d'un `package-lock.json` parasite dans le
 * dossier utilisateur (`C:\Users\<nom>\package-lock.json`, créé par un `npm
 * install` lancé hors projet) pour que Next.js élise `C:\Users\<nom>` comme
 * racine de workspace. La sortie standalone devenait alors :
 *
 *   .next/standalone/Desktop/GarageFlowsV2-<branche>/server.js
 *
 * …donc INTROUVABLE à `.next/standalone/server.js`. `scripts/post-build.js`
 * s'arrêtait sur « ❌ server.js NOT found — make sure you ran: npm run build »
 * alors que la compilation Next.js avait bien réussi, et
 * `build.extraResources` (.next/standalone) embarquait un dossier IMBRIQUÉ dans
 * l'installateur : application inlançable.
 *
 * En fixant explicitement la racine sur le dossier du projet :
 *   • la sortie redevient TOUJOURS `.next/standalone/server.js` ;
 *   • l'avertissement « We detected multiple lockfiles… inferred your workspace
 *     root, but it may not be correct » disparaît (plus d'inférence) ;
 *   • le contenu tracé ne dépend plus de fichiers situés HORS du dépôt.
 *
 * Le test `tests/next-config-standalone-root.test.cjs` verrouille ce réglage :
 * le retirer casse l'installateur, pas seulement un message.
 */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: PROJECT_ROOT,
  env: {
    NEXT_PUBLIC_GF_VERSION: GF_VERSION,
  },

  /**
   * Portail client — l'URL officielle est `https://app.garageflows.fr/clients`.
   *
   * Les pages vivaient sous `/portal/*` et aucune réécriture n'existait : tout
   * lien `…/clients/login` communiqué à un client tombait sur un 404. Les pages
   * ont été déplacées sous `/clients/*` (et non simplement réécrites — une
   * réécriture aurait laissé la barre d'adresse repasser à `/portal` dès la
   * première navigation interne).
   *
   * Cette redirection PERMANENTE couvre l'existant : QR codes déjà imprimés,
   * e-mails et SMS déjà envoyés, instantanés portail publiés au cloud avant la
   * bascule. Elle préserve le chemin complet, donc le jeton.
   */
  async redirects() {
    return [
      { source: '/portal', destination: '/clients', permanent: true },
      // `/clients` n'a pas de page : un client à qui l'on donne l'adresse du
      // portail sans chemin — QR code imprimé, adresse dictée au téléphone, URL
      // raccourcie par une messagerie — tombait sur un 404 anglophone sans la
      // moindre issue. On l'amène là où il doit aller.
      { source: '/clients', destination: '/clients/login', permanent: false },
      { source: '/portal/:path*', destination: '/clients/:path*', permanent: true },
    ]
  },

  async headers() {
    // 'unsafe-eval' n'est requis que par l'outillage de DÉVELOPPEMENT de
    // Next.js (react-refresh) : en production il constituait un relâchement
    // inutile de la CSP (AUD-024). Restreint au dev depuis la V13.
    // 'unsafe-inline' (scripts d'hydratation App Router sans nonce) reste
    // l'exception documentée — le durcissement par nonce est le chemin prévu.
    const dev = process.env.NODE_ENV === 'development'
    const csp = [
      "default-src 'self'",
      `script-src 'self'${dev ? " 'unsafe-eval'" : ''} 'unsafe-inline'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "font-src 'self' data:",
      "media-src 'self' blob:",
      "object-src 'none'",           // aucun plugin/embed
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // HSTS : force HTTPS sur le déploiement PWA (2 ans, sous-domaines inclus).
          // Ignoré par les navigateurs sur une réponse http ou un hôte IP loopback,
          // donc inoffensif sous Electron (http://127.0.0.1) et en dev.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ]
  },
}
export default nextConfig
