# Variables d'environnement — GarageFlowsV2 (client desktop / app web)

Aucune valeur réelle dans le dépôt. `setup-dev.js` génère un `NEXTAUTH_SECRET`
aléatoire à l'installation ; en production, l'app Electron injecte un secret par
installation. Validation fail-fast (`src/lib/env.ts` + `instrumentation.ts`).

| Variable | Obligatoire | Rôle | Génération |
|---|---|---|---|
| `DATABASE_URL` | oui | SQLite desktop (`file:./dev.db`) / Postgres (web) | fournisseur |
| `NEXTAUTH_SECRET` | oui | Signature session/cookie/portail | `openssl rand -base64 32` (auto en dev) |
| `NEXTAUTH_URL` | oui | URL de l'app | `https://app.garageflows.fr` |
| `GF_LICENSE_SERVER` | oui | Serveur de licences distant | `https://api.garageflows.fr` |
| `GARAGEFLOW_API_KEY` | oui | Auth Keygen → serveur (DISTINCTE) | `openssl rand -hex 32` |
| `GF_INTERNAL_EXPORT_KEY` | oui | Export/migration internes (loopback) | `openssl rand -hex 32` |
| `GF_PORTAL_SECRET` | non (→ NEXTAUTH_SECRET) | JWT portail/signature devis | `openssl rand -base64 32` |
| `ANTHROPIC_API_KEY` | non | OCR plaque (désactivé si absent) | console Anthropic |

Aucune de ces variables ne possède de **repli codé en dur** : une valeur absente
ou générique fait échouer le démarrage en production (ou la vérification à
l'exécution), jamais un contournement silencieux.
