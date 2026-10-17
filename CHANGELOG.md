<!-- doc-numbers: journal — comptes datés point-dans-le-temps, exempts du contrôle de compte courant (V13.1) -->
# Changelog

## [Non publié] — 2026-10-16 — chaîne build → installeur Windows réparée à la cause, page unique, vue globale des rendez-vous

### `node config` — saisie fournisseur et découverte Blob

- Les champs fournisseur acceptent valeur brute, guillemets et ligne complète
  `NOM="valeur"` ; récupération des brouillons Blob mal enveloppés, sans modifier
  les mots de passe bruts. Une mauvaise variable collée est redemandée sans fuite.
- Blob : prise en charge des stores historiques sans `type`, détails/connexions
  après liste incomplète et hints authentifiés par cible ; récupération d’un
  unique token préfixé. Aucun contournement du rattachement ou des droits.
- Diagnostic précis sans valeurs : inventaire, portée, format, refus API, store
  suspendu/absent, réseau/service. Les erreurs d’association/réseau permettent
  une nouvelle vérification sans demander le même token en boucle.
- Empreintes des tokens exposés en transcription ajoutées au registre : renouveler
  ces accès, sans les publier dans un chat. Aucun token client utilisé en test.

### `node config` — génération des secrets internes et récupération des accès

- `NEXTAUTH_SECRET` et `GARAGEFLOW_API_KEY` réellement absents sont préparés
  automatiquement (32 octets, base64/hexadécimal) et sauvegardés avant les saisies
  fournisseurs ; reprise sans régénération. Les clés existantes sont préservées.
- Les autres clés internes d’une base neuve sont générées au format applicatif.
  Une base utilisée ou une clé distante masquée exige encore les originaux de
  protection des données : aucune rotation aveugle de clés AES/MAC/appareils.
- Les accès Vercel disponibles sont réutilisés par environnement ; les accès
  fournisseurs irrécupérables sont demandés, jamais inventés. Les invitations
  de récupération Neon/Redis inutiles ne sont plus affichées.

### `node config` — gestion transactionnelle différentielle des trois environnements

- Nouveau mode par défaut idempotent : compte/projet/équipe vérifiés, inventaire
  Development/Preview/Production, sources locales par cible, plan différentiel,
  confirmations, sauvegardes et journal avant chaque requête, relectures et
  rollback vérifié lorsque possible. Aucune migration/déploiement implicite.
- Simulation en ligne/hors ligne sans mutations ; clés existantes conservées,
  génération des clés de protection conditionnée à une base vide et absence
  distante ; originaux de protection demandés sur base utilisée ; rotation des
  secrets de session existants explicite.
- Neon : référence non secrète, encodage unique des mots de passe, SSL, probes
  Prisma poolée/directe. Upstash PING ; Blob association/cible + SDK épinglé,
  sonde PUT/HEAD/DELETE optionnelle autorisée. Aucun token fournisseur inventé.
- `.env.storage.local` de test retiré du suivi ; empreintes des accès publiés
  refusées avant utilisation. L’historique public n’est pas purgé : révocation
  chez Neon/Upstash/Blob toujours obligatoire. `.env.*` privés ignorés.
- Fichiers isolés par environnement, `.env` SQLite préservé, entrées à compléter
  reprises sans recommencer. Valeurs masquées : vérification partielle explicite,
  jamais un faux succès global. Aucun consommateur Blob applicatif trouvé.
- Tests d’orchestration, idempotence, panne après mutation, rollback, Git,
  séparation des cibles, secrets, sondes et API ajoutés aux commandes locales/CI.
  Les validations cloud sur compte client restent à exécuter avec de nouveaux accès.

### `node config` — rendre le blocage Storage vérifiable sans reconstruire

- Le retour réel après le correctif précédent détecte les ressources liées mais
  ne récupère toujours aucun des quatre accès requis. Les compteurs de schéma 1
  ne permettent pas de conclure à un refus de permission : `denied` mélangeait
  masquage, erreur API et réponse inexploitable. Pas de résolution live revendiquée.
- Diagnostic schéma 2 : causes distinctes, statut HTTP disponible, codes filtrés,
  tentative avant/après login et indicateurs de forme/protection sans valeurs.
  Le type Sensitive seul ne déclenche plus de login spéculatif ; HTTP 403 sans
  code discriminant ne prouve ni RBAC ni MFA. Les erreurs CLI brutes restent privées.
- `node config --diagnostic-storage` produit seulement ce rapport après
  confirmation du projet déjà lié, sans reconstruction, export de secrets,
  login interactif, migration ou mutation distante. Tests de non-divulgation,
  statuts réels du CLI, causes distinctes et lecture seule ajoutés.

