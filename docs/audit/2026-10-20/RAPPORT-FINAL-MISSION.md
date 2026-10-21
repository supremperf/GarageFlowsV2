# GarageFlows — Rapport final de mission

**Date :** 2026-10-20 · **Branche :** `test-100-pourcent-valide` · **Commit :** `d022390`
**Déploiement de production :** `dpl_CtGNdjnecqqJZLVKgfx7Yfz3FCC4` (`appgarageflows-hqck325m1`)

> Aucune valeur de secret dans ce document : noms de variables et empreintes
> SHA-256 tronquées uniquement.

---

## A. Résumé exécutif

**Verdict : PRODUCTION VALIDÉE AVEC RÉSERVES.**

L'application est en service, la base joignable, les 169 routes déployées, le
rate-limit distribué actif, et la chaîne keygen → serveur → vérification est
cohérente de bout en bout pour la première fois. Les tests sont verts
(4344 / 0 échec), `tsc` à 0, et aucune vulnérabilité de dépendance en production.

Deux réserves subsistent, toutes deux hors de mon périmètre technique :

1. le token Vercel Blob compromis **reste actif** — le CLI Vercel interdit
   explicitement à un agent de supprimer un store ;
2. le mot de passe compromis de `neondb_owner` **reste actif** — vous avez
   choisi de le réinitialiser depuis la console Neon, ce qui est la bonne voie.

Une découverte majeure de cette session mérite d'être connue : **aucune licence
client réelle et fonctionnelle n'existait en base**. Les 11 enregistrements sont
des données de test, et aucun n'était cryptographiquement vérifiable.

---

## B. Les quatre problèmes initiaux

### 1. Token Vercel Blob compromis — **NON RÉSOLU (blocage fournisseur)**

| | |
|---|---|
| **Cause** | Token publié dans une transcription de terminal partagée le 17/10 (source consignée dans `scripts/compromised-secrets.json`) |
| **Audit** | 3 stores, **tous vides** (0 B, 0 fichier) confirmé. Le token désigne `store_ILUycD5y1HG8jsM4` (`app.garageflows.fr-blob`), empreinte `86543830ca0b…` — correspondance **exacte** avec une entrée compromise. `BLOB_READ_WRITE_TOKEN` n'est déclaré dans **aucun** des trois environnements Vercel. Aucun usage dans `src/` ni `electron/` (les « blob » d'`electron/main.js` sont des Buffer de chiffrement, celui de `splash.html` un commentaire CSS). Les 4 tests qui le référencent utilisent des valeurs simulées (`vercel_blob_rw_UnitTest_fixture-…-not-issued`) |
| **Test** | Appel réel à l'API Blob avec le token → **HTTP 200**, `{"hasMore":false,"blobs":[]}` : **le token est ACTIF** |
| **Action** | Suppression du store tentée. Refus du **CLI Vercel lui-même** : *« Deleting a blob store cannot be undone and cannot be performed non-interactively. Agents must not make this change on behalf of a user. »* |
| **État** | **OUVERT** — action interactive requise (voir §F) |

### 2. Rôle `neondb_owner` — **AUDITÉ, réinitialisation déléguée**

| | |
|---|---|
| **Audit des permissions** | Propriétaire de `neondb` : `neondb_owner`. Propriétaire du schéma `public` : `pg_database_owner`. Les **65 tables** appartiennent à `neondb_owner`. 223 index, 1 séquence, 0 vue, 0 fonction, 26 migrations appliquées |
| **Droits de `gf_app`** | `USAGE` + `CREATE` sur le schéma · **0 table sans SELECT** · **0 table sans INSERT/UPDATE/DELETE** · 1/1 séquence avec `USAGE` · `SELECT`+`INSERT` sur `_prisma_migrations` · **non superutilisateur**, ne peut pas créer de rôle, ne contourne pas RLS |
| **Migrations futures** | Privilèges par défaut `neondb_owner → gf_app` : `arwdDxtm` (tables) et `rwU` (séquences). Les objets créés par de futures migrations donneront donc automatiquement les droits à `gf_app` |
| **Production utilise bien `gf_app`** | **Prouvé** : après sollicitation du domaine, une connexion `gf_app` via `pgbouncer` apparaît dans `pg_stat_activity` |
| **Tests avec `gf_app`** | **10/10** en transaction **annulée** (aucune trace) : connexion, lectures, `INSERT` garage, `INSERT` client avec clé étrangère, `UPDATE`, `DELETE`, vérification du rollback |
| **Décision** | Réinitialisation du mot de passe **depuis la console Neon**, par vous. C'est plus sain : je n'ai aucun coffre où déposer la nouvelle valeur, et elle serait perdue |
| **État** | **AUDITÉ · réinitialisation à votre main.** Ne pas supprimer le rôle : il possède le schéma et les 65 tables |

