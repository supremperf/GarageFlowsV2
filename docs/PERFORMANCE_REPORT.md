# Rapport de performance — GarageFlow

_Document de data room M&A. Vérifié de première main le 2026-07-31._

## 0. Avertissement d'honnêteté (à lire en premier)

> **AUCUN test de charge, benchmark ni mesure de performance n'a été exécuté sur GarageFlow.** Ce document ne contient **aucun chiffre mesuré**. Il décrit les **caractéristiques architecturales de montée en charge** (déduites du code et des schémas) et propose un **plan de test** ainsi que des **cibles de performance PROPOSÉES**. Tout ce qui est chiffré ci-dessous est explicitement étiqueté **[PROPOSÉ]** et n'a pas valeur de mesure.

## 1. Modèle de déploiement et ce qu'il implique pour la performance

GarageFlow n'est **pas** un SaaS mono-cluster ; c'est une architecture à deux plans dont les profils de charge sont très différents :

| Plan | Techno | Base | Profil de charge |
|---|---|---|---|
| **Desktop / PWA** (`GarageFlowsV2`) | Electron + Next.js 14 standalone, serveur bouclé sur `127.0.0.1:4028` | **SQLite** locale, une base par installation | Charge = **un seul garage** par processus. Pas de contention multi-locataire ; la « montée en charge » se mesure en volume de données d'un garage, pas en nombre de garages. |
| **Cloud control-plane** (`garagesite3`) | Next.js 15 App Router sur Vercel (serverless) | **PostgreSQL** partagé | Charge = **N garages** appelant activation/heartbeat/check/crash/release. C'est le seul plan réellement multi-tenant et le seul où « 1/10/100/1000 garages » a un sens. |

**Conséquence de conception** : chaque installation desktop porte sa propre base SQLite. Le débit transactionnel du plan desktop ne dépend donc **pas** du nombre de clients vendus — il n'y a pas de base opérationnelle centrale à saturer. Le goulot de scalabilité réel se situe sur le control-plane cloud (heartbeats/checks distribués) et sur son backend Redis/Postgres.

## 2. Index connus (lus dans les schémas Prisma)

Les schémas sont correctement indexés sur les colonnes de filtrage/tri chaudes. Extraits vérifiés dans `prisma/schema.prisma` (desktop) et `garagesite3/prisma/schema.prisma` (cloud).

### 2.1 Desktop — `prisma/schema.prisma` (37 modèles)
Chaque modèle opérationnel est scopé par `garageId` avec index composites orientés requêtes :

| Modèle | Index / contraintes notables |
|---|---|
| `Client` | `@@index([garageId])`, `@@index([garageId, name])` |
| `Vehicle` | `@@unique([licensePlate, garageId])`, `@@index([garageId])`, `@@index([clientId])`, `@@index([garageId, updatedAt])` |
| `Job` | `@@index([garageId])`, `@@index([garageId, date])`, `@@index([garageId, status])`, `@@index([mechanicId])` |
| `Quote` | `@@unique([garageId, number])`, `@@index([garageId, status])`, `@@index([clientId])` |
| `Invoice` | `@@unique([garageId, number])`, `@@index([garageId, status])`, `@@index([clientId])`, `@@index([garageId, createdAt])` |
| `WorkOrder` / `PurchaseOrder` | `@@unique([garageId, number])`, `@@index([garageId, status])` |
| `Warranty` | `@@index([garageId, status])`, `@@index([garageId, expiresAt])` |
| `AuditLog` | `@@index([garageId, createdAt])`, `@@index([entityType, entityId])`, `@@index([garageId, entityType])` |
| `Appointment` | `@@index([garageId, date])`, `@@index([portalUserId])` |
| `LicenseDevice` | `@@unique([licenseId, hwidHash])`, `@@index([licenseId, status])` |

### 2.2 Cloud — `garagesite3/prisma/schema.prisma` (13 modèles)
| Modèle | Index notables |
|---|---|
| `LicenseKey` | `@@index([status])`, `@@index([customerId])`, `@@index([expiryAt])`, `@@index([hwid])`, `@@index([status, expiryAt])`, `@@index([lastSeenAt])` |
| `Device` | `@@unique([licenseId, hwidHash])`, `@@index([licenseId])`, `@@index([hwidHash])`, `@@index([status])`, `@@index([deviceId])` |
| `AppRelease` | `@@unique([channel, version])`, `@@index([channel, status, publishedAt])` |
| `CrashReport` | `@@index([fingerprint, createdAt])`, `@@index([licenseId])`, `@@index([appVersion])`, `@@index([handled])` |
| `AuditLog` | `@@index([category, createdAt])`, `@@index([action, createdAt])`, `@@index([licenseId, createdAt])` |
| `Notification` | `@@index([status, startsAt])`, `@@index([targetType, targetValue])` |

**Lecture** : les requêtes chaudes du control-plane (recherche de licence par clé/HWID/statut, activation, heartbeat, publication de release, groupement de crashs par fingerprint) sont adossées à des index dédiés. Il n'y a pas de trou d'index évident sur les chemins critiques.

## 3. Caractéristiques de montée en charge (déduites, non mesurées)