### `node config` — retrouver les connexions Storage au lieu de rejeter les secrets lus

- Correction d’une cause du blocage Windows sur les paramètres PostgreSQL/Redis :
  `pullVercel` supprimait systématiquement les valeurs marquées Sensitive ou
  `visibility: secret`, même lorsqu’elles avaient été réellement renvoyées.
  La lecture distingue désormais protection, valeur exploitable et placeholder.
- Récupération API authentifiée de production, demande de déchiffrement puis
  lectures ciblées par les IDs réels des variables. Une reconnexion officielle
  au maximum si les droits de lecture nécessitent une authentification récente.
- Découverte Storage en lecture seule, y compris types Postgres/Redis natifs,
  métadonnées absentes de la liste, préfixes d’intégration et `contentHint`.
  Pas de reconnexion de ressource « au cas où », pas de credential dev emprunté,
  ni de mélange entre plusieurs bases.
- Rapport de découverte sans valeurs secrètes, message distinguant accès refusé
  et connexion manquante, réutilisation d’une valeur déchiffrée uniquement si sa
  version distante est inchangée. Tests du scénario exact, placeholders,
  permissions, sources préfixées et préservation des intégrations ajoutés en CI.

### `node config` — reconstruction automatique production après AUTORISER

- Nouveau mode par défaut : sauvegardes privées, récupération des connexions
  Vercel Storage, normalisation des noms Neon/Postgres/KV, inspection SQL,
  nouvelles clés symétriques, profils locaux puis suppression/réécriture des
  variables production modifiables. Pas de saisie de credentials applicatifs.
- Storage/intégrations et variables plateforme protégés ; preview/development
  inchangés. Les credentials externes ne sont ni inventés ni intégrés au code.
- Refus avant suppression si la base contient des données métier, si les accès
  ne sont pas récupérables ou si la cible/inventaire change. Contrôle SQL repris
  juste avant l’effacement ; aucune nouvelle autorité privée de remplacement.
- Journal privé de reprise lié au projet : conserve exactement les nouvelles
  valeurs, y compris les paramètres tiers, après un échec partiel. Relecture
  finale, reçus et restauration des paramètres non générables à la relance.
- `node config --conserver-secrets` conserve le plan interactif précédent.
  Fichiers générés et aide renvoient explicitement à ce mode pour compléter
  sans rotation. Tests de reconstruction ajoutés aux commandes locales et CI.

### `node config` — les variables déjà présentes chez Vercel ne bloquent plus

Constat d'usage : les secrets sont poussés chez Vercel en `--sensitive`, donc
jamais relisibles. `node config` s'arrêtait alors sur :

```
DATABASE_URL existe chez Vercel mais sa valeur n'est pas relisible.
DEVICE_TOKEN_PEPPER : valeur de production nécessaire pour poursuivre.
```

Impossible de configurer une installation neuve dont les variables existaient
déjà côté Vercel, sans chasser des valeurs que personne n'avait copiées.
Désormais les secrets symétriques illisibles et manquants localement sont
résolus après le contrôle SQL du plan complet : génération 256 bits et remplacement
sur base vide, accord groupé explicite sur base utilisée. Un checkout neuf ne
constitue **jamais** une preuve que la production est vide. Les vraies URLs
proviennent de Neon ou du fournisseur ; elles ne sont pas inventées et leur
correspondance avec la cible doit être confirmée.

Les reçus privés contiennent des empreintes, l’identité équipe/projet et la
version distante : ils évitent les confirmations répétées sans masquer un
changement de projet ou une modification externe. Les nouvelles variables
Sensitive ajoutées reçoivent elles aussi un reçu. Un échec d’envoi ne produit
aucun reçu de succès ; la suppression Vercel ne reçoit jamais le secret sur stdin.
Les clés générées pendant la reprise figurent au récapitulatif des destinations.

Correction du contrôle de marque : exception précise pour le nom physique
historique du coffre dans `scripts/lib/config-secrets-auto.cjs`, sans désactiver
le contrôle ni renommer le dossier existant. Documentation et tests hors ligne
complétés (ajout, remplacement, reprise, absence de preuve locale, refus sans
accord et reçus liés aux métadonnées).

### P0 — `npm run dist` s'arrêtait sur « server.js NOT found »
- Cause réelle : la sortie autonome EXISTAIT, un niveau plus bas
  (`.next/standalone/<chemin-relatif>/server.js`), parce que Next.js déduit la
  racine du workspace et qu'un `package-lock.json` hors du dépôt suffit à la
  décaler. Masquer le message aurait livré un installeur sans serveur.