### 3. Divergence `keys/server_config.json` — **RÉSOLU**

| | |
|---|---|
| **Cause racine** | Non pas deux clés différentes, mais **la bonne clé avec un caractère `"f"` surnuméraire** : `server_config.api_key` (65 car.) = `GARAGEFLOW_API_KEY` (64 car.) + `"f"`. Prouvé par comparaison : `a.startsWith(b) === true`, reste `"f"` |
| **Source de vérité** | Le serveur, **établie par test** et non par le rapport précédent : la clé à 64 caractères donne HTTP 200 et liste 11 licences |
| **Correction** | `keys/server_config.json` aligné sur `GARAGEFLOW_API_KEY`. Ancien fichier sauvegardé (`.avant-correction-20261020`) |
| **Tests** | `keygen_server.test_connection` → **« Connexion réussie (HTTP 200) · 11 licence(s) connue(s) »**. Batterie de 6 cas **tous conformes** : config valide acceptée ; mauvaise clé de même longueur, clé vide, clé trop courte, URL inexistante et `http://` hors localhost **tous refusés** avec un message précis |
| **État** | **RÉSOLU et vérifié** |

### 4. Cron e-facturation — **CONFIGURÉ, sans effet par conception**

| | |
|---|---|
| **Enregistrement** | **Prouvé indirectement** : Vercel a **refusé** `17 * * * *` (« Hobby accounts are limited to daily cron jobs ») puis **accepté** `17 3 * * *`. Il lit donc bien `vercel.json`. Le CLI n'expose pas la liste des crons enregistrés |
| **Sécurité de la route** | Jeton dédié `EINVOICING_QUEUE_TOKEN` ≥ 32 car. en `Authorization: Bearer`, comparaison `timingSafeEqual`, **503 sans jeton configuré**, aucun repli sur une autre clé |
| **Comportement réel** | `POST` → **409 `FEATURE_DISABLED`** : les drapeaux `EINVOICING_*` ne sont pas déclarés en production, et le contrôle du drapeau **précède** celui du jeton. `GET` → 405 |
| **Idempotence** | Documentée dans la route : jamais de reprise d'une transmission `unknown` ou `rejected`, maximum 5 tentatives automatiques (`queue.ts`) |
| **Conclusion honnête** | Le cron **s'exécutera sans rien faire** jusqu'à l'activation de la facturation électronique. C'est cohérent : aucune plateforme agréée n'est contractée. **Je ne le déclare pas opérationnel** |
| **État** | **CONFIGURÉ · effet nul attendu**, verrouillé par 8 tests |

---

## C. État réel des services

| Service | État | Preuve |
|---|---|---|
| **Vercel** | ✅ en service | domaine sert `appgarageflows-hqck325m1`, vérifié par `vercel ls` |
| **Neon / PostgreSQL** | ✅ opérationnel | `/api/health` appelle `dbReachable()` et renvoie 503 si injoignable → répond **200** |
| **Rôle `gf_app`** | ✅ moindre privilège | 10/10 tests de droits, non superutilisateur |
| **Redis / Upstash** | ✅ actif en production | **4 compteurs `rl:*`** observés dans Redis après sollicitation, avec TTL |
| **Rate-limit distribué** | ✅ validé | compteur pseudonymisé (SHA-256, aucune IP en clair) ; saturation → **429** |
| **Keygen → serveur** | ✅ validé | `test_connection` OK, 11 licences vues ; 6/6 cas d'authentification conformes |
| **Autorité de licence** | ✅ cohérente | licence émise localement **acceptée par l'ancrage déployé** (`b16d2e1b`) |
| **API (169 routes)** | ✅ déployées | 169 occurrences `/api/` dans les logs de build |
| **Authentification** | ✅ | `/api/clients` 401 `UNAUTHENTICATED`, `/api/admin/licenses` 403 |
| **Vercel Blob** | ⚠️ token compromis actif | 3 stores vides, aucun usage applicatif |
| **Cron** | ⚠️ configuré, effet nul | 409 `FEATURE_DISABLED` |
| **Facturation électronique** | ❌ non configurée | aucune plateforme agréée |
| **Paiements** | ❌ non intégrés | aucun bac à sable fournisseur |
| **E-mails / SMTP** | ❌ non vérifiés | aucun test d'envoi réalisé |

