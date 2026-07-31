# Référence API

> Document de data room — diligence technique M&A.
> Deux surfaces distinctes sont documentées : (A) l'**API publique `/api/v1`** du plan de contrôle cloud (garagesite3), et (B) les **API internes** de l'application desktop.

---

## A. API publique `/api/v1` (garagesite3)

### ⚠️ AVERTISSEMENT SANS DÉTOUR — bac à sable non persistant

L'API publique REST `/api/v1` **n'est PAS une API de production**. C'est une **démonstration en mémoire** :

- Les données sont **pré-remplies (seed) au démarrage du serveur** et **ne sont pas persistées durablement**, ni partagées entre instances. Source : commentaire explicite en tête de `src/lib/api/store.ts:1-8` : *« Bac à sable : les données … ne sont pas persistées durablement (ni partagées entre instances) … à brancher sur une vraie base de données pour la production. »*
- Le stockage est une `Map` en mémoire (`store.ts:242-256`), **partitionnée par clé d'API** (chaque clé ne voit que sa propre copie amorcée — pas de fuite inter-tenant, mais pas de persistance).
- Sur le déploiement Vercel serverless visé, cela signifie : **perte des écritures à chaque cold start** et **incohérence entre lambdas**.
- La limitation de débit `/api/v1` est une `Map` **en mémoire par instance** (`src/lib/api/auth.ts:48-67`) — donc **non distribuée**, contrairement aux routes de licence qui utilisent Upstash Redis fail-closed.

