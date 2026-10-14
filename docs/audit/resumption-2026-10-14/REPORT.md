<!-- doc-numbers: journal -->

# Reprise d’audit du 14 octobre 2026 — état documenté avant publication GitHub

## A. Décision et périmètre

**VALIDATION PARTIELLE — NON PRÊT POUR LA PRODUCTION.**

Ce document est un rapport de reprise, pas une clôture définitive. Installation normale/native, tests critiques, navigateur/authentification, build standard, budget de production, distribution Windows, scanners/protections et revue exhaustive restent insuffisamment démontrés. Du travail indépendant de revue/triage reste possible : les blocages réseau ne rendent pas la revue terminée.

Racine : `/home/user/GarageFlowsV2`. Branche : `arena/c9eaae15-garageflowsv2`. Base : `c4a2cca2cf446f96be580e99cca8afbca45396c5`. Fuseau de présentation : Europe/Paris ; dates ISO des journaux en UTC. Le dernier message utilisateur autorise explicitement la mise à jour GitHub : commit/push de cette branche seulement, sans fusion, déploiement, release ni rotation. La publication et ses éventuels résultats CI doivent être vérifiés séparément ; ce rapport ne prédit pas leur succès.

Rapport historique **inchangé** : `../REPORT-2026-10-14.md`, SHA256 `34ec3d8cd7741342fdd221d1a250db7b22652272405bcf914fc77ed043e67c84`. Suivi antérieur conservé : `../followup-2026-10-14/REPORT.md`, SHA256 `a354d824f3d34d94fe59bb5f68c4c74e70e373deb51fa82114e2e94171c53da3`. Toutes les empreintes de ses preuves et sources ont été vérifiées sans divergence au démarrage (`initial-state.json`). Les sources corrigées ensuite ont été réévaluées ; les anciennes preuves ne sont pas réétiquetées comme nouvelles exécutions.

## B. Traçabilité et corrections

Les **21 identifiants historiques sont conservés**, avec historique, cause, action, dépendances, preuve et risque résiduel dans `issue-matrix.json` et `ISSUE-MATRIX.md`. Les graphes initial et actuel sont distincts (`dependency-graph*.json`). Le graphe d’exécution sépare construction et validation d’artefact pour éviter une dépendance cyclique entre packaging et intégrité.

| ID FUP-20261014- | État actuel | Portée / reste à faire |
|---|---|---|
| 001 | BLOQUÉ | Installation normale Electron/Prisma, natifs vérifiés absents. |
| 002 | ÉCHOUÉ | Trois tests SQLite et quatre rejets Prisma ; 808 corps empêchés par setup. |
| 003 | BLOQUÉ | Chromium absent ; découverte 144 cas seulement. |
| 004 | PARTIELLEMENT VALIDÉ | Optimisation UI sans perte conservée ; mesure de production actuelle absente. |
| 005 | PARTIELLEMENT VALIDÉ | 60 sources intégralement revues sur 1 247 fichiers ; non exhaustif. |
| 006 | RÉSOLU, borné | Copie/template Prisma sans DB client/reset, tests de sûreté réussis ; artefact natif non validé. |
| 007 | BLOQUÉ | Identité indépendante de l’autorité/jetons de recette à attester. |
| 008 | PARTIELLEMENT VALIDÉ | Politique six jobs testée ; obligation distante non attestée. |
| 009 | BLOQUÉ | Téléchargement officiel Gitleaks interrompu après redirection ; aucun scan exécuté. |
| 010 | RÉSOLU, borné | Préservation de DB historique testée sur fixtures possédées. |
| 011 | RÉSOLU, borné | Neuf désabonnements isolés testés ; pas un lancement Electron. |
| 012 | RÉSOLU, borné | Keygen Python réel testé avec clés éphémères ; aucun faux succès sans assertions. |
| 013 | PARTIELLEMENT VALIDÉ | Absence d’artefact honnête ; mode obligatoire fail-closed, preuve positive manquante. |
| 014 | VALIDÉ, mesure npm | Audit complet/strict et arbre npm à zéro ; portée limitée au scanner et à la date. |
| 015 | PARTIELLEMENT VALIDÉ | SAST local réellement exécuté mais signaux/parser ouverts ; CodeQL distant 403. |
| 016 | BLOQUÉ | Recette authentifiée isolée approuvée non disponible. |
| 017 | PARTIELLEMENT VALIDÉ | Redis réel 5/5 ; PostgreSQL et parité CI/services gérés non validés. |
| 018 | BLOQUÉ | Build/dist/Windows/runtime et services externes non validés. |
| 019 | RÉSOLU, borné | Gardes de liens/jonctions Prisma testés ; pas preuve contre écrivain hostile concurrent. |
| 020 | PARTIELLEMENT VALIDÉ | Exclusions globales de sécurité retirées ; scan Gitleaks encore absent. |
| 021 | EN ATTENTE DE REVUE | Politique des appelants IPC et revue complète de main.js ouvertes. |
| 022, nouveau | RÉSOLU, borné | Collisions de sauvegarde, annexes et rétention corrigées/testées. |
| 023, nouveau | RÉSOLU, borné | Secrets cités/préfixés échappant aux journaux/crashs corrigés/testés. |
| 024, nouveau | RÉSOLU, borné | Quatre déchiffreurs GCM refusaient insuffisamment les tags courts ; correction testée. |
| 025, nouveau | BLOQUÉ | Ancrage de grâce hors ligne sur birthtime recréable ; décision de sécurité/métier nécessaire. |

