# GARAGEFLOWS — PHASE 5

**PARTIELLEMENT VALIDÉ — NON PRÊT POUR LA PRODUCTION**
15 octobre 2026 — Europe/Paris. PR [9](https://github.com/supremperf/GarageFlowsV2/pull/9) **ouverte, draft** ; branche `arena/c9eaae15-garageflowsv2`. Aucun merge, déploiement, appel modèle payant ou rotation de secret autorisé/effectué.

Ce rapport ajoute les preuves de phase 5 sans réécrire les preuves historiques. Les reçus `Vxx` ci-dessous sont dans **`docs/audit/copilot-phase5/`**, pas les identifiants Vxx des questions du benchmark.

## 1. Résultats, sans transformer les limites en PASS

| Contrôle | Résultat établi | Périmètre / preuve |
|---|---|---|
| Gitleaks officiel | **VALIDÉ** : scan configuré à zéro | Deux scans complets sur `5c1d082`, puis sur `70450d3`/`4a335c1` ; pas un scan de tout l’historique |
| Triage des détections | **VALIDÉ sur l’inventaire décrit** | 669 détections + 290 anciennes localisations exemptées, 959 examinées individuellement |
| Génération native Prisma | **VALIDÉ en CI ; BLOQUÉ localement** | Deux clients officiels 5.22.0 générés en CI ; sandbox : reset avant TLS |
| Six suites natives | **ÉCHOUÉ : 52/54, 54 exécutés** | Deux cas MECHANIC/stock échouent ; pas de skip en CI ; conflit RBAC/contrat historique |
| TypeScript standard | **VALIDÉ en CI** | Job `base-verification` sur `70450d3`, sans faux types/flags alternatifs ; 225 diagnostics locaux sans clients ne sont pas des erreurs natives confirmées |
| Build standard | **VALIDÉ en CI** | `npm run build`, `70450d3`, pas une compilation diagnostic |
| Budget JS immuable | **VALIDÉ en CI** | **3 612 476 / 3 625 984 octets**, 237 fichiers ; seuil non modifié |
| Tests Copilot | **VALIDÉ localement : 202/202** | V06 puis V25, neuf fichiers ; dont 40 contrats sémantiques |
| Config | **VALIDÉ sur tests : 78/78** | V19 ; aucune licence/clé de production inventée |
| Matrice RBAC | **VALIDÉ sur tests : 199/199** | V21 ; production `authz.ts` et catalogue inchangés |
| Politique dépendances | **VALIDÉ candidat npm : zéro** | V12, V20 (9 tests), V27 ; gate CI après correction du test de graphe |
| Release-safety | **VALIDÉ localement : 56/56** | V29 ; V28 échoué conservé, ancienne attente à six jobs étendue à sept sans retirer de garde |
| Contrôles phase 5 | **VALIDÉ localement : 39/39** | V30 + ESLint des scripts/tests modifiés ; pas une preuve native/modèle |
| Benchmark figé 48 | **ÉCHOUÉ : 17/48 local** | V07/V16, mêmes 31 échecs ; ni corpus ni runtime retouché pour ces cas |
| Intelligence modèle réelle | **EN ATTENTE** | Zéro appel ; aucune mesure de compréhension, fait ou réponse finale modèle |
| Second ensemble externe | **EN ATTENTE DE REVUE/AUTEUR** | Intake et gel 32 cas préparés ; aucun corpus indépendant reçu |
| CodeQL | **ÉCHOUÉ / EN ATTENTE DE REVUE** | 17 nouvelles alertes dont 7 hautes dans le check, non assimilées à 17 exploits confirmés |
| Dependabot branche par défaut | **BLOQUÉ : API 403** | Avertissement GitHub 151 distinct ; inventaire détaillé inconnu |
| E2E publics | **VALIDÉ sur `70450d3`** | Responsive en mode dev uniquement ; pas authentification/licence/production |
| Démarrage production / E2E licenciés | **NON VALIDÉ** | Pas de cible staging/DSN/licence/issuer réels approuvés ; gates aval ne sont pas des PASS |
| Gate globale de release | **ÉCHOUÉ / étapes aval skipped** | L’échec natif reste obligatoire ; aucune publication |

Les snapshots CI portent leur SHA, IDs, horodatages, URL, étapes et commandes API reproductibles. `ci-70450d3.json` contient une observation avec certaines étapes encore en cours ; ne pas extrapoler les résultats des autres jobs. `ci-4a335c1.json` confirme le retour de la gate dépendances au succès et les deux mêmes échecs natifs. Les preuves futures sur des commits documentaires doivent être distinguées des mesures applicatives sur ces SHA.

## 2. Gitleaks : examen complet, remédiation précise et preuve officielle

L’extraction initiale de dix annotations n’était pas complète. Deux scans officiels sur `43d56c1` ont chacun fourni **669 localisations**, reconstruites depuis trois pages de métadonnées identiques. Un premier format de pages trop grand a été tronqué par l’API à environ 4 KiB : cet essai échoué n’est pas présenté comme preuve complète. Le format corrigé groupe fichier/règle/lignes, garde toutes les occurrences, borne les pages et signale explicitement l’incomplétude. La version, les arguments, la portée et le code de sortie du scanner restent inchangés.

L’exception provisoire phase 4 masquait exactement **290 localisations supplémentaires**, énumérées, pas présumées bénignes. Parmi les **959 emplacements** :

- **957 SHA-256 de fichiers publics** : pour chaque ligne, vérification du JSON/`sourceHashes`, du SHA du reçu entier, recalcul SHA-256 des octets du fichier source Git au commit enregistré, présence historique et identité du blob de reçu public ; **33 couples source/digest distincts** ;
- **2 littéraux d’assertion documentaire** : ligne du test de politique et copie dans un ancien patch ; même préfixe que le titre public de revue gelé, fichiers/lignes/prose verrouillés par hash ;
- **20 couples antérieurs vérifiés individuellement**, et vérifiés à nouveau par les tests, sans les traiter comme preuve des 939 autres.

Les reçus sont présents byte-identiques au commit historique `c8441a1` ; les commits de source précis sont enregistrés par ligne. C’est une preuve d’exposition historique **de ces contenus publics**, pas une exploration exhaustive de tous les secrets de l’histoire Git.

L’extension regex phase 4 a été retirée de `.gitleaks.toml` (restauration de la politique antérieure). `.gitleaksignore` ajoute seulement les **959 fingerprints de localisation**, avec tests obligatoires du fichier entier, ligne et source. Les quatre empreintes historiques déjà vérifiées (trois identifiants OAuth publics et une prose) restent séparément hash-lockées. Aucun dossier, fichier entier, classe générale de SHA ou contrôle n’a été nouvellement exempté. Altérer une ligne exemptée, son reçu/source ou la prose invalide les tests ; les valeurs ailleurs restent scannées.

**Aucun secret réel identifié dans ces 959 cas vérifiés** : pas de rotation justifiée pour des hashes publics. Cette conclusion ne couvre pas arbitrairement l’historique ou les autres exemptions historiques. Si une nouvelle détection est un secret, la traiter compromis : isoler la preuve sans valeur, demander autorisation de révocation/rotation/nettoyage appropriés, ne pas réécrire l’histoire ou révoquer un tiers spontanément.

Preuves : `gitleaks-full-inventory.json`, `gitleaks-triage.json` (une décision par emplacement), `gitleaks-triage-summary.json`, `gitleaks-remediation-proof.json`, snapshots CI. Les rapports bruts, `Secret`, `Match`, extraits sensibles et sorties enfant ne sont pas publiés. Le scanner conserve sa sortie non nulle lorsqu’il détecte/échoue.

## 3. Prisma et deux échecs natifs : causes distinctes

Voir [diagnostic réseau et validation native](COPILOT_PHASE5_NETWORK_AND_NATIVE.md) pour domaines, versions, URL de téléchargement officielle, erreur avant certificat et procédure reproductible. Aucun moteur non officiel, checksum/TLS ignoré, faux client ou déclaration diagnostic n’a été introduit dans le projet.

La CI permet désormais la mesure qui était bloquée localement : SQLite réel, fixtures de test, deux clients générés officiels. Sur `70450d3`, les deux index initiaux de `copilot-cout-achat` échouent ; les trois suivants et tous les autres cas passent. Le problème n’est plus le réseau pour ces jobs.

Les deux tests demandent du stock opérationnel pour MECHANIC ; le catalogue impose les rôles staff et `job:manage`, absent des 11 permissions mécanicien. **Ne pas ouvrir les permissions ni changer le gold historique pour gagner deux PASS.** Arbitrage produit/sécurité requis : préserver ce refus, ou concevoir explicitement une nouvelle capacité stock opérationnel expurgée, limitée au garage de session, avec revue de menace et tests négatifs. Rien de cela n’a été accordé implicitement ici.

## 4. Les 31 échecs : taxonomie stable, pas de patch lexical

Détail individuel dans `frozen48-failure-taxonomy.json` : attendu inchangé, résultat observé, catégorie primaire/secondaire, classe de cause, doutes du benchmark et limites causales. Totaux primaires :

| Catégorie | Cas |
|---|---:|
| Limite du fallback local | 20 |
| Entité/référence non résolue | 1 |
| Contrainte perdue | 3 |
| Information manquante non détectée | 1 |
| Intention incorrecte | 1 |
| Clarification nécessaire | 4 |
| Mauvais outil | 1 |

Les catégories paramètre invalide et attendu insuffisamment spécifié sont conservées dans la taxonomie ; aucune preuve n’autorise à prétendre qu’un paramètre erroné a réellement été envoyé au backend dans ce runner de sélection. Certains défauts d’attendu sont des **doutes annotés**, pas des tests corrigés ou retirés (encaissements/date de règlement vs facture payée, ellipses, demande de possibilité vs action).

Points de conception : V16 héritage d’aide périmé ; V31 perte de deux des quatre opérations et réponse partielle au lieu de clarification ; V33 outil de retards choisi pour une demande causale certaine ; V36 projection du mois suivant choisie pour deux mois. Les abstentions unknown ne sont pas des lectures dangereuses, mais ne satisfont pas toujours le contrat de clarification.

**Mesures exactes** : 17/48 contrats de sélection, choix outils 27/48 ; paramètres 43/48 dont **42 cas vacuement vrais et seulement 1/6 cas non vides réussi** ; intention sémantique 0 cas mesurés. Faits et réponse finale natifs/humains de ce benchmark : non évalués, pas taux nul d’erreur. Aucun modèle, SQL ou écriture dans ces deux évaluations. L’analyse statique propose une cause ; ce n’est pas une trace instrumentée de chaque branche.

Le corpus reste une **régression**, SHA-256 `7b23aa75f2f08b6b23e9bf65a64d1051c95aef0bac33168257f562feb1227092`. Aucun changement sous `src/` en phase 5. Le travail transversal à considérer est la représentation intention/entités/contraintes/informations manquantes/opérations candidates et la couverture de demande, pas 31 ajouts lexicaux. La mesure nouvelle devra venir d’un auteur/relecteur externe aveugle.

## 5. Modèle réel, coûts et indépendance

[Protocole opérateur/intake aveugle](COPILOT_PHASE5_BLIND_EVALUATION_PROTOCOL.md). Le runner distingue désormais local seul, garde sans appel, interprétation modèle acceptée et fallback après tentative ; aucun succès de fallback n’est vendu comme intelligence modèle. JSON valide n’équivaut pas à sélection/faits corrects.

L’ancien claim `.consumed` dépendait du chemin du manifeste, donc copier le fichier pouvait contourner l’unicité. Le mécanisme préparé lie un grant Ed25519 version 2 au modèle/corpus/runner/portée/expiration et utilise un claim exclusif par ID signé dans un état privé fixe. Les tests anti-rejeu/signature/horloge/permissions sont synthétiques, pas une autorisation de cette conversation ou une preuve de facturation.

**Blocage explicite de `--live`** : le plafond EUR effectivement appliqué hors du processus candidat n’a pas été vérifié. Les réservations et tarifs approuvés ne sont qu’une estimation ; ni code modifiable par l’administrateur ni CLI `--approve-paid` ne prouvent un consentement humain ou un plafond fournisseur non contournable. Il faudra un enforcement externe revu, un hôte opérateur de confiance, signature, consentement et rapprochement facture avant toute affirmation de sécurité budgétaire. **0 appel, 0 dépense modèle dans cette phase.**

## 6. Dépendances et alertes GitHub : trois univers séparés

1. **Candidat** : V12 audit npm complet à zéro, V27 `npm ls --all` + gate stricte à zéro ; V20 neuf tests de politique/compatibilité, dont 4 653 sorties différentielles braces et Sharp natif. Aucune dépendance/override/lock modifié en phase 5.
2. **`main` vérifié à `e3ac5f5a55284906531dcc5d4a620cb0ff072313`** : copie isolée exacte du lock, audit registry lock-only V11 : **50 groupes de paquets** (2 critiques, 34 hauts, 13 modérés, 1 bas), dont 12 directs. Matrice complète par paquet/nœud/scope versionné, recommandations et **163 advisory publics** (versions corrigées récupérées) dans `dependency-default-candidate-matrix.json`.
3. **Avertissement Dependabot par défaut** : **151** (2 critiques/63 hauts/71 modérés/15 bas) au push ; endpoint détaillé **403**, inventaire inconnu (`dependabot-current.json`). Ni tableau vide ni audit npm zéro ne signifient zéro alerte GitHub ; on ne soustrait pas des unités incomparables.

Exemples étayés : `next` main 14.2.35 → candidat 15.5.27 ; deux advisories critiques indiquent un correctif dans la branche 15.5 dès 15.5.24 (alternative 16.3.3). `tar` main 6.2.1 → candidat 7.5.22 ; advisory critique corrigé dès 7.5.19. Ne pas accepter aveuglément la recommandation de saut Next 16 / electron-builder 26 de l’audit main : versions exactes, compatibilité et correctifs de la branche retenue comptent. Ces remédiations sont déjà dans le candidat des phases précédentes, pas fusionnées sur main.

La présence prod/dev/optional n’est **pas** une preuve de reachability/exploitabilité. Les 50 lignes le signalent. Le vendor local braces sort de la couverture automatique des advisories upstream : audit zéro ne remplace pas sa revue source et ses tests bornés/différentiels. Les 151 alertes GitHub devront être exportées ou rendues accessibles en lecture par le propriétaire sécurité autorisé, sans partager un token en chat ni modifier arbitrairement des scopes.

## 7. Sécurité globale et CI restant rouges

`codeql-locations.json` conserve les 17 titres/localisations sans source sensible. Sept annotations hautes : six races filesystem potentielles et une alerte d’échappement incomplet. Cinq des scripts concernés sont des preuves historiques gelées ; ne pas les modifier/supprimer silencieusement. Leurs usages/menaces et le traitement autorisé restent à arbitrer ; ne pas les relancer pour écraser une preuve. Les dix autres annotations couvrent téléchargements/écritures et transferts fonctionnels, un no-op de test et trois logs middleware. L’existence d’une fonction de nettoyage CR/LF n’est pas une preuve automatique que chaque alerte est fausse ; revue des flux requise.

Aucune règle CodeQL retirée, alerte dismissée ni contrôle désactivé pour obtenir du vert. Les alertes ne sont pas des exploits confirmés, mais le check rouge reste rouge. Les E2E authentifiés/staging, packaging Windows, gate globale et démarrage production ne sont pas validés par des E2E publics ou un build.

Régression introduite pendant cette phase : l’ajout du septième job obligatoire a d’abord fait échouer le test de graphe qui attendait les six anciens (V28 : 55/56). Correction : **ajout du septième** dans l’attendu et dans le shell agrégateur, conservation des six anciens et tests échec/annulation/skip sur chacun. V29 56/56 ; gate dépendances CI réussie sur `4a335c1`. Ce n’était pas une nouvelle vulnérabilité npm, et l’échec initial reste dans les preuves.

## 8. Commandes, provenance et limites d’exécution

Chaque `Vxx.json` contient ID, dates Europe/Paris, cwd, commande exacte, versions Node/npm, HEAD, hashes de sources, exit, durée, chemin et SHA du log normalisé, SHA du log original privé et limites. Les originaux privés ne sont pas des livrables ni des logs scanner récupérés. Les hashes/inventaires ne valent pas revue fonctionnelle. `source-review.json` décrit la portée/ranges/hash/risque/tests de chaque source modifiée ; les reçus historiques ne sont pas réévalués implicitement.

| Reçus | Commande / résultat synthétique |
|---|---|
| V01 | Installation verrouillée sans scripts, 0 ; pas une génération native |
| V02–V04 | Diagnostic et deux générations Prisma officiels, 1 chacun |
| V05 / V09 / V10 | Reporting/politique Gitleaks : 19 puis 19 puis 20 tests, lint/diff ; 0 |
| V06 / V25 | Neuf fichiers Copilot exacts : 202/202 à chaque exécution, 0 |
| V07 / V16 | Corpus figé : 17/48 identique, 1 ; V16 ajoute strates sans changer le runtime |
| V08 / V23 | Marque échouée puis 0 ; V23 inclut lint global source, 0 |
| V11 / V12 | Audit isolé main : 1/50 groupes ; candidat : 0/zéro |
| V13 | Six suites locales : setup échoué, 54 non exécutés, 1 ; distinct de CI 52/54 |
| V14 / V15 / V17 | Wrapper natif (3), contrôle budget/grant (9), combinaison préflight (12), 0 |
| V18 / V26 | Intake (4), intake+wrapper (7), 0 ; fixtures, pas un nouveau benchmark |
| V19 / V20 / V21 | Config 78, dépendances 9, RBAC 199 ; chacun 0 |
| V22 | Sous-ensemble effectivement sélectionné : **174/174, sept fichiers**, 0 ; deux chemins inexistants ignorés par Vitest ; ne pas compter 202 ici ; V25 reprend les neuf chemins réels |
| V24 | Diagnostic local types sans génération : 225, exit 2 ; pas un build ni test natif |
| V27 | Graphe npm + audit strict, 0 |
| V28 / V29 | Release-safety avant/après septième gate : 55/56 exit 1 puis 56/56 exit 0 |
| V30 | Sept fichiers de contrôles phase 5 : 39/39 + ESLint scripts/tests + diff, 0 |

Pas d’addition de passages issus de runs répétés, pas de skip transformé en pass, pas d’intelligence modèle extrapolée. Les commandes exactes sont celles des reçus, les requêtes GitHub exactes celles des snapshots CI. Les scripts/tests de fixture ne sont pas une preuve d’issuer réel ou de permissions HTTP de production.

Publication : le contrôle `git diff --cached --check` a signalé des espaces de fin de ligne dans la sortie normalisée **V28.txt** (diff généré par Node lors du test échoué). Ces octets de preuve restent inchangés ; le contrôle n’est pas présenté comme réussi, aucune exclusion Git/scanner n’a été ajoutée. Le reçu V31 et `publication-integrity.json` consignent cette limite de format, distincte des tests source.

## 9. Conditions de suite

1. Arbitrer explicitement le contrat stock MECHANIC avant tout changement de RBAC/attendu ; conserver entre-temps les deux échecs visibles.
2. Examiner les 17 flux CodeQL, dont traitement des scripts historiques sans altérer les preuves ; pas de suppression générale.
3. Obtenir en lecture l’inventaire réel des alertes default branch et évaluer leur exploitabilité/version corrigée ; pas de merge automatique du candidat.
4. Réseau local Prisma à ouvrir par son propriétaire si reproduction locale requise ; la preuve CI native est déjà distinctement disponible.
5. Auteur/revue externes pour le second ensemble, oracles métier et réponse finale ; enforcement de coût revu et accord explicite avant tout appel.
6. Configuration/DSN/licence/staging non-production autorisés et gates globales complètes avant readiness/production. Ne pas simuler, déployer ou fusionner pendant ces blocages.
