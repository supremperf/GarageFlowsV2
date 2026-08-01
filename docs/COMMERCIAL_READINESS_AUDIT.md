# Audit de préparation commerciale — GarageFlow (état réel)

_Statuts : **RÉEL** (code exécuté/testé) · **PARTIEL** (code présent, un manque
précis) · **MANQUANT** (à construire) · **BLOQUÉ_EXTERNE** (cert/PDP/juriste) ·
**BLOQUÉ_ENV** (Windows/infra indisponible). Date : 2026-08-01.
Base de mesure : voir `IMPLEMENTATION_BASELINE.md`._

Ce document cartographie **honnêtement** l'écart entre l'état actuel du code et
ce qu'exige une mise en production pour garages pilotes puis abonnements
commerciaux. Il précède et cadre les phases 2 à 10 de la finalisation. Aucune
recommandation n'y remplace une implémentation : chaque écart identifié est
soit corrigé par du code dans une phase dédiée, soit documenté comme bloqué
avec sa cause exacte.

## 1. Migrations base desktop (SQLite) — **PARTIEL**, risque élevé
- **Existant** : `src/lib/migrations.ts` (liste ordonnée `MIGRATIONS`, 119
  entrées additives) + runner `POST /api/internal/migrate` qui suit chaque
  migration dans une table `_gf_migrations` (chacune jouée une seule fois,
  idempotente). Appelé au démarrage par `electron/main.js`
  (`runInternalMigration`). Le template `garageflow-template.db` n'est copié
  que sur une **première** installation (ou base corrompue).
- **Écarts vérifiés** :
  1. **Les tables `EInvoiceSubmission` / `EInvoiceEvent` ne sont PAS dans
     `MIGRATIONS`** (`grep -c EInvoice src/lib/migrations.ts` → 0). Elles
     existent dans le schéma et le template : une **nouvelle** installation les
     a, mais une **installation existante** mise à jour ne les recevra jamais →
     la persistance e-invoicing plante sur base ancienne. **Régression de
     livraison à corriger en priorité (Phase 2).**
  2. Pas de **sauvegarde automatique avant migration**.
  3. Pas de **validation post-migration** (intégrité, tables attendues).
  4. Pas de **rollback** en cas d'échec partiel (une migration qui échoue laisse
     la base dans un état intermédiaire ; le runner réessaie au prochain
     démarrage mais sans garde-fou de cohérence).
  5. Pas de **numéro de version de schéma** lisible (uniquement des ids
     individuels), donc pas de diagnostic « version courante ».
- **Cible Phase 2** : version de schéma explicite, sauvegarde auto horodatée
  avant toute migration, validation post-migration, rollback sur échec,
  ajout des tables e-invoicing à `MIGRATIONS`, tests base neuve + base ancienne.

## 2. Chiffrement des identifiants SMTP — **PARTIEL** (faille réelle)
- **Existant** : colonne `Garage.smtpPass` ; `GET /api/email` ne renvoie **pas**
  le mot de passe (bon). Envoi via `nodemailer`.
- **Écart vérifié** : `PATCH /api/email` fait `data.smtpPass = body.smtpPass`
  → **stockage en clair**. Trois sites lisent le clair :
  `src/app/api/email/route.ts` (test SMTP), `src/app/api/reminders/send/route.ts`,
  `src/app/api/notifications/dispatch/route.ts`. La doc affirme « chiffré via
  `GF_SMTP_CIPHER_KEY` » — non vrai aujourd'hui.
- **Cible Phase 3** : chiffrement réel AES-256-GCM (format versionné, clé
  `GF_SMTP_CIPHER_KEY` dédiée ou dérivée), chiffrement à l'écriture, déchiffrement
  aux 3 lectures, jamais renvoyé par l'API, migration paresseuse du clair
  existant (distinguer absent/chiffré/clair/invalide), tests.

## 3. Récupération de compte & cycle de vie employé — **MANQUANT**
- **Existant** : `next-auth` (JWT, 30 j) + `CredentialsProvider` (bcrypt).
  Modèle `User` minimal : `email @unique`, `password`, `name`, `role`,
  `garageId`. Le callback `jwt` ne peuple le token **qu'à la connexion** : aucune
  revalidation en base ensuite.
- **Écarts vérifiés** :
  - **Aucun mot de passe oublié** : pas de table de jetons de réinitialisation,
    pas de flux. Un propriétaire qui perd son mot de passe est bloqué.
  - **Aucune vérification d'e-mail** pour les comptes internes.
  - **Cycle de vie employé inexistant** : pas de suspension/réactivation
    (pas de champ `status` sur `User`), pas de révocation de session
    (JWT stateless → un employé licencié garde l'accès jusqu'à 30 j), pas de
    transfert de propriété, pas de protection du dernier `OWNER`.
  - Un changement de rôle ne prend effet qu'à la reconnexion (token figé).
- **Cible Phase 4** : champs additifs `User.status`, `User.sessionEpoch`,
  `User.emailVerified`, tables jetons (reset/verify, **hachés**, usage unique),
  endpoints serveur (authz + garageId), revalidation en base dans le callback
  `jwt` (suspension et révocation effectives), transfert de propriété,
  protection dernier propriétaire, tests.

