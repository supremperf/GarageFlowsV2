# Rapport de validation — preuves par captures d'écran

| | |
|---|---|
| Date | 21/10/2026 |
| Dépôt | `supremperf/GarageFlowsV2`, branche `claude/new-session-qkf0vj`, PR #34 (brouillon) |
| Base auditée | `3dc2293` |
| Dernier commit de code vérifié | `aeddc95` (les commits suivants ne modifient que la documentation) |
| Demande | « Vérification et preuve de réalisation des tâches par captures d'écran » |

Ce rapport rapproche chaque exigence du brief initial (deux missions : audit et
sécurisation de l'écosystème, puis ingénierie de finalisation ; consigne
finale « une fois terminé, mets à jour sur GitHub ») d'une preuve visuelle
réelle, puis conclut par un statut. Il s'adresse à un responsable, un client
ou un évaluateur qui n'a pas suivi la session.

## 1. Comment lire ce dossier

- `00_LISTE_DES_PREUVES.md` : les 39 exigences (D01 à D39) et la preuve
  nécessaire pour chacune, établies **avant** la première capture.
- `Capture_NN_Dxx_….png` : 94 captures numérotées. Le nom donne l'exigence
  (`Dxx`) et, le cas échéant, AVANT ou APRÈS un correctif.
- §4 : le tableau de validation, une ligne par exigence.
- §5 : les défauts trouvés pendant la vérification.
- §6 : les écarts et les actions correctives proposées.
- §7 : les limites de la vérification et les manipulations qui fourniraient
  les preuves manquantes.
- §8 : l'index des captures.
- `outils/` : les scripts exacts qui ont produit les captures.

## 2. Méthode et garanties

### 2.1 Origine des captures

| Type | Captures | Production | Ce que la capture garantit |
|---|---|---|---|
| Terminal | 01 à 35, 51, 88 à 90 | Commande réellement exécutée dans un `xterm` sur un affichage X virtuel (Xvfb), fenêtre capturée par ImageMagick (`outils/capt.sh`) | En-tête : date UTC, dossier, branche, commit. Puis la commande exacte, sa sortie et son code de sortie. |
| Keygen | 36 à 50, 52 à 60, 64, 65, 67, 70, 74, 76, 77, 81, 84, 86, 87, 91 | Le vrai `scripts/keygen_ui.py` sous Tk 8.6, piloté à la souris et au clavier (xdotool) | L'écran tel que l'opérateur le voit. |
| Application | 61 à 63, 66, 68, 69, 71 à 73, 75, 78 à 80, 82, 83, 85 | Serveur Next.js de la copie de démonstration, Chromium piloté par Playwright (`outils/web.cjs`) | La page réelle et les réponses réelles des API. |
| GitHub | 92 à 94 | Pages publiques de github.com, Chromium sans connexion | L'état réel de la PR et de la CI au moment de la capture. |

Aucune capture n'est une maquette, un montage ni une image générée. Les
seules retouches sont des **masquages** : un rectangle noir légendé
« masqué ».

### 2.2 Informations confidentielles et personnelles

| Information | Traitement |
|---|---|
| Jeton de licence | Masqué ; seul le préfixe `GF2.` reste visible (captures 60, 66, 68). |
| Mot de passe | Masqué (capture 61). |
| Clé API du keygen | Masquée par l'interface elle-même, en points (capture 52). |
| Autres secrets | Jamais affichés : les scripts les lisent dans des fichiers en mode 600. |
| Données personnelles | Aucune. Bénéficiaire fictif « Camille Martin, Garage de démonstration (TEST), contact@garage-demo.test ». Clients, véhicules et le compte `admingarageflow@admin.fr` viennent du jeu de démonstration du dépôt (`prisma/seed.ts`). |

### 2.3 Autorité de licence

La clé privée de l'autorité de production n'est pas dans le dépôt, et ne doit
pas y être. Le cycle de vie d'une licence a donc été joué avec une **autorité
de test jetable** (empreinte `f6966933bac5d80e`), créée dans une **copie
isolée** du dépôt, avec son propre serveur de développement et sa propre base
(capture 51). L'autorité de production (`b16d2e1bf6b9662f`) n'a jamais été
touchée (captures 09, 51). Les licences de test ne valent que pour cette copie.

### 2.4 Statuts

