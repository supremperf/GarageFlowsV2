# Guide de configuration — variables d'environnement GarageFlow

Inventaire **exhaustif** des variables réellement lues par le code
(`grep process.env`), par produit, avec obligation, environnement et
comportement si absente. Aucune valeur secrète réelle ne figure ici.

> Règle générale : **fail-closed en production**. `src/lib/env.ts` (les deux
> repos) **refuse le démarrage** si une variable critique est absente, trop
> courte ou générique. Générer un secret fort : `openssl rand -base64 32`.

---

## 1. GarageFlow Desktop / app (`GarageFlowsV2`)

### 1.1 Base de données & auth (cœur)

| Variable | Obligatoire | Environnement | Rôle / comportement si absente |
|---|---|---|---|
| `DATABASE_URL` | ✅ | tous | `file:…` → client SQLite (desktop/dev) ; `postgresql://…` → client serveur (PWA). En prod PWA, SQLite est **refusé** (`env.ts`). |
| `DIRECT_URL` | ✅ (PWA) | serveur/PWA | Connexion PostgreSQL **directe** (non poolée) pour `prisma migrate`. |
| `NEXTAUTH_SECRET` | ✅ | tous | Signe les sessions NextAuth + JWT `gf_session`. Sous Electron, un secret **unique par machine** est généré si absent. En prod PWA : **refus** si faible/absent. |
| `NEXTAUTH_URL` | ✅ | tous | URL de base NextAuth. |
| `ELECTRON` | — | desktop | `=1` sous Electron : active le mode desktop (SQLite autorisé, licence contrôlée localement). Posé par `electron/main.js`. |
| `LICENSE_ENFORCEMENT` | — | serveur/PWA | Active la validation de session licenciée (fail-closed) hors Electron. |

> **Note d'architecture.** Le cahier des charges évoquait `DESKTOP_DATABASE_URL`
> pour le desktop. L'implémentation retenue utilise **un seul `DATABASE_URL`**,
> le client Prisma étant choisi d'après le **schéma** de l'URL (`file:` vs
> `postgresql:`), voir `src/lib/db.ts`. C'est structurellement sûr (impossible
> d'utiliser SQLite contre Postgres) et `env.ts` interdit SQLite en prod PWA.
> Déviation documentée et **acceptée**.

### 1.2 Sécurité / licences / secrets serveur

| Variable | Obligatoire | Rôle |
|---|---|---|
| `GF_PRIVATE_KEY` | opérateur uniquement | Clé privée (base64 PEM) de **génération** de licences (route admin serveur). **Jamais** dans le client desktop (vérifié : non référencée dans `electron/`). |
| `GF_SIGNATURE_SECRET` | ✅ (si signatures) | Secret de signature applicative. |
| `GF_PORTAL_SECRET` | ✅ (portail) | Signe les tokens du portail client. |
| `GF_DB_MAC_SECRET` | ✅ (desktop) | MAC d'intégrité des enregistrements SQLite locaux. |
| `GF_INTERNAL_EXPORT_KEY` / `X-Internal-Key` | ✅ (interne) | Protège `POST /api/internal/migrate` et `/api/internal/export`. |
| `DEVICE_TOKEN_PEPPER` | ✅ (prod PWA) | Pepper HMAC des jetons d'appareil. **Refus** au démarrage si faible en prod PWA. |
| `GF_BACKUP_KEY` | optionnel | Clé AES-256 (base64, 32 o) des sauvegardes chiffrées. Si présente mais faible → **exception** (aucun repli codé en dur). |

### 1.3 Rate limiting (prod PWA multi-instance)

| Variable | Obligatoire | Rôle |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | ✅ (prod PWA) | Limiteur **distribué**. Absent en prod PWA → **refus** (sinon fail-closed permanent 503). |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ (prod PWA) | Idem. |
| `RATE_LIMIT_LOGIN_MAX` / `RATE_LIMIT_LOGIN_WINDOW_SECONDS` | optionnel | Réglage fin (défauts sûrs). |
| `TRUST_PROXY_HEADERS` | optionnel | Autorise `X-Forwarded-For` derrière un proxy de confiance (IP client). |

### 1.4 Mises à jour, IA, divers

