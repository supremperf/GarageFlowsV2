# Reprise finale FUP — 14 octobre 2026

## Décision

**VALIDATION PARTIELLE — NON PRÊT POUR LA PRODUCTION.**

Suivi local daté du 14/10/2026, heures des preuves en UTC (`Z`), fuseau utilisateur Europe/Paris (UTC+2). Cette reprise réalise des contrôles et corrections ; elle ne constitue ni une clôture exhaustive ni une autorisation de livraison.

## 1. Identité Git, périmètre et conservation

- Branche vérifiée : `arena/c9eaae15-garageflowsv2`.
- HEAD et référence distante vérifiés initialement : **4989b53d4a8f10cf8afb2f7c579d1de354f58508**, arbre propre, aucun commit/diff depuis la publication déclarée. Les références initiales et l'observation courante sont distinguées dans [initial-and-candidate-state.json](initial-and-candidate-state.json).
- **Candidat local final : HEAD4989b53 + 18 fichiers source/test modifiés**, delta Git source SHA-256 **075562ac7cc0ebbd36a04f0d883157dc40a5ebcc4bc8e4e0839dd4810b55e80e**. [Identité finale et empreintes](candidate-source.json), [patch exact](source-changes.patch).
- Aucun commit, push, merge, workflow dispatch, déploiement, release, force-push, rotation ou changement de permissions effectué. La CI de4989 ne valide pas les modifications locales non publiées.
- L'ancien dossier `../investigation-2026-10-14/`, son manifeste et les rapports précédents ne sont pas réécrits. Contrôle initial de cohérence : [exit0](evidence/historical-coherence.log). Les empreintes des anciennes preuves sont à nouveau contrôlées par le vérificateur de ce dossier ; les anciennes empreintes de **sources modifiées** sont des références historiques, pas des attestations du candidat courant.
- [Matrice courante des26 identifiants](ISSUE-MATRIX.md) ; versions JSON, graphes et registres distincts des historiques. Les résultats intermédiaires de cette reprise sont conservés ; fichiers `*-final` et suite `vitest-candidate` sont les versions finales explicitement désignées.

## 2. P0 — Verdict final de CI4989, désormais établi