### 3.1 Atouts structurels
- **Verrou pessimiste transactionnel** sur l'application de licence : la séquence activate/count/create tourne dans une transaction ouverte par `SELECT ... FOR UPDATE` avec re-comptage de contrôle (`garagesite3/src/lib/licenses/service.ts:411-472`). Correct pour la cohérence, mais sérialise les activations concurrentes **par licence** (contention bornée à une même licence, pas globale).
- **Rate limiting distribué fail-closed** via Upstash Redis sur les routes licence/admin (`rate-limit-distributed.ts`) — protège le control-plane contre les rafales.
- **Heartbeat adaptatif** côté desktop : sondage 2 min en régime normal / 20 s si bloqué (voir `verified-facts.md`), ce qui **lisse** la charge de heartbeat côté serveur.
- **SQLite locale** : lectures/écritures d'un garage sans latence réseau ni contention inter-tenant.

### 3.2 Risques de performance connus / N+1
- **Risque N+1 à auditer** : les handlers de listes (jobs, invoices, quotes avec lignes et relations client/véhicule) doivent être vérifiés pour l'usage systématique d'`include`/`select` Prisma plutôt que de requêtes en boucle. **Aucun profilage n'a été fait** ; c'est un point de vérification, pas un défaut constaté.
- **SSE serverless** : le flux temps-réel admin (`/api/admin/stream`) a une durée de connexion limitée en serverless ; un fallback polling existe sur `/api/admin/stats`. À charge élevée d'admins connectés, privilégier le polling.
- **Rate limiter v1 non distribué** : le limiteur de l'API publique `/api/v1` est un `Map` en mémoire par instance (`api/auth.ts:48-67`), donc non borné entre lambdas. Peu d'impact aujourd'hui car l'API v1 est un bac à sable en mémoire (voir §5), mais deviendra un enjeu si elle est rendue persistante.
- **Absence d'export de métriques** : pas de Prometheus/OTel, pas de corrélation-ID de requête (`src/lib/logger.ts`). Le triage d'incident de perf en production sera difficile sans instrumentation supplémentaire.

## 4. Cibles PROPOSÉES et plan de test 1 / 10 / 100 / 1000 garages

> Toutes les valeurs ci-dessous sont **[PROPOSÉ]** — objectifs de conception à valider, **non mesurés**.

### 4.1 Périmètre de test
Le test « 1/10/100/1000 garages » vise le **control-plane cloud**, seul plan multi-tenant. Le plan desktop se teste séparément par **volume de données d'un garage** (voir §4.4).

### 4.2 Cibles de charge control-plane **[PROPOSÉ]**

| Échelle | Devices actifs (≈2/garage) | Heartbeats/min (2 min de cycle) | Cible p95 latence `check`/`activate` **[PROPOSÉ]** | Cible taux d'erreur **[PROPOSÉ]** |
|---|---|---|---|---|
| 1 garage | ~2 | ~1 | < 150 ms | 0 % |
| 10 garages | ~20 | ~10 | < 200 ms | < 0,1 % |
| 100 garages | ~200 | ~100 | < 300 ms | < 0,1 % |
| 1000 garages | ~2000 | ~1000 | < 500 ms | < 0,5 % |

Hypothèses : 2 devices/garage, heartbeat 2 min, Postgres géré + Upstash Redis correctement dimensionnés. **À confirmer par mesure.**

### 4.3 Plan d'exécution proposé
1. **Outil** : k6 ou Artillery contre un environnement de staging isolé (jamais la prod).
2. **Scénarios** : (a) rafale d'activation (verrou `FOR UPDATE` par licence), (b) heartbeat soutenu au débit du tableau, (c) `check` en lecture pure, (d) publication de release + `rollout-check` cron horaire, (e) ingestion de crashs.
3. **Montée** : paliers 1 → 10 → 100 → 1000 garages simulés, 10 min par palier, rampe de 1 min.
4. **Métriques à capturer** : p50/p95/p99 par route, taux d'erreur, saturation Redis (fail-closed 503 = signal), connexions Postgres, temps de `SELECT FOR UPDATE`.
5. **Critères d'arrêt** : p95 > cible, taux d'erreur > cible, ou 503 fail-closed Redis soutenus.

### 4.4 Plan de test desktop (par garage) proposé
Générer des jeux SQLite de taille croissante (ex. 1k / 10k / 100k jobs, invoices, véhicules) et mesurer la latence des handlers de listes et du dashboard. Objectif : détecter les N+1 et valider que les index composites `@@index([garageId, ...])` tiennent le volume d'un gros garage sur plusieurs années.

## 5. Rappel de périmètre : l'API `/api/v1` n'est PAS un plan de production

L'API REST publique `/api/v1` (clients, véhicules, factures, devis…) est un **bac à sable en mémoire non persistant** (`garagesite3/src/lib/api/store.ts`) qui se réinitialise à chaque cold start serverless et ne partage pas d'état entre lambdas. **Aucun test de performance ne doit lui être appliqué comme s'il s'agissait d'une surface d'intégration réelle** — elle est fonctionnellement une démo. La rendre réelle (persistance DB + rate limiting distribué) est un prérequis avant tout dimensionnement.

## 6. Caveats

- Aucun benchmark, test de charge ou profilage n'a été exécuté ; toutes les cibles sont proposées et non validées.
- L'état de déploiement production réel sur Vercel (dimensionnement Postgres/Redis, config env) n'a pas pu être observé.
- Les risques N+1 sont signalés comme points de vérification et non comme défauts mesurés.

---
_Voir aussi : [docs/ACQUISITION_READINESS_AUDIT.md](./ACQUISITION_READINESS_AUDIT.md)._
