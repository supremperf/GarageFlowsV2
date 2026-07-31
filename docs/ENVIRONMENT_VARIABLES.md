# Variables d'environnement — surface consolidée des deux dépôts

> Document de data room. Consolide la surface de configuration des **deux
> dépôts**, à partir de leurs fichiers `.env.example` suivis par git :
> `GarageFlowsV2/.env.example` (desktop + cible web) et
> `garagesite3/.env.example` (control-plane cloud).
>
> **Aucun secret réel** ne figure ici — uniquement noms, objectifs et
> comportements. Les `.env` réels sont git-ignorés ; les vrais secrets vivent
> dans `.env.local` (dev) ou les variables Vercel scopées par environnement.
> Génération des secrets : `openssl rand -hex 32` ou `openssl rand -base64 32`.

Convention de la colonne « Obligatoire ? » :
- **Prod** = requise en production (démarrage refusé sinon) ;
- **Endpoint** = requise seulement pour la fonctionnalité concernée ;
- **Non** = optionnelle.

## 1. Dépôt `GarageFlowsV2` (desktop Electron + cible web)

Source : `GarageFlowsV2/.env.example`.

| Variable | Objectif | Obligatoire ? | Défaut / comportement si absente |
|---|---|---|---|
| `DATABASE_URL` | Chaîne Prisma. `file:…` → client desktop SQLite ; `postgresql://…` → client serveur PostgreSQL (cible web) | **Prod** | Démarrage **refusé** en prod (instrumentation.ts). En prod web, une URL `file:` est aussi refusée |
| `DIRECT_URL` | URL PostgreSQL **directe** (non poolée) pour `migrate deploy` / `db push` (schéma serveur) | Endpoint (migrations serveur) | Si absente, retombe sur `DATABASE_URL` |
| `NEXTAUTH_URL` | URL de base publique (NextAuth). En Electron, la valeur loopback est injectée | Non (recommandé en prod web) | Flux NextAuth dégradés |
| `NEXTAUTH_SECRET` | Signe/vérifie la session (cookie `gf_session`, HS256) | **Prod** (≥ 32 car.) | Démarrage **refusé** en prod. En dev : généré par `setup-dev.js`. En Electron : secret **unique par installation** |
| `GARAGEFLOW_API_KEY` | Authentifie l'outil admin (keygen) sur `/api/admin/licenses/revoke-by-key` | Endpoint | Si absente/faible (<16), l'endpoint **refuse tout** (fail-closed, 500) |
| `GF_LICENSE_SERVER` | Base HTTPS du serveur officiel de licences interrogé par Electron (activation, heartbeat, révocation, MàJ ; sonde de la grâce 48 h/72 h) | Non (requise en prod packagée) | **Aucun défaut compilé** — plan de contrôle distant désactivé, seul `127.0.0.1` répond |
| `DEVICE_TOKEN_PEPPER` | Clé HMAC-SHA256 des `tokenHash` / `hwidHash` (jamais stockés en clair) | **Prod (web)** | Démarrage **refusé** en prod web. En Electron : repli légitime sur le secret d'installation (mono-poste). Rotation = ré-activation auto des clients |
| `UPSTASH_REDIS_REST_URL` | Rate limiting distribué (compteurs atomiques Lua) | **Prod (web)** | Démarrage **refusé** en prod web ; panne runtime → routes sensibles **503** (fail-closed). Inutile en Electron |
| `UPSTASH_REDIS_REST_TOKEN` | Idem (token REST Upstash) | **Prod (web)** | Idem |
| `RATE_LIMIT_*` | Politiques de rate limiting par catégorie (login, activation, statut, admin, api) | Non | Défauts : login 10/900s · activation 5/900s · statut/heartbeat 60/60s · admin 60/60s · api 120/60s |
| `LICENSE_ENFORCEMENT` | Active/désactive l'application des licences sur les API métier (`on`/`off`) — **dev uniquement** | Non | Prod web : toujours active (ignorée) ; Electron : inactive (contrôle local) ; dev : active par défaut |
| `GF_MIN_ELECTRON_VERSION` | Version minimale acceptée par `/api/license/check` (sinon 426) | Non | Vide = aucun minimum |
| `GF_MIN_PWA_VERSION` | Idem pour la cible web | Non | Vide = aucun minimum |
| `GF_DEVICE_AUTH_DEADLINE` | Fin de tolérance des heartbeats **sans** jeton d'appareil (date RFC3339) | Non | Non définie → jeton **exigé immédiatement** (défaut sûr) ; date future → fenêtre de migration |
| `TRUST_PROXY_HEADERS` | Autorise `x-real-ip`/`x-forwarded-for` derrière un proxy de confiance (hors Vercel, auto-détecté) | Non | Sans proxy de confiance, ces en-têtes forgés sont **ignorés** |
| `GF_PORTAL_SECRET` | Signe les tokens du portail client / signature de devis | Non | Repli sur `NEXTAUTH_SECRET` (jamais de repli codé en dur) |
| `ANTHROPIC_API_KEY` | OCR d'immatriculation / estimation IA | Non | Fonctionnalité IA/OCR **désactivée silencieusement** |
| `GF_UPDATE_SIGNING_KEY` | Clé **privée** Ed25519 de signature des manifestes de MàJ — **serveur de publication uniquement** | Non (recommandé prod) | Ne JAMAIS committer. Client n'embarque que la clé **publique** |
| `GF_UPDATE_SERVER` | Serveur central des mises à jour (Electron) | Non | Par défaut réutilise `GF_LICENSE_SERVER` |
| `GF_UPDATE_CHANNEL` | Canal de mise à jour (`stable`/`beta`) | Non | `stable` |
| `GF_INTEGRITY_MODE` | Vérification d'intégrité au démarrage (`audit`/`enforce`/`off`) | Non | `audit` (journalise). Passer à `enforce` après validation d'un build |
| `GF_ANTIDEBUG` | Blocage si débogueur détecté (`1` = enforce) | Non | `0` |

