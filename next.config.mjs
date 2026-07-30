/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    outputFileTracingRoot: undefined,
    instrumentationHook: true,
  },

  async headers() {
    const csp = [
      "default-src 'self'",
      // Next.js (App Router) requiert 'unsafe-eval' (chargement de chunks) et
      // 'unsafe-inline' (scripts d'hydratation) sans nonce. Exception justifiée et
      // limitée à 'self' ; l'app ne charge aucun script tiers.
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
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