### Corrections de cette reprise

- **022 — Sauvegardes** : cinq échecs sur sept cas initiaux. Nommage séquentiel borné, réservation exclusive `COPYFILE_EXCL` avec traitement des collisions, prise en compte des annexes orphelines, filtre de noms générés exact et tri numérique de séquence. Rotation de `-journal` ajoutée. Dix cas passent, avec véritables bases SQLite et données distinctes conservées. Les annexes synthétiques ne sont pas présentées comme un test de récupération de journal chaud. Une première relance 8/10 a révélé deux défauts du nouveau montage de test : lecture immuable limitée au fichier principal d’une fixture avec journal synthétique, et injection d’erreur déplacée au stade rotation. Les assertions n’ont pas été retirées. Un NUL littéral a aussi été remplacé par son échappement JS, avec preuve d’égalité de la signature SQLite à l’exécution.
- **023 — Confidentialité** : 28/29 contre-exemples échouaient avant correction. Masquage des clés/valeurs citées, espaces, échappements, valeurs tronquées et préfixes d’environnement dans les deux sinks, plus clés d’objet sensibles côté serveur. Les 33 nouveaux cas et les régressions existantes passent. Les données métier ne sont pas modifiées ; le détecteur n’est pas une garantie universelle contre tout secret encodé.
- **024 — GCM** : 24/54 cas échouaient avant correction. Les déchiffreurs sauvegarde, SMTP, e-facturation et helper de migration SMTP acceptaient des tags de 4/8/12/13/14/15 octets. Ajout minimal de `{ authTagLength: 16 }`, conforme aux quatre formats réellement produits. Les 54 nouveaux cas passent ; suite ciblée 94/94. Les clés de test restent éphémères. Le helper CLI est testé en VM avec le vrai crypto, sans invoquer la migration Prisma. Les chemins TOTP/ressources à taille déjà fixe ne sont pas automatiquement des vulnérabilités parce qu’un scanner les signale.
- **025 — Limite non corrigée silencieusement** : le contre-exemple utilise une origine ancienne **simulée** de 200 h et une **vraie copie SQLite** aux mêmes octets/données, avec birthtime récent. La politique passe de verrou à permission sans état signé. Cela réfute l’hypothèse documentaire selon laquelle recréer un fichier ferait nécessairement perdre les données. Ce n’est pas une attaque empaquetée/émetteur validée ni une attente physique de 200 h. Une référence durable et une politique approuvée nouvelle installation/restauration sont nécessaires avant changement de comportement.

