<!-- doc-numbers: journal -->

# Investigation complémentaire FUP — 14 octobre 2026

**VALIDATION PARTIELLE — NON PRÊT POUR LA PRODUCTION.** Suivi autonome ; les rapports et preuves antérieurs restent inchangés. Ce premier état publie une collecte de métadonnées Gitleaks, pas une clôture de sécurité.

## A. Réconciliation et décision

Départ propre sur arena/c9eaae15-garageflowsv2, HEAD et distant 77558ca7dad4ed145aa7a58cf6ef7b31a325d7cd. Push initial : Everything up-to-date. Autorisation explicite utilisateur de mise à jour avant/après cette investigation ; aucune autorisation main/PR, release, force push, rotation ou déploiement. Toutes les empreintes du manifeste au départ vérifiées ; copie nommée EVIDENCE-SHA256-at-77558ca.jsonl conservée.

Les CI source c53d8e5 (38581782030) et documentaire 77558ca (38583146598) sont toutes deux terminées en failure : scan Gitleaks/Required validation échoués, trois jobs de contrôle réussis, recette authentifiée/Windows/release complète skipped. Aucun succès transmis d’un commit à l’autre. Les réponses complètes horodatées sont dans evidence/ci-{source,documentary}.log.

## B. P0 Gitleaks — FUP-009/008/020

Statut **ÉCHOUÉ** du contrôle distant, accès détaillé **BLOQUÉ** : nouvel essai de récupération des logs par gh sur 77558ca, avec query strings supprimées avant tout enregistrement ; voir external-access.json. Ne pas interpréter le précontrôle de trois familles comme un scan Gitleaks.

Amélioration de collecte : scripts/gitleaks-ci.cjs conserve le binaire officiel, le périmètre dir/config/redact et le code négatif. Rapport temporaire expurgé dans un répertoire 0700, sortie enfant jamais imprimée, projection exclusivement règle/chemin/lignes/commit/scope. Annotations notice pour métadonnées non triées ; le job reste en échec sur exit1, aucun finding n’est ignoré. Suppression du seul répertoire temporaire possédé. Échec fermé sur rapport absent/incohérent, JSON invalide, interruption, erreur système. Caractères de workflow échappés. Quatorze tests unitaires du collecteur passent ; il ne s’agit PAS d’un scan officiel local. Le JsonReporter v8.24.3 officiel confirme l’encodage JSON d’une slice nil en null, pris en charge sans transformer exit1 en succès. La CI doit encore confirmer le comportement réel et les limites d’annotations.

## C. P0 Dependabot — FUP-026

Accès détails retenté en lecture seule ; HTTP403 (external-access.json). Aucun paquet/plage/exploitabilité des 151 alertes annoncé. Compteur historique main distinct de l’audit npm de branche. main récupérée pour comparaison en lecture seule, sans checkout/merge. Export expurgé ou permission Dependabot alerts read requis ; aucune clé ni jeton dans le chat.

## D. Régressions et Prisma

Vrais tests locaux réexécutés : backup réel SQLite/FS 10/10 ; suite ciblée crypto/redaction/sauvegarde/crash réussie (totaux exacts dans corrections-regression.json). Trois échecs SQLite reproduits dans sqlite-reproduction.json : échec du checksum/moteur officiel Prisma, pas un succès de persistance. Une vérification statique réussit dans le même fichier ; aucun mock de moteur. Le résultat global historique 3829/2982 pass/3 fail/844 skips/4 erreurs est une exécution distincte et n’est pas recalculé en additionnant ces relances. Lint et type-check réussis ; test:release-safety renforcé avec le collecteur, réussi.

## E. Travaux indépendants et preuves

Triage/parser Semgrep, comparaison main, revue manuelle et réconciliation des skips poursuivis dans cette investigation. Le budget reste 3625984 octets ; ni build officiel ni paquet Windows ni issuer/staging ne sont validés. Les résultats approfondis et la matrice courante seront ajoutés sans réécrire les résultats historiques. commands.jsonl capture argv, versions référencées, heures UTC/Paris, HEAD, état de travail et codes propres à chaque contrôle. external-access.json distingue les codes des accès externes du succès de collecte de leur diagnostic. Les manifestes ne certifient pas la sécurité intrinsèque des contenus.

Premier contrôle consistency : ÉCHOUÉ car la nouvelle lecture du SHA fourni par GitHub n’était pas déclarée dans le registre canonique. GITHUB_SHA ajouté précisément à platformProvided (pas une exemption de fichier/règle). Les deux lignes vides finales des journaux types/lint sont conservées telles quelles : le contrôle whitespace initial retourne2, pas0 ; aucune preuve normalisée pour cacher ce résultat.

