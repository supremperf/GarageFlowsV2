# Validation locale du patch — 14 octobre 2026

## Décision

**VALIDATION PARTIELLE — NON PRÊT POUR LA PRODUCTION.**

Dates ISO des reçus en UTC, fuseau utilisateur Europe/Paris (UTC+2). Nouvelle phase strictement locale : aucun commit, push, merge, workflow dispatch, déploiement, release, rotation ou changement de protection. Le dossier de clôture antérieur n’est pas réécrit.

## 1. Écart de référence et conservation

La référence déclarée commit4989b53 est dépassée : branche `arena/c9eaae15-garageflowsv2`, HEAD et distant réels **f88f2832eb256310852ed86040057c062d44433e**. Arbre initial propre, y compris non suivis. Les18 corrections source/test du précédent candidat sont déjà publiées sous l’autorisation antérieure. Pas de reset ni d’opération d’écrasement. [Observation initiale et comparaison](initial-state.json).

Les146 preuves du manifeste de clôture ont été recontrôlées exactement ; son SHA reste `7f6c460702f20ea90a4a9f75f23a529a8e4a81bcfe22171d876b2a2674725a7b`. Les18 empreintes source publiées correspondent au candidat de clôture. Les mentions « non publié » dans l’ancien rapport sont une photographie prépublication, pas l’état courant.

**Nouveau delta local : `.gitleaksignore` et `tests/secret-scan-policy.test.cjs`**, plus ce dossier de preuves et navigation. Empreinte du patch : `cae162fcff57054d0c695930a14c68e179a316ed14661f0ecdc76e3f1307267f` ; empreinte des fichiers suivis hors audit : `de3a75edb7e53fcb48b1f20555f47b1f51e663250a55b2b0a2b2a9e0188bb67d`. [Candidat et dépendances de preuves](candidate.json), [diff exact](local-source.patch). Les preuves documentaires utilisées par le test de politique sont liées séparément par SHA et manifeste. Aucune CI distante n’a testé ce nouveau delta.

[26 identifiants avec historique et prérequis](ISSUE-MATRIX.md). Les anciens rapports, journaux et manifestes sont conservés ; le vérificateur prépublication ancien n’est pas modifié pour accepter artificiellement le nouveau HEAD.

## 2. CI exacte du commit publié, distincte du delta local