Fichiers produit modifiés pendant cette reprise : `electron/{control-plane,pre-migration-backup}.js`, `src/lib/redact.ts`, `src/lib/backup/crypto.ts`, `src/lib/security/secret-cipher.ts`, `src/lib/einvoicing/credentials-cipher.ts`, `scripts/encrypt-smtp-secrets.js`, `package.json` (nouveau test de sauvegarde dans `test:release-safety`). Ajouts : `.semgrepignore` sans exclusion, trois fichiers de régression (`quoted-secret-redaction`, `gcm-tag-length`, `pre-migration-backup-safety`) et ce dossier de preuves. Les autres changements locaux antérieurs sont préservés et font partie de la mise à jour globale demandée, sans leur attribuer une nouvelle correction dans cette reprise.

## C. Dépendances, installation et services

Versions capturées dans `tool-versions.json` : Node 22.22.3, npm **11.16.0** épinglé (npm système 10.9.8), Prisma CLI/client 5.22.0, Electron 41.10.6, electron-builder 26.15.3, Playwright 1.62.1, Vitest 4.1.11. Python keygen local 3.11.2 ; CI 3.12 configuré, non assimilé à une exécution locale de 3.12.

Audit npm complet JSON, audit strict et `npm ls --all` : **exit 0**, toutes gravités zéro, sans omettre dev/optionnelles. Ceci ne valide pas la sécurité générale. Surveillance upstream renouvelée : braces **3.0.3** reste la dernière version publiée ; GHSA-vfj7-8cjw-p6xm est **high**, affecte `<=3.0.3`, aucune version corrigée publiée. Le fork borné reste un risque de maintenance suivi, et le résultat npm sur son nom local n’est pas une attestation indépendante de l’upstream.

Installation normale/build/dist précédents : exit 1, preuves conservées dans le suivi antérieur. Aucun nouveau retry identique n’a été lancé sans changement de prérequis. Vérification actuelle des fichiers : binaire Electron, moteur Prisma Debian et Chromium absents (`native-current-state.json`). Les trois tests échoués reproduisent actuellement l’échec TLS sur :

`https://binaries.prisma.sh/all_commits/605197351a3c8bdd595af2d2a9bc3025bca48ea2/debian-openssl-3.0.x/libquery_engine.so.node.gz.sha256`

Erreur : socket réseau déconnectée avant établissement TLS. Il n’y a ni checksum récupéré ni moteur validé ; aucune désactivation TLS, faux ORM ou binaire tiers alternatif. Pour Electron/Chromium, consulter les URL/versions et essais officiels du suivi, puis utiliser un runner dont les téléchargements officiels et leurs redirections sont autorisés. Une installation JS seule n’est pas une installation normale valide.

**Redis indépendant débloqué** : source officielle Redis 8.10.2, commit API `498ecd0d6d007db11ddb3aea9428552598a78622`, compilation locale réussie. Source/archive/binaire et limites de signature sont consignés. Instance éphémère, loopback, sans persistance ; cinq tests réels passent (dont nettoyage), puis arrêt explicite. Aucun sysctl modifié. Ce n’est ni PostgreSQL, ni Redis 7 de CI, ni une attestation d’Upstash géré. Aucun PostgreSQL isolé n’a été exécuté ici.

## D. Tests et réconciliation individuelle

| Contrôle | Résultat réel | Preuve |
|---|---|---|
| ESLint final | exit 0 | `evidence/lint-final.log` |
| TypeScript final | exit 0 | `evidence/type-check-final.log` |
| Configuration | 49/49, exit 0 | `evidence/config-tests.log` |
| Sécurité dépendances/compatibilité | 9/9, exit 0 | `evidence/security-tests.log` |
| Sûreté release | **37/37**, exit 0 | `evidence/release-safety-final.log` |
| Cohérence | exit 0 | `evidence/consistency.log` |
| Suite complète finale | **3 829 : 2 982 pass, 3 fail, 844 skip ; 4 erreurs non gérées ; exit 1** | `evidence/vitest-final.{json,log}` |
| Redis réel séparé | **5/5**, exit 0 | `evidence/redis-real-tests.{json,log}` |
| Régressions GCM + existantes ciblées | 94/94, exit 0 | `evidence/gcm-after.json` |
| Journaux + sauvegarde ciblés | 57/57, exit 0 | `evidence/targeted-final.json` |

