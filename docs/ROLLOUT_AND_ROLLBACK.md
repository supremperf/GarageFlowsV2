# Déploiement progressif et rollback — GarageFlow

Ce document décrit le **déploiement progressif (staged rollout)**, le **ciblage**,
et les **deux voies de rollback** (manuel et automatique par seuil de crash),
tels qu'ils sont **implémentés et testés dans le code**. Source principale :
`garagesite3/src/lib/releases/service.ts` et `src/lib/releases/rollout.ts`.

> Statut global : **Opérationnel**. Le rollback automatique était auparavant
> **code seul, non planifié** (constat de l'audit) ; il est désormais planifié
> via Vercel Cron (voir §4). La logique de rollout (`rollout.ts`) est **pure et
> testée** (`__tests__/rollout.test.ts`).

---

## 1. Déploiement progressif (staged rollout)

Chaque `AppRelease` porte un `rolloutPercent` (0–100, défaut 100). Un client
n'est « dans le bucket » de façon **stable et déterministe** que si son HWID le
place sous le pourcentage.

**Bucketing déterministe** (`rollout.ts:12-18`) :

```
bucketFor(hwid, releaseKey) = SHA256(`${hwid}::${releaseKey}`)[0..3] (uint32 BE) % 100
```

Le même HWID obtient **toujours** la même valeur 0–99 pour une version donnée
(`releaseKey = "${channel}:${version}"`). Conséquence : un rollout à 10 % touche
toujours **les mêmes 10 %** de machines, puis les **inclut** quand on monte à
25 %, 50 %, 100 % — **sans effet yo-yo** (une machine déjà servie ne « ressort »
pas du groupe).

**Test :** `rollout.test.ts` vérifie le déterminisme (même HWID → même bucket) et
la cohérence de la distribution (`bucketFor(hwid, "stable:1.5.0")`).

---

## 2. Éligibilité et ciblage

`isEligible(release, ctx)` (`rollout.ts:43-60`) — logique pure, ordre des
règles :

1. **`rolledBack` → jamais éligible** (la version n'est plus proposée).
2. **`targetCountry`** défini → le pays du client doit correspondre (déduit via
   `countryFromRequest` côté route), sinon exclu.
3. **`targetVersion`** défini → n'offrir qu'aux clients **actuellement** sur
   cette version précise (mise à jour ciblée d'un lot spécifique).
4. **`rolloutPercent`** :
   - ≥ 100 → éligible ;
   - ≤ 0 → jamais ;
   - entre les deux → `bucketFor(hwid) < pct`. **Sans HWID, un rollout partiel
     n'est PAS exposé** (le client attendra 100 %) — car le bucketing stable
     exige un HWID (`rollout.ts:58`).

Le HWID est transmis par le client desktop dans `GET /api/update/latest`
(`electron/main.js:190-192`), ce qui permet un rollout ciblé sans que le serveur
ait à tenir un état par machine.

**Contrôles admin** (`updateRelease`, `service.ts:171-199`, via `PATCH
/api/admin/update/[id]`, schéma `updateReleaseSchema`) : ajuster
`rolloutPercent`, `targetCountry` (ISO 2 lettres), `targetVersion`, `mandatory`,
`minVersion`, `status`, et basculer `rolledBack`. Chaque changement écrit un
`ReleaseEvent` (`updated` ou `rolled_back`).

---

## 3. Rollback manuel et blocage de version

Deux mécanismes distincts :

- **Rollback immédiat d'une version** : `updateRelease(id, { rolledBack: true,
  rollbackReason })`. La version passe `rolledBack=true` et **cesse d'être
  proposée** à tout client (`isEligible` la rejette en règle 1) ; les clients
  déjà installés ne sont pas désinstallés, mais plus aucune nouvelle machine ne
  la reçoit. Un `ReleaseEvent` `rolled_back` est journalisé.
- **Blocage par version minimale** : `minVersion` sur une release plus récente
  rend obligatoire (`mandatory`) la mise à jour pour tout client sous ce seuil
  (`resolveLatestForClient` → `mandatory = release.mandatory || currentVersion <
  minVersion`, `service.ts:336-343`). C'est le levier pour **forcer la sortie**
  d'une version défectueuse déjà déployée : publier une correction avec un
  `minVersion` qui exclut la mauvaise version.

Le back-office `/admin/updates` expose ces contrôles.

---

## 4. Rollback automatique (seuil de crash) + planification Cron

**Statut : Opérationnel (planification ajoutée cette session).**

### 4.1 Moteur

`autoRollbackIfUnhealthy({ threshold, windowMs })` (`service.ts:206-228`) :

- Parcourt les versions `published` non encore `rolledBack` (100 plus récentes).
- Pour chacune, compte les **machines distinctes en crash** sur la fenêtre via
  `crashCountForVersion(version, windowMs)`.
- Si `crashes >= threshold`, bascule `rolledBack=true` avec
  `rollbackReason = "auto: N machines en crash (< windowMs)"` et journalise un
  `ReleaseEvent` `rolled_back`.
- **Idempotent** : une version déjà rollback n'est pas re-traitée. Retourne la
  liste des versions basculées.

### 4.2 Comptage anti-abus (durcissement)

`crashCountForVersion` (`crashes/service.ts:188-221`) est durci contre le déni de
service du déploiement, car `POST /api/crash` est **public et non authentifié** :

- ne comptent **que** les rapports portant un `hwid` **correspondant à un
  appareil réellement enregistré** (`Device.hwidHash = HMAC serveur`) ;
- l'`id` de ligne n'est **jamais** utilisé comme substitut de machine (l'ancienne
  implémentation comptait chaque rapport anonyme comme une machine distincte —
  10 requêtes anonymes suffisaient à faire rollback une version saine) ;
- un attaquant devrait donc connaître N HWID de machines réellement activées —
  infaisable.

### 4.3 Planification (Vercel Cron) + `CRON_SECRET`

Historiquement, `autoRollbackIfUnhealthy` **n'était appelé par aucun
planificateur** — le « rollback automatique » n'était donc pas réellement
automatique (constat explicite de l'audit). Corrigé cette session :

- `garagesite3/vercel.json` déclare une tâche horaire :
  ```json
  { "crons": [ { "path": "/api/cron/rollback-check", "schedule": "0 * * * *" } ] }
  ```
- `GET /api/cron/rollback-check` (`src/app/api/cron/rollback-check/route.ts`)
  invoque le moteur avec les seuils d'environnement
  `ROLLBACK_CRASH_THRESHOLD` (défaut **10**) et `ROLLBACK_WINDOW_MINUTES`
  (défaut **60**), et journalise un audit `update / auto_rollback` si des
  versions ont basculé.
- **Auth `CRON_SECRET` — fail-closed** (`src/lib/server/cron-auth.ts`) : bearer
  `Authorization: Bearer <CRON_SECRET>` comparé en temps constant ; **503 si
  `CRON_SECRET` non configuré** ; 401 si bearer invalide/absent ; secret jamais
  journalisé. Couvert par `__tests__/cron-auth.test.ts` (5 cas).

### 4.4 Voie manuelle équivalente

Le même moteur reste invocable à la demande par un administrateur : `POST
/api/admin/update/rollback-check` (auth `x-gf-key` via `guardAdmin`, corps validé
par `rollbackCheckSchema` : `threshold` 1–100000, `windowMinutes` 1–10080).
Utile pour un déclenchement immédiat ou depuis une GitHub Action.

---

## 5. Cycle de vie d'une version — résumé

```
 publish (100% ou canary N%)
        │
        ├─►  rollout progressif : N% → 25% → 50% → 100%   (bucketing stable par HWID)
        │
        │        ┌─ crashes ≥ seuil sur la fenêtre ─►  ROLLBACK AUTO (cron horaire, CRON_SECRET)
        │        │
        ├────────┤                                        rolledBack=true → plus proposée
        │        │
        │        └─ décision admin ─────────────────────►  ROLLBACK MANUEL (PATCH rolledBack)
        │
        └─►  correction publiée avec minVersion  ─────────►  force la sortie de la version défectueuse
```

---

## 6. Réserves

- Le rollback automatique dépend d'un **flux de crashs suffisant et attribuable**
  (HWID d'appareils enregistrés) ; sur un parc très réduit, le seuil par défaut
  (10 machines/60 min) peut être trop élevé — ajustable par variables d'env.
- L'exécution planifiée requiert que **`CRON_SECRET` soit provisionné** sur le
  projet Vercel (sinon la route est fail-closed en 503, donc inactive — par
  conception).
- La cible d'hébergement (Vercel Cron) et les secrets associés font partie des
  **actifs externes à transférer** (voir `docs/RELEASE_PROCESS.md` §8).

---

*Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md` pour l'analyse de maturité et les risques classés.*
