/**
 * Point d'entrée d'instrumentation Next.js — exécuté une fois au démarrage du
 * serveur. Valide la configuration (fail-fast en production).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertEnv } = await import('@/lib/env')
    assertEnv()
  }
}