[Run38602614687](https://github.com/supremperf/GarageFlowsV2/actions/runs/38602614687), SHAf88f283 exact : **completed / failure**. [Huit jobs REST et étapes](ci-final-jobs.json), observations chronologiques `evidence/ci-run*.log` et `evidence/ci-jobs*.log`.

|Job|Conclusion GitHub|ID|
|---|---|---|
|Full dependency tree — zero vulnerabilities|success|115985376589|
|E2E (Playwright — responsive, auto-démarrage)|success|115985376739|
|Type-check, Lint & Test (desktop SQLite + serveur PostgreSQL)|success|115985376849|
|Secret scan (Gitleaks)|failure|115985377234|
|Final release gate (full)|skipped|115985379873|
|Required validation|failure|115987562880|
|Authenticated browser validation (approved staging only)|skipped|115987563361|
|Windows candidate packaging and inspection (not publication)|skipped|115987564679|

Le job Type/Lint/Test réussit installation normale, générations Prisma, tests, build standard et budget sur commitf88f283 : ce n’est plus uniquement une preuve du commit4989b53. Aucun nombre de cas distant n’est inventé sans journal par cas. Les E2E réussis sont publics ; les parcours authentifiés et Windows **ne sont pas exécutés** dans ce nouveau run, à la suite du prérequis secrets en échec. Le gate complet manuel est skipped, pas validé.

L’historique commit4989b53 garde ses échecs staging préflight, Windows `npm run dist` et Required ; nouvelles demandes de journaux officiels **exit1 / EOF**, sorties et redirections signées non exportées. [Accès aux logs](historical-log-access.json). Aucun lien causal avec Prisma local n’est inféré.

## 3. Correction locale réellement ajoutée : faux positif documentaire Gitleaks

L’installation officielle distante et son checksum réussissent sur commitf88f283. Le scanner termine **findings=1 / scannerExit=1** : règle generic-api-key, rapport de clôture ligne96. La ligne entière a été examinée : prose française décrivant les helpers d’autorisation, noms hérités, nombres de tests et liens relatifs, sans credential/token/affectation de secret. [Triage métadonnées seulement](gitleaks-triage.jsonl). Aucune valeur Secret/Match exportée, aucune rotation nécessaire démontrée.

Le rapport reste byte-identique. Une seule exception `fichier:règle:ligne` est ajoutée, avec contrôle obligatoire du SHA du fichier entier, de la ligne et de sa structure. Les trois exceptions d’en-têtes OAuth publics restent protégées ; aucune règle désactivée, aucun répertoire/fichier globalement soustrait.

**16/16 tests de politique/collecteur**, puis **52/52 release-safety**, et quatre scénarios sur copies possédées : baseline exit0 ; modification de la prose, d’un en-tête public ou ajout d’un fingerprint non autorisé → exit1 attendu. [Tests négatifs](policy-negative-results.json). Ce sont des tests de garde, **pas un scan simulé**.

Le téléchargement local officiel v8.24.3 de l’archive et des checksums échoue **curl35 après HTTP302**, zéro octet reçu, aucun binaire extrait/vérifié/exécuté. [Reçu complet](gitleaks-prerequisite.json). Scan de l’arbre corrigé : **BLOQUÉ**. Scan du commit corrigé et de l’historique : **EN ATTENTE DE REVUE**, non exécutés. Le scan distant en échec concerne l’arbre publié, pas l’historique ni ce delta local.

## 4. Contrôles locaux réellement reproduits

Chaque commande exacte, date, HEAD, empreinte source, code et journal figure dans `evidence/<id>.command.json` et [commands.jsonl](commands.jsonl). Versions : Node22.22.3, npm11.16.0, TypeScript5.9.3, Prisma/Client5.22.0, Vitest4.1.11, Semgrep1.180.0 ; Python isolé3.11.2/cryptography50.0.2 explicitement provisionné dans PATH. [Versions](evidence/tool-versions.log), [Python](evidence/python-prerequisites.log).

|Contrôle|Statut|Résultat de cette phase / preuve|
|---|---|---|
|TypeScript stabilisé|VALIDÉ|exit0, `evidence/typecheck-settled.log`|
|ESLint|VALIDÉ|exit0, `evidence/lint.log`|
|Autorisations|VALIDÉ|205/205, `evidence/authz.json`|
|Sauvegardes pré-migration|VALIDÉ|10/10 SQLite/FS, `evidence/backup.log`|
|Masquage cité/préfixé exact|VALIDÉ|33/33, `evidence/redaction-exact.json`|
|Suite composite historique exacte|VALIDÉ|94/94, `evidence/gcm-composite.json`|
|Redis isolé réel|VALIDÉ|5/5, `evidence/redis-real.json`|
|Secrets Electron|VALIDÉ|17/17 cas ciblés, `evidence/electron-secrets.json` ; pas runtime natif|
|Audit npm strict|VALIDÉ|LOW/MODERATE/HIGH/CRITICAL/TOTAL=0 ; `evidence/audit-strict.log` ; politique `evidence/audit-policy.log`|
|Release-safety|VALIDÉ|52/52, `evidence/release-safety.log` ; tests de sûreté, pas paquet|
|Parsing/JS émis|VALIDÉ|15 fichiers/17 alias, JS byte-identique, assertions inchangées, `patch-verification-v2.json`|
|Suite complète provisionnée|ÉCHOUÉ|3841/2994/3/844 +4 erreurs, `full-suite-provisioned-summary.json`|
|Générations Prisma desktop/serveur|ÉCHOUÉ|exit1 chacune ; capacité native BLOQUÉE|
|Build standard local|ÉCHOUÉ|exit1 au premier Prisma generate, avant Next|
|Budget diagnostique ancien .next|ÉCHOUÉ|10440593 octets, pas mesure du build candidat|

Le contrôle complet `npm run check:consistency` a été rejoué après rédaction : exit0. **Limite explicite :** `check:public-key` et `keys:check` signalent NON EXÉCUTÉ car `keys/public.pem` est absent ; aucune comparaison avec la clé externe n’a eu lieu. La cohérence des clés embarquées ne remplace pas cette preuve. Voir `evidence/docs-consistency-report.log`.

Les suites ciblées se recouvrent et **ne sont pas additionnées**. Composite94 =54 tags GCM +6 pré-backup +10 backup crypto +13 TOTP +11 secret-cipher, pas94 nouveaux cas dédiés aux tags. Redis8.10.2 officiel déjà compilé, hash enregistré, boucle locale16381 sans persistance, arrêté proprement et port vérifié fermé ; ni Redis7 de CI ni Upstash géré attesté. [Provenance/exécution/arrêt](redis-runtime.json).

Les12 échecs historiques des six noms Object.prototype dans les deux helpers sont rapprochés nominativement des cas actuels réussis : [mapping](authz-regression-mapping.json). Object.hasOwn précède les accès ; `can` renvoie false et `permissionsOf` une liste vide pour ces noms. Les listes de permissions sont inchangées et aucun contrôle contourné. Les quinze refactorisations ne modifient pas le JavaScript TS ES2022/ESNext émis sans commentaires/source map ; le probe réel reproduit le défaut de grammaire initial et accepte l’alias. [Probe](parser-probe.json).

Le test financier conserve ses **16 lignes expect byte-identiques** et ses cinq IDs fixes distincts du marqueur de coût. L’analyse historique expurgée établit la collision uniquement dans un garageId généré ; elle est conservée sous `../closure-2026-10-14/ci-assertion-analysis.json`. La première recette de vérification de cette phase reconnaissait mal le préfixe des IDs : elle est conservée, mais **v2** impose cinq IDs et absence de collision. Le test isolé de facturation reste **0 réussi/7 empêchés**, hook Prisma en échec ; aucune validation SQLite métier revendiquée.

## 5. Trois échecs et quatre erreurs globales : traces actuelles

Trois cas `prepare-test-db.test.ts` échouent encore : création d’un modèle exploitable, réutilisation du modèle, remplacement d’une base périmée. Chaque trace contient `prepareTestDb` → `construireModele` → CLI local `db push --skip-generate --accept-data-loss` → téléchargement officiel checksum/moteur interrompu avant TLS. [Cas et traces complètes](full-suite-provisioned-failed.jsonl), [reproduction isolée](evidence/prepare-db-isolated.log). Le quatrième cas statique de ce fichier réussit. Échecs réels conservés, pas convertis en skips.

Les quatre contextes de rejets non gérés sont relancés séparément :

|Suite isolée|Assertions réussies|Processus|Cause observée|
|---|---|---|---|
|publication-mise-a-jour|11|exit1|Query Engine absent,1 rejet|
|license-devices-unit|16|exit1|Query Engine absent,1 rejet|
|mechanic-admin|6|exit1|Query Engine absent,1 rejet|
|audit-v21-fixes|13|exit1|Query Engine absent,1 rejet|

Journaux `evidence/*-isolated.log`, [registre global actuel](full-suite-provisioned-global-errors.json). Le singleton DB est créé lors de l’import, y compris par dépendances transitives de helpers ; pile native loadLibrary/loadEngine/instantiateLibrary. Attribution immédiate à l’absence du moteur démontrée, mais toute la logique métier n’est pas innocentée. Même si le JSON isolé dit success=true, **le code de sortie1 et le rejet priment**. Aucune capture silencieuse de promesse, faux ORM, désactivation ou mock ajouté pour obtenir un succès.

La première suite de cette phase a donné **3841/2987/3/851 +4 erreurs** : le Python système n’avait pas cryptography, sept cas keygen empêchés par beforeAll. Ce défaut de provisionnement de la relance a été corrigé via le Python isolé déjà installé, sans changer les tests :7/7 isolés, puis seconde suite entière **3841/2994/3/844 +4 erreurs**, exit1. [Comparaison des deux exécutions](tests-comparison.json). Aucun résultat fusionné, première preuve conservée.

Les844 non-exécutions de la seconde suite sont rapprochées individuellement des motifs historiques :808 corps obligatoires empêchés par setup,21 PostgreSQL,5 Redis,5 issuer privé,2 clés publiques externes,2 jetons réels,1 artefact réel. [Registre nominatif](full-suite-provisioned-skipped.jsonl). Les808 ne sont pas des skips volontaires. Les succès ciblés Redis n’effacent pas les cinq skips de cette suite.

## 6. Réseau officiel et intégrité Prisma

[Diagnostic](prisma-network.json), [observations plateforme](environment-observations.json). Linux x64/glibc2.36/OpenSSL3.5.6, moteur605197351a3c8bdd595af2d2a9bc3025bca48ea2. DNS réussit ; ECONNRESET avant secureConnect, ni HTTP ni certificat reçu, aucune preuve de certificat expiré. Proxy/cafile alternatifs non configurés ; vérification TLS conservée.

L’hôte officiel n’est pas dans l’allowlist de sortie du sandbox. Les URLs réelles gz/non-gz restent dans les journaux correspondants ; aucune somme ni binaire reçu, intégrité native non attestée. Pas de miroir, substitution ni contournement TLS. Le diagnostic de routage est limité à la politique et aux observations réseau disponibles, pas une preuve sur le serveur distant.

Prérequis : chemin réseau approuvé vers moteurs/checksums officiels, générations desktop/serveur, chargement natif et SQLite réel, relances isolées puis complètes, PostgreSQL réel, build standard. Sans ce prérequis la capacité native est **BLOQUÉE**, malgré les commandes exécutées en échec.

## 7. Sécurité et revue : progrès bornés, pas clôture

**SAST stabilisé :996/996 cibles,865 signaux,845 groupes,20 doublons conservés,0 erreur de parsing**, exit1 pour findings. Même version/règles épinglées, options strictes et configuration ; [commande exacte](semgrep-exact-command-settled.json), [cibles/hashes](semgrep-targets-settled.json), [synthèse](sast-summary.json).

Les865 IDs d’origine sont conservés.27 décisions historiques revalidées, **32 nouvelles décisions =59 sur45 groupes**,14 VALIDÉ et45 PARTIELLEMENT VALIDÉ ; **806 occurrences en attente**. Groupes :14 VALIDÉ/31 PARTIELLEMENT VALIDÉ/800 EN ATTENTE DE REVUE. [Registre par groupe/alias](sast-review-register.jsonl), [décisions individuelles](sast-triage-current.jsonl). Les ERROR déjà triés restent visibles ; les nouvelles décisions ciblent les accès fichiers aux secrets Electron/ressources chiffrées et le constructeur de regex de politique. Les chemins/permissions/concurrence non prouvés restent partiels, pas des faux positifs globaux.

**Revue sémantique :1250 fichiers,72 complètes bornées,46 partielles,1132 en attente ;87 fichiers lus entièrement.** DB singleton et gate release lus intégralement mais encore partiels ; extraits keygen déclarés partiels, pas lecture complète. Les deux sources de politique modifiées sont réévaluées avec hashes renouvelés. [Registre par fichier](review-ledger-current.jsonl), [notes/catégories/tests/limites](manual-review-notes.json). Les outils de preuve ajoutés sont inventoriés séparément avec leur état d’exécution, sans certification fonctionnelle implicite. Une empreinte ou une lecture ne prouve pas toutes les fonctions.

Le premier scan et le premier TypeScript ont croisé l’édition du test de politique ; leurs reçus le révèlent. Ils restent historiques dans cette phase ; les exécutions stabilisées sans divergence d’empreinte sont autoritatives. Aucun resserrement artificiel de portée : limites des langages, extensions sans analyseur et dossiers de preuves explicitement conservées, pas d’exemption produit ajoutée.

Dependabot/protections : HTTP403 réessayés. Règles effectives [] ne démontrent pas absence de protection classique. Les151 alertes/deux critiques sont historiques, sans inventaire actuel ; paquet/version/exploitabilité non inventés. Audit npm branche0, snapshot historique de main et alertes réellement applicables au candidat sont **trois analyses distinctes**. [Demande d’accès minimale/export expurgé](ACCESS-REQUEST.md).

## 8. Build, budget, staging et Windows

Build standard local exit1 avant Next ; budget officiel local **BLOQUÉ**. Le diagnostic sur12 fichiers préexistants .next retourne exit1 (10440593 octets, chunk7611850), BUILD_ID absent et aucun lien au candidat. Ni suppression des anciens fichiers ni relèvement : **3625984/524288 octets inchangés**. Le step budget distant sur commitf88f283 réussit, sans nouvelle mesure chiffrée locale ni artefact récupéré.

Staging : cible isolée HTTPS approuvée, disponibilité, fixtures/comptes synthétiques et secrets fournis via le gestionnaire approuvé, approbation non-production nécessaires. Aucune valeur demandée en clair, aucun compte/donnée de production employé. Ne pas interpréter le skipped actuel ou la garde historique comme une exécution authentifiée.

Windows : installation/build/dist/packaging/inspection d’artefact/runtime restent des preuves distinctes. Nouveau job skipped ; ancien dist en échec/EOF, cause exacte non établie. Aucun package candidat Windows produit/testé ici, ni Linux assimilé à Windows.

## 9. Dossier de reprise et critères restants

Pour une future publication **uniquement après nouvel accord explicite** : publier le candidat exact et ses preuves, puis vérifier chaque job obligatoire et ses étapes, Gitleaks après correction, dépendances/types/lint/tests, build standard/budget, E2E publics et authentifiés en staging approuvé, Windows/artefacts/runtime, Required et protections effectives. Une CI simulée ou historique n’est pas une preuve distante du delta.

Travaux locaux encore possibles sans accès :806 occurrences SAST,46 revues partielles/1132 en attente, autorisations/révocation, accès fichiers/backup/restauration, IPC, clés et commandes. Leur non-achèvement n’est pas imputé au réseau. Les prérequis humains/environnementaux sont détaillés dans [ACCESS-REQUEST.md](ACCESS-REQUEST.md).

**Des critères obligatoires restent ÉCHOUÉS, BLOQUÉS ou EN ATTENTE DE REVUE : production non autorisée. VALIDATION PARTIELLE — NON PRÊT POUR LA PRODUCTION.**

## 10. Gel des preuves de cette phase

Le [manifeste courant](EVIDENCE-SHA256.jsonl) couvre les fichiers de ce nouveau dossier, sans s’auto-inclure ni inclure les caches Python régénérables. [Journal des commandes](commands.jsonl), [inventaire des outils de preuve](evidence-tools-inventory.json), [reçu de gel](freeze-receipt.json). Ce manifeste prouve l’identité des octets, pas leur innocuité ni la sécurité absolue du produit.

Les contrôles finaux `coherence-final`, `consistency-final` et `whitespace-final` retournent exit0. Le vérificateur courant confirme l’identité Git/distant, l’index vide, les anciennes preuves intactes, les empreintes source et registres, le plafond inchangé et l’arrêt de Redis ; il n’affirme pas que les tests/build/CI de production réussissent. Les résultats négatifs et non-exécutions détaillés ci-dessus restent ouverts.