| Statut | Sens |
|---|---|
| **Réalisée** | Une preuve concrète montre l'exigence satisfaite. |
| **Partiellement réalisée** | Une partie seulement est prouvée ou conforme ; l'écart est décrit. |
| **Non réalisée** | Le constat prouvé est que l'exigence n'est pas satisfaite. |
| **Non vérifiable** | La preuve ne peut pas être produite depuis cet environnement ; la manipulation nécessaire est au §7. |

## 3. Synthèse

| Statut | Nombre | Exigences |
|---|---|---|
| Réalisée | 25 | D01, D02, D03, D07, D09, D11, D12, D14, D15, D16, D17, D18, D19, D20, D21, D22, D24, D25, D26, D28, D30, D31, D32, D35, D38 |
| Partiellement réalisée | 8 | D04, D13, D23, D27, D29, D33, D34, D37 |
| Non réalisée | 2 | D36, D39 |
| Non vérifiable | 4 | D05, D06, D08, D10 |

**Ce que la vérification a changé.** Les captures ont révélé quatre défauts
réels que toutes les suites automatisées, vertes, laissaient passer. Trois
sont corrigés et prouvés avant/après, un reste ouvert :

- GF-1021-08 : cinq pages du keygen n'affichaient que leur titre ;
- GF-1021-09 : le keygen lisait ses textes indicatifs comme des saisies ;
  une licence sans liaison matérielle était impossible à générer ;
- GF-1021-10 : une licence suspendue ou révoquée laissait l'application en
  chargement infini après un rechargement ;
- GF-1021-11 (ouvert) : un poste web dont l'appareil a été libéré par le SAV
  reste bloqué, jusqu'à 30 jours.

**Conclusion.** L'essentiel de ce qui pouvait être prouvé depuis cet
environnement l'est, captures à l'appui ; la seule exception, le parcours
métier rejoué à l'écran (D34), est signalée. Le logiciel n'est **pas prêt pour une mise en production
certifiée** (D39 : NO-GO). Ce qui manque relève surtout d'accès que la
session n'avait pas : comptes Vercel, Neon et Upstash, clé de l'autorité
réelle, poste Windows. Il manque aussi un module de paiement et
l'interconnexion de la facturation électronique.

## 4. Tableau de validation

