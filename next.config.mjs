/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    outputFileTracingRoot: undefined,
    instrumentationHook: true,

    // CLÉ PRIVÉE — NE JAMAIS L'EMBARQUER DANS LE PAQUET.
    //
    // `src/app/api/admin/licenses/generate/route.ts` écrit
    // `path.join(process.cwd(), 'keys', 'private.pem')` (émission de licences
    // en développement). Le traceur de fichiers de Next RÉSOUT ce chemin
    // littéral et COPIE le fichier dans `.next/standalone`, d'où
    // `build.extraResources` (qui prend tout le dossier, sans filtre) le
    // reprenait dans CHAQUE installateur : la clé de signature des licences
    // était distribuée aux clients, rendant possible la forge de licences.
    //
    // Constaté dans dist/GarageFlows Setup 1.1.0.exe →
    // resources\standalone\keys\private.pem. On exclut donc explicitement tout
    // matériel de clé du traçage ; `scripts/post-build.js` conserve en plus une
    // purge + un refus de livrer, en défense en profondeur.
    outputFileTracingExcludes: {
      '**/*': ['keys/**'],
    },
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