Les suites ciblées recouvrent la suite globale et ne doivent pas être additionnées comme des cas uniques supplémentaires. L’union des preuves globale + Redis porte sur 3 829 cas uniques : **2 987 pass, 3 fail et 839 encore non exécutés**, sur exécutions distinctes. La suite globale elle-même conserve bien 844 skips ; cinq seulement sont validés séparément. Le passage de 2 895 à 2 982 succès par rapport au suivi antérieur correspond aux **87 nouveaux cas** (33 confidentialité + 54 GCM), pas à la disparition des trois échecs.

Les trois échecs, inchangés dans `src/test-utils/__tests__/prepare-test-db.test.ts` :
1. « produit une base exploitable, et le modèle porte l’empreinte du schéma » ;
2. « le second appel réutilise le modèle au lieu de reconstruire » ;
3. « une base déjà présente est REMPLACÉE, jamais réutilisée telle quelle ».

La relance isolée du fichier confirme un succès statique et les trois mêmes échecs (exit 1 ; `evidence/sqlite-isolated.json`). Tous échouent lors de la construction préalable, commande locale Prisma `db push --skip-generate --accept-data-loss` sur DB de fixture, avant de démontrer les propriétés ciblées. Le stderr identifie le checksum TLS ci-dessus. Aucune assertion n’est remplacée par un skip et aucun fallback DB n’est introduit. Les tests de construction/réutilisation/remplacement restent donc non validés.

Répartition des 844 skips de la suite globale : **808 empêchés par setup**, 21 PostgreSQL, 5 Redis, 2 clé publique externe, 5 poste de signature émetteur, 2 jetons réellement émis, 1 artefact réel absent. Les 325 fichiers comprennent 78 fichiers échoués et 77 dont tous les corps sont empêchés par setup. Les quatre rejets non gérés sont attribués individuellement à `publication-mise-a-jour`, `license-devices-unit`, `mechanic-admin`, `audit-v21-fixes` : Query Engine Debian absent, pas quatre erreurs mystérieusement supprimées.

Inventaires reproductibles : `tests-{all,failed,skipped,setup-errors,unhandled-errors,e2e}.jsonl`, `tests-summary.json`. Les classifications par criticité sont conservatrices, pas une revue métier complète de chaque test. Première tentative globale sans limitation de workers : timeout 240 s, aucun bilan exploitable ; conservée, non présentée comme résultat complet. Relances avec `--maxWorkers=2`, reporters observables et délai de sécurité suffisant : bilan complet final ci-dessus.

E2E : découverte actuelle **144 cas**, commande `playwright test --list --reporter=json`, exit 0. **Ce n’est pas une exécution navigateur.** L’ancien essai réel reste 0 pass, 54 échecs avant rendu faute de Chromium, 90 skips d’authentification. Aucun scénario navigateur/authentifié n’est revendiqué validé par les unités, la découverte ou le shim Redis.

## E. Build, budget, distribution et licences

Plafonds `perf-budget.json` **inchangés** : total JS **3 625 984 octets**, chunk **524 288**. L’optimisation historique conserve 562 entrées × 14 langues et ses tests sans perte. La mesure diagnostique historique 3 632 537 → 3 609 457 n’est pas un build standard actuel et ne suffit pas à fermer 004 ; les changements serveur/crypto doivent passer le build standard sur runner autorisé.

