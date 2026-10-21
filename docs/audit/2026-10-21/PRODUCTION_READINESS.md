# PRODUCTION_READINESS — 2026-10-21

## 1. Verdict

**NO-GO pour une mise en production certifiée**, inchangé depuis le
2026-10-17. Le code est dans un état nettement mieux prouvé : suite complète
sans échec (comptes dans `TEST_RESULTS.md`), PostgreSQL et Redis réels, OCR
réel, interface du keygen rendue, cycle de vie d'une licence joué de bout en
bout avec une autorité de test et prouvé par captures (`preuves/`).
L'installateur Windows est désormais construit, installé, lancé, réinstallé et
désinstallé avec succès par la CI de la PR #34. Restent hors de portée : la
rotation des secrets exposés, les licences de l'autorité réelle, la mise à
jour Vn → Vn+1 sur un vrai poste, Authenticode et l'e-facturation
interconnectée.

## 2. Domaines

| Domaine | État | Preuve |
|---|---|---|
| Code source (tsc, ESLint) | VALIDÉ | 0 / 0 |
| Dépendances | VALIDÉ | `npm audit` : 0 |
| Backend et API | VALIDÉ | suites vertes ; balayage des 169 routes sans session |
| Base de données | VALIDÉ | 22 migrations sur PostgreSQL vierge ; concurrence réelle |
| Relations métier (client, véhicule, intervention, devis, facture, stock) | VALIDÉ (API) | `scenario-maitre`, `business-workflow-e2e` |
| Stock | VALIDÉ | défaut de concurrence SQLite **corrigé** |
| Facturation (calculs, numérotation, immutabilité) | VALIDÉ | tests au centime, 50 numéros parallèles |
| Paiements | **NON APPLICABLE** | aucun module de paiement dans le produit |
| Facturation électronique | NON VALIDÉ | aucune interconnexion, conformité non vérifiée |
| Licences et HWID | VALIDÉ (clés de test) / BLOQUÉ (autorité réelle) | captures 51 à 91 ; GF-1021-11 ouvert (appareil libéré bloqué côté web) |
| Cryptographie des mises à jour | VALIDÉ (clés de test) | — |
| Scan des captures | VALIDÉ | défaut OCR **corrigé** |
| Build Next | VALIDÉ | build d'empaquetage + `verify:standalone` |
| Serveur empaqueté (composant) | VALIDÉ | démarrage, auth, persistance sous Linux |
| Setup.exe : build, intégrité, installation, lancement jusqu'à l'activation, réinstallation, désinstallation | VALIDÉ (CI `windows-latest`) | job Windows de la PR #34 sur `9a244ad`, voir `AUDIT_BUILD_INSTALLATION.md` §4 |
| Mise à jour Vn → Vn+1, Windows 10/11 vierge, parcours licencié | NON TESTÉ | — |
| Signature Authenticode | BLOQUÉ | aucun certificat |
| Frontend navigateur authentifié | PARTIEL : parcours licence joué avec une autorité de test ; suite E2E authentifiée de la CI BLOQUÉE (secrets de staging) | captures 61 à 85 |
| Rotation des secrets, Vercel, Neon, Upstash | BLOQUÉ | aucun accès |
| Performances | VALIDÉ (budget bundle) / NON TESTÉ (charge) | — |

## 3. Tests

- Réussis : 4 378 vitest, 483 Node, 181 Python (20 + 10 + 93 + 39 + 19),
  54 Playwright, plus les contrôles de `TEST_RESULTS.md` §3 et le rejeu des
  étapes de la CI (§4), Gitleaks compris.
- Échoués à la fin de la session : **0**. Six défauts réels ont échoué puis
  été corrigés : GF-1021-01, GF-1021-02, GF-1021-07 (révélé par la CI), et
  GF-1021-08, GF-1021-09, GF-1021-10, révélés par la vérification par captures
  d'écran alors que toutes les suites étaient vertes.
- Ignorés ou bloqués dans le conteneur : 7 vitest (clé privée ; le test du
  build Windows, lui, passe dans la CI Windows), 90 Playwright (session
  licenciée).

## 4. Reste à faire pour passer en production

