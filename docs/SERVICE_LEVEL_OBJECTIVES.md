# Objectifs de niveau de service (SLO) — GarageFlow

> **AVERTISSEMENT — CIBLES PROPOSÉES, NON MESURÉES.**
> Ce document décrit des **SLO PROPOSÉS** (targets d'ingénierie) et non des SLA
> contractuels ni des mesures historiques. À ce jour, **aucune télémétrie
> d'uptime/latence n'est agrégée** : il n'existe pas d'export de métriques
> (Prometheus/OpenTelemetry) ni de corrélation de requêtes dans le code (voir
> `docs/OBSERVABILITY.md`). Les chiffres ci-dessous sont des objectifs à
> atteindre après mise en place de la mesure, pas des garanties actuelles.
> Un acquéreur ne doit pas les présenter à des clients comme des engagements.

---

## 1. Périmètre et architecture

GarageFlow se compose de deux surfaces au comportement de disponibilité
radicalement différent :

1. **Application desktop (Electron + Next.js standalone + SQLite)** — s'exécute
   **localement** sur le poste du garage, serveur lié à `127.0.0.1:4028`. Sa
   disponibilité ne dépend **pas** d'un hébergement : elle est locale. Le
   contrôle de licence est **fail-open** en cas d'erreur réseau (l'app ne se
   bloque pas hors-ligne), sous réserve du **verrou hors-ligne dur à 72 h**
   (`electron/main.js` ; documenté comme risque produit dans l'audit).
2. **Plan de contrôle cloud (`garagesite3`, Next.js 15 sur Vercel + PostgreSQL +
   Upstash Redis)** — sert la licence/activation, les releases/mises à jour,
   les modules, notifications et l'ingestion de crashs. C'est la cible réelle
   des SLO ci-dessous.

Cette séparation est structurante : **une indisponibilité du cloud n'empêche pas
un garage de travailler** (grâce au fail-open et à la sonde adaptative), elle
retarde seulement l'activation de nouvelles machines, la publication de mises à
jour et la remontée de crashs.

---

## 2. SLO proposés — Plan de contrôle cloud

### 2.1 Disponibilité

| Service / classe de route | SLO proposé (mensuel) | Budget d'erreur |
|---------------------------|-----------------------|-----------------|
| Vérification de licence (`/api/license/check`, `/activate`) | **99,9 %** | ≈ 43 min/mois |
| Résolution de mise à jour (`/api/update/latest`) | **99,5 %** | ≈ 3 h 39 min/mois |
| Back-office admin (`/admin/*`, `/api/admin/*`) | **99,0 %** | ≈ 7 h 18 min/mois |
| API publique `/api/v1/*` (bac à sable) | *Aucun SLO* | *Non applicable — démo non persistante* |

**Justification :**
- La **vérification de licence** est le chemin le plus critique commercialement
  et est déjà **fail-closed** en production (503 plutôt que d'autoriser à tort
  sur panne d'infrastructure — `licenses/service.ts`, `check/route.ts`), ce qui
  justifie la cible la plus haute. Le client desktop, lui, est fail-open : une
  brève indisponibilité n'interrompt pas l'utilisateur.
- La **résolution de mise à jour** tolère une cible plus basse : le client
  réessaie au démarrage puis toutes les heures et dispose de replis (fichier
  local admin, GitHub). Une erreur serveur renvoie « pas de maj », jamais un
  blocage (`update/latest/route.ts:37`).
- L'**API `/api/v1`** est explicitement un **bac à sable en mémoire non
  persistant** (audit) : lui attribuer un SLO serait trompeur tant qu'elle n'est
  pas adossée à la base.

### 2.2 Latence (proposée)

| Route | SLO latence (p95) | SLO latence (p99) |
|-------|-------------------|-------------------|
| `/api/health` (liveness `SELECT 1`) | < 150 ms | < 400 ms |
| `/api/license/check` | < 300 ms | < 800 ms |
| `/api/update/latest` | < 400 ms | < 1000 ms |
| `/api/admin/*` (lectures) | < 600 ms | < 1500 ms |

**Justification :** ces seuils s'alignent sur les seuils de notation déjà codés
dans le monitoring desktop (`dbLatencyMs` warn 200 ms / crit 1000 ms —
`src/lib/monitoring/metrics.ts:32`). Les routes de licence font un travail
cryptographique (vérification ECDSA/HMAC) et une transaction verrouillée
(`SELECT … FOR UPDATE`) pour les sièges, d'où une marge supérieure à la simple
liveness.

### 2.3 Taux d'erreur

| Indicateur | SLO proposé |
|-----------|-------------|
| Taux d'erreurs 5xx sur routes de licence | < 0,1 % des requêtes |
| Taux d'erreurs 5xx sur `/api/update/latest` | < 0,5 % des requêtes |
| Réponses 503 dues au fail-closed (Redis/DB indisponible) | Comptées **séparément** — sécurité, pas panne applicative |

**Justification :** les 503 émis par la politique **fail-closed** (rate-limit
distribué Upstash indisponible, DB injoignable) sont un comportement de sécurité
_voulu_, pas un défaut applicatif ; les mêler au taux d'erreur fausserait le
budget d'erreur. Ils doivent être suivis comme un signal d'infrastructure
distinct.

---

## 3. SLO proposés — Application desktop

La disponibilité de l'app desktop est **locale** et ne se prête pas à un SLO
d'hébergement classique. Objectifs proposés, orientés fiabilité :

| Objectif | Cible proposée | Base |
|----------|----------------|------|
| Démarrage sans crash | ≥ 99,5 % des lancements | Mesurable via crash reporting (`kind`/`fatal`, cloud) |
| Taux de crash par version | < 10 machines distinctes / 60 min | Seuil déjà câblé dans le rollback auto (`ROLLBACK_CRASH_THRESHOLD`) |
| Réussite de vérification de mise à jour signée | 100 % des installations (signature Ed25519 obligatoire) | `electron/update-verify.js` — refus sinon |

Le seuil « crash par version » n'est pas qu'un SLO : il **déclenche
mécaniquement** le rollback automatique (voir `docs/ROLLOUT_AND_ROLLBACK.md`).

---

## 4. Mesure et pré-requis (avant de tenir ces SLO)

Pour transformer ces cibles proposées en SLO réellement mesurés, les éléments
suivants — **actuellement non construits** — sont nécessaires :

1. **Corrélation de requêtes** (`requestId`/`traceId`) propagée dans le logger
   (aujourd'hui absente — `docs/OBSERVABILITY.md` §1).
2. **Export/agrégation de métriques** (Prometheus, OpenTelemetry ou équivalent
   Vercel Analytics) — aujourd'hui seules des métriques ponctuelles sont
   exposées via `/api/admin/monitoring`.
3. **Moniteur d'uptime externe** frappant `/api/health` (liveness déjà prête).
4. **Tableau de bord SLO / alerting** sur budget d'erreur.

Ces briques relèvent d'un investissement d'observabilité à budgéter
post-acquisition ; elles ne remettent pas en cause la robustesse des chemins
critiques (fail-closed licence, fail-open client, signatures de mise à jour).

---

*Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md` pour l'analyse de maturité et les risques classés.*
