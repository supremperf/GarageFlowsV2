# Modèle de sécurité multi-locataire — GarageFlow

> Document de data room (due diligence M&A). Décrit le modèle d'isolation par garage,
> la garde de clé étrangère locataire, et la matrice 401/403 testée. Faits vérifiés au
> 31/07/2026. Inclut la limite honnête : locataire **mono-garage**, pas de hiérarchie
> organisationnelle.

## 1. Modèle d'isolation

Le locataire opérationnel est le **`Garage`**. Tous les modèles métier
(clients, véhicules, OR, factures, devis, mécaniciens, etc.) portent un `garageId` avec
`@@index([garageId])` et suppressions en cascade — `prisma/schema.prisma`. Une session
authentifiée est liée à **un seul `garageId`** ; la licence est liée de manière
**immuable** à un garage (liaison à la première utilisation via `updateMany` atomique,
puis 403 en cas de non-correspondance) — `src/lib/license/session.ts:109-152`.

Défense en profondeur (plusieurs couches indépendantes) :

1. **Middleware** — gate toutes les pages ; les handlers `/api` gèrent leur propre auth
   — `src/middleware.ts:35-98`.
2. **`requireSession()`** — valide centralement la session licenciée et lie la licence au
   garage — `src/lib/api-helpers.ts:27-104`.
3. **Scoping inline** — chaque lecture/écriture métier filtre `where:{ id, garageId }`
   — ex. `src/app/api/jobs/[id]/route.ts:11-86`.
4. **Garde de relation (2nd ordre)** — `assertRelations` bloque l'IDOR par inclusion de
   relations — `src/lib/tenant.ts:15-54`.

## 2. Garde de clé étrangère locataire — `src/lib/tenant.ts`

Le fichier `src/lib/tenant.ts:15-54` fournit `relationInGarage` / `assertRelations` :
une garde typée (sans `any`, sans `@ts-ignore`) qui vérifie que toute entité référencée
par FK (ex. un `mechanicId` passé dans une requête OR) appartient bien au `garageId` de
la session **avant** de l'utiliser. Cela ferme la classe d'IDOR de **second ordre** où un
locataire tente de rattacher/lire une entité d'un autre garage via une relation. La garde
est utilisée dans les routes qui croisent des références (ex. FK mécanicien scopée dans
`jobs/[id]/route.ts`).

## 3. Matrice d'accès testée (401 / 403)

Adossée à `src/lib/__tests__/require-session-enforcement.test.ts:68-103` :

| Scénario | Résultat attendu | Vérifié |
|---|---|---|
| Requête sans session | **401** | Oui (test) |
| Session avec la licence d'un **autre** garage | **403** | Oui (test) |
| Session avec un **appareil révoqué** (cookie encore signé) | **403** | Oui (test) |
| Accès cross-garage à une ressource (IDOR direct) | **404/refus** (scoping `where:{id,garageId}`) | Oui (`tenant-isolation.test.ts`, `catalog.test.ts`) |
| IDOR 2nd ordre via relation | Refus (`assertRelations`) | Oui (`tenant-guard.test.ts`) |

L'isolation à deux garages est prouvée par ensemencement de **deux garages** sur SQLite
temporaire (`src/lib/__tests__/tenant-isolation.test.ts`) et par exécution du vrai
handler `GET /api/catalog` avec vérification de scoping (`src/integration/catalog.test.ts`).

## 4. Enforcement transversal

- **Sièges/HWID** : activation TOCTOU-safe via `SELECT ... FOR UPDATE` + recomptage de
  contrôle (`garagesite3/src/lib/licenses/service.ts:411-472`) — garantit qu'un garage ne
  dépasse pas son quota d'appareils.
- **Routes internes desktop** : clé forte + comparaison temps constant + origine loopback
  obligatoire (`src/lib/internal-auth.ts:15-38`) — neutralise tout accès cross-tenant si
  l'app Electron était exposée sur le web.
- **Backups** : téléchargement scopé `readBackupBlob(garageId, id)` avec `requireOwner`
  — pas d'IDOR (`src/app/api/admin/backups/[id]/download/route.ts:13-27`).

## 5. Limite honnête — locataire mono-garage, pas de hiérarchie

Le modèle opérationnel **plafonne au `Garage`**. Il n'existe **aucune entité
`Organization` / `Network` / groupe de locataires au-dessus** de `Garage` dans le schéma
opérationnel — une recherche `organization`/`network` dans `prisma/schema.prisma` ne
renvoie rien (`prisma/schema.prisma:24`). Conséquences :

- L'isolation **par garage** fonctionne et est testée, mais il n'y a **pas** de
  regroupement, de reporting consolidé, ni de contrôle d'accès inter-garages.
- Le « réseau multi-garages » est une capacité de **licensing/déploiement** (le plan de
  contrôle cloud gère de nombreuses installations) **et** un palier de plan marketing —
  **pas** une hiérarchie organisationnelle opérationnelle.
- Une thèse de **roll-up / franchise multi-sites** exigerait une refonte du schéma
  (entité parente), un contrôle d'accès inter-garages et un reporting consolidé, qui
  **n'existent pas** aujourd'hui. À traiter comme limitation connue / élément de roadmap.

L'installation desktop est **mono-garage par installation** (SQLite locale) ; le plan de
contrôle cloud coordonne les licences/modules/mises à jour à travers les installations,
mais sans agréger les données métier.

---

*Référence croisée : voir [docs/ACQUISITION_READINESS_AUDIT.md](./ACQUISITION_READINESS_AUDIT.md).*