**Build standard, dist, candidat Windows, inspection finale, fuses et lancement empaqueté non validés.** Aucun code 0 diagnostique avec erreur Prisma n’est transformé en succès de release. Les contrôles de paquet requis restent fail-closed. Les couples éphémères Python/Node ne prouvent pas l’identité de l’autorité réelle ; ne pas transmettre de clé privée de production au dépôt/chat/CI. Exiger des jetons de recette approuvés et une attestation publique indépendante.

## F. Sécurité et CI

Semgrep **1.180.0** installé dans un venv hors produit : **66 wheels** vérifiées contre les SHA256 des métadonnées PyPI officielles puis installation `--require-hashes --no-index`. Aucune dépendance de production ajoutée. Règles officielles épinglées au commit vérifié `9bbf021d0acffa3095fcffd17b2bc7787eb4796d`. Télémétrie et vérification de version désactivées lors des scans, sans envoi de code à un service SAST.

Dernier scan : **994/994 cibles explicitement sélectionnées**, 592 règles chargées, **575 exécutées**, **864 signaux** (14 ERROR, 353 WARNING, 497 INFO), **15 erreurs de parsing**. Exit 1, pas un audit propre. `.semgrepignore` ne contient que des commentaires ; pas d’exclusion tests/source, pas de plafond implicite 1 Mo dans ce second scan. Limites de langage, règles non exécutées et parser restent explicites. Le premier scan, différent (844 signaux/17 erreurs), est conservé et ne doit pas servir de delta comparable sans tenir compte du périmètre. Quatre signaux GCM à garde de longueur déjà présente ont un triage borné dans `sast-triage.jsonl` ; les 860 autres restent en attente. `sast-findings.jsonl` contient chaque signal avec hash, règle, emplacement et statut de triage ; les extraits/valeurs interpolées sont omis pour éviter une fuite.

Gitleaks 8.24.3 : API de release accessible mais les **deux assets officiels** (archive/checksum) échouent après redirection `release-assets.githubusercontent.com`, erreur EOF, zéro octet. Aucune extraction/exécution sans checksum. Les query strings signées temporaires ont été expurgées des **nouvelles** preuves, originaux conservés dans un cache ignoré restreint et empreintes consignées (`evidence-redaction.json`). Aucune ancienne preuve du suivi n’a été réécrite.

API protections/CodeQL : **HTTP 403 Resource not accessible by integration**. Rulesets : réponse `[]`, qui ne démontre pas l’absence de protection classique. Accès minimal : lecture Administration/protections et lecture des alertes Code scanning, ou attestation administrateur expurgée ; pas de privilèges de déploiement ni de jeton dans le chat.

Politique CI : six prérequis, refus failure/cancelled/skipped, services isolés, keygen réel, artefact Windows et recette approuvée. Tests synthétiques des agrégats réussis, mais ce n’est pas une exécution distante ni une preuve de status checks obligatoires. La nouvelle autorisation de push permet une observation du run correspondant au commit publié ; il ne faut pas confondre un run antérieur, un run encore en cours ou l’upload SARIF avec une livraison validée. Aucun workflow de déploiement/release n’est déclenché manuellement par cet audit.

## G. Revue manuelle

Périmètre recalculé : **1 247 fichiers**, contre 1 243 auparavant. Revue source intégrale cumulative : **60** ; partielle : **12** ; encore en attente : **1 175**. Ces 60 lectures/analyse ne sont pas 60 certifications fonctionnelles. Les stades inventorié/lu/analysé/vérifié/fonctionnel/clôturé, plages réellement couvertes, hashes, catégories, constats et limites sont explicites dans `review-ledger.jsonl`. Les anciennes attestations ne sont réutilisées que si le hash correspond ; `package.json` courant a été relu intégralement après son changement.

Lot Electron déterministe poursuivi, suivi des déchiffreurs jusqu’aux formats, des sinks de crash/logs, de l’ordre backup→serveur et de l’ancrage d’horloge. **main.js reste partiel**, notamment les rôles/appelants IPC ; aucun résultat SAST/AST/inventaire ne le fait passer en revue complète. Le milieu du shim Redis n’est pas déclaré entièrement lu malgré les cinq tests réussis.