**Conclusion pour l'acquéreur** : cette API est vendable comme *preuve de faisabilité d'intégration*, **pas** comme service de données opérationnel. La rendre réelle suppose de brancher `store.ts` sur PostgreSQL/Prisma et de passer le rate-limiter en Redis distribué (effort d'ingénierie matériel).

### A.1 Authentification
- **Par clé d'API**, jamais en base ni dans le code : les clés valides proviennent de la variable d'environnement `GARAGEFLOW_API_KEYS` (liste séparée par virgules). Source : `src/lib/api/auth.ts:14-22`.
- Deux en-têtes acceptés (`auth.ts:24-32`) :
  - `Authorization: Bearer <clé>`
  - `X-Api-Key: <clé>`
- **Mode déduit du préfixe de clé** : `gf_live_…` → `live`, sinon `test` (`auth.ts:120`). Il n'y a **pas** d'émission/révocation de clé sans redéploiement, ni de quota par clé au-delà du débit global.
- Si aucune clé n'est configurée côté serveur → `500 internal_error`. Clé absente → `401`. Clé invalide → `401`.

### A.2 Limites de débit
- Fenêtre glissante simple : `GARAGEFLOW_API_RATE_LIMIT` requêtes par **60 s** (défaut **120**). Source : `auth.ts:48-67`.
- En-têtes renvoyés à chaque réponse : `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
- Dépassement → `429 rate_limited`.
- **Limite architecturale** : compteur par instance, non distribué (voir avertissement).

### A.3 Enveloppe de réponse et en-têtes
Source : `src/lib/api/http.ts`.
- Succès unitaire : `{ "data": … }`.
- Liste : `{ "object": "list", "data": [...], "pagination": { total, limit, offset, has_more } }`.
- Erreur : `{ "error": { "code", "message", "details?" } }`.
- En-têtes communs : `Cache-Control: no-store`, `X-GarageFlow-Api-Version: 1.0`, en-têtes CORS.
- **CORS** : `Access-Control-Allow-Origin` = `GARAGEFLOW_API_CORS_ORIGIN` **ou `*` par défaut** si non défini (`http.ts:9`) — à noter comme risque de configuration (le `.env.example` laisse entendre un refus par défaut, ce qui est contredit par le code).
- Pagination bornée : `limit` ∈ [1,100] (défaut 20), `offset` ≥ 0 (`http.ts:97-107`).

### A.4 Codes d'erreur
| Code | HTTP |
|---|---|
| `unauthorized` | 401 |
| `forbidden` | 403 |
| `not_found` | 404 |
| `invalid_request` | 400 |
| `method_not_allowed` | 405 |
| `rate_limited` | 429 |
| `internal_error` | 500 |

### A.5 Points d'accès

**Méta / service**
- `GET /api/v1` — index (nécessite une clé valide) : liste des ressources + pointeur OpenAPI. Source : `src/app/api/v1/route.ts`.
- `GET /api/v1/ping` — disponibilité (sécurité désactivée dans l'OpenAPI).
- `GET /api/v1/me` — contexte de la clé : `{ object:"api_key", key:<masquée>, mode, authenticated:true }`. Source : `src/app/api/v1/me/route.ts`.
- `GET /api/v1/openapi.json` — spécification **OpenAPI 3.1.0** générée dynamiquement à partir des définitions de ressources (`src/app/api/v1/openapi.json/route.ts`). Sécurité : `bearerAuth` / `apiKeyHeader`.

**Ressources CRUD** (mêmes verbes pour chacune ; handlers génériques `collectionRoute`/`itemRoute` dans `src/lib/api/resource.ts`) :

| Ressource | Objet | Champs clés (source `store.ts`) |
|---|---|---|
| `clients` | `client` | name*, email, phone, address, company |
| `vehicles` | `vehicle` | client_id* (ref), make*, model*, plate*, vin, year, mileage |
| `mechanics` | `mechanic` | name*, role, active |
| `appointments` | `appointment` | vehicle_id* (ref), client_id (ref), mechanic_id (ref), service*, status (enum), scheduled_at, duration_min |
| `quotes` | `quote` | client_id* (ref), vehicle_id (ref), number, status (enum), lines[], total_ht (lecture seule), total_ttc (lecture seule), vat_rate |
| `invoices` | `invoice` | client_id* (ref), vehicle_id (ref), quote_id (ref), number, status (enum), amount_ttc*, issued_at, due_at |
| `parts` | `part` | sku*, name*, stock, threshold, price |

`*` = requis. Verbes par ressource :
- `GET /api/v1/<ressource>` — liste paginée, filtres d'égalité simples sur champs connus (`resource.ts:49-62`).
- `POST /api/v1/<ressource>` — création (validation des types + champs requis + vérification des références `ref` existantes) → `201`.
- `GET /api/v1/<ressource>/{id}` — lecture → `200` / `404`.
- `PATCH /api/v1/<ressource>/{id}` — mise à jour partielle → `200` / `404`.
- `DELETE /api/v1/<ressource>/{id}` — suppression → `{ id, object, deleted:true }` / `404`.
- `OPTIONS` — préflight CORS `204`.

Les champs marqués `readonly` (ex. `total_ht`, `total_ttc` des devis) sont **calculés côté serveur** (`store.ts:computeTotals`) et ignorés en entrée.

### A.6 Exemple
```bash
curl -H "Authorization: Bearer gf_test_xxx" https://<host>/api/v1/clients?limit=20
# → { "object":"list", "data":[…], "pagination":{ "total":3,"limit":20,"offset":0,"has_more":false } }
```
Rappel : toute écriture est **volatile** (voir §Avertissement).

### A.7 Ce qui N'EXISTE PAS sur cette API
- Pas de persistance base de données. Pas de webhooks (voir WEBHOOKS.md — conception uniquement).
- Pas d'émission/rotation de clés en libre-service. Pas de RBAC. Pas de pagination par curseur. Pas de recherche plein-texte. Pas de filtres avancés (uniquement égalité stricte).

---

## B. API internes de l'application desktop (garagesite / GarageFlowsV2)

> Conceptuel : ces routes servent l'UI locale, **pas** une intégration tierce. Elles ne sont **pas** exposées sur le réseau : le serveur Next.js standalone est lié **strictement à `127.0.0.1:4028`** (loopback) à l'intérieur d'Electron (`electron/main.js`). 125 routes `route.ts` au total.

### B.1 Modèle d'authentification interne
- **Session** applicative (NextAuth), un `garageId` par session ; garde de tenant typée `src/lib/tenant.ts`.
- Enveloppe `withAuth` + `requireSession` (`src/lib/api-helpers.ts`) sur les routes métier.
- Limitation de débit locale via `src/lib/security/rate-limit.ts` (ex. `enforceRateLimit('api', …, { max, windowSec })`).
- Endpoints internes sensibles (export/migrate) protégés par une **clé aléatoire générée par exécution** (loopback + clé), jamais exposée au LAN.

### B.2 Familles de routes (illustratif, non exhaustif)
- **Métier** : clients, véhicules, ordres de réparation, devis (`/api/quotes`), factures (`/api/invoices` — numérotation transactionnelle, immutabilité une fois émis), opérations de main-d'œuvre, pièces/stock, fournisseurs, rendez-vous/planning, tableau de bord.
- **Enrichissement véhicule** : `GET /api/vin`, `GET /api/plate-lookup?plate=…` (authentifiée, rate-limitée, appel sortant SIV puis repli IA — voir INTEGRATION_ARCHITECTURE.md), `/api/plate-ocr`.
- **Import** : `POST /api/labor-operations/bulk-import` (unique import en lot, périmètre étroit — voir DATA_MIGRATION_GUIDE.md).
- **Export** : `GET /api/export/fec` (export comptable FEC).
- **Copilot** : assistant déterministe, provider LLM optionnel (voir INTEGRATION_ARCHITECTURE.md).

### B.3 Conventions
- Isolation multi-tenant systématique par `garageId`.
- Montants en centimes entiers.
- Codes HTTP standard ; messages d'erreur en français.

### B.4 Limites
- Pas de version publique stable ni de contrat externe : ces routes peuvent changer sans préavis (API interne).
- L'authentification repose sur la session locale, pas sur des clés d'API tierces.

---

## C. Plan de contrôle (licence / mises à jour) — pointeur
Le cœur de valeur du cloud est le **plan de contrôle** (activation de licence ES256, tokens device HMAC, publication de releases signées Ed25519, crash-reporting, modules, notifications, audit), Prisma/PostgreSQL, fail-closed, couvert par des tests. Il **n'est pas** l'API `/api/v1` publique. Voir `docs/CLOUD_ARCHITECTURE.md`, `docs/LICENSING_ARCHITECTURE.md`.

---
*Voir aussi : [docs/ACQUISITION_READINESS_AUDIT.md](./ACQUISITION_READINESS_AUDIT.md).*