## 4. Sauvegarde / restauration — **PARTIEL**
- **Existant** : `src/lib/backup/{service,crypto,snapshot}.ts`. Snapshot logique
  par garage (18 tables), chiffrement AES-256-GCM (`GF_BACKUP_KEY` ou
  passphrase scrypt), checksum SHA-256, `BackupRecord` (historique), verify
  (déchiffre + revérifie le checksum sans toucher aux données), restore
  (transaction atomique), lecture du blob pour stockage hors-site.
- **Écarts vérifiés** :
  - Le snapshot **ne couvre pas** `EInvoiceSubmission/EInvoiceEvent`, `PortalUser`
    et rattachés, ni `User` (comptes). Une restauration ne rétablit donc pas ces
    données.
  - Pas de **manifeste** explicite (version schéma, app, empreinte) ni de
    procédure documentée de **restauration sur une autre machine**.
  - Pas d'**assistant** (UI) : usage via API/CLI seulement.
- **Cible Phase 5** : manifeste versionné + intégrité, couverture des tables
  manquantes pertinentes, procédure/rapport de restauration sur machine vierge,
  tests. (Assistant UI desktop : selon disponibilité — sinon documenté.)

## 5. Import CSV/XLSX — **MANQUANT**
- **Existant** : export CSV desktop quotidien (`electron/main.js`). Aucun import.
- **Cible Phase 6** : bibliothèque d'import (mapping colonnes, détection de
  doublons, exécution à blanc `dry-run`, transaction, **protection anti-injection
  CSV** `= + - @`, isolation `garageId`), tests. UI selon disponibilité.

## 6. Tests E2E (Playwright) — **MANQUANT**
- **Existant** : 750 tests unitaires/intégration ; Chromium préinstallé.
- **Écart** : aucun parcours navigateur bout-en-bout.
- **Cible Phase 7** : specs Playwright de 8 parcours garage réels (dont
  isolation multi-tenant), données fictives. Exécution : selon capacité à
  démarrer la pile complète dans l'environnement (sinon **BLOQUÉ_ENV**, specs
  livrées et exécutables en CI).

## 7. RGPD — **MANQUANT (mécanismes) / à cadrer (juridique)**
- **Existant** : sécurité (secrets chiffrés, mots de passe hachés, isolation
  testée, audit) ; checklist pilote `docs/pilot/DATA_PROCESSING_CHECKLIST.md`.
- **Écart** : pas de cartographie des données, pas de mécanismes techniques
  dédiés (export/accès/effacement d'une personne concernée), pas de modèles
  juridiques (registre, DPA, mentions).
- **Cible Phase 8** : cartographie, mécanismes techniques (accès/export/
  effacement ciblés, réutilisant le snapshot), modèles juridiques marqués
  **« [À FAIRE VALIDER PAR UN JURISTE] »**. Validation juridique = **BLOQUÉ_EXTERNE**.

## 8. Facturation électronique — communication honnête — **PARTIEL**
- **Existant** : bibliothèque UBL/CII + validateur EN 16931 (cœur), provider
  **sandbox**, persistance + API (Phase 4 session précédente). Aucune
  intégration PDP agréée.
- **Écart** : pas de **niveaux de statut de conformité** explicites dans le code,
  pas de garde-fou contre les formulations interdites (« Certifié conforme »,
  « PDP intégré ») dans le dépôt/UI.
- **Cible Phase 9** : énumération de niveaux
  (`INTERNAL_SANDBOX_ONLY` → `PRODUCTION_VALIDATED`), scanner de dépôt des
  formulations interdites (test + script CI), guide
  `FACTURATION_ELECTRONIQUE_COMMERCIAL_GUIDELINES.md`. Statut réel affiché :
  **sandbox interne uniquement**.

## 9. Modèle d'abonnement — **MANQUANT**
- **Existant** : licences desktop (HWID/appareils) côté control-plane
  (`garagesite3`). Pas de modèle d'abonnement (essai/actif/grâce/suspendu/annulé).
- **Cible Phase 10** : modèle de données d'abonnement côté serveur (control-plane),
  décisions d'accès **côté serveur**, transitions d'état, tests. Le paiement réel
  (facturation externe/Stripe) reste **BLOQUÉ_EXTERNE**.

## 10. Synthèse des priorités
| # | Sujet | Statut actuel | Phase |
|---|---|---|---|
| 1 | Migrations desktop robustes (+ tables e-invoicing) | PARTIEL, risque élevé | 2 |
| 2 | Chiffrement SMTP réel | PARTIEL (clair) | 3 |
| 3 | Récupération compte + cycle employé | MANQUANT | 4 |
| 4 | Sauvegarde/restauration (manifeste, portabilité) | PARTIEL | 5 |
| 5 | Import CSV/XLSX | MANQUANT | 6 |
| 6 | E2E Playwright | MANQUANT | 7 |
| 7 | RGPD (mécanismes + modèles) | MANQUANT / cadrage | 8 |
| 8 | E-invoicing : communication honnête | PARTIEL | 9 |
| 9 | Modèle d'abonnement | MANQUANT | 10 |

Les corrections sont livrées **dans cet ordre**, chacune en commit atomique avec
tests, sans jamais transformer un élément bloqué en « fait ».
