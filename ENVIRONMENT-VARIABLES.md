# Variables d’environnement — contrat canonique

> **Document GÉNÉRÉ** par `npm run env:doc` depuis
> [`scripts/garageflow-env-manifest.json`](scripts/garageflow-env-manifest.json), qui fait foi.
> Ne pas éditer à la main : `check:env-consistency` échoue en cas de divergence.

## La règle

**Une configuration logique = un seul nom canonique = exactement le même nom partout** :
`.env`, Vercel, Prisma, Next.js, Electron, PWA, scripts, CI, documentation.

Aucun repli silencieux entre deux noms. Aucun alias historique conservé indéfiniment.
Une variable manquante fait échouer le démarrage avec un message exploitable ;
elle n’est jamais remplacée en douce par une autre.

**Aucune valeur ne figure dans ce document** — uniquement des noms et des rôles.

## Alias INTERDITS

Ces noms ont désigné une configuration qui possède déjà un nom canonique.
Leur réapparition — dans le code, un script, un `.env`, la documentation active
ou chez Vercel — fait échouer `npm run check:env-consistency`.

| Alias interdit | Nom canonique | Pourquoi il a existé |
| --- | --- | --- |
| `PWA_DATABASE_URL` | `DATABASE_URL` | Portait la MÊME valeur que DATABASE_URL sur Vercel. Un patch injecté par RESET-GARAGEFLOW dans src/instrumentation.ts la recopiait vers DATABASE_URL au démarrage — patch absent du dépôt, donc tout déploiement fait autrement (vercel deploy --prod) démarrait sa… |
| `PWA_DIRECT_URL` | `DIRECT_URL` | Doublon de DIRECT_URL, même mécanisme de recopie que PWA_DATABASE_URL. |
| `DESKTOP_DATABASE_URL` | `DATABASE_URL` | Nom historique pour la connexion du poste. DATABASE_URL est volontairement POLYMORPHE (file: sur le poste, postgresql:// sur le cloud) : c'est son schéma qui sélectionne le client Prisma dans src/lib/db.ts, pas son nom. |
| `DATABASE_URL_UNPOOLED` | `DIRECT_URL` | Nom employé par Neon pour la connexion non poolée. GarageFlows retient DIRECT_URL, qui est le nom attendu par `directUrl` dans les schémas Prisma. |
| `SERVER_DATABASE_URL` | `DATABASE_URL` | Jamais employé dans ce dépôt ; déclaré pour empêcher sa réintroduction. |
| `NEXT_DATABASE_URL` | `DATABASE_URL` | Jamais employé dans ce dépôt ; déclaré pour empêcher sa réintroduction. |
| `DB_URL` | `DATABASE_URL` | Abréviation ambiguë ; déclarée pour empêcher sa réintroduction. |
| `NEXT_PUBLIC_APP_URL` | `GF_APP_URL` | Troisième nom pour « URL publique de l'application ». publicAppUrl() n'est importée que par des routes d'API : la valeur n'atteint jamais le navigateur, le préfixe NEXT_PUBLIC_ y annonçait donc une exposition inexistante (§48). Aucun outillage ne la provision… |

## Contrat par catégorie

### Configuration fonctionnelle (62)

| Nom | Sensibilité | Requise en production | Portée | Rôle |
| --- | --- | --- | --- | --- |
| `EINVOICING_CONNECTIONS_ENABLED` | CONFIGURATION | non | server | Autorise la connexion des garages a leur plateforme. Sans effet si EINVOICING_ENABLED est OFF. |
| `EINVOICING_DEFAULT_ENVIRONMENT` | CONFIGURATION | non | server | sandbox ou production. Ignore (force sandbox) tant que EINVOICING_SANDBOX_ONLY est true. |
| `EINVOICING_ENABLED` | CONFIGURATION | non | server | Drapeau maitre de la facturation electronique. OFF par defaut. Jamais active automatiquement par le reset (autoManage=false). |
| `EINVOICING_INCOMING_ENABLED` | CONFIGURATION | non | server | Autorise la reception des factures. OFF par defaut. |
| `EINVOICING_OUTGOING_ENABLED` | CONFIGURATION | non | server | Autorise l envoi electronique des factures. OFF par defaut. Sans effet si maitre OFF. |
| `EINVOICING_PAYMENT_REPORTING_ENABLED` | CONFIGURATION | non | server | Autorise le e-reporting de paiement. OFF par defaut. |
| `EINVOICING_PROVIDER_CATALOG_ENABLED` | CONFIGURATION | non | server | Affiche le catalogue des plateformes (lecture seule, aucun secret). Defaut true. |
| `EINVOICING_SANDBOX_ONLY` | CONFIGURATION | non | server | Verrouille l environnement sur sandbox (defaut true) : aucune transmission reelle par megarde. |
| `GARAGEFLOW_LLM` | CONFIGURATION | non | server | Only documented in the provider stub; no network provider is actually implemented in this repository. |
| `GF_ALLOW_DEBUG` | CONFIGURATION | non | desktop | Development override; must not be enabled in production builds. |
| `GF_ANTIDEBUG` | CONFIGURATION | non | desktop | Enables anti-debug enforcement only with integrity enforcement. |
| `GF_BRAND_ACCENT_COLOR` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_APP_DOMAIN` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_APP_ID` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_COMMERCIAL_EMAIL` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_COMMERCIAL_URL` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_COMPANY` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_COMPANY_LEGAL` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_DOCS_DOMAIN` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_EXE_PRODUCT_NAME` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_EXECUTABLE_NAME` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_LEGAL_ADDRESS` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_LEGAL_ENTITY` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_LEGAL_SIREN` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_MAIL_FROM` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_MAIL_FROM_NAME` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_MAIL_REPLY_TO` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_MARKETING_DOMAIN` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_PRIMARY_COLOR` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_PRIMARY_DARK_COLOR` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_PRODUCT_NAME` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_SHORT_NAME` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_SUPPORT_EMAIL` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_SUPPORT_PHONE` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_SUPPORT_URL` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_TAGLINE` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_WORDMARK_PRIMARY` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_BRAND_WORDMARK_SECONDARY` | CONFIGURATION | non | build-time | Optional white-label build configuration. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés pour évi… *(aucun consommateur dans ce dépôt)* |
| `GF_CONFIGURER_API_TEST_MODE` | CONFIGURATION | non | maintenance-tool | Exécution des scripts de configuration en mode test (aucune mutation distante). Réservé aux tests. |
| `GF_DEVICE_AUTH_DEADLINE` | CONFIGURATION | non | server | — |
| `GF_EINVOICE_CREDENTIALS_KEY_VERSION` | SECRET | non | server | Version de la cle de chiffrement des identifiants (defaut 1). Incrementee lors d une rotation controlee. |
| `GF_INTEGRITY_MODE` | CONFIGURATION | non | desktop | Controls Electron integrity behavior. |
| `GF_KEYGEN_MAX_MECHANIC` | SECRET | non | server-keygen | Nombre maximum de clés mécanicien générables en une fois par le Keygen (défaut 20). |
| `GF_MAX_MECHANIC_KEYS` | SECRET | non | server | Plafond de clés mécanicien rattachables à une licence garage. |
| `GF_MECHANIC_TIMER_AUTOCOMPLETE` | CONFIGURATION | non | server | Bascule l'achèvement automatique d'une intervention à l'arrêt du chronomètre mécanicien. |
| `GF_MIN_ELECTRON_VERSION` | CONFIGURATION | non | server | — |
| `GF_MIN_PWA_VERSION` | CONFIGURATION | non | server | — |
| `GF_UPDATE_CHANNEL` | CONFIGURATION | non | desktop | — |
| `GF_UPDATE_SIGNING_KEY_FILE` | SECRET | non | release-tooling | Chemin d'un fichier contenant la clé privée de signature, alternative à GF_UPDATE_SIGNING_KEY. Outillage de release uniquement. |
| `LICENSE_ENFORCEMENT` | CONFIGURATION | non | development | — |
| `RATE_LIMIT_ADMIN_MAX` | CONFIGURATION | non | server | Optional positive integer override; code has a safe default. |
| `RATE_LIMIT_ADMIN_WINDOW_SECONDS` | CONFIGURATION | non | server | Optional positive integer override; code has a safe default. |
| `RATE_LIMIT_API_MAX` | CONFIGURATION | non | server | Optional positive integer override; code has a safe default. |
| `RATE_LIMIT_API_WINDOW_SECONDS` | CONFIGURATION | non | server | Optional positive integer override; code has a safe default. |
| `RATE_LIMIT_LICENSE_ACTIVATE_MAX` | CONFIGURATION | non | server | Optional positive integer override; code has a safe default. |
| `RATE_LIMIT_LICENSE_ACTIVATE_WINDOW_SECONDS` | CONFIGURATION | non | server | Optional positive integer override; code has a safe default. |
| `RATE_LIMIT_LICENSE_STATUS_MAX` | CONFIGURATION | non | server | Optional positive integer override; code has a safe default. |
| `RATE_LIMIT_LICENSE_STATUS_WINDOW_SECONDS` | CONFIGURATION | non | server | Optional positive integer override; code has a safe default. |
| `RATE_LIMIT_LOGIN_MAX` | CONFIGURATION | non | server | Optional positive integer override; code has a safe default. |
| `RATE_LIMIT_LOGIN_WINDOW_SECONDS` | CONFIGURATION | non | server | Optional positive integer override; code has a safe default. |
| `TRUST_PROXY_HEADERS` | CONFIGURATION | non | server | — |
| `UPSTASH_REDIS_TIMEOUT_MS` | CONFIGURATION | non | server | Délai d'attente d'un appel Upstash, en millisecondes. Facultative : absente, le défaut est 1500 ms — la valeur qui était codée en dur, donc comportem… |

### dangerous (15)

| Nom | Sensibilité | Requise en production | Portée | Rôle |
| --- | --- | --- | --- | --- |
| `DEMO_RESET_FORCE` | CONFIGURATION | non | development | Lève la protection du jeu de démonstration (effacement de données). Jamais en production. |
| `DEVICE_TOKEN_PEPPER` | SECRET | **oui** | server | Rotation invalidates existing device tokens and HWID hashes. |
| `GF_ALLOW_INSECURE_SYNC` | CONFIGURATION | non | development | DÉVELOPPEMENT UNIQUEMENT : autorise une autorité cloud en http:// (anti-downgrade désactivé). Doit rester absente ou à 0 en production. |
| `GF_BACKUP_KEY` | SECRET | non | server | Doit décoder exactement 32 octets. CHIFFREMENT AU REPOS : la rotation rend ILLISIBLES toutes les sauvegardes déjà produites avec la clé brute. Jamais… |
| `GF_DB_MAC_SECRET` | SECRET | **oui** | both | Electron derives this from the HWID. A server value protects LicenseKey records and must not be rotated blindly. |
| `GF_DEBUG` | CONFIGURATION | non | desktop-runtime | Journalisation détaillée du poste. À laisser absente en production (verbosité et informations d'environnement). |
| `GF_EINVOICE_CREDENTIALS_KEY` | SECRET | non | server | Cle AES-256-GCM des identifiants de plateformes. NE JAMAIS roter automatiquement (rendrait les identifiants existants indechiffrables). Generee une s… |
| `GF_PORTAL_SECRET` | SECRET | non | server | Rotation invalidates portal and quote-signature JWTs. |
| `GF_SIGNATURE_SECRET` | SECRET | non | server | Rotation changes the derived signature-sealing key. |
| `GF_SMTP_CIPHER_KEY` | SECRET | non | server | Existing gsmtp1.k1 values require the same key. No automatic multi-key migration exists. — Statut « absent-consumer » corrigé le 15/08/2026 : la vari… |
| `GF_SMTP_CIPHER_KEY_OLD` | SECRET | non | server | MIGRATION DE ROTATION de GF_SMTP_CIPHER_KEY : anciennes clés (séparées par des virgules) conservées le temps de rechiffrer les mots de passe SMTP exi… |
| `GF_TOTP_ENC_KEY` | SECRET | non | server | Chiffre les secrets TOTP du portail au repos (format gtotp1.<kid>.<iv>.<tag>.<ct>, AES-256-GCM avec AAD de domaine). DISTINCTE de GF_SMTP_CIPHER_KEY … |
| `GF_TOTP_ENC_KEY_OLD` | SECRET | non | server | MIGRATION DE ROTATION de GF_TOTP_ENC_KEY : anciennes cles (separees par des virgules) conservees le temps de rechiffrer les secrets TOTP existants. S… |
| `NEXTAUTH_SECRET` | SECRET | **oui** | both | Rotation invalidates sessions and may make d1-encrypted TOTP/SMTP data unreadable. |
| `SEED_ADMIN_PASSWORD` | SECRET | non | development | Mot de passe du compte administrateur créé par les jeux de données de démonstration. Ne JAMAIS réutiliser une valeur de production ; sans elle, l'amo… |

### dangerous-external (3)

| Nom | Sensibilité | Requise en production | Portée | Rôle |
| --- | --- | --- | --- | --- |
| `GF_PRIVATE_KEY` | SECRET | non | server-publisher | Base64-encoded PKCS#8 EC P-256 private PEM. Must match the public key embedded in Electron and src/lib/license/public-key.ts. Never rotate or generat… |
| `GF_UPDATE_SIGNING_KEY` | SECRET | non | publisher-only | Clé PRIVÉE Ed25519 (PEM PKCS#8) signant les manifestes de mise à jour. Cette entrée portait « documented but not consumed by this repository » : c'ét… |
| `VERCEL_TOKEN` | SECRET | non | publisher-only | Jeton d'API Vercel de l'ÉDITEUR, utilisé pour pousser les variables et déclencher un déploiement. Ne doit jamais être livré à un garage ni écrit dans… |

### Fournies par un service externe (9)

| Nom | Sensibilité | Requise en production | Portée | Rôle |
| --- | --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | SECRET | non | server | plate-lookup ne consomme plus cette clé : son « repli IA » demandait au modèle de déduire marque/modèle/année d'une plaque SIV, qui n'encode rien de … |
| `DATABASE_URL` | SENSIBLE | **oui** | both | Desktop must remain file:./dev.db. Vercel must use a pooled PostgreSQL URL. |
| `DIRECT_URL` | SENSIBLE | **oui** | server | Direct PostgreSQL URL used by migrations. |
| `GF_APP_URL` | SENSIBLE | non | server | URL publique de l'application, base des liens du portail client (publicUrlFor). Nom CANONIQUE depuis le 15/08/2026 : NEXT_PUBLIC_APP_URL a été retiré… |
| `GF_LICENSE_SERVER` | CONFIGURATION | non | desktop | — |
| `GF_UPDATE_SERVER` | CONFIGURATION | non | desktop | — |
| `NEXTAUTH_URL` | SENSIBLE | **oui** | both | — |
| `UPSTASH_REDIS_REST_TOKEN` | SECRET | **oui** | server | — |
| `UPSTASH_REDIS_REST_URL` | SENSIBLE | **oui** | server | — |

### external-config (1)

| Nom | Sensibilité | Requise en production | Portée | Rôle |
| --- | --- | --- | --- | --- |
| `GF_BRAND_CONFIG` | CONFIGURATION | non | build-time | Path to brand JSON or inline JSON. Not a secret. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt ; autoGenerate/autoManage désactivés p… *(aucun consommateur dans ce dépôt)* |

### external-path (3)

| Nom | Sensibilité | Requise en production | Portée | Rôle |
| --- | --- | --- | --- | --- |
| `GF_APP_DATA` | CONFIGURATION | non | maintenance-tool | Optional override for the local restore utility. |
| `GF_BACKUP_DIR` | CONFIGURATION | non | server | Optional backup storage directory. |
| `GF_PHOTOS_DIR` | CONFIGURATION | non | both | Optional storage path; defaults depend on runtime. |

### generated (1)

| Nom | Sensibilité | Requise en production | Portée | Rôle |
| --- | --- | --- | --- | --- |
| `GARAGEFLOW_API_KEY` | SECRET | **oui** | server-keygen | Must be changed transactionally in Vercel, local configuration and keys/server_config.json. |

### public-build-configuration (11)

| Nom | Sensibilité | Requise en production | Portée | Rôle |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_GF_BRAND_ACCENT_COLOR` | PUBLIC | non | build-time-public | Public value embedded into the browser bundle at build time; never store a secret here. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt… *(aucun consommateur dans ce dépôt)* |
| `NEXT_PUBLIC_GF_BRAND_EXECUTABLE_NAME` | PUBLIC | non | build-time-public | Public value embedded into the browser bundle at build time; never store a secret here. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt… *(aucun consommateur dans ce dépôt)* |
| `NEXT_PUBLIC_GF_BRAND_MARKETING_DOMAIN` | PUBLIC | non | build-time-public | Public value embedded into the browser bundle at build time; never store a secret here. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt… *(aucun consommateur dans ce dépôt)* |
| `NEXT_PUBLIC_GF_BRAND_PRIMARY_COLOR` | PUBLIC | non | build-time-public | Public value embedded into the browser bundle at build time; never store a secret here. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt… *(aucun consommateur dans ce dépôt)* |
| `NEXT_PUBLIC_GF_BRAND_PRIMARY_DARK_COLOR` | PUBLIC | non | build-time-public | Public value embedded into the browser bundle at build time; never store a secret here. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt… *(aucun consommateur dans ce dépôt)* |
| `NEXT_PUBLIC_GF_BRAND_PRODUCT_NAME` | PUBLIC | non | build-time-public | Public value embedded into the browser bundle at build time; never store a secret here. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt… *(aucun consommateur dans ce dépôt)* |
| `NEXT_PUBLIC_GF_BRAND_SHORT_NAME` | PUBLIC | non | build-time-public | Public value embedded into the browser bundle at build time; never store a secret here. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt… *(aucun consommateur dans ce dépôt)* |
| `NEXT_PUBLIC_GF_BRAND_SUPPORT_URL` | PUBLIC | non | build-time-public | Public value embedded into the browser bundle at build time; never store a secret here. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt… *(aucun consommateur dans ce dépôt)* |
| `NEXT_PUBLIC_GF_BRAND_TAGLINE` | PUBLIC | non | build-time-public | Public value embedded into the browser bundle at build time; never store a secret here. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt… *(aucun consommateur dans ce dépôt)* |
| `NEXT_PUBLIC_GF_BRAND_WORDMARK_PRIMARY` | PUBLIC | non | build-time-public | Public value embedded into the browser bundle at build time; never store a secret here. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt… *(aucun consommateur dans ce dépôt)* |
| `NEXT_PUBLIC_GF_BRAND_WORDMARK_SECONDARY` | PUBLIC | non | build-time-public | Public value embedded into the browser bundle at build time; never store a secret here. — Audit 2026-08-03 : aucun consommateur présent dans ce dépôt… *(aucun consommateur dans ce dépôt)* |

### runtime-generated (1)

| Nom | Sensibilité | Requise en production | Portée | Rôle |
| --- | --- | --- | --- | --- |
| `GF_INTERNAL_EXPORT_KEY` | SECRET | non | desktop-runtime | Generated in memory by Electron for each process. Do not persist or send to Vercel. |

### Fournies par le système d’exécution (9)

| Nom | Sensibilité | Requise en production | Portée | Rôle |
| --- | --- | --- | --- | --- |
| `APPDATA` | CONFIGURATION | non | runtime-system | Set by Windows, Node.js, Electron, Vercel or the test runner; never synchronize manually. |
| `ELECTRON` | CONFIGURATION | non | runtime-system | Set by Windows, Node.js, Electron, Vercel or the test runner; never synchronize manually. |
| `ELECTRON_DEV` | CONFIGURATION | non | runtime-system | Set by Windows, Node.js, Electron, Vercel or the test runner; never synchronize manually. |
| `GF_E2E_CHROMIUM` | CONFIGURATION | non | runtime-system | Set by Windows, Node.js, Electron, Vercel or the test runner; never synchronize manually. |
| `HOSTNAME` | CONFIGURATION | non | runtime-system | Runtime/test host name; never managed. |
| `NEXT_RUNTIME` | CONFIGURATION | non | runtime-system | Set by Windows, Node.js, Electron, Vercel or the test runner; never synchronize manually. |
| `NODE_ENV` | CONFIGURATION | non | runtime-system | Set by Windows, Node.js, Electron, Vercel or the test runner; never synchronize manually. |
| `NODE_INSPECTOR_IPC` | CONFIGURATION | non | runtime-system | Set by Windows, Node.js, Electron, Vercel or the test runner; never synchronize manually. |
| `VERCEL` | CONFIGURATION | non | runtime-system | Set by Windows, Node.js, Electron, Vercel or the test runner; never synchronize manually. |

### Harnais de test (2)

| Nom | Sensibilité | Requise en production | Portée | Rôle |
| --- | --- | --- | --- | --- |
| `TEST_POSTGRES_URL` | CONFIGURATION | non | test-only | Optional integration-test PostgreSQL URL; never copy to production. |
| `TEST_REDIS_URL` | CONFIGURATION | non | test-only | Optional integration-test Redis URL; never copy to production. |

## Fournies par la plateforme

Node, Electron, Vercel, la CI ou les harnais de test les définissent :
elles ne se provisionnent pas et ne figurent pas au contrat à provisionner.

`ALLOW_PROD` · `APPDATA` · `BASE_URL` · `CHROME_PATH` · `CI` · `DEBUG` · `E2E_EMAIL` · `E2E_LICENSE` · `E2E_PASSWORD` · `ELECTRON` · `ELECTRON_DEV` · `ELECTRON_RUN_AS_NODE` · `FORCE_COLOR` · `GF_E2E_CHROMIUM` · `GF_MANIFEST_NOW` · `GF_SCRIPT_TO_PARSE` · `GF_TEST_ALLOW_UPSTASH` · `GF_TEST_LICENSE` · `HEADER_COOKIE` · `HOME` · `HOSTNAME` · `LANG` · `LOCALAPPDATA` · `NEXT_PUBLIC_GF_VERSION` · `NEXT_RUNTIME` · `NODE_ENV` · `NODE_INSPECTOR_IPC` · `NODE_OPTIONS` · `OS` · `PATH` · `PWD` · `PYTHONIOENCODING` · `PYTHONPATH` · `SHELL` · `TEMP` · `TERM` · `TEST_POSTGRES_URL` · `TEST_REDIS_URL` · `TMP` · `TZ` · `USERPROFILE` · `VERCEL` · `VERCEL_ENV` · `VERCEL_REGION` · `VERCEL_URL` · `VITEST`

## Contrôles

| Commande | Ce qu’elle vérifie |
| --- | --- |
| `npm run check:env-consistency` | Alias interdit réapparu, variable lue non déclarée, variable déclarée devenue inerte, statut périmé, typo, nom non canonique dans un `.env.example`, secret exposé au navigateur. Incluse dans `check:consistency`, donc dans `release:gate`. |
| `npm run check:env-contract` | Même analyse, en mode rapport : affiche la matrice complète sans faire échouer. |
| `npm run check:env-vercel` | Compare les NOMS du contrat à ceux présents chez Vercel (requis manquants, alias historiques, inconnues). Nécessite le CLI et le réseau. |
| `npm run env:doc` | Régénère ce document depuis le manifeste. |

Les tests `src/lib/__tests__/env-contract.test.ts` et `env-manifest-drift.test.ts`
verrouillent le registre et le comportement au démarrage.