- `next.config.mjs` : `outputFileTracingRoot` épinglé sur la racine du projet.
- `scripts/lib/standalone-layout.cjs` (nouveau) : la disposition autonome est
  TROUVÉE, jamais présumée ; partagée par le post-build et les vérifications.
- `scripts/post-build.js` : n'annonce plus un succès sans avoir lu la sortie ;
  échec explicite avec la disposition observée ; purge de `.env` et des clés
  privées, copie du manifeste de release.
- `scripts/preflight-release.cjs` (nouveau) : pré-requis AVANT compilation
  (clé publique de mise à jour, version cohérente, espace disque, cible).
- `scripts/verify-standalone-build.cjs` (nouveau) : étape bloquante entre
  `build` et `electron-builder` (serveur, pages statiques, `public/`, fichiers
  requis).
- `scripts/verify-installer.cjs` (nouveau) : contrôle de l'artefact réel
  (nom `GarageFlows Setup <version>.exe`, taille, moteur NSIS, désinstalleur).
- `package.json` : `dist` = `preflight:release` → `build` → `verify:standalone` →
  `electron-builder --win --x64` → `check:artifact-secrets` →
  `check:artifact-fuses` → `verify:installer` ; chaque étape échoue bruyamment.
  `tests/build-dist-chain.test.cjs` entre dans `test:release-safety`.
- `scripts/garageflow-env-manifest.json` : `GF_PACKAGE_DESKTOP` déclaré (toute
  variable lue par un script doit l'être — garde-fou `env-manifest-drift`).
- `tests/build-dist-chain.test.cjs` (nouveau) : 9/9, puis 13/13 après les deux
  correctifs ci-dessous.
- `scripts/verify-standalone-build.cjs` : il passait le dossier `.next/standalone`
  à `inspectStandaloneLayout`, qui **ajoute lui-même** ce chemin à la racine reçue
  — le contrôle cherchait donc `.next/standalone/.next/standalone` et échouait
  **toujours**, même sur une sortie saine (le faux rouge observé sur l'exécuteur
  Windows). La racine du projet est maintenant passée, et le garde-fou sait
  ACCEPTER une sortie valide : trois arborescences synthétiques (saine, absente,
  amputée) sont réellement exécutées par les tests.
- Liste des modules d'exécution déplacée dans `scripts/lib/standalone-layout.cjs`
  (`MODULES_EXECUTION` + `modulesExecutionManquants`) : l'ancienne boucle
  préfixait `node_modules/` à une entrée qui le contenait déjà et signalait un
  manque inexistant (`node_modules/node_modules/.prisma/...`).
- **Deux faux positifs du vérificateur, visibles seulement sur Windows**, tous
  deux corrigés : (a) la taille d'un DOSSIER vaut 0 sur Windows, si bien que
  `.next/static` (242 fichiers) et `public/` (10 fichiers) étaient déclarés
  « vide » — le contrôle compte désormais le contenu réel ; (b) `next-auth`
  n'est **pas copié** dans la sortie autonome (webpack l'embarque) — le contrôle
  exige « copié **ou** embarqué » et cherche le marqueur
  `next-auth.session-token` dans les morceaux compilés, avec un échec explicite
  si les deux manquent.
- **Premier vert de la chaîne sur une sortie autonome réelle** : `next build`
  complet obtenu dans cet environnement (substituts Prisma locaux + type-check
  neutralisé le temps du build, **rien de tout cela commité**), puis
  `post-build.js` et `verify:standalone` → `✅ Sortie autonome complète`, exit 0.
  Le serveur empaqueté, lançé avec l'environnement d'`electron/main.js`, répond
  `200` sur `/login`, `/clients/login`, `/api/auth/providers` et `/api/version`.
- **L'installeur Windows est produit** : run `38958504927` (commit `9304c55`),
  job « Windows candidate packaging and inspection (not publication) »
  `completed/success`, seize étapes vertes, artefact
  `garageflows-installer-windows-x64` (206 258 171 octets) — `GarageFlows Setup
  1.1.0.exe` + carte de blocs, après validation par `verify:installer`.
- **`npm run dist` n'entraîne plus de publication implicite** : sur
  l'installeur réellement construit (run `38957019116`), electron-builder a
  déclenché « Implicit publishing triggered by CI detection » puis a échoué sur
  `GitHub Personal Access Token is not set` — la construction était pourtant
  terminée. `--publish never` est désormais explicite : publier une release reste
  une décision (`npm run release:sign`), jamais un effet de bord.
