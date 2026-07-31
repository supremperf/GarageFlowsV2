# 14 — Capacités d'intégration

_Document de data room M&A. Vérifié de première main le 2026-07-31._

> Message central : l'**API publique `/api/v1` annoncée est une démo en mémoire non persistante**, pas une plateforme d'intégration en production. Il n'existe **aucun système de webhooks**. Les intégrations réelles et fonctionnelles sont ailleurs : le control-plane licence/update (interne) et deux features IA optionnelles bien abstraites.

## 1. API publique `/api/v1` — état réel : démo non persistante

Le dépôt cloud expose une API REST versionnée (`src/app/api/v1/*`) avec une route OpenAPI (`v1/openapi.json`) couvrant clients, véhicules, factures, devis, pièces, rendez-vous, mécaniciens. **Mais** :

- Le stockage est un **`Map` en mémoire seedé par clé d'API**, **explicitement documenté comme non persistant** (`src/lib/api/store.ts:1-8, 242-256`).
- Sur le déploiement Vercel serverless visé, **les écritures sont perdues à chaque cold start** et **ne sont pas partagées entre lambdas**.
- Le rate limiter de l'API v1 est **in-memory par instance** (`api/auth.ts:48-67`), non distribué — limites sans effet à l'échelle.
- La gestion des clés d'API est **statique par variable d'environnement** : pas de quotas par clé, pas d'émission/révocation sans redéploiement.
- CORS retombe sur `'*'` si `GARAGEFLOW_API_CORS_ORIGIN` n'est pas défini (`api/http.ts:9`), contredisant le commentaire `.env.example`.

**Verdict** : un acquéreur attendant une « API ouverte pour intégrer un logiciel tiers » achète un **bac à sable**. La rendre réelle exige de câbler `store.ts` à la base de données avec autorisation par clé, rate limiting distribué et système de webhooks. **Ne pas valoriser comme surface d'intégration de production.**

## 2. Webhooks / événements sortants — inexistants

Aucun système de webhooks ni de livraison d'événements sortants, malgré le cadrage « intégration ». Le seul « webhook » est le callback `onUploadCompleted` de Vercel Blob, **inactif / no-op** (`blob-upload/route.ts:70-72`).

## 3. Intégrations réelles et fonctionnelles

### 3.1 Control-plane licence/update (interne, opérationnel)
Le vrai socle d'intégration est le protocole desktop ↔ control-plane :
- **Activation / heartbeat / check de licence** — Prisma-backed, ES256/ECDSA, jetons device HMAC, sièges transactionnels, fail-closed. **Opérationnel**, testé.
- **Publication de release + rollout/rollback** — opérationnel (`releases/service.ts`, UI `/admin/updates`).
- **Manifeste d'update signé Ed25519** — opérationnel (émis si clé de signature configurée).
- **Crash reporting** (fingerprinting, groupement, triage) — opérationnel.
- **Modules / entitlements**, **notifications**, **audit** — opérationnels.

C'est une intégration machine-à-machine réelle et sécurisée, mais **privée au produit**, pas une API tierce ouverte.

### 3.2 Features IA optionnelles (opérationnelles, bien isolées)
- **OCR plaque** (`@anthropic-ai/sdk`) — câblé à l'UI, auth-gated, rate-limité, cap de taille ; **503 si `ANTHROPIC_API_KEY` absente** (`plate-ocr/route.ts:23-26`).
- **Lookup plaque avec fallback IA** — API SIV externe d'abord, fallback Claude Haiku seulement si clé configurée, sinon `source:'unknown'` (`plate-lookup/route.ts:52-84`).
- **Copilot** — couche LLM **provider-agnostique** derrière une interface `LlmProvider`, déterministe par défaut (aucun provider bundlé), câblage `AnthropicProvider` documenté comme stub.

**Aucun verrouillage fournisseur IA** : le produit build et fonctionne sans Anthropic. Dépendance externe notable : `plate-lookup` s'appuie sur une API tierce gratuite (`api-immat.com`) **sans SLA contractuel** avant le fallback IA.

### 3.3 Export comptable
- **Export FEC** (`export/fec`) et export CSV de rapports (`src/lib/reports/csv.ts`) — export uniquement. **Pas** d'import (voir `15_PRODUCT_ROADMAP.md`).

## 4. Synthèse — état des capacités d'intégration

| Capacité | État | Note |
|---|---|---|
| API REST publique `/api/v1` | **Non opérationnel** | Démo en mémoire, reset au cold start |
| Webhooks / événements sortants | **Non construit** | Aucun système |
| Protocole control-plane (licence/update/crash) | **Opérationnel** | M2M interne, sécurisé, testé |
| OCR plaque IA (optionnel) | **Opérationnel** | Dégrade proprement sans clé |
| Lookup plaque + fallback IA | **Opérationnel** | Dépendance API tierce sans SLA |
| Copilot LLM (provider-agnostique) | **Partiel** | Interface prête, provider non bundlé |
| Export FEC / CSV | **Opérationnel** | Export seulement |
| Import de données tierces | **Non construit** | Voir roadmap |

## 5. Travaux pour une vraie plateforme d'intégration

1. Câbler `store.ts` à PostgreSQL avec **autorisation par clé** et isolation.
2. **Rate limiting distribué** sur l'API v1 (aligner sur les routes licence fail-closed).
3. **Système de webhooks** (souscriptions, signature HMAC, retries).
4. Émission/révocation de clés d'API **sans redéploiement** ; quotas par clé.
5. Corriger le défaut CORS (`'*'`).

Sans ces travaux, l'« ouverture aux logiciels tiers » reste une promesse marketing non tenue par le code.

---
_Voir aussi : [docs/ACQUISITION_READINESS_AUDIT.md](../ACQUISITION_READINESS_AUDIT.md)._