## F. Nouvelle exécution 3870736 — ne pas confondre avec les deux précédentes

Run38587226456 terminé en échec. Cette fois **Install gitleaks échoue avant le scan**, qui est skipped : aucune annotation de finding n’a été produite, le collecteur réel n’est donc pas encore validé. Cause réseau/permission/checksum non déterminée faute de logs détaillés. E2E responsives échouent aussi, après installation Chromium et préparation SQLite réussies ; pas de régression métier attribuée sans preuve. FUP-003/009 restent ouverts. Réponse complète ci-collector-final.log et liste d’annotations vide conservées.

Prochaine correction de robustesse/diagnostic : installation du même binaire vérifié sous RUNNER_TEMP plutôt qu’un répertoire système ; annotations HTTP/exit par téléchargement, checksum conservé, aucun retry aveugle ni bypass TLS. Cela évite une dépendance aux droits système sans affirmer qu’elle était la cause du premier échec. Inventaire de findings annoncé en annotation pour pouvoir réconcilier la pagination API. Les tests du collecteur restent14/14 et test:release-safety51/51.

Comparaison main e3ac5f5a55284906531dcc5d4a620cb0ff072313 effectuée en lecture seule ; audit npm du snapshot de manifestes : 50 alertes de paquets (2critical/34high/13moderate/1low), exit1. Ce n’est pas l’export des151 alertes Dependabot et aucune identité de compte n’est supposée. Audit npm de la branche courante :0, exit0. Pas d’installation de main, pas d’exécution de ses scripts.

## G. Résultats Gitleaks obtenus et triés sur 258eff3

Installation officielle avec checksum réussie. L’inventaire d’annotations annonce exactement4 findings, récupérés : tests/config.test.cjs:98 (placeholder explicitement invalide d’un test négatif), et trois lignes X-Oauth-Client-Id dans des journaux HTTP immuables. Ce dernier champ est un identifiant d’application OAuth PUBLIC, pas un client secret ni un access token. **Aucune valeur copiée dans le registre de triage.** gitleaks-triage.jsonl conserve règle, lignes, commit, SHA, classification, action et limites de chaque constat.

La valeur runtime du test reste identique, sous forme concaténée ; toutes les assertions sont conservées, test:config49/49. Les trois en-têtes publics ont uniquement des fingerprints fichier/règle/ligne dans .gitleaksignore, documentés et protégés par un contrôle obligatoire de SHA256 du fichier entier + type d’en-tête. Le garde s’exécute DANS le job secrets avant le scanner, ainsi que dans test:release-safety (52/52). Aucun fichier, répertoire ou règle exclu en entier. Le code officiel v8.24.3 detect/detect.go confirme le format exact des fingerprints. Toute modification de ces preuves invalide l’exception et doit faire échouer le garde. Aucune rotation ou réécriture d’historique pour ces quatre faux positifs démontrés. Le prochain scan distant doit encore prouver le résultat final.

Le premier collecteur d’annotations utilisait --slurp, absent de gh2.23.0 : son échec était local au CLI, PAS une preuve de refus API. Collecteur corrigé avec décodage des pages JSON concaténées, URL check_run_url obtenue depuis le job et nombre d’annotations déclaré contrôlable. Les premiers fichiers vides et diagnostics restent conservés pour la chronologie ; ci-installer-annotations-compatible.json est la récupération exploitable. Les téléchargements de logs restent distinctement bloqués par EOF sur l’autre hôte officiel.

## H. Bilan courant et traçabilité finale (après64619b6)

**VALIDATION PARTIELLE — NON PRÊT POUR LA PRODUCTION.** La matrice courante est ici `ISSUE-MATRIX.md`/`issue-matrix.json` :26IDs inchangés. Les matrices parentes sont des états historiques, pas le statut courant.

### Contrôle Gitleaks réellement validé, CI globale toujours en échec

