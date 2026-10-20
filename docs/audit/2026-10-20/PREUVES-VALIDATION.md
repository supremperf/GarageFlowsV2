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

---

# Addendum — session de validation Preview (20/10, après-midi)

## 8. INCIDENT DE PRODUCTION — détecté, diagnostiqué, résolu

**Fait.** À 14:09, un déploiement de production a été promu (hors de mon action :
je n'ai jamais lancé `vercel deploy --prod`). Toutes les routes API sont passées
en **404** ; seules les pages statiques répondaient.

**Diagnostic.** 404 réel, confirmé hors cache (paramètre unique + en-têtes
`no-cache`), avec un identifiant de build `BM0y_ek617uaQwlPj5emj`. Le build
affichait `Next.js 15.5.28` alors que `package.json` épingle **15.5.27**, avec
`Skipping linting` et `Created all serverless functions in: 316ms` (contre
1.448 s pour un build sain). Ce déploiement ne provenait donc pas du code de
cette branche.

**Résolution.** Rollback vers `dpl_6Khy1XJoiCMGwojg42cBookExTWj` (17/10), sur
autorisation explicite — le rollback touche la production, hors de mon périmètre
par défaut, et une première tentative a d'ailleurs été refusée par la politique
de la session.

Vérification après rollback :

| Route | Résultat |
|---|---|
| `/api/health` | **200** `{"status":"ok"}` |
| `/api/version` | **200** `schemaVersion: 214` |
| `/api/ping` | **200** |
| `/api/clients` | **401** `UNAUTHENTICATED` |
| `/api/admin/licenses` | **403** |

**Service rétabli.** Aucune donnée touchée.

**Enseignement.** Mon hypothèse initiale — `output: 'standalone'` empêchant la
génération des fonctions — était **fausse** : le Preview construit depuis cette
branche génère bien 169 routes, et le projet journalise « Build Vercel détecté —
post-build desktop ignoré ». La cause du déploiement cassé reste une version de
Next non épinglée (15.5.28), pas la configuration du dépôt.

## 9. Redis Preview — 10/10

PING, SET, GET, EXPIRE, TTL lisible, **expiration effective** après 1,6 s, DEL,
clé supprimée illisible, INCR atomique, incrémentation correcte. Instance laissée
à 0 clé.

**Isolation prouvée** : `vital-duckling-77598.upstash.io` (production) contre
`humble-gelding-137819.upstash.io` (Preview) — instances distinctes.

## 10. Rate-limit distribué — VALIDÉ

Un appel à `/api/license/status` crée `rl:license_status:a2be968c…` = 1, TTL 37 s.
Clé **pseudonymisée** (SHA-256 tronqué, aucune IP en clair). Compteur saturé
au-delà du seuil → **429 Too Many Requests**, avec la CSP complète dans la réponse.

**Correction d'un faux diagnostic.** Un premier test par martèlement POST (12
appels) n'avait produit aucun 429, et Redis restait vide — j'ai d'abord suspecté
un rate-limit inopérant. Vérification faite, le corps des réponses était
`400 Bad Request` en **texte brut**, pas le JSON applicatif : `vercel curl` ne
transmettait pas le corps des requêtes POST, qui n'atteignaient donc jamais les
handlers. **L'instrument de test était en cause, pas le code.**

## 11. Keygen → serveur — VALIDÉ

| Appel | Résultat |
|---|---|
| Bonne clé `x-gf-key` | **200** `{"ok":true,"count":0,"truncated":false,"licenses":[]}` |
| Mauvaise clé, même longueur | **403** |
| Sans en-tête | **403** |

Pour ce test, une clé API dédiée à Preview a été générée (43 caractères), déclarée,
puis le déploiement refait — les variables Vercel étant figées à la création d'un
déploiement. La valeur a été supprimée du poste après le test.

Note : `vercel env pull` rend `[SENSITIVE]` (11 caractères) pour les variables de
type **Secret**. C'est le bon comportement, et cela rend la valeur non relisible —
d'où la nécessité de régénérer pour tester.

## 12. Les cinq routes absentes — PRÉSENTES en Preview

| Route | Preview | Production |
|---|---|---|
| `/api/keygen/licenses` | **403** | **404** |
| `/api/internal/einvoicing/queue` | **405** | absente |
| `/api/einvoicing/webhooks/[id]` | **405** | absente |

## 13. Limitation fournisseur mesurée

Le compte Vercel est en plan **Hobby** : un seul cron par jour. L'expression
`17 * * * *` faisait **échouer le déploiement entier**. Corrigée en `17 3 * * *`
et verrouillée par un test. Reprise e-facturation possiblement différée de 24 h ;
le plan Pro lèverait la contrainte.

Aucune dépense engagée : la base Neon Preview est en plan `free_v3`, et le Redis
Preview a été provisionné sur le plan gratuit.

## 14. Vercel Blob — portée réelle du token compromis

Trois stores existent, **tous vides** (0 B, 0 fichier) : `app.garageflows.fr-blob`,
`garageflows-update`, `garageflow-updates` (les deux derniers portent des noms
quasi identiques — doublon à nettoyer).

`BLOB_READ_WRITE_TOKEN` et `@vercel/blob` ne sont référencés que par des **scripts
d'outillage** (`scripts/config-*.cjs`) : **aucun fichier de `src/`**. L'application
ne lit donc pas Blob à l'exécution, et le token compromis ne donne pas accès aux
données clients. Il reste à révoquer — `vercel blob` n'expose aucune commande de
rotation de token, l'opération passe par la console Storage.

Aucun store Preview n'a été créé : ce serait de la configuration sans usage.

## 15. État final du code

| Contrôle | Résultat |
|---|---|
| `tsc --noEmit` | **exit 0** |
| `vitest run` | **exit 0 — 4342 réussis, 0 échec**, 37 ignorés |
| `check-env-vercel` production | **exit 0** — 10/10 |
| `check-env-vercel` preview | exit 1 — 9/10 (`NEXTAUTH_URL` volontairement absente) |