Exclusions documentaires exactes : inventaires automatiques et deux dossiers de preuves/générateurs de ce suivi ; dépendances installées, configuration privée et sorties générées ignorées par Git. Pas d’exemption implicite de source applicative. Prochain lot ordonné avec hashes dans `review-progress.json` ; revue et triage restent des travaux indépendants à poursuivre.

## H. Risques restants et intervention minimale

1. **Environnement natif** : runner Linux/Windows isolé avec chaîne officielle complète Electron/Prisma/Chromium/Gitleaks, TLS et checksums vérifiés. Refaire installation normale propre, deux générations Prisma, trois tests isolés puis suite globale.
2. **Services** : PostgreSQL jetable, rôle limité à ses bases de recette ; Redis de version cible CI ; aucune URL de production. Configurer via les mécanismes autorisés, pas publier de DSN dans les preuves.
3. **Autorité/recette** : ancre publique authentifiée, jetons synthétiques émis par le poste autorisé, compte/backend de staging attesté et approbation ; jamais récupérer la clé privée de production dans le chat.
4. **Décision métier/sécurité** : traiter 025 sans supprimer silencieusement le fonctionnement légitime d’une installation neuve hors ligne ou d’une restauration.
5. **Logiciel/revue** : triage des 864 signaux et 15 gaps parser, poursuite des 1 175 fichiers et des 12 partiels, politique IPC, flux tenant/transactions. Une erreur de scanner n’est pas automatiquement un défaut logiciel.
6. **Release** : build standard + budget actuel + dist/inspection + runtime Windows ; contrôles émetteur, SAST/Gitleaks et protections réellement attestés. Aucun de ces critères ne peut être coché avec la seule présence de YAML.

## I. Reproductibilité et publication

`commands.jsonl` conserve identifiant, argv exacts, cwd, heures UTC et Paris, versions/référence, environnement contrôlé, code, signal/timeout et chemin de log. `tool-versions.json`, provenance wheels/règles/Redis, `semgrep-exact-command.json`, les matrices et `EVIDENCE-SHA256.jsonl` complètent les preuves. Les chemins sandbox des outils isolés doivent être recréés sur un autre runner ; les inventaires seuls ne réinstallent pas les outils.

Exemples de commandes officielles : `npm run lint`, `npm run type-check`, `npm run test:config`, `npm run test:audit`, `npm run test:release-safety`, `npm run check:consistency`, `npm audit --json`, `npm ls --all`, `npm run audit:strict` ; suite finale `npm test -- --maxWorkers=2 --reporter=default --reporter=json --outputFile.json=<nouvelle-preuve.json>`. Ne jamais écraser un fichier de preuve. Les commandes normales `npm ci`, les deux `prisma generate`, `npm run build`, `npm run dist` et les E2E réels restent à valider dans l’environnement débloqué.

Ces deux documents datés utilisent le mode existant `doc-numbers: journal` : ils consignent des exécutions datées et ne remplacent pas la baseline canonique. Le premier contrôle documentaire a signalé cette classification manquante (exit 1) ; aucun contrôle ni critère de livraison n’a été désactivé.

Le contrôle whitespace sur l’index Git complet retourne **2** : lignes vides finales dans `docs/audit/evidence/npm-ls-all.txt` et `vendor/braces-bounded/lib/stringify.js`, préexistantes à cette reprise. Elles sont conservées pour ne pas réécrire une preuve ni les octets de provenance du fork ; ce résultat n’est pas présenté comme exit 0 et aucune règle Git n’est désactivée.

Le précontrôle de confidentialité avant push ne détecte que trois familles de motifs, sans valeur imprimée : **il ne remplace pas Gitleaks et ne certifie pas l’absence de secrets**. Les originaux locaux, modifications utilisateur et anciennes preuves sont préservés. Les rapports historiques ne sont pas modifiés pour faire disparaître les échecs.

**Condition de sortie : aucun critère obligatoire ouvert, toutes preuves applicables au code courant. Cette condition n’est pas satisfaite.**
