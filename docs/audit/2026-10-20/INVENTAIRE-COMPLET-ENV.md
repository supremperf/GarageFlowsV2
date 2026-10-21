# GarageFlows — Inventaire complet des variables d'environnement

**Date :** 2026-10-20 · **Source de vérité :** `scripts/garageflow-env-manifest.json` (schemaVersion 2)

> Généré depuis le manifeste du dépôt. **Aucune valeur** n'y figure : noms, rôles et métadonnées uniquement.

## Synthèse

| Mesure | Valeur |
|---|---|
| Variables déclarées | **132** |
| Requises en production | **10** |
| Fournies par la plateforme | 53 |
| Alias interdits | 8 |
| Générables localement (autoGenerate) | 6 |

Répartition par classification :

| Classification | Nombre |
|---|---|
| `configuration` | 69 |
| `dangerous` | 18 |
| `public-build-configuration` | 11 |
| `external` | 9 |
| `runtime-system` | 9 |
| `test-external` | 4 |
| `secret` | 3 |
| `external-path` | 3 |
| `dangerous-external` | 3 |
| `generated` | 1 |
| `external-config` | 1 |
| `runtime-generated` | 1 |

## Contrat minimal de production

Ces variables sont exigées en production. Leur absence est désormais rapportée
par `node scripts/check-env-vercel.mjs --environnement production --projet app.garageflows.fr`.

| Variable | Portée | Format | Long. min | Risque rotation | Consommateur principal |
|---|---|---|---|---|---|
| `DATABASE_URL` | both | database-url | 5 | high | `prisma/schema.prisma` |
| `DEVICE_TOKEN_PEPPER` | server | strong-secret | 32 | critical | `src/lib/env.ts` |
| `DIRECT_URL` | server | postgres-url | 12 | high | `prisma/server/schema.prisma` |
| `GARAGEFLOW_API_KEY` | server-keygen | hex64 | 32 | medium | `src/app/api/admin/licenses/revoke-by-key/route.ts` |
| `GF_DB_MAC_SECRET` | both | strong-secret | 32 | critical | `src/lib/license/record-mac.ts` |
| `GF_PRODUCTION_DB_FINGERPRINT` | server | sha256-hex | 64 | low | `src/lib/env.ts` |
| `NEXTAUTH_SECRET` | both | strong-secret | 32 | critical | `src/middleware.ts` |
| `NEXTAUTH_URL` | both | http-url | 8 | low | `src/app/api/health/route.ts` |
| `UPSTASH_REDIS_REST_TOKEN` | server | nonempty-secret | 16 | medium | `src/lib/env.ts` |
| `UPSTASH_REDIS_REST_URL` | server | https-url | 8 | medium | `src/lib/env.ts` |

## Alias interdits

Noms historiques à ne jamais lire : le contrôle d'environnement les signale.

| Alias | Nom canonique |
|---|---|
| `PWA_DATABASE_URL` | `DATABASE_URL` |
| `PWA_DIRECT_URL` | `DIRECT_URL` |
| `DESKTOP_DATABASE_URL` | `DATABASE_URL` |
| `DATABASE_URL_UNPOOLED` | `DIRECT_URL` |
| `SERVER_DATABASE_URL` | `DATABASE_URL` |
| `NEXT_DATABASE_URL` | `DATABASE_URL` |
| `DB_URL` | `DATABASE_URL` |
| `NEXT_PUBLIC_APP_URL` | `GF_APP_URL` |

## Inventaire intégral

