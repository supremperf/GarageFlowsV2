/**
 * Next.js instrumentation — exécuté une fois au démarrage du serveur.
 * Valide les variables d'environnement critiques (fail-fast en production).
 * L'app de bureau (Electron) génère un NEXTAUTH_SECRET aléatoire au lancement,
 * donc cette vérification passe hors ligne ; elle protège surtout la cible web.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertServerEnv } = await import('./lib/env')
    assertServerEnv()
  }
}
