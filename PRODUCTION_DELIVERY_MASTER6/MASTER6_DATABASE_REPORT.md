---
doc-numbers: journal
---

# BASES DE DONNÉES — rapport MASTER 6

**Verdict : PASS.** SQLite desktop et PostgreSQL serveur exercés réellement, sur des bases **jetables et isolées**. Aucune base existante réinitialisée, aucun `DROP DATABASE` sur une base partagée, `prisma/dev.db` intacte.

## 1. Architecture

| | Desktop | Serveur / PWA |
|---|---|---|
| schéma | `prisma/schema.prisma` — 43 modèles | `prisma/server/schema.prisma` |
| moteur | SQLite (fichier du userData) | PostgreSQL (Neon) |
| client | `node_modules/@prisma/client` | `src/generated/server-client` |
| migrations | 2 (base créée depuis le modèle committé) | **22** |

## 2. Bases utilisées pendant MASTER 6 — toutes jetables

| Base | Rôle | Sort |
|---|---|---|
| `.tmp-m6-e2e/prisma/m6-e2e.db` | recette Playwright authentifiée, 24 mécaniciens | dossier `.tmp-*` jetable |
| `neondb` (Neon **Preview**) | staging réel, migrations + 48 tables | conservée — c'est le staging |
| `gf_gate_check_*` (PostgreSQL 17.11 local) | porte de release, migrations sur base vierge | disparue avec le conteneur |
| `gf_numbering_*`, `gf_it_*`, `gf_sess_*` (local) | suites de concurrence | disparues avec le conteneur |
| **`prisma/dev.db`** | base de développement du poste | **non ouverte, non modifiée** |
| `%APPDATA%\GarageFlow\garageflow.db` | **base métier réelle de l'utilisateur** | **inchangée** (hérité MASTER 5 : SHA-256 identique avant/après) |

## 3. SQLite — runtime desktop

Les 10 contrôles d'opérations réelles de MASTER 5 restent valides (connexion, 45 tables / 43 modèles, CRUD, lecture dans transaction, relation `Client → Vehicle`, isolation par `garageId`, index réellement emprunté, rollback effectif, persistance après reconnexion, cascade). Prisma n'a pas changé et les schémas sont identiques.

En MASTER 6, SQLite a en outre été exercé **par l'application complète** : la base de recette a été créée (`db push`), seedée, puis utilisée par 135 tests Playwright et 8 contrôles d'arbitrage passant par les vraies API HTTP.

## 4. PostgreSQL — serveur

| Contrôle | Résultat |
|---|---|
| connexion, authentification, TLS | **OK** — PostgreSQL 18.6 (Neon Preview) et 17.11 (local) |
| migrations sur base **vierge** à nom unique | **22/22** |
| `migrate status` après application | **à jour** |
| migration JSON monétaire v1 → v2 | **OK** |
| smoke test CRUD (`LicenseKey` + `LicenseDevice`) | **OK** — contraintes et cascade vérifiées |
| migrations sur la base de **staging** | **appliquées**, 48 tables |
| concurrence : 50 créations parallèles | **50 numéros distincts et contigus**, compteur exact |
| suites d'intégration (numérotation, stock, licences, sessions) | **OK** |

## 5. Intégrité métier — mesurée par HTTP

| Règle | Comportement |
|---|---|
| numérotation de facture | attribuée par le serveur dans la **même transaction** que l'incrément du compteur : `FAC-2026-001` |
| totaux et TVA | calculés côté serveur : HT 135,50 / TTC 162,60 à 20 % |
| facture émise | **non supprimable** (409) — série séquentielle préservée ; annulation par `status: 'cancelled'`, stock restitué |
| pièce engagée sur une facture | **non supprimable** (409) |
| **correction d'inventaire** | `{ quantity, expectedQuantity }` → mouvement `ADJUST` tracé, **concurrence optimiste** (409 si valeur périmée) |
| client / véhicule | `DELETE` non exposé (405) ; les FK sont en `Restrict` — voir `MASTER6_FUNCTIONAL_AUDIT.md` |
| isolation multi-tenant | identifiant d'un autre garage → **404** |

## 6. Traçabilité des licences — lacune structurelle

Le modèle `LicenseKey` **n'enregistre pas la clé qui a signé** la licence : ni `keyFingerprint`, ni `signerKid`. Et l'en-tête des jetons GF2 — `{"alg":"ES256","typ":"GF-LIC","v":2}` — **ne porte aucun `kid`**.

Conséquence : impossible de savoir, pour une licence donnée, quelle autorité l'a émise. C'est le point qui complique toute rotation de clés. Proposition d'ajout de `keyFingerprint` dans `MASTER6_ECC_KEY_REPORT.md §6`.

Inventaire des licences : **0** sur le staging. L'inventaire de **production** n'a pas été relevé — la base de production est hors périmètre autorisé.

## 7. Sauvegarde et restauration

48 assertions vertes du parcours « sauvegarde » (chiffrement, instantané, script de restauration, sauvegarde pré-migration, sauvegarde en souffrance, empaquetage sans sauvegarde), plus les suites d'intégration `restore-roundtrip` et `backup-coherent`.

La **sauvegarde pré-migration automatique** a été observée en conditions réelles sur l'application empaquetée (hérité MASTER 5) :

```
Sauvegarde pré-migration OK: …\backups\pre-migration\garageflows-pre-migration-20261023-041108.db
```

**Aucune restauration n'a été testée sur une base réelle** — uniquement en environnement de test, comme l'exige le mandat.