| Variable | Classification | Portée | Req. prod | Plateforme | Auto-gén. | Consommateurs |
|---|---|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | external | server | non | — | — | 2 (route.ts…) |
| `APPDATA` | runtime-system | runtime-system | non | oui | — | 1 (restore.js…) |
| `BLOB_READ_WRITE_TOKEN` | secret | release-tooling | non | — | — | 2 (config-manager.cjs…) |
| `CRON_SECRET` | secret | server | non | — | — | 1 (vercel.json (crons)…) |
| `DATABASE_URL` | external | both | **oui** | — | — | 4 (schema.prisma…) |
| `DEMO_RESET_FORCE` | dangerous | development | non | — | — | 1 (demo-tenant.ts…) |
| `DEVICE_TOKEN_PEPPER` | dangerous | server | **oui** | — | oui | 2 (env.ts…) |
| `DIRECT_URL` | external | server | **oui** | — | — | 2 (schema.prisma…) |
| `E2E_NON_PRODUCTION` | test-external | test-only | non | — | — | 1 (ci.yml…) |
| `E2E_STAGING_URL` | test-external | test-only | non | — | — | 1 (ci.yml…) |
| `EINVOICING_CONNECTIONS_ENABLED` | configuration | server | non | — | — | 1 (flags.ts…) |
| `EINVOICING_DEFAULT_ENVIRONMENT` | configuration | server | non | — | — | 1 (flags.ts…) |
| `EINVOICING_ENABLED` | configuration | server | non | — | — | 1 (flags.ts…) |
| `EINVOICING_INCOMING_ENABLED` | configuration | server | non | — | — | 1 (flags.ts…) |
| `EINVOICING_OUTGOING_ENABLED` | configuration | server | non | — | — | 1 (flags.ts…) |
| `EINVOICING_PAYMENT_REPORTING_ENABLED` | configuration | server | non | — | — | 1 (flags.ts…) |
| `EINVOICING_PROVIDER_CATALOG_ENABLED` | configuration | server | non | — | — | 1 (flags.ts…) |
| `EINVOICING_QUEUE_TOKEN` | secret | server | non | — | — | 1 (route.ts…) |
| `EINVOICING_SANDBOX_ONLY` | configuration | server | non | — | — | 1 (flags.ts…) |
| `ELECTRON` | runtime-system | runtime-system | non | oui | — | 2 (env.ts…) |
| `ELECTRON_DEV` | runtime-system | runtime-system | non | oui | — | 2 (main.js…) |
| `GARAGEFLOW_API_KEY` | generated | server-keygen | **oui** | — | oui | 3 (route.ts…) |
| `GARAGEFLOW_LLM` | configuration | server | non | — | — | 1 (provider.ts…) |
| `GARAGEFLOW_LLM_MODEL` | configuration | server | non | — | — | 1 (provider.ts…) |
| `GF_ALLOW_DEBUG` | configuration | desktop | non | — | — | 1 (integrity.js…) |
| `GF_ALLOW_INSECURE_SYNC` | dangerous | development | non | — | — | 1 (cloud-client.ts…) |
| `GF_ANCHOR_RESTORE_NETWORK` | configuration | release-tooling | non | — | — | 1 (restore-public-anchors.cjs…) |
| `GF_ANTIDEBUG` | configuration | desktop | non | — | — | 1 (main.js…) |
| `GF_APP_DATA` | external-path | maintenance-tool | non | — | — | 1 (restore.js…) |
| `GF_APP_URL` | external | server | non | — | — | 1 (public-url.ts…) |
| `GF_BACKUP_DIR` | external-path | server | non | — | — | 1 (service.ts…) |
| `GF_BACKUP_KEY` | dangerous | server | non | — | — | 3 (env.ts…) |
| `GF_BRAND_ACCENT_COLOR` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_APP_DOMAIN` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_APP_ID` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_COMMERCIAL_EMAIL` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_COMMERCIAL_URL` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_COMPANY` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_COMPANY_LEGAL` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_CONFIG` | external-config | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_DOCS_DOMAIN` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_EXE_PRODUCT_NAME` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_EXECUTABLE_NAME` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_LEGAL_ADDRESS` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_LEGAL_ENTITY` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_LEGAL_SIREN` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_MAIL_FROM` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_MAIL_FROM_NAME` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_MAIL_REPLY_TO` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_MARKETING_DOMAIN` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_PRIMARY_COLOR` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_PRIMARY_DARK_COLOR` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_PRODUCT_NAME` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_SHORT_NAME` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_SUPPORT_EMAIL` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_SUPPORT_PHONE` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_SUPPORT_URL` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_TAGLINE` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_WORDMARK_PRIMARY` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_BRAND_WORDMARK_SECONDARY` | configuration | build-time | non | — | — | 2 (brand.ts…) |
| `GF_CONFIGURER_API_TEST_MODE` | configuration | maintenance-tool | non | — | — | 2 (configurer-api-garageflow.ps1…) |
| `GF_DB_MAC_SECRET` | dangerous | both | **oui** | — | oui | 2 (record-mac.ts…) |
| `GF_DEBUG` | dangerous | desktop-runtime | non | — | — | 1 (main.js…) |
| `GF_DEVICE_AUTH_DEADLINE` | configuration | server | non | — | — | 1 (client-policy.ts…) |
| `GF_E2E_CHROMIUM` | runtime-system | runtime-system | non | oui | — | 1 (playwright.config.ts…) |
| `GF_EINVOICE_CREDENTIALS_KEY` | dangerous | server | non | — | — | 1 (credentials-cipher.ts…) |
| `GF_EINVOICE_CREDENTIALS_KEY_VERSION` | configuration | server | non | — | — | 1 (credentials-cipher.ts…) |
| `GF_INTEGRITY_MODE` | configuration | desktop | non | — | — | 1 (main.js…) |
| `GF_INTERNAL_EXPORT_KEY` | runtime-generated | desktop-runtime | non | — | — | 2 (main.js…) |
| `GF_KEYGEN_MAX_MECHANIC` | configuration | server-keygen | non | — | — | 2 (keygen.py…) |
| `GF_LICENSE_SERVER` | external | desktop | non | — | — | 1 (main.js…) |
| `GF_MAX_MECHANIC_KEYS` | configuration | server | non | — | — | 1 (mechanic-admin.ts…) |
| `GF_MECHANIC_TIMER_AUTOCOMPLETE` | configuration | server | non | — | — | 1 (route.ts…) |
| `GF_MIN_ELECTRON_VERSION` | configuration | server | non | — | — | 1 (client-policy.ts…) |
| `GF_MIN_PWA_VERSION` | configuration | server | non | — | — | 1 (client-policy.ts…) |
| `GF_NO_ANCHOR_RESTORE` | configuration | release-tooling | non | — | — | 2 (preflight-release.cjs…) |
| `GF_PACKAGE_DESKTOP` | configuration | release-tooling | non | — | — | 1 (post-build.js…) |
| `GF_PHOTOS_DIR` | external-path | both | non | — | — | 4 (photo-store.ts…) |
| `GF_PORTAL_SECRET` | dangerous | server | non | — | oui | 2 (auth-secret.ts…) |
| `GF_PRIVATE_KEY` | dangerous-external | server-publisher | non | — | — | 2 (route.ts…) |
| `GF_PROBE_NAMES` | configuration | maintenance-tool | non | — | — | 1 (reset-garageflow.ps1…) |
| `GF_PRODUCTION_DB_FINGERPRINT` | configuration | server | **oui** | — | — | 1 (env.ts…) |
| `GF_SIGNATURE_SECRET` | dangerous | server | non | — | oui | 1 (key.ts…) |
| `GF_SMTP_CIPHER_KEY` | dangerous | server | non | — | — | 3 (secret-cipher.ts…) |
| `GF_SMTP_CIPHER_KEY_OLD` | dangerous | server | non | — | — | 2 (secret-cipher.ts…) |
| `GF_TOTP_ENC_KEY` | dangerous | server | non | — | — | 1 (totp-crypto.ts…) |
| `GF_TOTP_ENC_KEY_OLD` | dangerous | server | non | — | — | 1 (totp-crypto.ts…) |
| `GF_UPDATE_CHANNEL` | configuration | desktop | non | — | — | 1 (main.js…) |
| `GF_UPDATE_SERVER` | external | desktop | non | — | — | 1 (main.js…) |
| `GF_UPDATE_SIGNING_KEY` | dangerous-external | publisher-only | non | — | — | 1 (sign-release-manifest.mjs…) |
| `GF_UPDATE_SIGNING_KEY_FILE` | configuration | release-tooling | non | — | — | 1 (sign-release-manifest.mjs…) |
| `GF_VERCEL_PROJECT` | configuration | maintenance-tool | non | — | — | 1 (check-env-vercel.mjs…) |
| `HOSTNAME` | runtime-system | runtime-system | non | oui | — | 1 (electron-loopback.test.ts…) |
| `LICENSE_ENFORCEMENT` | configuration | development | non | — | — | 1 (session.ts…) |
| `NEXT_PUBLIC_DEBUG` | dangerous | release-tooling | non | — | — | 3 (config-blob-setup.cjs…) |
| `NEXT_PUBLIC_GF_BRAND_ACCENT_COLOR` | public-build-configuration | build-time-public | non | — | — | 1 (brand.client.ts…) |
| `NEXT_PUBLIC_GF_BRAND_EXECUTABLE_NAME` | public-build-configuration | build-time-public | non | — | — | 1 (brand.client.ts…) |
| `NEXT_PUBLIC_GF_BRAND_MARKETING_DOMAIN` | public-build-configuration | build-time-public | non | — | — | 1 (brand.client.ts…) |
| `NEXT_PUBLIC_GF_BRAND_PRIMARY_COLOR` | public-build-configuration | build-time-public | non | — | — | 1 (brand.client.ts…) |
| `NEXT_PUBLIC_GF_BRAND_PRIMARY_DARK_COLOR` | public-build-configuration | build-time-public | non | — | — | 1 (brand.client.ts…) |
| `NEXT_PUBLIC_GF_BRAND_PRODUCT_NAME` | public-build-configuration | build-time-public | non | — | — | 1 (brand.client.ts…) |
| `NEXT_PUBLIC_GF_BRAND_SHORT_NAME` | public-build-configuration | build-time-public | non | — | — | 1 (brand.client.ts…) |
| `NEXT_PUBLIC_GF_BRAND_SUPPORT_URL` | public-build-configuration | build-time-public | non | — | — | 1 (brand.client.ts…) |
| `NEXT_PUBLIC_GF_BRAND_TAGLINE` | public-build-configuration | build-time-public | non | — | — | 1 (brand.client.ts…) |
| `NEXT_PUBLIC_GF_BRAND_WORDMARK_PRIMARY` | public-build-configuration | build-time-public | non | — | — | 1 (brand.client.ts…) |
| `NEXT_PUBLIC_GF_BRAND_WORDMARK_SECONDARY` | public-build-configuration | build-time-public | non | — | — | 1 (brand.client.ts…) |
| `NEXT_PUBLIC_VERCEL_BLOB_API_URL` | dangerous | release-tooling | non | — | — | 1 (config-cloud.cjs…) |
| `NEXT_RUNTIME` | runtime-system | runtime-system | non | oui | — | 1 (instrumentation.ts…) |
| `NEXTAUTH_SECRET` | dangerous | both | **oui** | — | oui | 4 (middleware.ts…) |
| `NEXTAUTH_URL` | external | both | **oui** | — | — | 2 (route.ts…) |
| `NODE_ENV` | runtime-system | runtime-system | non | oui | — | 2 (env.ts…) |
| `NODE_INSPECTOR_IPC` | runtime-system | runtime-system | non | oui | — | 1 (protection.ts…) |
| `RATE_LIMIT_ADMIN_MAX` | configuration | server | non | — | — | 1 (rate-limit.ts…) |
| `RATE_LIMIT_ADMIN_WINDOW_SECONDS` | configuration | server | non | — | — | 1 (rate-limit.ts…) |
| `RATE_LIMIT_API_MAX` | configuration | server | non | — | — | 1 (rate-limit.ts…) |
| `RATE_LIMIT_API_WINDOW_SECONDS` | configuration | server | non | — | — | 1 (rate-limit.ts…) |
| `RATE_LIMIT_LICENSE_ACTIVATE_MAX` | configuration | server | non | — | — | 1 (rate-limit.ts…) |
| `RATE_LIMIT_LICENSE_ACTIVATE_WINDOW_SECONDS` | configuration | server | non | — | — | 1 (rate-limit.ts…) |
| `RATE_LIMIT_LICENSE_STATUS_MAX` | configuration | server | non | — | — | 1 (rate-limit.ts…) |
| `RATE_LIMIT_LICENSE_STATUS_WINDOW_SECONDS` | configuration | server | non | — | — | 1 (rate-limit.ts…) |
| `RATE_LIMIT_LOGIN_MAX` | configuration | server | non | — | — | 1 (rate-limit.ts…) |
| `RATE_LIMIT_LOGIN_WINDOW_SECONDS` | configuration | server | non | — | — | 1 (rate-limit.ts…) |
| `SEED_ADMIN_PASSWORD` | dangerous | development | non | — | — | 2 (seed.ts…) |
| `TEST_POSTGRES_URL` | test-external | test-only | non | oui | — | 2 (licensed-session.postgres.int.test.ts…) |
| `TEST_REDIS_URL` | test-external | test-only | non | oui | — | 1 (rate-limit-multi-instance.int.test.ts…) |
| `TRUST_PROXY_HEADERS` | configuration | server | non | — | — | 1 (rate-limit.ts…) |
| `UPSTASH_REDIS_REST_TOKEN` | external | server | **oui** | — | — | 2 (env.ts…) |
| `UPSTASH_REDIS_REST_URL` | external | server | **oui** | — | — | 2 (env.ts…) |
| `UPSTASH_REDIS_TIMEOUT_MS` | configuration | server | non | — | — | 2 (env.ts…) |
| `VERCEL` | runtime-system | runtime-system | non | oui | — | 2 (setup-dev.js…) |
| `VERCEL_BLOB_API_URL` | dangerous | release-tooling | non | — | — | 1 (config-cloud.cjs…) |
| `VERCEL_TOKEN` | dangerous-external | publisher-only | non | — | — | 1 (configurer-api-garageflow.ps1…) |

## Méthode

Le manifeste est la source de vérité, et il est verrouillé par deux tests :
`env-manifest-drift.test.ts` échoue si une variable lue par le code n'y est pas déclarée
(il a d'ailleurs détecté l'ajout de `GF_VERCEL_PROJECT` au cours de cet audit), et
`env-contract.test.ts` vérifie la cohérence du contrat. `ENVIRONMENT-VARIABLES.md`
est régénéré depuis ce même manifeste par `npm run env:doc`.
