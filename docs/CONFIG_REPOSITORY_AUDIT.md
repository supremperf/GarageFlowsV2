# Configuration — inventaire et analyse transversale du dépôt

> Généré par `npm run config:audit`. Inventaire statique de tous les fichiers suivis et lecture des fichiers texte ; analyse des points de configuration et des composants structurants. Ce n’est ni une preuve d’absence de bogue dans chaque fonction ni un test des comptes externes.

- 2289 fichiers inventoriés, 2279 textes lus, 10 binaires identifiés (non interprétés).
- 1134 fichiers de code/configuration balayés pour les lectures littérales d’environnement.
- 164 routes API, 47 modèles PostgreSQL, 22 migrations serveur.
- 122 variables canoniques : 56 application, 11 platform, 11 manual, 39 unused, 2 runtime, 1 keygen, 2 publisher.

## Architecture et conséquences pour config

- Next.js 14 App Router : interface, API, instrumentation de validation, sessions et contrôle de licence serveur. Deux clients Prisma sont générés ; `src/lib/db.ts` choisit SQLite/PostgreSQL depuis le schéma de connexion.
- Electron : serveur Next local sur loopback, SQLite dans userData, secrets par installation, photos sur disque, mise à jour vérifiée et intégrité. Les secrets d’un poste installé ne doivent pas être remplacés par ceux du serveur.
- PWA/Vercel : PostgreSQL durable et Redis REST distribué obligatoires. Pas de chemin de disque local fictif pour rendre persistantes les sauvegardes. Les variables runtime Vercel restent gérées par Vercel.
- Licence : P-256 privé côté émetteur/keygen ; clé publique embarquée en Electron et Next. Record-MAC HMAC et pepper distincts. Le keygen attend `keys/private.pem`, `keys/public.pem` et `keys/server_config.json`.
- Portail : secrets de sessions/liens, signatures et TOTP séparés. SMTP, TOTP, sauvegardes et identifiants de facturation ont leurs propres clés ; une rotation involontaire détruit l’accès aux cryptogrammes.
- Publication : Ed25519 privé hors dépôt, clés publiques historiques conservées dans le client. Le service de publication garagesite3 est un autre dépôt et ne peut pas être déployé à partir de ces seules sources.
- Outillage : scripts PowerShell de configuration/reset/rotation déjà présents. Le mode complet par défaut reconstruit les variables production modifiables sur base vide après AUTORISER (sauvegardes/journal, Storage protégé). --conserver-secrets garde le plan conservateur. Aucun reset SQL ni réalignement arbitraire de migrations.
- Secrets non relisibles : une variable Sensitive déjà présente n’est retirée/recréée chez Vercel que lorsque sa valeur locale est générée (base cible confirmée puis inspectée sans données métier dans le plan complet) ou lorsque le remplacement est autorisé explicitement. Les URLs de base viennent de Neon, jamais d’une valeur inventée ; les reçus ne contiennent que des empreintes SHA-256.
- Dépendances : Node 22/npm pour l’application ; Python/cryptography pour le keygen. Builds Windows, signature de code, identité légale et fournisseur de facturation exigent des ressources externes.

## Blocages que des variables ne résolvent pas

1. Sur Vercel, le service de sauvegarde actuel écrit des fichiers : un stockage durable + adaptation applicative sont nécessaires. Config signale cette limitation, sans déclarer le stockage opérationnel.
2. Le provider LLM du Copilot n’est pas implémenté (`resolveLlmProvider()` rend null). Une clé Anthropic configure l’OCR existant, pas une intégration Copilot imaginaire.
3. Les 39 entrées historiques marquées absent-consumer ne sont pas réactivées. Les variables de test/reset/debug ne sont pas déployées.
4. Clés privées perdues, secrets Vercel non relisibles, domaine/DNS, SMTP et comptes des plateformes : autorisation/valeur d’origine nécessaire, jamais inventée.
5. Les migrations existantes restent la source de vérité ; un drift après déploiement bloque le plan au lieu de lancer db push/reset.

## Répartition des fichiers

| Répertoire | Fichiers |
|---|---:|
| docs | 1128 |
| src | 888 |
| scripts | 116 |
| (racine) | 46 |
| prisma | 30 |
| tests | 25 |
| electron | 24 |
| vendor | 12 |
| public | 10 |
| e2e | 6 |
| .github | 3 |
| artifacts | 1 |

## Couverture du contrat complet