État au 21/10/2026, tête de la PR #34 : `433bf81`. La PR contient tout le
contenu de la branche par défaut (`arena/7d755e35-garageflowsv2`) et de
`main` (dont l'arbre est celui de `e6710cf`, ancêtre de la PR) : sa fusion
vers l'une ou l'autre ne crée aucun conflit.

Le verdict passera à GO quand les étapes 1 à 6 et 15 à 17 seront faites, et
que les étapes 7 et 8 seront tranchées pour les fonctions vendues.

### 4.1 Bloquant : accès que seul le propriétaire détient

| # | Action | Preuve attendue | Référence |
|---|---|---|---|
| 1 | Renouveler les secrets de production exposés historiquement (`NEXTAUTH_SECRET`, `GARAGEFLOW_API_KEY`, chaînes Neon, jetons Upstash…), migrer `GF_SMTP_CIPHER_KEY` en rechiffrant les mots de passe SMTP, synchroniser Vercel Development, Preview et Production | Rapport du configurateur (`npm run env:configure`) ; `/api/health` du nouveau déploiement ; un e-mail de test envoyé avec un mot de passe SMTP rechiffré | `docs/ROTATION_SECRETS.md` ; D05, D06, D08, D10 ; `EXTERNAL_BLOCKERS.md` n° 9, 10 |
| 2 | Configurer l'environnement GitHub `e2e-staging` : recette HTTPS hors production, compte et licence synthétiques, `E2E_NON_PRODUCTION=true` | Job « Authenticated browser validation » vert, donc « Required validation » vert | n° 12 ; D33 |
| 3 | Restaurer la clé privée de l'autorité de licences sur le poste de build, puis rejouer les 7 tests ignorés avec `GF_TEST_LICENSE` | Suite complète sans test ignoré hors Windows | n° 13 ; D15, D16 |
| 4 | Campagne sur Windows 10 et 11 vierges : installation, mise à jour Vn → Vn+1, réinstallation, réparation, désinstallation, application ouverte pendant la mise à jour, redémarrage, parcours licencié | Captures et journaux ; point de départ : `scripts/test-windows-setup.ps1`, déjà vert en CI pour l'installation | n° 1, 3 ; D23, D29 |
| 5 | Signer l'installateur et l'exe (Authenticode) ; signer le manifeste de la version candidate (Ed25519) | `signtool verify` ; poste qui refuse un binaire modifié et accepte la version signée | n° 2, 14 ; D24, D25 |
| 6 | Retrouver dans la base du keygen de production les licences émises depuis le 19/10 avec l'identifiant client « ex. CUST-042 », et les réémettre si nécessaire | Base du keygen sans cet identifiant | GF-1021-09 |

### 4.2 Décisions avant de vendre les fonctions concernées

| # | Action | Preuve attendue | Référence |
|---|---|---|---|
| 7 | Paiements : aucun module (paiement partiel ou multiple, remboursement, webhooks). Le développer, ou ne pas l'annoncer | Décision écrite | D36 |
| 8 | Facturation électronique : comptes de test de plateforme (PDP, Chorus Pro), validation XSD / Schematron officielle, avis d'un spécialiste de la conformité | Fichiers réels validés ; échange réussi avec une plateforme | D37 ; n° 7 |
| 9 | Administration : identités individuelles, MFA et droits fins à la place de la clé statique ; ré-émission des clés mécanicien à la réattribution | Conception validée, puis tests | n° 8, 8 bis |

### 4.3 Correctifs de code restants, faisables sans accès externe

| # | Action | Preuve attendue | Référence |
|---|---|---|---|
| 10 | Point d'accès qui retire la session d'un appareil libéré par le SAV, puis renvoi vers `/license` | Captures avant / après, comme pour GF-1021-10 | GF-1021-11 (P2) |
| 11 | Keygen : clés lues depuis `GF_LICENSE_PRIVATE_KEY_FILE` / `GF_LICENSE_PUBLIC_KEY_FILE`, à défaut `%APPDATA%\GarageFlows\keys` | Tests du keygen | D13 |
| 12 | Keygen : confirmations en français quelle que soit la langue du système ; molette ; affichages rognés | Captures | D27 ; GF-1021-12, 13 (P3) |
| 13 | Parcours client → véhicule → intervention → devis → facture joué dans le navigateur | Test Playwright et captures | D34 |
| 14 | Grille des variables d'environnement au format du brief (9 catégories, 12 attributs) | Document relu par le titulaire des comptes | D04 |

### 4.4 Mise en production

| # | Action | Preuve attendue | Référence |
|---|---|---|---|
| 15 | Porte « Final release gate (full) » verte sur le commit candidat | Run `workflow_dispatch` de la CI | lancée le 21/10 sur `433bf81` (run 646) |
| 16 | Fusionner la PR #34 dans la branche par défaut, puis dans `main` | Aucun conflit (voir ci-dessus) | — |
| 17 | Déployer après la rotation (configurateur, puis `vercel deploy --prod`), puis vérifier https://app.garageflows.fr : santé, connexion, activation d'une licence de test, E2E authentifié contre la production avec des comptes jetables | Rapport de déploiement ; E2E vert | n° 11 |

## 5. Risques résiduels

Voir `AUDIT_SECURITY.md` §6 et `EXTERNAL_BLOCKERS.md`.