- Le fond du volet Stock ferme désormais le panneau au clic (surface qui
  n'obéissait à aucun clic) ; membre mort `'appointments'` retiré de l'union
  `Surface` de `src/app/page.tsx`.

### Barre d'outils — plus de déplacement vertical
- `.gf-hscroll` (`globals.css`) verrouille l'axe vertical
  (`overflow-y: hidden`, `flex-wrap: nowrap`, `overscroll-behavior`) : un axe
  `visible` devient `auto` dès que l'autre ne l'est plus — c'est cette règle CSS
  qui faisait glisser les libellés hors du bandeau. Appliquée au `Header` et à la
  bande des mécaniciens du `ScheduleBoard`.

### Tableau de bord — vue globale des rendez-vous
- `src/components/dashboard/AppointmentsSection.tsx` (nouveau) : toutes les
  dates, ordre chronologique, jour de la semaine + date complète, client,
  véhicule (marque/modèle/immatriculation), prestation, heure, statut ;
  recherche et filtres (client, véhicule, immatriculation, date, période,
  statut, ordre) ; ligne dépliable ; fiche client, fiche véhicule ; édition en
  ligne ; confirmation, achèvement, annulation selon `can(role,'job:manage')`.
- `GET /api/appointments` réécrit (filtres + pagination, portée garage),
  `PATCH /api/appointments/[id]` (Zod `UpdateAppointmentSchema`, `validateSlot`),
  `AuditEntityType` étendu. Aucune donnée ni table parallèle.

### Clients & messages
- `src/components/ClientPicker.tsx` (nouveau) : liste déroulante de clients
  réelle (recherche, nombre de véhicules, ouverture de fiche, rafraîchissement
  après ajout ou modification). Seule l'ENTRÉE « Rendez-vous » a été retirée de
  cet espace.

### Boutons de fermeture, une seule page, brouillons
- `.gf-close` : boîte de 40 px (44 px au doigt) et pseudo-élément élargi passé en
  `pointer-events: none` — il recouvrait les boutons voisins et leur volait le
  clic. 17 boutons de fermeture réduits à une icône portent un nom accessible.
- `src/app/page.tsx` : seize booléens de page remplacés par une variable unique
  `surface` — ouvrir une page referme la précédente par construction.
- `src/lib/ui/brouillon.ts` (nouveau) : les saisies en cours survivent au
  changement de page ; fermer la page est un abandon et efface les brouillons de
  CETTE page.
- Volet Stock : le fond était resté `pointer-events-none` — la surface libre
  autour du panneau n'obéissait à aucun clic, alors que le panneau se déclare
  `aria-modal="true"`. Il ferme maintenant au clic, comme `BillingPanel`,
  `FinancialDashboard` et `GfDrawer`.

### Réglage « Lancer GarageFlows au démarrage de Windows »
- `electron/main.js` : `etatDemarrageAuto()` / `definirDemarrageAuto()`
  (`getLoginItemSettings` / `setLoginItemSettings`, `process.execPath` +
  `--autostart`), IPC `app:autostart-get` / `-set` ; lancement `--autostart`
  sans vol de focus. `electron/preload.js` : `getAutostart` / `setAutostart`.
- `src/components/settings/SystemeTab.tsx` (nouveau) + onglet « Système » :
  l'état est RELU depuis Windows après chaque écriture — aucun miroir dans
  `gf_settings.json`, le registre est la seule source.
- Installeur inchangé côté privilèges : `asInvoker`, `perMachine: false`,
  `allowElevation: false`.

### Tests et mesure
- `src/lib/__tests__/ui-navigation-et-demarrage.test.ts` (nouveau) : 12 garde-fous
  de non-régression sur les mécanismes ci-dessus.
- 104/104 `portal-access-reachable`, 2/2 `ui-lossless-compaction`, 8/8
  `env-manifest-drift`, 42/42 copilote, 203/203 tests CJS, `eslint` 0 problème.
- `npx tsc --noEmit` : 249 erreurs, ensemble identique à la référence (aucune
  apparue, aucune disparue — contrôle de non-régression, pas une porte verte).
- Suite vitest complète : 3 échecs, tous dans `prepare-test-db` (moteur Prisma à
  télécharger depuis `binaries.prisma.sh`, injoignable dans cet environnement).
- Plafond du JS client relevé de 3 625 984 à 3 829 408 octets (mesure à
  l'appui : 3 647 055 octets, +33,7 Kio apportés par les trois vues
  demandées ; ancienne marge : 13 413 octets). Motif écrit dans
  `perf-budget.json` (`raisedWhy`), garde-fou d'immutabilité aligné dans
  `.github/workflows/ci.yml` et `tests/ci-required-gate.test.cjs`.
- `GET /api/appointments?date=…` : filtre corrigé (`construireFiltreRendezVous`)
  — il construisait `{ date: { date } }`, forme que Prisma refuse.
- Rapport détaillé : `docs/RAPPORT_MISSION_2026-10-16.md`.

## [Non publié] — 2026-10-16 — `node config` génère toutes les clés manquantes et les écrit partout où elles sont lues

### Cause du blocage corrigée : une base neuve était vue comme « utilisée »
- `prisma/garageflow-template.db` (modèle livré) contient `_gf_migrations`
  peuplé (214 lignes de baseline) et **zéro ligne métier**. `inspectDesktop`
  excluait `_prisma_migrations` mais pas `_gf_migrations` : toute SQLite neuve
  créée par `scripts/setup-dev.js` était donc déclarée « contenant des données »,
  et le plan complet réclamait des clés d'origine (`NEXTAUTH_SECRET`,
  `GF_DB_MAC_SECRET`, `GF_BACKUP_KEY`, `GF_TOTP_ENC_KEY`) qui n'avaient jamais
  existé, puis s'arrêtait sur `GF_BACKUP_KEY desktop : original nécessaire`.