[CI64619b6 /38589332331](https://github.com/supremperf/GarageFlowsV2/actions/runs/38589332331) terminée le14octobre2026 à15:29:23UTC (17:29:23Paris) : **Secret scan (Gitleaks) success**, installation/intégrité/guard/scan réussis ; annotation d’inventaire **findings=0, scannerExit=0**. Les quatre findings précédents ont chacun un triage. FUP-009 est **VALIDÉ sur l’arbre646**, pas sur tout l’historique Git, les secrets hors dépôt ou la production. Les trois fingerprints publics restent liés aux octets immuables par un garde exécuté AVANT le scanner. Ce n’est pas une exemption générale ni une suppression d’alerte réelle.

|Contrôle646|Observation|Limite|
|---|---|---|
|Dépendances|VALIDÉ, job success|npm strict ; ne clôt pas main|
|Gitleaks|VALIDÉ, inventaire0/exit0|Arbre courant uniquement|
|Types/lint/tests|ÉCHOUÉ au step Tests (unit + integration)|npm ci, Prisma, types/lint et smoke PostgreSQL précédents réussissent ; aucun total de cas distant inventé|
|E2E responsives|VALIDÉ au niveau job success|Les échecs387/258 ne sont pas effacés ; recette authentifiée distincte|
|Required validation|ÉCHOUÉ|Refus réel, pas seulement YAML ; protections403 non attestées|
|Authentifié / Windows / gate full|BLOQUÉ, conclusion GitHub skipped|Pas de preuve d’exécution ; approbations/services/plateforme restent requis|

`ci-jobs.jsonl` contient40 observations distinctes pour5commits : noms, SHA, IDs/URLs, début/fin/durée, statut/conclusion, étapes échouées et limites de causalité des skips. Le nouvel échec distant des tests **ne peut pas être attribué au TLS local** : la préparation native distante a réussi. Les annotations accessibles donnent uniquement le code global ; l’investigation de ses cas exacts exige le journal expurgé ou le téléchargement officiel accessible. Aucune assertion, test, job obligatoire ou gate n’a été désactivé pour obtenir ce bilan.

### Exécutions locales séparées

- Suite complète fraîche : **3829 cas /2982 pass /3 fail /844 skips /4 rejets globaux**, exit1.325 fichiers ; les compteurs JSON de suites imbriquées ne sont pas assimilés au nombre de fichiers. `tests-all.jsonl` et les sous-registres pointent chaque cas vers le JSON exact de cette exécution.
- Régression des correctifs : **122/122**, dont54 cas de tags GCM,33 cas de secrets cités, sauvegardes/crash/redaction/cipher historiques ; tests de sauvegarde SQLite/FS **10/10** séparés. L’ancien94/94 ciblé reste historique, non présenté comme une nouvelle exécution ni ajouté au total complet.
- Collecteur Gitleaks **14/14** ; configuration **49/49** ; sûreté de release renforcée **52/52**. Ces contrôles unitaires ne remplacent pas le vrai scan distant.
- Lot manuel ciblé : résultats exacts dans `evidence/manual-batch-regression.json`, sans mélange au total global. Lint/type-check réussis ; consistency initialement échoué sur la nouvelle variable système non déclarée, puis réussi après déclaration canonique GITHUB_SHA et régénération de la documentation. Preuve négative conservée.
- Trois échecs SQLite reproduits individuellement dans le fichier isolé ; erreur exacte du téléchargement `binaries.prisma.sh`, plateforme debian-openssl-3.0.x, moteur605197351a3c8bdd595af2d2a9bc3025bca48ea2 : socket interrompu **avant TLS**, checksum non récupéré. Aucun artefact reçu donc aucune intégrité prétendue. Le défaut applicatif éventuel n’est pas exclu : corps de persistance encore non validés localement.
-844 skips réconciliés **individuellement**, mêmes motifs retrouvés :808 corps empêchés par setup,21 PostgreSQL,5 Redis,5 autorité privée,2 clés publiques externes,2 jetons émis,1 artefact réel absent. Le succès Redis historique5/5 n’est pas réinjecté dans cette exécution sans Redis.
- Build **standard** `npm run build` relancé, exit1 au premier prisma generate, même pré-TLS ; Next build non atteint. Budget total **3625984** et chunk524288 **inchangés**, aucune mesure de production actuelle ni paquet Windows validé. Pas de build diagnostique présenté comme officiel.

### Semgrep et revue manuelle

Dernier scan officiel local **1.180.0**, mêmes règles upstream épinglées et environnement hash-vérifié : **996/996 cibles sélectionnées**, **865 signaux bruts**, **845 groupes règle+plage exacte**, **20 occurrences dupliquées conservées avec leurs IDs**, **864 IDs historiques conservés** et nouveau SAST-20261014-0865.14ERROR,354WARNING,497INFO ;277security,59best-practice,99correctness,430portability. Ces catégories ne sont pas des vulnérabilités confirmées. **17 triages bornés** (11VALIDÉ sur le constat,6PARTIELLEMENT VALIDÉ), **848 signaux encore en attente**, aucune règle désactivée.

**15 gaps parser :4 erreurs complètes/11 partielles**, chemins, empreintes et spans dans sast-summary-final.json. Tous ces fichiers sont du TypeScript syntaxiquement valide selon le compilateur installé (0diagnostic syntaxique) ; un probe minimal avec generic `typeof import` reproduit une limite Semgrep. Cela explique une classe de limites, pas nécessairement chaque détail de chaque erreur. Aucun fichier n’a été retiré, aucune approbation implicite des gaps. La sélection de996 fichiers ne démontre pas leur parsing intégral. Les décomptes de règles chargées/exécutées de l’ancien scan ne sont pas inventés pour cette nouvelle exécution.

Les brouillons de post-traitement restent conservés : regroupement initial trop grossier par lignes, préfixe absolu de règle non normalisé, SHA relevé au post-traitement au lieu du snapshot de scan, puis erreur de déballage des spans. `sast-ledger-corrections.json` identifie précisément les fichiers remplacés pour l’analyse et les résultats faisant foi : **sast-*-final**, IDs uniques/plages complètes/hash du manifeste pré-scan, sans perte des doublons. Il ne faut pas utiliser les brouillons pour conclure.

Périmètre de revue courant : **1250 chemins distincts,69 revues source intégrales,13 partielles,1168 en attente**. Catégories disjointes vérifiées ;3 nouvelles sources de politique/collecteur par rapport aux1247 précédentes. Relectures du delta package/CI et lot secret/startup/chemin utilisateur/alerte sauvegarde/SemVer/DOM de test, avec sources, ranges, risques, tests et limitations. Les changements de hash invalident les revues héritées, notamment tests/config maintenu partiel. **Lecture complète ≠ validation fonctionnelle**, `closed=false` reste explicite. Les points de concurrence de première création de secret, validation stricte SemVer et frontières IPC restent à approfondir ; pas d’exploit ou de résolution supposé.

### Dependabot main reste distinct et bloqué

FUP-026 **BLOQUÉ** : nouvelle requête API403 ;151 alertes serveur historiques non exportées, dont2critiques, aucun inventaire de151 entrées fabriqué. Comparaison read-only du commit main e3ac5f5a55284906531dcc5d4a620cb0ff072313 :390 entrées de lock et14 déclarations directes diffèrent. Leurs versions sont des résolutions de manifeste, pas une attestation des binaires installés sur main. Audit npm du snapshot de manifestes, sans installation/scripts : **50** (2critical/34high/13moderate/1low), exit1 ; audit frais de branche **0**, exit0. Ces deux scanners/périmètres ne sont pas confondus avec les151 alertes GitHub. Aucune fusion main ni suppression d’alerte distante.

## I. Travaux ouverts ordonnés et intervention minimale

1. **Tests CI646** : fournir journal/artefacts expurgés des cas et erreurs du step Tests, ou accès à la chaîne officielle de téléchargement des logs Actions. Ne transmettre ni secrets, ni URL signée temporaire, ni tokens. Diagnostiquer la cause réelle, corriger et relancer ; ne pas hériter du succès des anciens jobs.
2. **FUP-026** : permission lecture Dependabot alerts ou export expurgé (ID, dépôt/périmètre/main+commit/manifeste, paquet/écosystème, gravité, version/plage, correctif, état, URL, date). Poursuivre la comparaison/test ; intégration main uniquement sur autorisation distincte.
3. **Prisma/natifs** : accès officiel complet avec TLS/checksums sur runner isolé. npm ci normal et deux générations,3 tests SQLite puis suite globale ; ne pas utiliser un faux moteur/contournement TLS. Les services distants verts ne certifient pas automatiquement leur contenu sans preuves de cas.
4. **SAST** : poursuivre848 signaux et résoudre les15 gaps via configuration/version upstream approuvée et vérifiée, ou faire approuver explicitement la portée résiduelle. Aucun gap tacitement approuvé.
5. **Revue/IPC/licence** : poursuivre1168 fichiers/13 partiels, analyse des appelants IPC, décision sur ancre de grâce hors ligne025 et preuve indépendante issuer007. Aucun changement silencieux de politique ni clé privée en CI/chat.
6. **Release** : staging authentifié réellement isolé et approuvé, build standard/budget, candidat Windows/inspection ET exécution native, attestation des protections/status checks. Pas de lancement manuel de release gate/deploy ni d’accès production dans cette investigation.

Commandes exactes/horaires UTC et Paris/HEAD/état de travail/codes/versions référencées dans commands.jsonl ; réponses externes et limites dans external-access.json ; contrôles de cohérence dans verify-current.py. Les hashes sont des comparaisons d’intégrité, **pas une garantie de sécurité intrinsèque**. Les mises à jour de documentation après646 ont leur propre SHA et leur propre CI, jamais validée par héritage. **Condition de production non satisfaite.**
