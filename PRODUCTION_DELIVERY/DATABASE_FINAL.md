---
doc-numbers: journal
---

# BASES DE DONNÉES — état final MASTER 5

**Verdict : SQLite PASS, PostgreSQL PASS.** Opérations réelles exécutées sur les deux moteurs, sur des bases **isolées et jetables**. Aucune base existante réinitialisée, aucun `DROP DATABASE`.

## 1. Architecture réelle (deux schémas, deux cibles)

| | Desktop | Serveur / PWA |
|---|---|---|
| schéma | `prisma/schema.prisma` | `prisma/server/schema.prisma` |
| moteur | SQLite (fichier dans le userData) | PostgreSQL (Neon) |
| client généré | `node_modules/@prisma/client` | `src/generated/server-client` |
| modèles | 43 | — |
| migrations | 2 (base créée depuis le modèle committé) | **22** |

## 2. SQLite — runtime desktop

Base jetable copiée depuis `prisma/garageflow-template.db` à chaque exécution ; `prisma/dev.db` n'est **jamais** ouverte par ce contrôle.

| Contrôle | Windows | Linux (conteneur) |
|---|---|---|
| version du moteur SQLite | 3.45.0 | 3.45.0 |
| tables / modèles | 45 / 43 | 45 / 43 |
| création de tenant `Garage` | PASS | PASS |
| CRUD `Client` + relecture dans la transaction | PASS | PASS |
| relation `Client → Vehicle` | PASS | PASS |
| isolation multi-tenant par `garageId` | PASS | PASS |
| index réellement emprunté (`EXPLAIN QUERY PLAN`) | `SEARCH Client USING INDEX Client_garageId_idx` | idem |
| annulation de transaction | PASS | PASS |
| persistance après reconnexion | PASS | PASS |
| cascade de suppression | PASS | PASS |

Preuves : `MASTER5_EVIDENCE/logs/06-prisma-runtime-smoke.txt`, `25-linux-container-verify.txt`.

### Persistance vérifiée sur l'application EMPAQUETÉE

Deux démarrages successifs de `dist/win-unpacked/GarageFlows.exe`, PATH réduit à Windows, répertoire courant vide. Journal applicatif réel :

```
userData: %APPDATA%\GarageFlow
IS_DEV: false
[integrity] OK — 540 fichiers critiques vérifiés | paquet: 2bc9e8cc7aeb
Existing database: %APPDATA%\GarageFlow\garageflow.db
Sauvegarde pré-migration OK: …\backups\pre-migration\garageflows-pre-migration-20261023-041108.db
No valid license — showing activation window
Activation cancelled — quitting
```

La **sauvegarde pré-migration automatique** fonctionne. La base métier est restée identique (SHA-256 relevé avant/après).
Preuve : `MASTER5_EVIDENCE/logs/32-packaged-app-launch.txt`.

## 3. PostgreSQL — migrations sur base VIERGE

`scripts/gate-fresh-postgres.mjs` crée une base à nom unique (`gf_gate_check_<16 hex>`), y rejoue **toutes** les migrations serveur, puis lance le smoke test.

```
Datasource "db": PostgreSQL database "gf_gate_check_4932ccf019deb8b9" … eu-central-1.aws.neon.tech
22 migrations found in prisma/migrations
All migrations have been successfully applied.
▶ prisma migrate status… Database schema is up to date!
▶ Migration JSON monétaire v1 → v2… terminée
▶ Smoke test CRUD (LicenseKey + LicenseDevice)…
✅ Base serveur PostgreSQL valide : migrations appliquées, contraintes et cascade vérifiées.
```

Connexion effectivement établie : **PostgreSQL 18.6** (Neon, `neondb` / `neondb_owner`, port 5432, TLS).
Preuves : `MASTER5_EVIDENCE/logs/18-postgres-gate-fresh.txt`, `19-redis-upstash-smoke.txt` pour l'environnement associé.