| Numéro de la demande | Description de l'exigence | Action réalisée | Statut | Référence de la capture d'écran | Commentaire et conclusion |
|---|---|---|---|---|---|
| D01 | Audit intégral et cartographie avant toute modification (mission 1 §1.1, mission 2 §4) | Cartographie de l'architecture et des fichiers ; tests rejoués sur la base `3dc2293` avant toute correction | Réalisée | 03, 04, 21 | Deux échecs réels constatés avant correction (stock, OCR). Écart de forme corrigé : 2 656 fichiers suivis dans `AUDIT_GLOBAL.md`, 2 667 lors de la capture (fichiers ajoutés par la campagne). |
| D02 | Mettre à jour sur GitHub une fois terminé | Branche poussée ; PR #34 ouverte en brouillon et mise à jour à chaque correctif ; CI rejouée à chaque poussée | Réalisée | 01, 92, 93, 94 | Sur `aeddc95`, tous les jobs sont verts sauf « Authenticated browser validation (approved staging only) », qui exige des secrets de staging absents du dépôt (annotation `MISSING_INPUT:BASE_URL`, capture 93), et l'agrégateur « Required validation » qui en dépend. La fusion reste une décision du responsable. |
| D03 | Livrables documentaires : 9 documents (mission 2 §22) et rapport final (mission 1 §20) | Les 9 documents dans `docs/audit/2026-10-21/`, plus ce dossier de preuves | Réalisée | 02 | Documents mis à jour en fin de campagne (GF-1021-08 à 13, chiffres finaux). |
| D04 | Inventaire et classification de toutes les variables `.env` (mission 1 §3.2) | Manifeste du dépôt lu sans aucune valeur : 142 variables canoniques classées, 8 alias interdits, 53 variables de plateforme ; contrôle de cohérence vert | Partiellement réalisée | 06 | La classification suit la taxonomie du dépôt (`configuration`, `dangerous`, `external`, `secret`…), avec 6 attributs par variable (`docs/VARIABLES_ENVIRONNEMENT.md`). La grille exigée (9 catégories, 12 attributs dont propriétaire et statut actuel) n'a pas été produite telle quelle. Voir §6. |
| D05 | Renouveler les secrets internes (mission 1 §3.3) | Constat des accès disponibles | Non vérifiable | 08 | Aucun jeton Vercel, Neon ni Upstash, aucune CLI. Aucune valeur de production n'a été générée : déployer une configuration incomplète est interdit. Manipulation au §7. |
| D06 | Connexions Neon et Upstash réelles (mission 1 §3.4) | Même constat | Non vérifiable | 08 | PostgreSQL et Redis ont été éprouvés sur des instances locales jetables (26, 88), pas sur les comptes réels. |
| D07 | Conserver les variables externes et SMTP (mission 1 §3.5) | Comparaison de la base `3dc2293` avec la tête de branche | Réalisée | 07 | Aucun fichier d'environnement modifié. Les valeurs de production (Vercel) n'étaient ni lisibles ni modifiables depuis la session. |
| D08 | Migration de `GF_SMTP_CIPHER_KEY` (mission 1 §3.6) | Constat : aucune base de production accessible | Non vérifiable | 08 | Rechiffrement à faire sur la base réelle, selon `docs/ROTATION_SECRETS.md`. |
| D09 | Autorité ECC préservée, aucune paire régénérée en cachette (mission 1 §3.7) | Ancrages publics alignés sur `b16d2e1b…` ; keygen sans clé qui refuse d'inventer une autorité ; autorité de démonstration créée dans une copie | Réalisée | 09, 41, 51 | Aucune clé privée n'a été recherchée, reconstruite ni exposée. |
| D10 | Synchronisation Vercel Development / Preview / Production (mission 1 §4) | Constat des accès | Non vérifiable | 08 | Manipulation au §7. |
| D11 | Secrets hors de Git, `.gitignore` complété (mission 1 §4.4, §13) | `*.pem`, `*.key`, `*.sig` ignorés partout (GF-1021-05) ; Gitleaks 8.24.3 sur l'arbre suivi | Réalisée | 10, 11, 93 | 0 occurrence ; job Gitleaks de la CI vert. |
| D12 | Keygen Python : toutes les sections, en français (mission 1 §6.2) | Les 10 sections du keygen livré capturées ; 5 pages vides constatées puis corrigées (GF-1021-08) ; textes indicatifs corrigés (GF-1021-09) ; 19 tests sur le vrai keygen affiché | Réalisée | 36 à 45 (avant), 46 à 50 (après), 52 à 60, 89, 90 | Avant cette vérification, l'exigence était déclarée satisfaite alors que la moitié des sections était inutilisable. Deux défauts mineurs restent ouverts : molette (GF-1021-12), affichages rognés (GF-1021-13). |
| D13 | Gestion ECC P-256, PEM, emplacements `%APPDATA%` et `GF_LICENSE_*_KEY_FILE` (mission 1 §6.3) | Page « Clés ECC » ; recherche des emplacements demandés dans le code | Partiellement réalisée | 12, 41 | P-256, PEM, empreinte et contrôle des ancrages : conformes. Les clés sont lues seulement dans `keys/` du dépôt : ni `%APPDATA%`, ni `GF_LICENSE_PRIVATE_KEY_FILE` / `GF_LICENSE_PUBLIC_KEY_FILE`. |
| D14 | Offres PREMIUM et ADMIN uniquement (mission 1 §6.4) | Écran de génération ; licence PREMIUM réellement signée | Réalisée | 37, 60 | Deux offres seulement. |
| D15 | Créer, consulter, suspendre, réactiver, révoquer une licence (mission 1 §6.4) | Cycle complet avec l'autorité de test : création dans le keygen, activation dans Chromium, état serveur consulté, suspension, réactivation, révocation, réactivation avec motif obligatoire, journal d'audit | Réalisée | 51 à 65, 68 à 72, 74 à 84, 86 | Chaque changement d'état fait dans le keygen apparaît dans l'application en quelques secondes. A fait corriger GF-1021-09 et GF-1021-10. Avec l'autorité de production : non vérifiable ici (clé privée absente par conception). |
| D16 | Format signé canonique, compatibilité Python / Node (mission 1 §6.5) | Tests de compatibilité croisée | Réalisée | 13 | 41 réussis ; 4 ignorés qui exigent la clé privée de production. |
| D17 | HWID V1 officiel, vecteurs identiques Node / Python (mission 1 §7.1-7.2) | Vecteurs de test des deux implémentations ; page « Appareils et HWID » | Réalisée | 14, 40, 48, 87 | 23 tests vitest et 10 tests Python. |
| D18 | Première activation atomique, refus d'un appareil en trop (mission 1 §7.4) | Concurrence réelle sur PostgreSQL ; dans le navigateur, 1er appareil activé, 2e refusé, siège libéré par le SAV puis réactivation | Réalisée | 15, 65, 66, 67, 69, 91 | Refus affiché : « Nombre maximal d'appareils atteint pour cette licence (1) ». Défaut connexe ouvert : l'appareil libéré reste bloqué côté web (GF-1021-11, captures 73, 85). |
| D19 | Compatibilité HWID V0 / V1 (mission 1 §7.3) | Tests de coexistence | Réalisée | 14 | — |
| D20 | PostgreSQL : migrations sans perte (mission 1 §8.1, mission 2 §9) | 22 migrations rejouées sur une base vierge, contraintes et cascade vérifiées | Réalisée | 16 | Base locale jetable, pas la base Neon de production. |
| D21 | SQLite poste : transactions et concurrence (mission 1 §8.2) | Interblocage reproduit puis corrigé (GF-1021-01) | Réalisée | 04, 05 | Avant : 2 échecs par dépassement de délai. Après : réussite. |
| D22 | API authentifiées et autorisées (mission 1 §8.3, mission 2 §8) | Chaque méthode exportée appelée sans session | Réalisée | 17 | Aucune donnée sans authentification. 245 couples méthode × route sur 246 : seul le gestionnaire NextAuth (`GET /api/auth/[...nextauth]`) n'a pas été balayé. Chiffre corrigé dans `AUDIT_API.md`, qui indiquait 244 à tort. |
| D23 | Electron : IPC, preload, démarrage du serveur local (mission 1 §8.4) | Tests du preload et de l'IPC ; job Windows de la CI qui installe et lance le vrai Setup | Partiellement réalisée | 18, 94 | Electron ne s'exécute pas dans le conteneur. Le lancement n'est prouvé que par la CI Windows, dont les journaux exigent une connexion GitHub. Aucune capture de la fenêtre Electron. |
| D24 | `npm run sign-update`, message exact sans clé (mission 1 §9.2-9.3) | Exécution réelle sans clé, puis avec une clé étrangère ; onglet « Mises à jour » du keygen | Réalisée | 19, 42 | Le glisser-déposer annoncé exige le module `tkinterdnd2`, absent : l'écran le signale (42). |
| D25 | Vérification des mises à jour côté client (mission 1 §9.4, §14.6) | Refus d'un binaire modifié et d'une clé étrangère | Réalisée | 20 | — |
| D26 | Détection des secrets sur les captures, masquage, blocage (mission 1 §10) | Captures réelles contenant des secrets factices, analysées avant et après correctif (GF-1021-02) ; service local | Réalisée | 21, 22, 23, 43, 49 | Avant : clé OpenAI non bloquée, clé Stripe manquée. Après : bloquées, valeurs masquées. |
| D27 | Interfaces en français, messages d'état (mission 1 §11) | Revue de toutes les captures d'interface | Partiellement réalisée | 52 à 87 | Keygen et application en français, messages d'état clairs (« Compte suspendu », « Compte révoqué », « Compte réactivé »…). Exception : les boîtes de confirmation Tk affichent « Yes / No » (67, 76) sous la locale de l'environnement Linux. Sous Windows, Tk utilise les boîtes natives, dans la langue du système (non vérifié). |
| D28 | `npm install` puis `npm run dist` produisant l'installateur (mission 1 §12, mission 2 §12.3) | Build d'empaquetage local ; `npm run dist` complet sur `windows-latest` | Réalisée | 31, 94 | Impossible dans le conteneur (téléchargement d'Electron refusé) ; prouvé par la CI. |
| D29 | Installation, lancement, réinstallation, désinstallation, mise à jour (mission 2 §12.4-12.5) | Étape de la CI « Install, launch, reinstall and uninstall the actual single-file Setup » | Partiellement réalisée | 94 | Installation, lancement, réinstallation et désinstallation : verts. Mise à jour Vn → Vn+1, Windows 10/11 vierge et parcours licencié sous Windows : non testés. Setup non signé (Authenticode). |
| D30 | Lint et typage sans erreur (mission 1 §15) | `tsc --noEmit`, ESLint | Réalisée | 24, 93 | 0 erreur, 0 avertissement ; rejoué par la CI. |
| D31 | Aucune vulnérabilité de dépendance (mission 1 §15.1, mission 2 §12.2) | `npm audit` | Réalisée | 25, 93 | 0 vulnérabilité, toutes sévérités. |
| D32 | Suite de tests complète sans échec (mission 2 §16) | Vitest avec PostgreSQL 16 et Redis réels ; suites Python et Node | Réalisée | 26, 27, 28, 88, 89 | Fin de campagne : 4 378 réussis, 0 échec, 7 ignorés (clé privée de production, build Windows) ; Python 20 + 10 + 93 + 39 + 19 ; Node 483. |
| D33 | Tests de bout en bout dans un navigateur (mission 2 §13) | Playwright, 6 gabarits ; parcours de licence joué dans Chromium | Partiellement réalisée | 29, 61 à 85, 93 | 54 réussis, 90 ignorés faute de session licenciée. Le job E2E authentifié de la CI est bloqué (secrets de staging). Le parcours de licence a été joué hors suite, dans la copie de démonstration. |
| D34 | Parcours métier client → véhicule → intervention → devis → facture (mission 2 §7.1) | Tests d'intégration du parcours ; écran du planning | Partiellement réalisée | 30, 63, 75 | 107 tests d'intégration réussis. À l'écran, seul le planning a été capturé : le parcours complet n'a pas été rejoué dans l'interface. |
| D35 | Stock : pas de double déduction, concurrence (mission 2 §7.2) | Avant / après du correctif GF-1021-01 | Réalisée | 04, 05 | Le stock restait juste avant correctif ; c'est l'interblocage qui faisait échouer les validations. |
| D36 | Paiements : partiel, multiple, remboursement, webhooks (mission 2 §6.7) | Constat dans les schémas et les routes | Non réalisée | 33 | Aucun modèle ni route de paiement : « payée » est un simple statut de facture. |
| D37 | Facturation électronique et conformité (mission 2 §11) | 313 tests des formats, de la file et des webhooks signés ; niveaux atteints | Partiellement réalisée | 34 | Niveaux 1 et 2 atteints. Tests de conformité, interconnexion (PDP, Chorus Pro) et conformité réglementaire : non faits. |
| D38 | Aucun secret dans les bundles et artefacts (mission 2 §15) | Recherche dans la sortie de build ; Gitleaks | Réalisée | 11, 32 | Seule la clé publique (`b16d2e1b…`) est embarquée. |
| D39 | Logiciel prêt pour la production (mission 2 §25) | Verdict argumenté | Non réalisée | 35 | NO-GO : secrets de production non renouvelés, autorité réelle et Windows réel non éprouvés, paiements absents, e-facturation non interconnectée, GF-1021-11 ouvert. |

## 5. Défauts trouvés pendant la vérification

| ID | Gravité | Constat | Preuve avant | Correctif | Preuve après | Statut |
|---|---|---|---|---|---|---|
| GF-1021-08 | P1 | Keygen : « Gérer les licences », « Clients », « Appareils et HWID », « Détection des secrets », « Journaux » n'affichaient que leur titre | 38, 39, 40, 43, 44 | `b4a291c` : le cadre de chaque carte est placé | 46 à 50 | Corrigé |
| GF-1021-09 | P1 | Keygen : licence sans HWID refusée (« HWID invalide »), identifiant client « ex. CUST-042 » signé, listes vides (« 0 licence(s) affichée(s) sur 1 »), contrôle des champs de mise à jour contourné | 53 à 56 | `5993010` : texte indicatif posé par-dessus le champ, jamais écrit dedans | 57 à 60, 90 | Corrigé |
| GF-1021-10 | P2 | Licence suspendue ou révoquée : après un rechargement, « Chargement du planning… » sans fin ni message | 72, 79 | `aeddc95` : overlay de licence monté dès l'écran de chargement ; rechargement après réactivation | 80, 82, 83, 90 | Corrigé |
| GF-1021-11 | P2 | Appareil libéré par le SAV : le poste web reste sur l'écran de chargement (API : 401 « Appareil inconnu. Réactivez votre licence. ») jusqu'à expiration de la session (30 jours) | 73, 85 | — | — | **Ouvert** (§6) |
| GF-1021-12 | P3 | Keygen : la molette ne fait pas défiler les formulaires | constat pendant les captures | — | — | Ouvert |
| GF-1021-13 | P3 | Keygen : première ligne du panneau de synthèse masquée, notifications superposées, noms tronqués (1 280 × 860) | 64, 67, 76, 91 | — | — | Ouvert |

Le détail (cause, correction, tests) est dans `../BUGFIX_CHANGELOG.md`. Pour
chaque correctif, de nouveaux tests échouent sur l'ancien code et passent
avec le correctif (capture 90). La suite complète reste à 0 échec (88, 89).

## 6. Écarts et actions correctives

| Exigence ou défaut | Écart | Action corrective proposée | Qui |
|---|---|---|---|
| D04 | Grille du brief (9 catégories, 12 attributs) non produite | Dériver la grille du manifeste `scripts/garageflow-env-manifest.json` : `secret`, `generated`, `runtime-generated` → secret interne ; `DATABASE_URL`, `DIRECT_URL` → connexion Neon ; `UPSTASH_*` → connexion Upstash ; `SMTP_*` → configuration SMTP externe ; `external*` → identifiant fournisseur ou clé API externe ; `configuration` → variable métier ; les 8 alias interdits → anciennes variables. Compléter propriétaire et statut actuel avec le titulaire des comptes. | Équipe, puis titulaire des comptes |
| D05, D06, D08, D10 | Aucun accès aux comptes de production | Rotation selon `docs/ROTATION_SECRETS.md`, migration de `GF_SMTP_CIPHER_KEY` comprise, par le titulaire des comptes Vercel, Neon et Upstash. Preuves à capturer au §7. | Titulaire des comptes |
| D13 | Emplacements `%APPDATA%` et `GF_LICENSE_*_KEY_FILE` non pris en charge | Lire `GF_LICENSE_PRIVATE_KEY_FILE` / `GF_LICENSE_PUBLIC_KEY_FILE`, à défaut `%APPDATA%\GarageFlows\keys`, en gardant le contrôle des ancrages publics ; ou décision écrite de conserver `keys/`. | Équipe |
| D23, D29 | Pas de Windows réel ; mise à jour Vn → Vn+1 non testée ; Setup non signé | Campagne sur une machine virtuelle Windows 10 et 11 vierge (§7) ; certificat Authenticode. | Équipe, achat du certificat |
| D27 | Boutons « Yes / No » des confirmations Tk sous Linux | Forcer la locale des messages Tk au démarrage du keygen (`msgcat::mclocale fr`), ou des boîtes de confirmation maison. | Équipe |
| D33 | E2E authentifié de la CI bloqué | Créer l'environnement GitHub approuvé et ses secrets de staging (`BASE_URL` et les autres entrées du job), avec une licence de test signée. | Responsable du dépôt |
| D34 | Parcours métier non rejoué à l'écran | Scénario Playwright client → véhicule → intervention → devis → facture, avec captures de chaque étape. | Équipe |
| D36 | Aucun module de paiement | Décision produit : développer le module, ou ne pas annoncer de suivi des paiements. | Responsable produit |
| D37 | E-facturation non interconnectée | Comptes de test de plateforme (PDP, Chorus Pro), validation XSD / Schematron officielle, avis d'un spécialiste de la conformité. | Équipe, spécialiste |
| D39 | NO-GO | Lever les points ci-dessus, puis rejouer ce dossier. | Responsable |
| GF-1021-09 (suite) | Licences déjà émises avec l'identifiant client « ex. CUST-042 » | Rechercher dans la base du keygen de production (`keys/licenses_db.json`) les licences émises depuis le 19/10 avec cet identifiant ; elles restent valides, mais leur rattachement client est faux : les réémettre si nécessaire. | Opérateur du keygen |
| GF-1021-11 | Appareil libéré bloqué côté web | Point d'accès serveur qui expire `gf_session`, `gf_license_validated` et `gf_license_type`, appelé par la page d'accueil sur un 401 de licence ou d'appareil, puis renvoi vers `/license` (même solution que `/api/mechanic/logout` pour l'espace mécanicien). Contournement : effacer les cookies du site. | Équipe |
| GF-1021-12, GF-1021-13 | Ergonomie du keygen | Lier la molette sur la fenêtre racine ; hauteurs et largeurs adaptatives. | Équipe |