## 2. Dépôt `garagesite3` (control-plane cloud)

Source : `garagesite3/.env.example`.

| Variable | Objectif | Obligatoire ? | Défaut / comportement si absente |
|---|---|---|---|
| `DATABASE_URL` | PostgreSQL **poolé** (runtime des licences — source de vérité) | **Prod** (≥ 20 car.) | Démarrage **refusé** en prod |
| `DIRECT_DATABASE_URL` | PostgreSQL **direct** (non poolé) pour `migrate deploy/dev` | Endpoint (migrations) | Migrations impossibles sans elle |
| `LICENSE_ADMIN_API_KEY` | Clé admin des routes `/api/admin/*` (en-tête `x-gf-key`) | **Prod** (≥ 24 car.) | Démarrage **refusé** en prod |
| `NEXTAUTH_SECRET` | Secret de session (vérif du cookie `gf_session`) | **Prod** (≥ 16 car.) | Démarrage **refusé** en prod |
| `DEVICE_TOKEN_SECRET` | HMAC des jetons d'appareil | **Prod** (≥ 32 car.) | Démarrage **refusé** en prod. Dev : repli sur `NEXTAUTH_SECRET` toléré |
| `HWID_HMAC_SECRET` | HMAC des HWID (jamais de HWID brut en base) | **Prod** (≥ 32 car.) | Démarrage **refusé** en prod. Dev : repli toléré |
| `UPSTASH_REDIS_REST_URL` | Rate limiting distribué (fail-closed) | **Prod** | Démarrage **refusé** en prod ; panne → routes sensibles **503** |
| `UPSTASH_REDIS_REST_TOKEN` | Idem | **Prod** (≥ 16 car.) | Idem |
| `GF_PRIVATE_KEY` | (Optionnel) base64 PKCS8 PEM de la clé privée ECC pour signature côté serveur | Non | Vide = le Keygen est le seul signeur (recommandé) |
| `GARAGEFLOW_API_KEYS` | Clés de l'API de **démo** publique `/api/v1/*` (bac à sable non persistant) | Endpoint (démo) | Sans clé, l'API démo refuse. **⚠ Ne pas utiliser pour de vraies données** |
| `GARAGEFLOW_API_CORS_ORIGIN` | Origine CORS autorisée pour `/api/v1` (sans slash final) | Non | ⚠ **Défaut `*`** dans le code (`src/lib/api/http.ts:9`) — contredit le commentaire `.env.example` qui annonce un « refus ». Blast radius limité (API démo) |
| `GARAGEFLOW_API_RATE_LIMIT` | Plafond de requêtes de l'API démo | Non | Rate limiter **par instance** (non distribué) pour `/api/v1` |
| `NEXT_PUBLIC_SITE_URL` | URL publique de la vitrine (SEO, canonical, sitemap) | Non (recommandé) | Voir `src/lib/domains.ts` |
| `NEXT_PUBLIC_API_URL` | URL publique de l'API | Non | idem |
| `NEXT_PUBLIC_APP_URL` | URL publique de la PWA | Non | idem |
| `NEXT_PUBLIC_CONTACT_EMAIL` | E-mail de contact affiché | Non | idem |
| `NEXT_PUBLIC_PRODUCT_NAME` | Nom produit surchargeable (white-label, ajouté en session) | Non | Défaut `src/lib/site.ts` |
| `NEXT_PUBLIC_CONTACT_PHONE` / `_WHATSAPP` / `_ADDRESS` / `_DEMO_URL` / `_HOSTING_PROVIDER` | Coordonnées / contenu vitrine | Non | **Vide = non affiché** (jamais de valeur inventée) |
| `NEXT_PUBLIC_SOCIAL_*` | Liens réseaux sociaux (LinkedIn, X, Instagram, YouTube, Facebook) | Non | N'affiche que les liens renseignés |
| `NEXT_PUBLIC_LEGAL_*` | Identité légale (raison sociale, forme, capital, RCS, SIREN, TVA, directeur) | Non | Chaque ligne affichée seulement si renseignée |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | Envoi des leads de contact + confirmation newsletter | Non | Sans SMTP : leads **enregistrés en base**, échec journalisé (jamais de perte), mais aucun e-mail envoyé |
| `LEADS_NOTIFY_EMAIL` | Destinataire des notifications de nouveaux leads | Non | Défaut : `NEXT_PUBLIC_CONTACT_EMAIL` |
| `BLOB_READ_WRITE_TOKEN` | Upload direct des `.exe` via Vercel Blob | Non | Sans lui : route **501** ; l'option « fournir un lien » reste disponible |
| `UPDATE_SIGNING_KEY_ID` | Identifiant de la clé de signature des MàJ | Non (recommandé prod) | Sans elle, pas de manifeste signé |
| `UPDATE_SIGNING_PRIVATE_KEY` | Clé **privée** Ed25519 (base64 PKCS8 PEM) de signature des MàJ | Non (recommandé prod) | Sans elle, aucun manifeste signé servi → le client refuse d'installer. **JAMAIS committer** |
| `CRON_SECRET` | Authentifie le cron `/api/cron/rollback-check` (fail-closed) | Non (recommandé prod) | Sans en-tête valide, la route de rollback **refuse** la requête |

## 3. Notes transversales de sécurité

- **Aucun secret par défaut** n'est codé en dur. Un secret absent ou faible
  **bloque le démarrage** en production (`src/lib/env.ts` via
  `instrumentation.ts`) dans les deux dépôts.
- Les clés privées de signature (**licences ECC P-256** et **mises à jour
  Ed25519**) sont des **secrets externes** absents du dépôt par conception —
  éléments de transfert du deal, pas du code.
- `DEVICE_TOKEN_SECRET` / `HWID_HMAC_SECRET` distincts permettent une **rotation
  indépendante** de `NEXTAUTH_SECRET`.
- Les `.env.example` des deux dépôts sont exemplaires : chaque variable documente
  objectif · environnement · obligatoire · exemple fictif · comportement si
  absente.

---
*Voir aussi : [`docs/ACQUISITION_READINESS_AUDIT.md`](./ACQUISITION_READINESS_AUDIT.md) pour l'audit complet de préparation à la cession.*