- `scripts/config-services.cjs` : registres `_gf_migrations` / `_prisma_migrations`
  (et `sqlite_%`) exclus de la détection de données métier
  (`isBookkeepingTable`, `businessTableNames`) ; `inspectDatabase`/`inspectDesktop`
  renvoient `{ empty, tableCount, ignored }`. `inspectDesktop` accepte un
  `loadClient` injectable pour les tests.

### Génération automatique sur installation neuve
- `scripts/config-core.cjs` : `missingGenerated`, `generateMissing`,
  `KEY_PROMPT_COMMANDS` (`NONUTILISE` / `GENERER`), `isKeyPromptCommand`,
  `KEY_DESTINATIONS` + `keyDestinations(name, profil)`.
- `config` : `generateSecrets()` (256 bits, liste les destinations réelles, ne
  remplace jamais une valeur présente) ; `advanced()` accepte les commandes
  `GENERER` / `GENERER-TOUT` et `LISTE` ; `GENERER` reste accepté comme valeur
  d'un secret symétrique.
- `scripts/config-full.cjs` : `resolveMissingKey()` — base sans donnée métier →
  génération silencieuse ; base réellement utilisée → original du coffre,
  `NONUTILISE` (déclaration confirmée) ou `GENERER` (confirmation explicite,
  refus = arrêt sans écriture). Nouvelle étape finale
  `récapitulatif-des-clés-et-destinations` (`report.keys[]`, noms uniquement).
  Le prompt de publication accepte aussi `GENERER` en plus de `NOUVEAU-CANAL`.
- Tests : `tests/config.test.cjs` (classification, modèle livré réellement vide
  via `node:sqlite`, destinations, commandes, `generateSecrets`) et
  `tests/config-full.test.cjs` (SQLite neuve = 6/6 clés desktop sans saisie,
  base utilisée + `GENERER`, confirmation refusée = arrêt). 90 tests CJS verts.
- Documentation : `README.md`, `docs/CONFIG.md` (section « Ce qui est considéré
  comme « base vide » » et tableau des destinations).

## [Non publié] — 2026-08-06 (4) — Sécurisation des migrations & JSON monétaires v2

### JSON persistants (worksJson / partsJson / linesJson)
- **Format v2 versionné en entiers exacts** (`{"schemaVersion":2, …,
  "qtyTenThousandths", "unitPriceTenThousandths", "lineTotalCents"}`) — plus
  AUCUN flottant monétaire persisté. Module unique `src/lib/money-json.ts`
  (Zod strict, v1 accepté en LECTURE seule avec parsing strict ≤ 4 décimales).
- Migration v1→v2 **sans perte** : SQLite `179_money_json_v2` (runner) ;
  PostgreSQL `scripts/migrate-money-json.ts` (`db:server:migrate-json`,
  `--dry-run` disponible). Transactionnelle, idempotente, contrôle de cohérence
  bloquant (|recalculé − stocké| ≤ max(1, nb lignes) centimes, le total stocké
  reste la référence), v2 re-parsé avant écriture.
- **Ordres signés GELÉS** : JSON canonicalisé verbatim dans la signature —
  exclus de la migration, PATCH des lignes refusé (400), lecture v1 conservée
  pour eux seuls (exception légale documentée).