| Variable | Rôle |
|---|---|
| `GF_UPDATE_SERVER` / `GF_UPDATE_CHANNEL` / `GF_MIN_ELECTRON_VERSION` / `GF_MIN_PWA_VERSION` | Serveur/canal/plancher de version des mises à jour. |
| `GF_LICENSE_SERVER` | URL du control-plane de licences (`api.garageflows.fr`). |
| `ANTHROPIC_API_KEY` / `GARAGEFLOW_LLM` | Copilot IA (optionnel — dégradation propre si absent). |
| `GF_PHOTOS_DIR` / `GF_BACKUP_DIR` / `GF_APP_DATA` | Emplacements de stockage local (desktop). |
| `GF_INTEGRITY_MODE` / `GF_ANTIDEBUG` / `GF_ALLOW_DEBUG` | Durcissement Electron (anti-debug, intégrité des ressources). |
| `GARAGEFLOW_API_KEY` | Clé d'accès API inter-services. |

### 1.5 Tests (jamais en prod)

`TEST_POSTGRES_URL`, `TEST_REDIS_URL` — activent les suites d'intégration.

---

## 2. Control-Plane / Vitrine / PWA (`garagesite3`)

### 2.1 Cœur (validés par `src/lib/env.ts`, fail-closed prod)

| Variable | Obligatoire | Min | Rôle |
|---|---|---|---|
| `DATABASE_URL` | ✅ | 20 | PostgreSQL/Neon **poolée** (runtime applicatif). |
| `DIRECT_DATABASE_URL` | ✅ | — | PostgreSQL/Neon **directe** (migrations). |
| `NEXTAUTH_SECRET` | ✅ | 16 | Secret de session. |
| `LICENSE_ADMIN_API_KEY` | ✅ | 24 | Protège toutes les routes `/api/admin/*` (comparaison temps constant). |
| `DEVICE_TOKEN_SECRET` | ✅ prod | 32 | Signature des jetons d'appareil (repli `NEXTAUTH_SECRET` **dev seulement**). |
| `HWID_HMAC_SECRET` | ✅ prod | 32 | Hachage HWID (repli `NEXTAUTH_SECRET` **dev seulement**). |
| `UPSTASH_REDIS_REST_URL` | ✅ prod | https | Limiteur distribué (sinon 503 fail-closed permanent). |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ prod | 16 | Idem. |

### 2.2 Mises à jour signées

| Variable | Rôle |
|---|---|
| `UPDATE_SIGNING_PRIVATE_KEY` | Clé privée de **signature des manifestes** de mise à jour (serveur uniquement). |
| `UPDATE_SIGNING_KEY_ID` | Identifiant de clé (rotation). |
| `GF_PRIVATE_KEY` | Clé privée de génération de licences (serveur uniquement). |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob (stockage des binaires de mise à jour). |

### 2.3 API v1 (bac à sable de démonstration)

| Variable | Rôle |
|---|---|
| `GARAGEFLOW_API_KEYS` / `GARAGEFLOW_API_KEY` | Clés d'accès à l'API `/api/v1/*` (démo). |
| `GARAGEFLOW_API_CORS_ORIGIN` | Origine CORS autorisée. |
| `GARAGEFLOW_API_RATE_LIMIT` | Plafond de requêtes. |

> ⚠️ `/api/v1/*` est un **bac à sable en mémoire** (données de démonstration,
> non persistées, non partagées entre instances) — voir `src/lib/api/store.ts`.
> Ne pas le confondre avec l'API métier réelle (portée par `GarageFlowsV2`).

### 2.4 E-mail (SMTP) & marketing

| Variable | Rôle |
|---|---|
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | Envoi d'e-mails (contact, newsletter, leads). |
| `LEADS_NOTIFY_EMAIL` | Destinataire des notifications de leads. |
| `NEXT_PUBLIC_*` (SITE_URL, CONTACT_*, LEGAL_*, SOCIAL_*, …) | Contenu **public** de la vitrine (non secret). |

---

## 3. Où configurer

| Cible | Emplacement |
|---|---|
| Dev local (desktop) | `.env` (généré par `setup-dev.js`, **gitignoré**) |
| Dev local (site) | `.env` / `.env.local` (**gitignoré**) |
| Production Vercel (site) | Project Settings → Environment Variables |
| Neon | Chaîne poolée → `DATABASE_URL` ; directe → `DIRECT_DATABASE_URL` |
| Electron packagé | Injecté à l'exécution par `electron/main.js` (aucun `.env` packagé) |
| CI | Secrets du dépôt / du workflow (jamais commités) |

**Aucune valeur secrète réelle ne doit être ajoutée à `.env.example` ni commitée.**