La base de contrôle est **conservée** (le script n'automatise aucune suppression). Son retrait figure dans `ACTIONS_MANUELLES_RESTANTES.md`.

## 4. PostgreSQL — concurrence réelle

`npm run release:gate` exécute les quatre suites d'intégration PostgreSQL :

```
▶ Tests PostgreSQL réels (concurrence numérotation/stock/licences/sessions)… OK
   document-numbering.postgres.int.test.ts   — 50 créations parallèles → 50 numéros distincts et contigus
   stock-concurrency.postgres.int.test.ts
   license-devices.postgres.int.test.ts
   licensed-session.postgres.int.test.ts
```

### Un choix d'environnement à connaître

Lancées contre l'URL **directe** d'une base **Neon serverless**, les 50 créations parallèles échouent sur `Transaction API error: Unable to start a transaction in the given time`. Ce n'est pas un défaut de la numérotation : c'est une seule instance de calcul serverless qui ne sert pas 50 transactions interactives simultanées dans le délai d'acquisition de Prisma. Le test documente lui-même sa cible : « service postgres en CI, ou **cluster local jetable** ».

La preuve a donc été produite contre un **PostgreSQL 17.11 local jetable** (conteneur `postgres:17-alpine`), où l'invariant comptable est vérifié : aucun doublon, aucun trou, compteur exact, aucune création en échec. Les deux mesures sont conservées :
`MASTER5_EVIDENCE/logs/36-release-gate.txt` (local, OK) et l'échec Neon est décrit dans `PERFORMANCE_FINAL.md §Limites`.

## 5. Redis / Upstash — réel

Instance Upstash de **Preview** (jamais la production), via l'API REST que le produit utilise (`src/lib/security/rate-limit.ts`) :

| Contrôle | Résultat |
|---|---|
| connexion + authentification (`PING`) | `PONG` |
| écriture puis lecture (`SET`/`GET`) | valeur relue conforme |
| incrément atomique (`INCR`) | 1 puis 2 |
| expiration réelle (`EXPIRE` + `TTL` + disparition) | TTL=1 s puis clé absente |
| fenêtre de limitation (3 autorisés / 2 refusés) | `autorisé, autorisé, autorisé, refusé, refusé` |
| indisponibilité : jeton invalide | **HTTP 401** — aucun accès sans jeton valide |
| nettoyage | 0 clé résiduelle sous le préfixe de contrôle |

Toutes les clés créées étaient préfixées et ont été supprimées.
Preuve : `MASTER5_EVIDENCE/logs/19-redis-upstash-smoke.txt`.

Et le **partage inter-instances** est prouvé séparément par la porte, contre un vrai Redis local (protocole RESP, deux instances indépendantes du module de limitation) :

```
▶ Rate-limit distribué multi-instance (Redis réel)… OK
```

## 6. Isolation multi-tenant — vérifiée par les API réelles

Au-delà des tests unitaires, l'audit fonctionnel par HTTP a vérifié sur une instance dédiée :

- `GET /api/clients/<identifiant étranger>` → **404** (pas de fuite inter-tenant) ;
- comptage filtré par `garageId` : 1 dans le tenant, 0 hors tenant ;
- les routes de facturation revérifient côté serveur que `clientId`, `vehicleId`, `jobId` et chaque `partId` appartiennent au garage de la session (anti-IDOR), avant toute écriture.

Preuve : `MASTER5_EVIDENCE/logs/35-audit-fonctionnel-api.txt`.

## 7. Intégrité métier constatée

| Règle | Comportement mesuré |
|---|---|
| numérotation de facture | attribuée par le serveur dans la MÊME transaction que l'incrément du compteur : `FAC-2026-001` |
| totaux et TVA | calculés côté serveur : HT 135,50 / TTC 162,60 au taux 20 % |
| facture émise | **non supprimable** (HTTP 409) — la série séquentielle est préservée ; l'annulation passe par `status: 'cancelled'`, qui restitue le stock |
| pièce engagée sur une facture | **non supprimable** (HTTP 409) |
| quantité de stock | non modifiable directement par `PATCH /api/parts/:id` — les mouvements passent par les bons de commande et les pièces d'intervention |

## 8. Sauvegarde et restauration

Couvertes par le parcours « sauvegarde » du rapport métier : **48/48 assertions** (`crypto`, `snapshot`, `restore-script`, `pre-migration-backup`, `sauvegarde-en-souffrance`, `packaging-sans-sauvegarde`), plus deux suites d'intégration (`restore-roundtrip`, `backup-coherent`) exécutées dans le passage Vitest complet. La sauvegarde pré-migration a par ailleurs été observée **en production locale** sur l'application empaquetée (§2).