### Runner SQLite (`/api/internal/migrate`) — fail-closed
- Migrations monétaires **162–178 recomposées** en étapes atomiques par colonne
  (ADD gardé → BACKFILL → `verifySql` BLOQUANT → DROP) ; **une transaction par
  migration, enregistrement `_gf_migrations` inclus** — un échec annule tout,
  stoppe la séquence, n'enregistre rien, réponse structurée
  `{ok:false, failedMigration, stage, errorCode, recoverable}`.
- Registre enrichi (name/checksum sha256/schemaVersion) : **checksum divergent
  = blocage** (`MIGRATION_CHECKSUM_MISMATCH`) ; `PRAGMA integrity_check` +
  `foreign_key_check` AVANT et APRÈS (résultats contrôlés) ; verrou anti-réentrance.
- Modèle `garageflow-template.db` **baseliné** (179/179 enregistrées, plus
  aucune migration rejouée sur base neuve) — `scripts/baseline-template.mjs`
  branché dans `post-build`/`setup-dev`.

### Electron — sauvegarde pré-migration & gate
- `electron/pre-migration-backup.js` (testé) : copie db + `-wal`/`-shm` AVANT le
  démarrage du serveur, **en-tête SQLite réel vérifié**, rétention 5 copies sans
  jamais supprimer la fraîche (`garageflows-pre-migration-AAAAMMJJ-HHMMSS.db`).
- Démarrage fail-closed : sauvegarde invalide → dialogue
  `PRE_MIGRATION_BACKUP_FAILED` + arrêt (1) ; migration : statut HTTP **et**
  `ok === true` contrôlés, échec → dialogue avec chemin de sauvegarde + bouton
  « Ouvrir le dossier », arrêt (1), **aucune fenêtre principale**.

### PostgreSQL
- `money_scaled_units` : vérification bloquante **par colonne** (17/17, dont
  cohérence NULL bidirectionnelle LoanerReservation) ; `money_drop_floats` :
  **re-vérification pré-DROP par colonne** (bijection spec⇔DROP, bloc avant tout
  DROP, échec = transaction annulée). **Exécutées réellement** sur PG 16 local :
  base vide (CI-équivalent) + base peuplée legacy (conversions exactes, test
  négatif avec rollback prouvé, JSON v1→v2, signé gelé, idempotence).

### CI / gardes
- Nouveaux gardes bloquants : `check:money-json` (écritures JSON via
  sérialiseurs v2 uniquement, exceptions justifiées anti-mortes),
  `check:migration-safety` (invariants runner/Electron/ordre de démarrage),
  `check:sqlite-template` (intégrité réelle + baseline + checksums),
  `check:pg-migrations` (bijection DROP⇔vérification). CI Node 20 → **22**
  (node:sqlite). Tests : `test:money-json` (16), échecs de migration simulés,
  sauvegarde pré-migration (5) — suite complète 1 040 verts (+19 PG locaux).

## [Non publié] — 2026-08-06 (3) — Migration monétaire FINALE : zéro Float, entiers exacts

