# GarageFlows — Dossier de preuves

**Date :** 2026-10-20 · Chaque ligne correspond à une commande réellement exécutée.

> Statuts : **VALIDÉ** (exécuté, conforme) · **ÉCHEC** (exécuté, non conforme) ·
> **BLOQUÉ** (obstacle identifié) · **NON TESTÉ** (aucune vérification suffisante).
> Un état BLOQUÉ ou NON TESTÉ n'est jamais requalifié en VALIDÉ.

## 1. Accès — ce qui a été vérifié avant d'agir

| Accès | Constat | Statut |
|---|---|---|
| Vercel CLI | `vercel whoami` → compte de l'équipe `garage-flows` | **VALIDÉ** |
| Vercel — écriture | sonde `GF_AUDIT_PROBE` créée en Development, relue, puis retirée | **VALIDÉ** |
| GitHub | `gh auth status` → `supremperf`, scope `repo` | **VALIDÉ** |
| Neon — API dédiée | aucun `neonctl`, aucune clé d'API Neon sur le poste | **BLOQUÉ** (contourné via Marketplace + SQL) |
| Upstash — CLI | absent ; provisionnement exige le navigateur | **BLOQUÉ** |

## 2. Variables d'environnement

| Contrôle | Commande | Résultat | Statut |
|---|---|---|---|
| Contrat de production | `check-env-vercel --environnement production --projet app.garageflows.fr` | **exit 0** — 10/10 présentes, 0 alias interdit | **VALIDÉ** |
| Contrat Preview | idem `--environnement preview` | exit 1 — 7/10 (Upstash bloqué, `NEXTAUTH_URL` volontairement absente) | **ÉCHEC partiel** |
| Secrets non exposés au navigateur | les 7 secrets de production sont en type `Secret` chez Vercel | valeurs non relisibles | **VALIDÉ** |
| Aucune valeur sur disque | mdp `gf_app` généré, utilisé et déclaré dans un **seul** processus | jamais écrit | **VALIDÉ** |

## 3. Neon / PostgreSQL

| Contrôle | Résultat | Statut |
|---|---|---|
| État initial de la production | 21 garages, 0 client, 11 licences ; rôle `neondb_owner` | **VALIDÉ** |
| Création du rôle `gf_app` | `CREATE ROLE` + `GRANT` explicites (le `GRANT neondb_owner` a été refusé par Neon) | **VALIDÉ** |
| Nouveau rôle — lecture | connecté comme `gf_app`, 21 garages lus | **VALIDÉ** |
| Nouveau rôle — écriture | `CREATE TEMP TABLE` + `INSERT` | **VALIDÉ** |
| Production toujours en service après rotation | `/api/health` 200, `/api/version` 200 | **VALIDÉ** |
| Base Preview créée | `gf-preview-db`, plan `free_v3`, région `fra1` (UE), PostgreSQL 18.6 | **VALIDÉ** |
| Migrations sur base vide | `prisma migrate deploy` → **22 migrations, exit 0**, 48 tables | **VALIDÉ** |
| Isolation Production ⇄ Preview | empreintes `777a6b42d0d8…` vs `5d93970cee92…` — **différentes** | **VALIDÉ** |
| `validate-server-db.js` | `P1001` sur l'hôte direct, puis connexion en 235 ms → veille Neon | **ÉCHEC transitoire** |
| Restauration d'une sauvegarde | — | **NON TESTÉ** |

## 4. Tests métier sur PostgreSQL réel (base Preview) — 16/16

Données entièrement fictives, nettoyées en fin de test.

| Cas | Résultat |
|---|---|
| Création garage / client / véhicule / pièce | **OK** |
| Facture + ligne liée à la pièce | **OK** |
| Transaction de décrément (stock 10 → 9) | **OK** |
| Rejeu idempotent (aucun second débit) | **OK** |
| Rollback après panne simulée (stock reste 9) | **OK** |
| Isolation multi-tenant (2 garages) | **OK** — aucun objet visible du second |
| Concurrence : 5 engagements simultanés | **OK** — 1 seul gagnant, 1 seul décrément |
| Cohérence du journal (somme des deltas = −2) | **OK** |
| Suppression en cascade | **OK** |

## 5. Code et tests du dépôt

| Contrôle | Résultat | Statut |
|---|---|---|
| `tsc --noEmit` | exit 0 | **VALIDÉ** |
| `eslint` | exit 0 | **VALIDÉ** |
| `vitest run` (suite complète) | **exit 0 — 4341 réussis, 0 échec**, 37 ignorés, 354 fichiers | **VALIDÉ** |
| `check-docs-consistency` | ✅ source canonique unique | **VALIDÉ** |
| Tests d'isolation Preview (négatifs) | 11/11 | **VALIDÉ** |
| Tests des crons | 7/7, régression détectée (cron orphelin → 4 échecs) | **VALIDÉ** |
| Test de double déduction (SQLite réel) | 6/6 | **VALIDÉ** |
| Scan de secrets sur `4bfe1c0..HEAD` | aucune fuite, aucun motif PEM/token/URL-PG | **VALIDÉ** |

## 6. Ce qui reste BLOQUÉ ou NON TESTÉ

| Sujet | État | Obstacle précis |
|---|---|---|
| Redis Upstash Preview | **BLOQUÉ** | finalisation navigateur exigée par le fournisseur |
| Déploiement Preview | **BLOQUÉ** | dépend d'Upstash (`validateEnv` exige les variables Redis) |
| Les 5 routes absentes en production | **NON TESTÉ** | nécessite un déploiement |
| Keygen → serveur de licences | **NON TESTÉ** | les routes `/api/keygen/**` ne sont pas déployées |
| Exécution réelle du cron | **NON TESTÉ** | un cron ne tourne que sur un déploiement de production |
| Révocation de `BLOB_READ_WRITE_TOKEN` | **BLOQUÉ** | non exposée par le CLI Vercel |
| Révocation de `neondb_owner` | **differée volontairement** | à faire après validation du redéploiement |
| Restauration de sauvegarde | **NON TESTÉ** | — |
| Paiements, facturation électronique réelle | **NON TESTÉ** | comptes fournisseurs requis |
| Build desktop / installateur | **VALIDÉ en phase 1** | installateur produit (220,5 Mo), aucun secret dans l'artefact, 7 fusibles conformes ; refusé à la livraison faute d'identité de build (dossier hors dépôt git) |

## 7. Deux erreurs de ma part, corrigées

Elles figurent ici parce qu'un dossier de preuves qui ne consigne que les
succès n'est pas un dossier de preuves.

1. **Écriture d'identifiants de production dans un fichier** : refusée par la
   politique de la session. Approche corrigée — tout passe désormais par
   `--env-file` et stdin, sans secret sur disque.
2. **Test métier écrit avec `firstName`/`lastName`** alors que les deux schémas
   portent `Client.name`. Ce n'était pas une divergence de schéma mais mon
   erreur ; le test de parité du dépôt passe (6/6).