Chaque ligne a une décision explicite. « manual » signifie choix/outil spécifique non activé ; « unused » signifie qu’ajouter une valeur n’aurait aucun effet. Les variables facultatives peuvent rester vides.

| Variable canonique | Décision | Destination | Références littérales observées |
|---|---|---|---:|
| `ANTHROPIC_API_KEY` | application | .env.server.local / Vercel (selon profil) | 5 |
| `APPDATA` | platform | OS / Electron / Next / Vercel / tests | 1 |
| `DATABASE_URL` | application | .env.server.local / Vercel (selon profil) | 96 |
| `DEMO_RESET_FORCE` | manual | outil/opération concernée seulement | 1 |
| `DEVICE_TOKEN_PEPPER` | application | .env.server.local / Vercel (selon profil) | 6 |
| `DIRECT_URL` | application | .env.server.local / Vercel (selon profil) | 8 |
| `EINVOICING_CONNECTIONS_ENABLED` | application | .env.server.local / Vercel (selon profil) | 3 |
| `EINVOICING_DEFAULT_ENVIRONMENT` | application | .env.server.local / Vercel (selon profil) | 3 |
| `EINVOICING_ENABLED` | application | .env.server.local / Vercel (selon profil) | 3 |
| `EINVOICING_INCOMING_ENABLED` | application | .env.server.local / Vercel (selon profil) | 0 |
| `EINVOICING_OUTGOING_ENABLED` | application | .env.server.local / Vercel (selon profil) | 2 |
| `EINVOICING_PAYMENT_REPORTING_ENABLED` | application | .env.server.local / Vercel (selon profil) | 0 |
| `EINVOICING_PROVIDER_CATALOG_ENABLED` | application | .env.server.local / Vercel (selon profil) | 0 |
| `EINVOICING_SANDBOX_ONLY` | application | .env.server.local / Vercel (selon profil) | 2 |
| `ELECTRON` | platform | OS / Electron / Next / Vercel / tests | 22 |
| `ELECTRON_DEV` | platform | OS / Electron / Next / Vercel / tests | 2 |
| `GARAGEFLOW_API_KEY` | application | .env.server.local / Vercel (selon profil) | 9 |
| `GARAGEFLOW_LLM` | application | .env.server.local / Vercel (selon profil) | 3 |
| `GARAGEFLOW_LLM_MODEL` | application | .env.server.local / Vercel (selon profil) | 3 |
| `GF_ALLOW_DEBUG` | manual | outil/opération concernée seulement | 1 |
| `GF_ALLOW_INSECURE_SYNC` | manual | outil/opération concernée seulement | 1 |
| `GF_ANTIDEBUG` | application | .env / défaut compilé Electron | 1 |
| `GF_APP_DATA` | manual | outil/opération concernée seulement | 1 |
| `GF_APP_URL` | application | .env.server.local / Vercel (selon profil) | 2 |
| `GF_BACKUP_DIR` | application | .env.server.local / Vercel (selon profil) | 2 |
| `GF_BACKUP_KEY` | application | .env.server.local / Vercel (selon profil) | 3 |
| `GF_BRAND_ACCENT_COLOR` | unused | aucune | 0 |
| `GF_BRAND_APP_DOMAIN` | unused | aucune | 0 |
| `GF_BRAND_APP_ID` | unused | aucune | 0 |
| `GF_BRAND_COMMERCIAL_EMAIL` | unused | aucune | 0 |
| `GF_BRAND_COMMERCIAL_URL` | unused | aucune | 0 |
| `GF_BRAND_COMPANY` | unused | aucune | 0 |
| `GF_BRAND_COMPANY_LEGAL` | unused | aucune | 0 |
| `GF_BRAND_CONFIG` | unused | aucune | 0 |
| `GF_BRAND_DOCS_DOMAIN` | unused | aucune | 0 |
| `GF_BRAND_EXE_PRODUCT_NAME` | unused | aucune | 0 |
| `GF_BRAND_EXECUTABLE_NAME` | unused | aucune | 0 |
| `GF_BRAND_LEGAL_ADDRESS` | unused | aucune | 0 |
| `GF_BRAND_LEGAL_ENTITY` | unused | aucune | 0 |
| `GF_BRAND_LEGAL_SIREN` | unused | aucune | 0 |
| `GF_BRAND_MAIL_FROM` | unused | aucune | 0 |
| `GF_BRAND_MAIL_FROM_NAME` | unused | aucune | 0 |
| `GF_BRAND_MAIL_REPLY_TO` | unused | aucune | 0 |
| `GF_BRAND_MARKETING_DOMAIN` | unused | aucune | 0 |
| `GF_BRAND_PRIMARY_COLOR` | unused | aucune | 0 |
| `GF_BRAND_PRIMARY_DARK_COLOR` | unused | aucune | 0 |
| `GF_BRAND_PRODUCT_NAME` | unused | aucune | 0 |
| `GF_BRAND_SHORT_NAME` | unused | aucune | 0 |
| `GF_BRAND_SUPPORT_EMAIL` | unused | aucune | 0 |
| `GF_BRAND_SUPPORT_PHONE` | unused | aucune | 0 |
| `GF_BRAND_SUPPORT_URL` | unused | aucune | 0 |
| `GF_BRAND_TAGLINE` | unused | aucune | 0 |
| `GF_BRAND_WORDMARK_PRIMARY` | unused | aucune | 0 |
| `GF_BRAND_WORDMARK_SECONDARY` | unused | aucune | 0 |
| `GF_CONFIGURER_API_TEST_MODE` | manual | outil/opération concernée seulement | 0 |
| `GF_DB_MAC_SECRET` | application | .env.server.local / Vercel (selon profil) | 16 |
| `GF_DEBUG` | runtime | Electron userData / mémoire | 1 |
| `GF_DEVICE_AUTH_DEADLINE` | application | .env.server.local / Vercel (selon profil) | 3 |
| `GF_E2E_CHROMIUM` | platform | OS / Electron / Next / Vercel / tests | 0 |
| `GF_EINVOICE_CREDENTIALS_KEY` | application | .env.server.local / Vercel (selon profil) | 4 |
| `GF_EINVOICE_CREDENTIALS_KEY_VERSION` | application | .env.server.local / Vercel (selon profil) | 2 |
| `GF_INTEGRITY_MODE` | application | .env / défaut compilé Electron | 1 |
| `GF_INTERNAL_EXPORT_KEY` | runtime | Electron userData / mémoire | 2 |
| `GF_KEYGEN_MAX_MECHANIC` | keygen | keys/server_config.json + lanceur keygen | 2 |
| `GF_LICENSE_SERVER` | application | .env / défaut compilé Electron | 2 |
| `GF_MAX_MECHANIC_KEYS` | application | .env.server.local / Vercel (selon profil) | 3 |
| `GF_MECHANIC_TIMER_AUTOCOMPLETE` | application | .env.server.local / Vercel (selon profil) | 3 |
| `GF_MIN_ELECTRON_VERSION` | application | .env.server.local / Vercel (selon profil) | 4 |
| `GF_MIN_PWA_VERSION` | application | .env.server.local / Vercel (selon profil) | 4 |
| `GF_PACKAGE_DESKTOP` | manual | outil/opération concernée seulement | 1 |
| `GF_PHOTOS_DIR` | application | .env.server.local / Vercel (selon profil) | 15 |
| `GF_PORTAL_SECRET` | application | .env.server.local / Vercel (selon profil) | 20 |
| `GF_PRIVATE_KEY` | application | .env.server.local / Vercel (selon profil) | 4 |
| `GF_PROBE_NAMES` | manual | outil/opération concernée seulement | 1 |
| `GF_SIGNATURE_SECRET` | application | .env.server.local / Vercel (selon profil) | 1 |
| `GF_SMTP_CIPHER_KEY` | application | .env.server.local / Vercel (selon profil) | 6 |
| `GF_SMTP_CIPHER_KEY_OLD` | application | .env.server.local / Vercel (selon profil) | 2 |
| `GF_TOTP_ENC_KEY` | application | .env.server.local / Vercel (selon profil) | 5 |
| `GF_TOTP_ENC_KEY_OLD` | application | .env.server.local / Vercel (selon profil) | 2 |
| `GF_UPDATE_CHANNEL` | application | .env / défaut compilé Electron | 1 |
| `GF_UPDATE_SERVER` | application | .env / défaut compilé Electron | 1 |
| `GF_UPDATE_SIGNING_KEY` | publisher | coffre hors dépôt + GarageFlow-configuration/publisher.json (chemin/keyId seulement) | 2 |
| `GF_UPDATE_SIGNING_KEY_FILE` | publisher | coffre hors dépôt + GarageFlow-configuration/publisher.json (chemin/keyId seulement) | 2 |
| `HOSTNAME` | platform | OS / Electron / Next / Vercel / tests | 1 |
| `LICENSE_ENFORCEMENT` | application | .env.server.local / Vercel (selon profil) | 2 |
| `NEXT_PUBLIC_GF_BRAND_ACCENT_COLOR` | unused | aucune | 0 |
| `NEXT_PUBLIC_GF_BRAND_EXECUTABLE_NAME` | unused | aucune | 0 |
| `NEXT_PUBLIC_GF_BRAND_MARKETING_DOMAIN` | unused | aucune | 0 |
| `NEXT_PUBLIC_GF_BRAND_PRIMARY_COLOR` | unused | aucune | 0 |
| `NEXT_PUBLIC_GF_BRAND_PRIMARY_DARK_COLOR` | unused | aucune | 0 |
| `NEXT_PUBLIC_GF_BRAND_PRODUCT_NAME` | unused | aucune | 0 |
| `NEXT_PUBLIC_GF_BRAND_SHORT_NAME` | unused | aucune | 0 |
| `NEXT_PUBLIC_GF_BRAND_SUPPORT_URL` | unused | aucune | 0 |
| `NEXT_PUBLIC_GF_BRAND_TAGLINE` | unused | aucune | 0 |
| `NEXT_PUBLIC_GF_BRAND_WORDMARK_PRIMARY` | unused | aucune | 0 |
| `NEXT_PUBLIC_GF_BRAND_WORDMARK_SECONDARY` | unused | aucune | 0 |
| `NEXT_RUNTIME` | platform | OS / Electron / Next / Vercel / tests | 1 |
| `NEXTAUTH_SECRET` | application | .env.server.local / Vercel (selon profil) | 35 |
| `NEXTAUTH_URL` | application | .env.server.local / Vercel (selon profil) | 5 |
| `NODE_ENV` | platform | OS / Electron / Next / Vercel / tests | 13 |
| `NODE_INSPECTOR_IPC` | platform | OS / Electron / Next / Vercel / tests | 1 |
| `RATE_LIMIT_ADMIN_MAX` | application | .env.server.local / Vercel (selon profil) | 0 |
| `RATE_LIMIT_ADMIN_WINDOW_SECONDS` | application | .env.server.local / Vercel (selon profil) | 0 |
| `RATE_LIMIT_API_MAX` | application | .env.server.local / Vercel (selon profil) | 0 |
| `RATE_LIMIT_API_WINDOW_SECONDS` | application | .env.server.local / Vercel (selon profil) | 0 |
| `RATE_LIMIT_LICENSE_ACTIVATE_MAX` | application | .env.server.local / Vercel (selon profil) | 0 |
| `RATE_LIMIT_LICENSE_ACTIVATE_WINDOW_SECONDS` | application | .env.server.local / Vercel (selon profil) | 0 |
| `RATE_LIMIT_LICENSE_STATUS_MAX` | application | .env.server.local / Vercel (selon profil) | 0 |
| `RATE_LIMIT_LICENSE_STATUS_WINDOW_SECONDS` | application | .env.server.local / Vercel (selon profil) | 0 |
| `RATE_LIMIT_LOGIN_MAX` | application | .env.server.local / Vercel (selon profil) | 1 |
| `RATE_LIMIT_LOGIN_WINDOW_SECONDS` | application | .env.server.local / Vercel (selon profil) | 1 |
| `SEED_ADMIN_PASSWORD` | manual | outil/opération concernée seulement | 2 |
| `TEST_POSTGRES_URL` | platform | OS / Electron / Next / Vercel / tests | 7 |
| `TEST_REDIS_URL` | platform | OS / Electron / Next / Vercel / tests | 3 |
| `TRUST_PROXY_HEADERS` | application | .env.server.local / Vercel (selon profil) | 6 |
| `UPSTASH_REDIS_REST_TOKEN` | application | .env.server.local / Vercel (selon profil) | 9 |
| `UPSTASH_REDIS_REST_URL` | application | .env.server.local / Vercel (selon profil) | 9 |
| `UPSTASH_REDIS_TIMEOUT_MS` | application | .env.server.local / Vercel (selon profil) | 2 |
| `VERCEL` | platform | OS / Electron / Next / Vercel / tests | 7 |
| `VERCEL_TOKEN` | manual | outil/opération concernée seulement | 0 |
| `E2E_NON_PRODUCTION` | manual | outil/opération concernée seulement | 1 |
| `E2E_STAGING_URL` | manual | outil/opération concernée seulement | 0 |

Les recherches littérales ne prouvent pas l’absence d’un consommateur dynamique et peuvent relever des commentaires/tests. Le manifeste conserve les consommateurs déclarés ; cette matrice complète la garde `check:env-consistency`, elle ne la remplace pas.
