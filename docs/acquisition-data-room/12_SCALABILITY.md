# 12 — Scalabilité (analyse architecturale honnête)

_Document de data room M&A. Vérifié de première main le 2026-07-31._

> **Avertissement de méthode — à lire en premier.** Aucun test de charge, benchmark, ni test de performance n'a été réalisé ni trouvé dans les dépôts (pas de k6/Gatling/Locust/Artillery ; pas de suite de perf). Les chiffres cibles ci-dessous sont des **projections architecturales**, pas des mesures. Ils sont explicitement étiquetés PROPOSITION / ESTIMATION et doivent être validés par une campagne de charge réelle avant d'être communiqués à un client.

## 1. Le modèle de scalabilité découle du modèle de déploiement

GarageFlow n'est **pas** un SaaS mono-cluster : c'est un modèle **fan-out**.

| Plan | Charge portée | Facteur d'échelle |
|---|---|---|
| Desktop (SQLite local) | **1 garage par installation** | La charge métier est **distribuée par installation** — chaque poste ne sert qu'un garage. Il n'y a pas de « base métier centrale » à faire scaler. |
| PWA (PostgreSQL) | Multi-tenant `garageId` | Scalabilité SaaS classique (voir §3) |
| Control-plane (PostgreSQL cloud) | **Tous les garages** (licences/updates/crashs) | Le seul plan réellement centralisé ; c'est là que la charge s'agrège. |

**Implication clé** : pour le produit desktop, la scalabilité métier est essentiellement un **non-problème** — SQLite sert confortablement la charge d'un seul atelier. Le vrai sujet de scalabilité est le **control-plane** (activation/heartbeat/crash/release) qui voit le trafic agrégé de tout le parc.

## 2. Control-plane — analyse de charge (garagesite3)

### Points architecturaux favorables (constatés dans le code)
- **Serverless (Vercel)** : les routes scalent horizontalement par nature.
- **Rate limiting distribué fail-closed** (Upstash Redis) sur les routes sensibles licence/admin (`rate-limit-distributed.ts:96-129`) — protège contre l'abus et borne la charge.
- **Application des sièges TOCTOU-safe** via `SELECT ... FOR UPDATE` transactionnel (`licenses/service.ts:411-472`) — correcte sous concurrence.
- **Schéma indexé** : 13 modèles avec `@@index`/`@@unique` appropriés, cascades (`prisma/schema.prisma`).
- **Poll adaptatif desktop** : heartbeat à 2 min en régime normal / 20 s si bloqué (`verified-facts.md`) — limite la pression de heartbeat sur le control-plane.

### Goulets & limites réels
- **SSE en serverless** : le dashboard admin temps réel a une durée de connexion limitée en serverless ; un fallback polling existe (`stream/route.ts:11-14`). N'est pas un vrai canal temps réel durable à grande échelle.
- **Rate limiter de l'API `/api/v1`** : **in-memory par instance** (`api/auth.ts:48-67`) — inefficace en serverless multi-instances. (Mais l'API v1 est de toute façon une démo, cf. `14_INTEGRATION_CAPABILITIES.md`.)
- **Auto-rollback** : dépend d'un cron (câblé cette session via `vercel.json`) — pas un mécanisme temps réel.
- **PostgreSQL** : point de centralisation ; le pooling de connexions serverless (PgBouncer/`directUrl`) doit être dimensionné — non prouvé sous charge.

## 3. PWA multi-tenant — considérations

La variante PWA fait tourner le code métier sur PostgreSQL partagé. Elle hérite des mêmes gardes multi-tenant (prouvées par tests) mais introduit les problématiques SaaS classiques **non traitées aujourd'hui** :
- Pas d'export de métriques (Prometheus/OTel), pas d'IDs de corrélation de requête (`src/lib/logger.ts`) — le triage d'incident à l'échelle est difficile.
- Pas de test de charge du chemin PostgreSQL partagé.

## 4. Cibles proposées (PROPOSITION — à valider par charge réelle)

Ces cibles sont des **objectifs de dimensionnement raisonnables** pour l'architecture observée, **non mesurés** :

| Dimension | Cible proposée | Base du raisonnement |
|---|---|---|
| Parc desktop supporté | 1 000 – 10 000 installations | Le control-plane serverless + Redis borne l'activation/heartbeat ; heartbeat espacé (2 min) |
| Activations/heartbeats simultanés | Limité par Postgres + rate limiter distribué | `SELECT FOR UPDATE` correct mais sérialise par licence |
| Charge métier par garage | Non limitante (SQLite local, 1 atelier) | SQLite sert largement un poste mono-utilisateur/petit-multi |
| Ingestion de crashs | Bornée par le limiter (in-memory public — à durcir) | `crash/route.ts:18-21` |

## 5. Travaux requis avant de revendiquer la scalabilité

1. **Campagne de charge réelle** sur le control-plane (activation/heartbeat/crash) avec Postgres + Redis de prod. — _Prérequis à toute revendication chiffrée._
2. **Dimensionner le pooling PostgreSQL** serverless (`directUrl`/PgBouncer).
3. **Observabilité** : IDs de corrélation + export métriques avant exploitation SaaS.
4. **Durcir les limiters publics** (crash, API v1) en distribué.
5. Remplacer/compléter le SSE serverless par un canal durable si le temps réel admin devient critique.

**Conclusion honnête** : l'architecture est *raisonnablement* taillée pour un modèle fan-out et le control-plane serverless scale bien par construction, mais **aucune scalabilité n'est prouvée par la mesure**. Toute revendication chiffrée est aujourd'hui une projection.

---
_Voir aussi : [docs/ACQUISITION_READINESS_AUDIT.md](../ACQUISITION_READINESS_AUDIT.md)._