## 7. Limites de la vérification et manipulations nécessaires

| Limite | Effet sur les preuves | Manipulation qui fournirait la preuve |
|---|---|---|
| Aucun accès Vercel, Neon, Upstash | D05, D06, D08, D10 non vérifiables | Après rotation, capturer : la page des variables Vercel par environnement (valeurs masquées par Vercel), le tableau de bord Neon montrant une connexion récente, la console Upstash, puis `GET /api/health` en production ; vérifier qu'un mot de passe SMTP rechiffré permet toujours l'envoi d'un e-mail de test. |
| Clé privée de l'autorité de production absente (par conception) | Licences réelles non éprouvées ; 7 tests ignorés | Sur le poste de build, avec `keys/private.pem` restauré depuis sa sauvegarde : générer une licence de test réelle, l'activer sur un poste, capturer, puis la révoquer ; rejouer les 7 tests avec `GF_TEST_LICENSE`. |
| Pas de Windows dans le conteneur | Pas de capture de la fenêtre Electron ; mise à jour Vn → Vn+1 non testée | Machine virtuelle Windows 10 et 11 vierge : installer le Setup produit par la CI (artefact de la PR), capturer le premier lancement, l'activation, une mise à jour vers une version supérieure signée, puis la désinstallation avec données conservées. |
| Journaux de la CI non lisibles sans connexion | Les captures 93 et 94 montrent les étapes et leur statut, pas les journaux | Ouvrir le run connecté à GitHub ; le détail a été lu par l'API et consigné dans `../AUDIT_BUILD_INSTALLATION.md` §4. |
| Application capturée sur un serveur de développement | La pastille « N » de Next.js est visible en bas à gauche des captures web ; comportement fonctionnel identique, performances non représentatives | Rejouer les captures 61 à 85 sur un build de production (`npm run build`, puis `npm start`). |
| Keygen capturé sous Linux (Tk 8.6) | Rendu Windows non vérifié (polices, boîtes natives) | Lancer `scripts/keygen_ui.py` sous Windows et refaire les captures 36 à 60. |