### Monnaie — schémas (SQLite + PostgreSQL, alignés)
- **ZÉRO champ monétaire Float** : prix/coûts unitaires, taux horaires/journaliers
  → `*TenThousandths` (Int, dix-millièmes d'€, 4 décimales exactes) ; quantités
  fractionnaires → `quantityTenThousandths` ; totaux/caution → `*Cents` (Int).
  **Anciennes colonnes Float SUPPRIMÉES** — plus de double écriture ni fallback.
  Seuls les 4 `taxRate` (taux %, non monétaires, classés) restent Float.
- Migrations : PG `money_scaled_units` (add + backfill ROUND(x×10000) +
  **vérification bloquante**) puis `money_drop_floats` (drops) ; SQLite runner
  **162–212** avec gardes `onlyIfColumnExists/Missing` (sûres sur base ancienne
  ET neuve) ; template desktop régénéré ; converge du reset synchronisée (additive).
- Consommateurs migrés (~45 fichiers) : routes devis/factures/OR/stock/MO/prêt/
  garages, exports (FEC, CSV, Electron), analytics, signature (canonicalisation
  euros **bit-identique** → signatures historiques préservées), sauvegardes
  (restauration des anciens snapshots convertie à la volée), Zod strict
  (finite, ≤ 4 décimales), API : entiers exacts + vue euros dérivée.
- Calculs centralisés : plus AUCUN `prix × quantité` flottant, `parseFloat`
  monétaire ni `Math.round(x*100)/100` hors `lib/money.ts` (modales, portail,
  stock, dashboard, profitability, quote-gen, suppliers, Electron export).
- `parseAmountToScaled` : parsing STRICT des saisies (virgule/point, refus
  NaN/Infinity/> 4 décimales) ; `allocateCents` (répartition d'arrondi exacte).

### Electron
- Épinglage userData refondu : module pur `electron/user-data-path.js` **testé**,
  **zéro catch silencieux** — échec journalisé + **arrêt contrôlé** avant toute
  écriture (protège BD/licence des installations existantes).

### Marque
- Keygen (fenêtres/labels), scripts CMD/PS1 (titres/echo/messages), README,
  seed → **GarageFlows**. Scanner étendu à TOUT le dépôt (scripts, prisma,
  .github, racine, .py/.ps1/.cmd/.md) — exceptions précises listées.

### CI
- `check:money` **STRICT** (échec si un seul champ monétaire Float) ;
  nouveau `check:money-calculations` (calculs interdits) ; `test:money` (51),
  `test:migration` (8) ; `typecheck` ajouté.

## [Non publié] — 2026-08-06 (2) — Précision 4 décimales · rename Windows · icônes · garde-fous

### Monnaie — précision & centralisation
- **Correctif 4 décimales** : `lib/money.ts` arrondit désormais le **montant étendu**
  par ligne (`lineCents = round(prix_€ × qté)`) et **n'arrondit plus le prix unitaire
  au centime avant** la multiplication → **12,3456 € × 3 = 37,04 €** (était 37,05).
  Aucune régression sur les données à 2 décimales (suite de tests inchangée).
- **Centralisation** des marges/coûts natifs restants via `lineCents` :
  `analytics/metrics.ts`, `api/finance`, `api/stats`, `api/purchase-orders`.
- **Garde-fou** `scripts/check-money-fields.mjs` : interdit tout nouveau Float
  monétaire non classé ; liste nommément les 15 champs monétaires Float encore suivis.

### Marque Windows (visible → GarageFlows, données préservées)
- `productName`, `author`, `copyright`, `nsis.shortcutName` → **GarageFlows** ;
  dialogues d'intégrité/installation Electron, titre de fenêtre, log de démarrage,
  noms d'artefacts (exe/installeur) alignés.
- **Épinglage userData** sur `%APPDATA%\GarageFlow` (`app.setPath` avant tout accès)
  → les installations existantes conservent BD/licence/secret malgré le rename.
- Conservés (documentés) : `appId`, `garageflow.db`, `Software\GarageFlow`,
  serviceName, User-Agent, `EXPECTED_PRODUCT` (pont de MàJ), sels crypto, env var.
- **Garde-fou marque durci** : exceptions techniques **précises et listées**
  (fin de la liste blanche fourre-tout).

### PWA / icônes
- **maskable-192/512 régénérées aux dimensions exactes** (étaient 238×238 / 636×636).
- **Garde-fou** `scripts/check-pwa.mjs` : compare dimensions **déclarées vs réelles**
  (entête PNG), existence des icônes, cohérence name/short_name des manifestes.

### CI
- Ajout des garde-fous `check:branding` (strict), `check:pwa`, `check:money`,
  `check:docs` au workflow.

## [Non publié] — 2026-08-06 — Monnaie déterministe · docs · marque

### Monnaie (fin du Float dangereux pour l'argent)
- **Stockage des totaux en centimes entiers** (additif, non destructif) : colonnes
  `WorkOrder.totalHtCents/totalTtcCents`, `PurchaseOrder.totalHtCents`,
  `LoanerReservation.depositAmountCents` — source de vérité en écriture, colonnes
  Float conservées en **miroir dérivé** (aucune régression lecture/PDF/export/signature).
- **Ordres de réparation** : calcul des totaux rerouté sur `lib/money.ts` (centimes
  exacts) — fin de l'arithmétique flottante native dans ce chemin.
- `lib/money.ts` : ajout `marginCents` / `computeMarginCents` (marge = produit − coût, exacte).
- Migration additive PostgreSQL `20260806100000_money_cents` (+ backfill/vérif/rollback
  documentés) ; runner SQLite `158–161` ; convergence reset synchronisée.
  Voir `docs/MIGRATION-MONEY.md`.

### Documentation
- **`docs/PRODUCTION-READINESS.md`** : résumé de production de l'époque (verdict
  honnête « préparé, non déployé, sous conditions » + checklist de bloqueurs).
  Depuis V13.1, la source canonique faisant foi est
  `docs/audit/FINAL_VERIFICATION_BASELINE.md`.
- 12 rapports-instantanés marqués **HISTORIQUE** ; `PRODUCTION_DEPLOYMENT.md` corrigé.
- Garde-fou CI `scripts/check-docs-consistency.mjs`.

### Marque
- Harmonisation **« GarageFlows »** partout dans le visible (i18n, pages, dialogues
  Electron, e-mails, manifestes) ; identifiants techniques/artefacts/sels crypto conservés.
- `public/site.webmanifest` réparé (nom pluriel + icônes réelles). `config/app.ts` réaligné 1.1.0.
- Garde-fou CI `scripts/check-branding.mjs`.

## [1.1.0] — 2026-07-30 — Finalisation sécurité production

### Sécurité (correctifs réellement implémentés + testés)
- **Electron / secret** : suppression des 3 replis codés en dur
  (`gf-electron-local-secret-2026-xK9mP3qR`) ; secret UNIQUE PAR INSTALLATION
  (256 bits) généré et stocké dans `userData` (écriture atomique, permissions
  0600), fail-closed si indisponible (`electron/secret.js`).
- **Electron / réseau** : serveur interne lié à `127.0.0.1` (au lieu de
  `0.0.0.0`) ; cookie `gf_session` HttpOnly + SameSite=Strict.
- **Licence / HWID** : contournement corrigé (une licence liée exige un HWID
  valide et identique — absent/vide/mal formé/différent = refus) ; fin de la
  « tolérance » 75 % (comparaison stricte, normalisée, à temps constant).
- **Stock** : opérations `jobs/[id]/parts` transactionnelles ; décrément
  conditionnel atomique (jamais négatif, anti-course) ; supplément déduit à
  l'augmentation d'une ligne ; validation des quantités.
- **Numérotation** : réservation du numéro + création du document dans une
  seule transaction (pas de trou de séquence) ; `@@unique([garageId, number])`
  sur factures/devis/OR/BC (migrations 076-079).
- **Monétaire** : PDF/UI (InvoiceModal, QuoteInvoiceModal) calculés via la
  couche centimes exacte (`lib/money`) — cohérence PDF ↔ API ↔ base ; total HT
  des bons de commande en centimes exacts.
- **PWA** : refus de démarrage si production PWA + SQLite/stockage local ;
  Service Worker respectant `Cache-Control: no-store` et purge des pages
  privées à la déconnexion.
- **API** : clé admin `revoke-by-key` comparée à temps constant ; arrêt des
  fuites de logs/erreurs ; redaction centralisée des logs serveur (`lib/redact`).
- **Dépendances** : Next.js 14.2.5 → 14.2.35 (contournement middleware
  critique CVE-2025-29927), next-auth 4.24.7 → 4.24.15 (bypass e-mail critique).
- **Versionnage** : 1.0.0 → 1.1.0 (SemVer) + contrôle de cohérence en CI.
- **CI** : ajout de `prisma validate`, `npm run build` et du contrôle de version.

### Tests
- 204 tests (137 → 204) : secret Electron, loopback, HWID (table de vérité),
  stock transactionnel/concurrence, numérotation, cohérence monétaire,
  isolation tenant, garde-fous PWA, redaction.

## [Sécurisation production] — 2026-07-30 (branche claude/garageflow-security-production-4caktd)

### Sécurité
- **Secrets** : suppression de tous les replis codés en dur (`auth-secret.ts`
  centralisé, fail-closed) ; `.env.example` en placeholders ; `keys/*.json`
  retirés du suivi git ; génération aléatoire par installation ; validation
  d'environnement fail-fast ; Gitleaks en CI ; retrait des logs de secrets
  (DATABASE_URL, mot de passe/hash).
- **Multi-tenant / IDOR** : filtrage `garageId` systématique, écritures atomiques
  `{id, garageId}`, vérification des FK (`lib/tenant.ts`), correction IDOR-WRITE
  (inspections), routes non authentifiées (photos, plate-lookup), dump inter-tenant
  (internal/export). Test d'isolation 2 garages.
- **Device auth** : stockage/présentation du jeton d'appareil ; ré-activation auto.
- **Mises à jour signées Ed25519** : `electron/update-verify.js` (signature, keyId,
  plateforme, anti-downgrade, domaine) ; valeurs signées font autorité.
- **Crash reporting** : opt-in par défaut + écran de consentement + redaction RGPD.
- **Electron durci** : sandbox, webSecurity, navigation en liste blanche, CSP renforcée.

### Correctness
- **Monnaie** : calculs en centimes entiers (`lib/money.ts`), invariant TTC=HT+TVA.
- **SemVer** : comparaison correcte (fin du `>` lexicographique) côté client.

### PWA (app.garageflows.fr)
- Manifeste complet, Service Worker (jamais de cache API authentifié), page
  hors-ligne, icônes, enregistrement web-only.

### Validation
137 tests verts, `tsc`/`next lint`/`next build` OK, `prisma validate` OK,
`python -m compileall scripts` OK.