[Run38591143098](https://github.com/supremperf/GarageFlowsV2/actions/runs/38591143098), SHA4989b53 exact : **completed / failure** ; créé15:38:48Z, terminé/mis à jour15:45:40Z. [Métadonnées du workflow](ci-runs.json), [détails REST par job](ci-job-details.json).

| Job / identifiant | Conclusion GitHub | Statut du critère | Durée REST | Observation |
|---|---|---|---:|---|
| Dépendances115946041548 | success | VALIDÉ, audit de branche | 47s | npm ci JS diagnostique indépendant, arbres/audit/contrôles de sécurité réussis |
| Responsive115946041871 | success | VALIDÉ, parcours publics seulement | 137s | Préparation SQLite et Playwright publics réussis |
| Gitleaks115946042090 | success | VALIDÉ, arbre4989 | 8s | Annotation réelle findings=0, scannerExit=0 |
| Type/Lint/Test115946042324 | success | VALIDÉ, job4989 | 263s | npm ci normal, deux générations Prisma, TS/lint, migrations/smoke PostgreSQL, tests, build standard et budget réussis |
| Authentifié115948268697 | failure | BLOQUÉ pour les parcours | 2s | Garde préalable de cible/fixtures/approbation en échec ; Playwright non exécuté |
| Windows115948268736 | failure | ÉCHOUÉ | 135s | Installation/clé publique/tests préalables réussis, puis npm run dist échoue ; contrôles suivants ignorés |
| Required115949473105 | failure | ÉCHOUÉ | 3s | Refus des échecs obligatoires, sans affaiblissement de la porte |
| Final release gate115946044296 | skipped | EN ATTENTE DE REVUE | 0s | Condition workflow_dispatch ; jamais présenté comme réussi |

Les dates exactes de début/fin, liens et étapes se trouvent dans `ci-job-details.json`. **Sept timestamps completedAt divergent** entre la vue agrégée `gh run view` et l'API REST dédiée aux jobs : les deux observations sont conservées dans [ci-metadata-reconciliation.json](ci-metadata-reconciliation.json). Les durées ci-dessus utilisent REST ; les dépendances vérifiées n'ont pas d'incohérence temporelle avec cette source. Aucune conclusion négative n'est réétiquetée.

La porte Required dépend de dependency-security, secrets, check, e2e, e2e-authenticated et windows-package ; le gate complet manuel est distinct. YAML défensif ≠ preuve que GitHub impose ces checks sur la branche : protection classique toujours403. Aucun job ne reste in_progress dans cette observation finale ; les steps skipped restent non exécutés. Un job de tests réussi ne prouve pas, sans le journal par cas, l'absence de skips conditionnels internes.

## 3. P0 — Cause du précédent échec CI, sans attribution TLS abusive

Le run [38589332331](https://github.com/supremperf/GarageFlowsV2/actions/runs/38589332331), SHA **64619b6270d7923167130246c061ad5773e3f29a**, reste historiquement en échec. Aucun changement produit dans les chemins comparés entre646 et4989 : [comparaison](source-ci-comparison.json).

Les téléchargements de journaux des deux runs ont réellement échoué **exit1 / EOF**, pas avec un403 inventé. [Commandes et reçus expurgés](ci-log-access.json). Les annotations restent lisibles : elles localisent une **AssertionError dans invoice-authz.test.ts:170**, après préparation native distante réussie.

L'analyse d'une réponse JSON complète incluse dans l'annotation démontre que le marqueur numérique du coût se retrouve **uniquement comme sous-chaîne d'un garageId généré**, pas comme valeur égale au coût : [analyse expurgée](ci-assertion-analysis.json). Seuls le chemin JSON et le type sont exportés ; aucune valeur de réponse n'est reproduite. La garde `JSON.stringify(body).not.toContain(...)` avait un oracle ambigu.

**Correction locale : cinq identifiants de fixture explicites et stables**, sans ce marqueur. Les **16 lignes expect sont conservées byte-for-byte**, y compris toutes les assertions de confidentialité et le contrôle du JSON complet : [preuve de correction](fixture-correction.json). Pas de suppression d'assertion, pas de skip ajouté, pas de permission métier élargie. La suite isolée est exécutée mais bloquée dans son beforeAll Prisma ; ses7 cas ne sont pas validés : [JSON](evidence/invoice-authz-isolated.json), [trace](evidence/invoice-authz-isolated.log). Cette correction n'est pas déclarée fonctionnellement résolue sur SQLite.

Le détail de l'échec **Windows npm run dist** et le sous-motif exact de la garde authentifiée restent inconnus faute de journal expurgé. Ne pas confondre cette limite avec la cause désormais établie de l'assertion646.

## 4. P0 — Dependabot et protections

[Accès réessayés, paginés](external-access.json) :

- Dependabot : **HTTP403**, `Resource not accessible by integration`.
- Protection classique de la branche et de main : **HTTP403**, même diagnostic.
- API des règles effectives de la branche : exit0, **liste vide**. Cela ne prouve pas l'absence de protection classique ni l'obligation effective des checks.
- Les **151 alertes / deux critiques** sont le compte historiquement annoncé par GitHub, **pas un inventaire courant exporté**. Aucun paquet, version, exploitabilité ou état individuel n'est inventé. Aucune alerte non consultable n'est résolue.
- L'ancien snapshot main et sa comparaison de lockfiles restent historiques. Pas de merge/transplantation dans main, pas de nouvelle prétention d'audit de main.
- **Nouvel audit strict de la branche : LOW=0 MODERATE=0 HIGH=0 CRITICAL=0 TOTAL=0**, exit0 ; [preuve](evidence/audit-strict.log). Manifests/lockfiles inchangés. Ce zéro ne traite pas les alertes GitHub de main, n'atteste pas les binaires natifs et n'élimine pas les risques upstream/forks déjà documentés.

Minimum : export administrateur/security-manager expurgé, ou lecture GitHub App **Dependabot alerts:read** et **Administration:read** pour protections. Export attendu par alerte : ID/référence, dépôt/branche/périmètre/manifeste, paquet/écosystème/direct-transitif, sévérité, plage affectée, version corrigée, état, dates ; priorité aux deux critiques. Pour protections : branches/rulesets applicables, required_status_checks et politique d'obligation. Aucun droit d'écriture ou secret d'authentification demandé en chat.

## 5. P1 — Prisma : diagnostic officiel et limites établies

[Diagnostic réseau](prisma-network.json), [compatibilité/version des clients](prisma-compatibility.json), [versions des outils](tool-versions.json) : Node22.22.3, npm11.16.0, Prisma/Client/engines5.22.0, Linux x64/glibc2.36, OpenSSL3.5.6, moteur605197351a3c8bdd595af2d2a9bc3025bca48ea2.

DNS de binaries.prisma.sh réussit. Aucun proxy/cafile alternatif configuré ; npm strict-ssl=true, NODE_USE_SYSTEM_CA=1, TLS non désactivé. **ECONNRESET avant secureConnect**, aucun HTTP, certificat pair ou chaîne/date de validité reçus. Ce n'est pas une preuve d'expiration du certificat. La politique de sortie de cet environnement n'autorise que GitHub/npm/PyPI, pas ce domaine officiel Prisma.

Le probe HTTPS vise `.../libquery_engine.so.node.sha256` ; le vrai CLI demande notamment `.../libquery_engine.so.node.gz.sha256`, et le db push isolé atteint aussi `.../schema-engine.sha256`. Les URL sont distinguées, même hôte et commit officiel. Aucun binaire reçu, aucun checksum de binaire validé, aucune substitution de moteur ou désactivation TLS. La cohérence des métadonnées JS CLI/client/moteur ne prouve pas le chargement natif.

Génération officielle rejouée : exit1. Build standard final rejoué : exit1 au téléchargement Prisma, **Next n'est pas atteint**. [Génération](evidence/prisma-generate.log), [build final](evidence/standard-build-candidate.log). Prérequis : chemin réseau autorisé vers les téléchargements officiels et sommes de contrôle, puis génération desktop/serveur et vraie persistance. Aucun contournement de la politique réseau tenté.

## 6. P1 — Tests locaux du candidat final

Commande autoritative `vitest-candidate` : `npm test -- --maxWorkers=2 --reporter=default --reporter=json --outputFile.json=.../evidence/vitest-candidate.json`, argv/cwd/SHA/delta/versions/date/exit dans [commands.jsonl](commands.jsonl).

**3 841 cas : 2 994 réussis, 3 échoués, 844 ignorés ; 4 erreurs globales ; exit1.** 325 fichiers,78 fichiers en échec. [Synthèse](tests-summary.json), [registre de tous les cas](tests-all.jsonl), [trois échecs](tests-failed.jsonl), [skips individuels](tests-skipped.jsonl), [erreurs globales](tests-global-errors.json).

Les12 cas supplémentaires par rapport à3829 sont les régressions de rôles hérités. Les trois échecs de prepare-test-db sont reproduits isolément et dans la suite : db push réel échoue sur le téléchargement officiel avant TLS. C'est la cause immédiate attestée de ces exécutions, pas une preuve que toute la persistance est correcte une fois le moteur disponible.

Les quatre rejets globaux sont **PrismaClientInitializationError / Query Engine introuvable**, respectivement signalés dans publication-mise-a-jour, license-devices-unit, mechanic-admin et audit-v21-fixes. Ils sont expliqués mais **non résolus**. Les deux premiers runs JSON-seul ne permettent pas de compter ces erreurs ; les deux runs suivants à doubles reporters en observent4. Tous les runs intermédiaires sont conservés, jamais additionnés.

| Catégorie de non-exécution | Nombre |
|---|---:|
| Empêchés par setup, pas des skips intentionnels | 808 |
| PostgreSQL déclaré indisponible | 21 |
| Redis non fourni dans la suite complète | 5 |
| Clé privée d'issuer non fournie | 5 |
| Clé publique externe non fournie | 2 |
| Jetons émis réels non fournis | 2 |
| Artefact réel absent | 1 |

Pas de faux ORM, moteur modifié, tests retirés ou erreurs converties en skips. Les validations qui dépendent d'une autorité externe doivent se faire sur son environnement approuvé ; aucune clé privée d'issuer n'est sollicitée.

## 7. Correction locale supplémentaire — rôles hérités

Revue complète de authz.ts : can/permissionsOf indexaient un objet ordinaire, de sorte que `__proto__`, constructor et quatre autres noms hérités provoquaient une exception au lieu du refus promis. Régression avant : **12 échecs /43 cas**. Correction : **Object.hasOwn** avant l'accès aux deux matrices. Après : **205/205** sur autorisations/matrice/secrets ; TypeScript et ESLint finaux exit0. [Avant](evidence/authz-before.json), [après](evidence/authz-after.json), [TS final](evidence/typecheck-candidate.log), [lint](evidence/lint-final.log).

Aucun rôle ni droit ajouté. C'est une correction bornée du comportement de refus, pas la preuve d'une élévation de privilèges exploitable auparavant ni une certification de toutes les sessions. La suite complète finale inclut les12 régressions réussies.

## 8. P1 — SAST : parsing résolu, triage encore incomplet

Semgrep **1.180.0**, règles épinglées au commit9bbf021d0acffa3095fcffd17b2bc7787eb4796d, configurations JavaScript/TypeScript/Python identiques. [Commande complète](semgrep-exact-command-final.json), [996 cibles et SHA pré-scan](semgrep-targets-final.json), [synthèse finale](sast-summary-final.json).

Le probe reproduit le défaut de grammaire `importOriginal<typeof import(...)>()` : erreur3, alors que la forme alias équivalente parse. Refactorisation de **15 fichiers /17 occurrences**, sans changer les imports runtime ni assertions : alias `type ... = typeof import(...)` puis même appel typé. Pour chacun, JavaScript TS5.9.3 ES2022/ESNext **byte-identique avec removeComments=true/sourceMap=false**, commentaires source conservés. Une première comparaison incluant les commentaires émis a été refusée avant toute mutation ; elle reste dans parser-refactor.log. [Probe](parser-probe.json), [comparaison](parser-refactor.json), [détail des15 erreurs et couvertures historiques](parser-gaps-final.json).

**Scan final strict : 996/996 sélectionnés, 0 erreur de parsing, 865 signaux, 845 groupes règle+plage exacte,20 occurrences doublons conservées. Exit1.** Les865 identifiants historiques sont préservés après rapprochement par règle/plage complète et lignes source inchangées ; colonnes conservées, recouvrements non fusionnés arbitrairement. Aucun signal supprimé, aucune règle/exemption générale ajoutée. [Registre](sast-findings-final.jsonl), [groupes et alias](sast-location-groups-final.json).

Les17 triages historiques sont revalidés par empreinte. Dix analyses supplémentaires : deux faux positifs bornés sur la syntaxe de table Lua réellement exécutée dans Redis ; huit analyses de chemins du service de sauvegarde restent partielles (DB filename/stockage/collisions). **27 décisions exécutées : 13 VALIDÉ,14 PARTIELLEMENT VALIDÉ ; 838 signaux bruts encore en attente.** [Décisions individuelles](sast-triage-final.jsonl). Les14 ERROR/354 WARNING/497 INFO et277 signaux de catégorie security ne sont pas des nombres de vulnérabilités confirmées.

Le [registre courant par emplacement](sast-review-register.jsonl) superpose ces décisions à chaque groupe en conservant le statut de chaque occurrence : **13 groupes VALIDÉ,12 PARTIELLEMENT VALIDÉ,820 EN ATTENTE DE REVUE**. Les27 décisions brutes correspondent donc à25 groupes examinés, pas à27 emplacements distincts. Les838 occurrences non triées correspondent aux820 groupes encore en attente et à leurs alias. Le statut du registre brut de collecte n'est pas confondu avec ce statut courant de triage ; aucune décision n'est héritée silencieusement par un alias.

Zéro erreur de parsing ne signifie ni toutes les règles possibles, ni tous les langages, ni absence de vulnérabilité. SQL/Prisma/PowerShell/CMD/CSS/HTML et scripts sans extension restent à traiter par les contrôles appropriés et la revue manuelle. La résolution des15 erreurs observées est bornée à ce scanner/configuration ; aucune acceptation globale de risque n'est inventée.

## 9. P2 — Revue sémantique et risques encore ouverts

[Registre final](review-ledger-final.jsonl) : **1 250 fichiers,72 revues sémantiques bornées complètes,43 partielles,1 135 en attente**. **85 fichiers lus intégralement**, dont13 évaluations restant partielles ; ces catégories ne doivent pas être confondues. Les18 empreintes de sources modifiées sont renouvelées et les zones affectées réévaluées. Les15 refactorisations de types n'entraînent aucune revendication de lecture complète des tests concernés.

[Notes détaillées](manual-review-notes-final.json), [progression](review-progress-final.json). Approfondissement auth/authz/secrets, API helpers, quatre routes de sauvegarde administrateur, service/snapshot/route interne, récupération MFA, rate limiting, fixture financière. Deux préfixes de routes financières seulement sont lus et marqués partiels. Aucun lien symbolique suivi implicitement par le générateur courant ; aucun fichier produit retiré du périmètre.

Points non clos : fraîcheur/révocation des rôles JWT, couverture des handlers qui utilisent réellement requireSession, origine socket/proxy des routes internes, chemins de backup issus de DB, cohérence du stockage après échec disque, tables/versions/tenant/FK d'une restauration réelle, course existence/cleanup de la route interne VACUUM, politique d'appelants IPC et grâce hors-ligne. Ce sont des limites/risques à confirmer, pas des vulnérabilités toutes déclarées démontrées. **Les10 tests pré-migration ne valident pas cette route interne distincte.**

## 10. Correctifs conservés et revalidés

- Sauvegarde pré-migration : **10/10 tests SQLite/FS**, exit0, sans toucher une base métier : [preuve](evidence/backup-regression.log).
- Suite conservée : **122/122**, dont54 tags GCM,33 secrets cités/préfixés,6 sauvegardes historiques,7 crash,11 redaction,11 secret-cipher : [JSON](evidence/preserved-corrections.json). La suite historique exacte de cinq fichiers a également été rejouée : **94/94**, dont54 tags,6 sauvegardes,10 crypto de backup,13 TOTP et11 secret-cipher : [preuve nouvelle](evidence/gcm-historical-suite.json). C'est une suite composite, pas94 cas nouveaux de tags GCM. Aucun résultat historique écrasé ou ajouté artificiellement au total courant.
- Redis réel isolé : **5/5**, binaire comparé au hash de la compilation officielle antérieure ; boucle locale, aucun disque persistant, aucune connexion de production ni sysctl modifié ; **serveur arrêté**. [Exécution](evidence/redis-real.json), [provenance/arrêt](redis-runtime.json). Redis8.10.2 ≠ Redis7 de CI ≠ Upstash géré. Les cinq skips Redis de la suite complète restent bien des skips de cette exécution.
- Contrôles release-safety : **52/52**, audit strict npm exit0. Les conclusions bornées antérieures sur packaging/DB historique/IPC restent liées à leurs sources inchangées, pas à un nouveau paquet fonctionnel.

## 11. P2 — Build, budget et Windows

Seuils **3 625 984 octets total /524 288 par chunk**, fichiers package/lock/budget inchangés. Build et budget standard **réussis sur4989 en CI**, pas sur le candidat local modifié.

Le nouveau build local standard échoue avant Next. Une mesure diagnostique des fichiers **préexistants de12:42** sous .next/static renvoie exit1 :10 440 593 octets, chunk principal7 611 850 octets. **BUILD_ID absent**, aucune liaison à un build production/candidat courant ; ce résultat n'est ni dissimulé ni utilisé pour déclarer un dépassement de production actuel. [Provenance](stale-build-provenance.json), [mesure négative](evidence/budget-diagnostic.log). Rien n'est supprimé, aucun plafond relevé, aucune optimisation aveugle d'un bundle non identifié.

Windows4989 atteint npm run dist puis échoue ; contrôles budget/intégrité/artifact suivants non exécutés. Logs : EOF. Aucun dist ni application Windows actuelle inspectée/exécutée, pas de signature ou authenticité externe inventée. Packaging réussi, intégrité d'artefact et fonctionnement runtime sont trois critères séparés. Pas de simulation Linux présentée comme une validation Windows.

## 12. Traçabilité et reprise reproductible

[commands.jsonl](commands.jsonl) conserve ID unique, argv exact, cwd, temps, HEAD, état de travail, code réel/signal/timeout, versions et preuve. Les commandes postérieures à l'ajout du suivi de delta consignent aussi l'empreinte de diff source ; les premières sont bornées par les phases de modification décrites ici et les empreintes avant/après. [tool-versions.json](tool-versions.json) distingue package installé et exécutable natif utilisable.

Versions finales autoritatives : `sast-*-final`, `semgrep-*-final`, `parser-gaps-final`, `review-*-final`, suite `vitest-candidate`, matrice26 IDs de ce dossier. Les variantes sans final, les deux JSON-seuls et les runs intermédiaires sont des preuves chronologiques, pas des substituts au dernier résultat.

Le vérificateur read-only rapproche preuves historiques,1250 empreintes source,865 signaux et845 groupes,27 décisions,3841 cas/844 skips/4 erreurs,26 IDs, graphe et budget immuable. **Le manifeste SHA-256 démontre seulement l'identité des artefacts comparés**, pas leur innocuité. Aucun raw Secret/Match de scanner, réponse d'API métier ou URL signée de téléchargement n'est exporté. La validation locale Gitleaks reste bloquée : archives/checksums officiels en cache sont vides, aucun binaire n'a été exécuté ; [reçu](local-gitleaks-prerequisite.json). Le zéro distant4989 reste limité à ce SHA et à l'arbre scanné, pas à l'historique Git ni aux changements locaux.

Contrôles de clôture documentaire : cohérence read-only **exit0**, whitespace **exit0**, contrôle complet `npm run check:consistency` **exit0** après correction d'un libellé ambigu de commit dans la matrice. Le premier libellé numérique avait été interprété comme un nombre de cas par le garde documentaire ; le libellé actif précise désormais commit4989b53. Les deux échecs initiaux sont conservés, et la matrice intermédiaire originale reste byte-identique sous `.md.snapshot` (preuve chronologique, pas page active). [Reçu et empreinte du snapshot](doc-correction-receipt.json), [contrôle réussi](evidence/consistency-settled.log). Aucun garde, baseline ni exclusion produit n'est modifié pour obtenir ce résultat.

## 13. Prérequis externes minimaux et travaux indépendants restants

1. **Exports expurgés** Dependabot (d'abord critiques) et protections, ou droits de lecture minimaux listés §4. Pas de token/mot de passe en chat.
2. **Logs CI expurgés** Windows dist et garde staging ; l'annotation financière646 a pu être analysée sans exposer de réponse. Un export évite le chemin de téléchargement actuellement en EOF ; pas d'URL signée à transmettre.
3. **Réseau officiel natif autorisé** : Prisma/checksums et chaîne officielle Electron/GitHub release assets ; conserver TLS, vérifier intégrité, génération desktop/serveur puis SQLite et PostgreSQL réels, les3 échecs/4 erreurs et toute la suite.
4. **Cible HTTPS non-production approuvée et fixtures** : E2E_STAGING_URL, E2E_EMAIL, E2E_PASSWORD, E2E_LICENSE et E2E_NON_PRODUCTION=true, via le canal sécurisé de l'environnement GitHub prévu, jamais en chat ni sur garageflows.fr/production. L'absence exacte d'un de ces éléments n'est pas inférée du seul échec de la garde. Aucun secret/licence réelle de production demandé.
5. **Publication du patch et nouvelle CI uniquement sur autorisation explicite**. Aucun commit/push réalisé ici. Même après autorisation, conserver les jobs obligatoires et tester le candidat exact ; la dernière CI distante n'est pas celle du patch.
6. **Travail local encore faisable sans ces accès** : poursuivre les838 signaux/845 emplacements avec tous les alias conservés, les43 revues partielles et1135 en attente, les frontières auth/backup/IPC et les risques upstream. Leur non-achèvement n'est pas imputé artificiellement au réseau ou aux permissions.
7. Après prérequis : build standard courant, mesure officielle, dist Windows isolé, contrôles des ressources empaquetées, runtime et parcours authentifiés ; puis gate manuel complet autorisé, vérification des protections et gel des preuves sur le candidat de livraison.

## 14. Conditions de sortie : décision maintenue

La CI4989 est connue mais négative ; celle du patch non publié n'existe pas. Les3 échecs et4 erreurs globales persistent,808 cas obligatoires sont empêchés par setup, les alertes pertinentes et protections ne sont pas attestées,838 signaux/1135 fichiers restent à examiner. Build/budget/paquet/runtime Windows et parcours authentifiés du candidat exact ne sont pas démontrés. Les seuls critères validés restent explicitement bornés par SHA, outil et périmètre.

**VALIDATION PARTIELLE — NON PRÊT POUR LA PRODUCTION.**