---

## D. Chiffres

| Mesure | Valeur |
|---|---|
| Tests exécutés | **4 379** (354 fichiers) |
| Réussis | **4 344** |
| Échoués | **0** |
| Ignorés | 35 (dont 4 exigeant la clé privée émettrice — ignorés, jamais faussement verts) |
| `tsc --noEmit` | **exit 0** |
| `npm audit --omit=dev` | **0 vulnérabilité** (critical 0, high 0, moderate 0, low 0) |
| Vulnérabilité GitHub signalée | 1 modérée sur la branche par défaut (Dependabot #175) — hors de cette branche |
| Routes API déployées | **169** |
| Migrations appliquées | **26** |
| Tables / index | 65 / 223 |
| Licences en base | **11, inchangées** |

**Tests non réalisés** : parcours métier par l'interface (aucun compte applicatif
en base), paiements, envoi d'e-mails, facturation électronique réelle,
restauration de sauvegarde, exécution réelle du cron (premier déclenchement à
3 h 17).

---

## E. Déploiement

| | |
|---|---|
| Branche | `test-100-pourcent-valide` |
| Commit | `d022390` |
| Déploiement | `dpl_CtGNdjnecqqJZLVKgfx7Yfz3FCC4` / `appgarageflows-hqck325m1` |
| Domaine | `app.garageflows.fr` — **vérifié explicitement** par `vercel ls` |
| Promotion | 409 « already the current production deployment » : l'alias a été pris directement, le rollback de la veille n'étant plus actif |
| Rollback disponible | `vercel rollback dpl_6Khy1XJoiCMGwojg42cBookExTWj --yes` (déploiement du 17/10) |

**Leçon de la veille, appliquée** : un `vercel deploy --prod` peut réussir sans
que le domaine serve le nouveau déploiement, car un rollback **épingle** l'alias.
Le déploiement servi a donc été contrôlé explicitement, pas déduit du code de
sortie.

---

## F. Ce qui requiert votre intervention

| # | Action | Pourquoi moi je ne peux pas |
|---|---|---|
| 1 | `vercel blob delete-store store_ILUycD5y1HG8jsM4` **dans votre terminal** | Le CLI Vercel refuse qu'un agent supprime un store, quelle que soit l'autorisation. Alternative : régénérer le token depuis la console Storage |
| 2 | Réinitialiser le mot de passe de `neondb_owner` depuis la console Neon | Votre choix, et le bon : je n'ai aucun coffre où déposer la nouvelle valeur |
| 3 | Aligner la vitrine **`garagesite3`** sur la nouvelle clé publique `b16d2e1b` | Autre dépôt, hors de mon périmètre. Rappel émis par `keys:sync` |
| 4 | Décider du sort des 11 enregistrements de test en base | Décision métier. Aucun n'est une licence valide ; les identifiants valent « ex: CUST-042 — laisser vide = auto » |
| 5 | Nettoyer 2 stores Blob et 4 intégrations orphelines | Opérations destructives |
| 6 | Activer la facturation électronique | Nécessite un contrat avec une plateforme agréée |
| 7 | Arbitrer l'hébergement hors UE | Fonctions en `iad1`, base en `us-east-2`. La base Preview est en `fra1` |
| 8 | Plan Pro si une reprise e-facturation horaire est souhaitée | Hobby limite à un cron par jour |

---

## G. Conclusion

**PRODUCTION VALIDÉE AVEC RÉSERVES.**

Ce qui est prouvé fonctionner : l'application répond, la base est joignable sous
un rôle à moindre privilège testé, les 169 routes sont déployées, le rate-limit
distribué compte réellement dans Redis et renvoie 429 au-delà du seuil, et la
chaîne de licences est cohérente de bout en bout — une licence émise par le
keygen est acceptée par l'ancrage déployé.

Les réserves sont nommées, bornées et toutes documentées au §F. Les deux plus
importantes sont des **secrets compromis encore actifs** (token Blob, mot de
passe `neondb_owner`) : leur révocation est à votre main, pour des raisons de
politique d'outil dans un cas et de garde de secret dans l'autre.

Je ne qualifie pas cette production de « validée » sans réserve, et je ne
déclare opérationnels ni le cron, ni la facturation électronique, ni les
paiements, ni les e-mails : faute de preuve, ils restent **non testés**.