## 8. Index des captures

| N° | Exigence | Contenu |
|---|---|---|
| 01 | D02 | Branche poussée, état Git |
| 02 | D03 | Les 9 livrables documentaires |
| 03 | D01 | Cartographie de l'architecture, 2 667 fichiers suivis |
| 04 | D21, D35 | Stock, AVANT correctif : 2 échecs (interblocage SQLite) |
| 05 | D21, D35 | Stock, APRÈS correctif : réussite |
| 06 | D04 | Classification des variables d'environnement, sans valeur |
| 07 | D07 | Variables externes inchangées (aucun fichier d'environnement modifié) |
| 08 | D05, D06, D08, D10 | Accès de production absents de la session |
| 09 | D09 | Ancrages de la clé publique alignés (`b16d2e1b…`) |
| 10 | D11 | `.gitignore` : clés et signatures |
| 11 | D11, D38 | Gitleaks 8.24.3 : 0 occurrence |
| 12 | D13 | Emplacements des clés du keygen : `keys/` seulement |
| 13 | D16 | Format signé, compatibilité Python / Node |
| 14 | D17, D19 | HWID V1, vecteurs, coexistence V0 |
| 15 | D18 | Activations concurrentes sur PostgreSQL réel |
| 16 | D20 | 22 migrations PostgreSQL sur base vierge |
| 17 | D22 | Balayage des API sans session |
| 18 | D23 | Tests Electron : preload et IPC |
| 19 | D24 | `sign-update` sans clé, puis avec une clé étrangère |
| 20 | D25 | Vérification des mises à jour côté client |
| 21 | D26 | OCR, AVANT correctif : secrets non détectés |
| 22 | D26 | OCR, APRÈS correctif : secrets bloqués et masqués |
| 23 | D26 | Service local de scan : origine distante refusée |
| 24 | D30 | TypeScript et ESLint : 0 erreur |
| 25 | D31 | `npm audit` : 0 vulnérabilité |
| 26 | D32 | Vitest complet, PostgreSQL et Redis réels (milieu de campagne) |
| 27 | D32 | Suites Python (milieu de campagne) |
| 28 | D32 | Suites Node |
| 29 | D33 | Playwright, 6 gabarits |
| 30 | D34 | Parcours métier, tests d'intégration |
| 31 | D28 | Build d'empaquetage local |
| 32 | D38 | Sortie de build sans secret |
| 33 | D36 | Absence de module de paiement |
| 34 | D37 | Facturation électronique : tests et niveaux atteints |
| 35 | D39 | Verdict de mise en production |
| 36 à 45 | D12 et autres | Keygen tel que livré, ses 10 sections (38, 39, 40, 43, 44 : pages vides) |
| 46 à 50 | D12 | Keygen APRÈS GF-1021-08 : les cinq pages affichent leur contenu |
| 51 | D15 | Copie isolée : autorité de TEST jetable, production inchangée |
| 52 | D15 | Keygen relié au serveur de démonstration (clé API masquée) |
| 53 | D15 | AVANT GF-1021-09 : génération sans HWID refusée |
| 54 | D15 | AVANT GF-1021-09 : tableau de bord, 1 licence |
| 55 | D15 | AVANT GF-1021-09 : « 0 licence(s) affichée(s) sur 1 » |
| 56 | D15 | AVANT GF-1021-09 : « 0 client(s) » |
| 57 | D15 | APRÈS GF-1021-09 : « 1 licence(s) affichée(s) sur 1 » |
| 58 | D15 | APRÈS GF-1021-09 : identifiant « ex. CUST-042 » signé avant le correctif |
| 59 | D15 | APRÈS GF-1021-09 : HWID vide, « Aucune liaison » |
| 60 | D14, D15 | Licence PREMIUM sans HWID signée (jeton masqué) |
| 61 | D15 | Connexion à l'application (mot de passe masqué) |
| 62 | D15 | Licence requise après connexion |
| 63 | D15, D34 | Planning accessible après activation |
| 64 | D15 | Keygen synchronisé : serveur « Active », première activation |
| 65 | D15, D18 | Fiche complète : état serveur, 1 / 1 siège |
| 66 | D18 | Second appareil refusé (licence à 1 siège) |
| 67 | D18 | SAV : confirmation de la libération des appareils |
| 68 | D15 | Jeton collé dans l'application (masqué) |
| 69 | D15, D18 | Activation réussie après libération du siège |
| 70 | D15 | Keygen : licence suspendue |
| 71 | D15 | Application ouverte : « Compte suspendu » |
| 72 | D15 | AVANT GF-1021-10 : rechargement pendant la suspension, chargement infini |
| 73 | D18 | GF-1021-11 : appareil libéré, chargement infini |
| 74 | D15 | Keygen : licence réactivée |
| 75 | D15 | Planning de nouveau accessible |
| 76 | D15 | Keygen : confirmation de révocation |
| 77 | D15 | Keygen : licence révoquée |
| 78 | D15 | Application ouverte : « Compte révoqué » |
| 79 | D15 | AVANT GF-1021-10 : rechargement pendant la révocation, chargement infini |
| 80 | D15 | APRÈS GF-1021-10 : rechargement, « Compte révoqué » affiché |
| 81 | D15 | Keygen : réactivation d'une licence révoquée, motif obligatoire |
| 82 | D15 | APRÈS GF-1021-10 : « Compte réactivé » |
| 83 | D15 | APRÈS GF-1021-10 : planning rechargé automatiquement |
| 84 | D15 | Keygen : licence de nouveau active |
| 85 | D18 | GF-1021-11 NON CORRIGÉ : appareil libéré, toujours bloqué |
| 86 | D15 | Journal d'audit du keygen : tout le cycle de vie |
| 87 | D17 | Appareils et HWID : licence liée et non liée |
| 88 | D32 | Vitest complet APRÈS les correctifs : 4 378 réussis, 0 échec |
| 89 | D12, D32 | Suites Python APRÈS les correctifs |
| 90 | D12, D15 | Nouveaux tests : échecs sur l'ancien code, réussite avec les correctifs |
| 91 | D18 | SAV : appareils libérés ; notifications superposées (GF-1021-13) |
| 92 | D02 | Page de la PR #34 sur GitHub |
| 93 | D02 | Run de CI sur `aeddc95` : graphe des jobs et annotations |
| 94 | D23, D28, D29 | Job Windows : empaquetage, installation, lancement, réinstallation, désinstallation |

## 9. Outils de capture

Copies exactes des scripts utilisés, dans `outils/`. Ils lisent les secrets
dans des fichiers en mode 600 et ne les affichent jamais. Les chemins qu'ils
contiennent sont ceux de l'environnement de la session.

| Script | Rôle |
|---|---|
| `capt.sh` | Exécute une commande dans un `xterm` sur l'affichage virtuel, capture la fenêtre avec en-tête (date, branche, commit) |
| `keygen-start.sh`, `keygen-shot.sh` | Lancent le vrai keygen d'une copie, puis capturent une section |
| `masque.sh` | Recouvre une zone d'un rectangle noir légendé |
| `web.cjs` | Pilote Chromium (Playwright) sur l'application : connexion, activation, observation des changements d'état |
| `gh-shot.cjs` | Capture une page publique de GitHub |
| `env-classes.cjs`, `sweep2.mjs`, `ocr-table.sh` | Résumé du manifeste d'environnement (noms seulement), balayage des API sans session, tableau OCR |
