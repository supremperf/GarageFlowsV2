# GarageFlows Copilote — Phase 6 : fermeture des risques et validation préproduction

**15 octobre 2026 — Europe/Paris. PARTIELLEMENT VALIDÉ — NON PRÊT POUR LA PRODUCTION.**

Ce rapport décrit des corrections et des preuves bornées, pas une certification. Aucun appel payant, merge, déploiement, changement de droits MECHANIC, rotation de clé ou acceptation de risque n’a été effectué.

## 1. Révision, environnement et preuves

- Branche : `arena/c9eaae15-garageflowsv2` ; PR **9 toujours draft**.
- Dernière révision applicative examinée : `c1f6a5cc53a6ea4a7346f747567b8a585bc4a7de`. Les publications documentaires suivantes ne sont pas présentées comme de nouvelles exécutions applicatives.
- Local : `/home/user/GarageFlowsV2`, Node **22.22.3**, npm **10.9.8**, Next **15.5.27**, Prisma officiel **5.22.0**, Vitest **4.1.11**. CI : Ubuntu/GitHub, Node 22, npm épinglé **11.16.0**, génération des vrais clients Prisma ; PostgreSQL/Redis réels dans le job d’intégration.
- [proof-index.json](proof-index.json) donne chaque commande exacte, HEAD, horodatage, exit code et lien vers le reçu et le journal. Les reçus `Pxx.json` contiennent aussi l’inventaire SHA des sources et le SHA du journal. Cet inventaire n’est pas une preuve fonctionnelle.
- [source-review.json](source-review.json) couvre les fichiers modifiés, leur hash et leurs plages examinées ; les gros fichiers ne sont pas déclarés intégralement revus.
- Les preuves phase 4/5, les 959 triages, les 20 cas cryptographiques antérieurs, le corpus figé et ses classifications n’ont pas été réécrits. **P20** contrôle l’intégrité ; **P27** revalide les tests de politique sur l’arbre final ; **P28** vérifie 27 journaux antérieurs, 24 hashes de sources modifiées et les invariants de préservation (métadonnées seulement).

## 2. Résultats locaux — ne pas confondre avec une recette réelle

**P27 : exit 0**, sur `c1f6a5c` :

| Contrôle | Résultat et portée |
|---|---|
| 25 suites Vitest ciblées | **613/613**, zéro échec/skip : ensemble détaillé dans le journal |
| Copilote d’origine | **202/202** conservés, dont **40 contrats sémantiques** ; plus **5 nouveaux tests** de blocage payant, soit 207 |
| RBAC | **199/199**, aucune matrice de droits modifiée |
| Configuration | **78/78**, assertions d’origine conservées |
| Release safety | **58/58**, dont les nouvelles régressions du descripteur de clé publique |
| Sécurité de l’évaluateur, intake, transport d’inventaire et contextes | **31/31** tests Node PASS ; sous-tests dans P27 |
| Audit de l’outil d’audit | **9/9** |
| `npm ls --all` | exit 0 ; dépendances optionnelles d’autres plateformes affichées comme non installées, pas supprimées du lock |
| `npm run audit:strict` | **LOW=0 MODERATE=0 HIGH=0 CRITICAL=0 TOTAL=0** |

Les tests de modèle utilisent des transports explicitement simulés. La sonde de disponibilité utilise un probe simulé. Les tests Electron extraient et exécutent la vraie fonction source, avec FS réel lorsque précisé, mais **ne lancent pas Electron packagé**. Le test de redirection utilise **deux vrais serveurs HTTP locaux**, pas un fournisseur distant.

Exécutions négatives préservées : **P09 exit 1** (31 échecs du corpus figé), **P10 exit 1** (erreur de syntaxe d’un nouveau test, réparée puis P11 PASS), **P15 exit 1** (reproduction de fuite dans les logs avant correctif), **P25 exit 1** (reproduction de corruption dotenv Desktop avant correctif). Aucun de ces reçus n’a été remplacé par le résultat d’une relance.

## 3. CI officielle : preuves acquises et dernière révision

Les fichiers `ci-<sha>.json` séparent les révisions et gardent les check IDs, états et notices officielles. Un `head_sha` de check PR peut être celui du candidat tandis que la notice du scanner indique le **merge de test** effectivement scanné : ces deux SHA ne sont pas confondus.

Preuves complètes déjà acquises après les correctifs RBAC et de blocage payant :

- **Six suites natives, 54 exécutés / 54 PASS**, exit 0, zéro échec/skip, notamment sur `94ab650` et `382fb0b`. Clients Prisma réels, bases de test réelles ; sessions d’authentification du harness simulées. Ce n’est pas une connexion navigateur réelle avec une autorité réelle.
- `npx tsc --noEmit` et `npm run build` **standards** : jobs Native base PASS, sans déclarations de diagnostic ni drapeaux alternatifs.
- **3 612 476 octets JS / 3 625 984 maximum**, 237 fichiers, limite inchangée. Build réussi ne signifie ni démarrage ni readiness de production.
- Deux scans Gitleaks officiels complets : **0 finding**, notices paginées complètes, sorties scanner 0. La politique et les triages exacts restent actifs.
- Les jobs E2E publics/responsive ne valent pas recette authentifiée : leur configuration utilise `next dev` et peut ignorer les parcours nécessitant des fixtures absentes.

La dernière observation CI de `c1f6a5c` est [CI-c1f6a5c.md](CI-c1f6a5c.md) : build/budget, deux Gitleaks zéro et une notice native 54/54 déjà acquis ; les états de jobs encore en cours sont conservés tels quels. L’état de la publication documentaire est à lire dans la **mise à jour CI de la PR**, pas à déduire d’un ancien PASS. Aucune promotion de readiness ne dépend d’un job encore en cours, échoué ou skipped. Le gate de recette authentifiée et le gate global restent obligatoires.

## 4. Deux échecs Prisma : diagnostic, correction justifiée et relance

La reproduction reprend **le fichier exact du commit historique** `0d64899ed81ab32ab99fa32fbd6cde0c55d5ec63`, créé sous un nouveau nom exclusif en CI puis supprimé seulement s’il appartient au diagnostic. Le résultat attendu de ce **diagnostic négatif** est un enfant Vitest **exit 1**, statuts **failed, failed, passed, passed, passed**. Le succès du script de capture signifie « échec historique intégralement capturé », jamais « candidat 54/54 ».

Traces intégrales, stdout et stderr : `historical-native-b7e155e-check-116481296263.json`, puis captures des révisions suivantes. Deux erreurs :

1. `.toMatch() expects to receive a string, but got undefined`, assertion historique ligne 70 : le test cherchait un message métier absent d’une réponse de refus.
2. `undefined is not iterable (cannot read property Symbol(Symbol.iterator))`, ligne 79 : le test itérait `data`, également absent du refus.

**Cause : attentes de tests incompatibles avec le RBAC staff/job:manage existant, pas défaut du moteur Prisma.** Le MECHANIC n’a pas ce droit ; UNKNOWN non plus. Aucun droit n’a été ajouté.

Correction : MECHANIC et UNKNOWN doivent répondre **403 / Accès refusé**, sans données/message/produits/coûts ; espion `part.findMany` : **zéro lecture**. Cas positif : RECEPTIONIST déjà autorisé conserve les quantités, sans coût d’achat ; les cas OWNER et le contrat propre de stock-forecast sont conservés. Les cinq cas restent cinq ; les six suites complètes sont relancées par le gate natif obligatoire de 54 assertions.

L’ancienne première capture 8270 contenait un encodage d’ANSI transformé par GitHub : elle est marquée incomplète, pas utilisée comme preuve intégrale. Le transport corrigé compresse **après** construction du diagnostic complet ; les captures suivantes se décompressent sans perte et leur aller-retour ANSI/Unicode est testé.

## 5. CodeQL — les 17 cas initiaux, les sept high et les limites

**[codeql-alert-review.json](codeql-alert-review.json)** contient **17 lignes individuelles**, les emplacements initiaux, règle, fingerprint, tous les emplacements physiques des codeFlows/threadFlows/relatedLocations émis, contexte, exploitabilité, état, preuves et limites. Les identifiants `P6-CQ-*` sont des **IDs de revue locaux**, pas des numéros d’alertes GitHub inventés.

L’API officielle d’alertes répond encore **403** : numéros GitHub et inventaire officiel d’états non disponibles. Les règles/fingerprints/flows proviennent du SARIF émis normalement par CodeQL, projeté en lecture seule, sans messages/snippets ni modification des requêtes `security-extended`. Une absence de flow SARIF signifie « aucun flow émis », pas « aucune circulation de donnée possible ».

### Sept high d’origine : priorité examinée individuellement

- **Clé publique de build** : course check-then-read du fichier corrigée via **même fd** pour fstat et lecture ; création exclusive, ancrages et clé publique d’origine conservés. Régressions échange de pathname et dossier symlink. Résultat absent des SARIF suivants. Pas de garantie openat portable sur tous les ancêtres.
- **Config-core, ligne 97** : pas d’injection reproduite dans le vrai consommateur Next. La revue du **second consommateur actif Electron** a néanmoins trouvé un vrai défaut de fidélité : dollars échappés et backticks mal décodés. **P25 FAIL → P26 PASS** après correctif de ce consommateur, sans interpolation/eval, sans écraser l’environnement ou le fichier existant. Le signal CodeQL de l’encodeur reste visible ; ce résultat n’est pas un certificat d’encoding universel.
- **Closure/run-command, ligne 11** : le vrai appel historique possède `flag:'wx'`. Le test FS réel démontre EEXIST sur une symlink et conservation de la preuve cible : **faux positif contextualisé sur cette écriture exclusive**. Source historique conservée.
- **Quatre autres utilitaires historiques** : courses locales encore **OUVERTES, NON ACCEPTÉES** : resumption/run-command, investigation/run-command, publication-preflight et followup/build-review-ledger. Précondition examinée : modification concurrente du checkout/répertoire local ; aucune entrée HTTP ou élévation de privilège démontrée. Les preuves historiques ne sont pas réécrites pour faire disparaître les alertes. Ne pas réexécuter ces runners comme validateurs sécurisés sans successeur revu.

### Autres résultats

- Trois alertes middleware : diagnostics conservés comme **littéraux fixes**, sans chemin, cookie, nom/code/message d’erreur contrôlé. Tests des trois branches et des refus ; les trois résultats disparaissent du SARIF sans suppression de règle.
- Logs Electron : vraie fuite de signature URL/contrôles terminal reproduite **P15**, corrigée avant console et fichier ; **P16 PASS**. Le flux intentionnel HTTP→log reste détecté.
- Crash queue : vérification du **consentement courant** avant lecture/envoi ; révocation et livraison consentie/rétention en échec testées. Réassainissement d’une file altérée localement et chaîne réelle Electron→autorité non démontrés.
- Cloud sync : redirections désormais refusées ; un vrai HTTP 307 local ne reçoit plus le corps privé. Le transfert de photo/licence vers l’autorité configurée reste intentionnel ; l’autorité distante et tous les appelants ne sont pas validés ici.
- Upstash : lecture de session CLI puis authentification vers l’endpoint HTTPS fixe, autorisation de création gratuite explicite, `redirect:error`, timeout et plan free ; tests simulés, **aucune création fournisseur** réalisée.
- État licence : JSON au chemin fixe, signé HMAC, pas de chemin/code fourni par le réseau ; revue ciblée, limites UI/taille documentées.
- Photo-store : 20 tests FS MIME/traversée PASS ; pas de preuve d’absence de courses/symlinks sur les répertoires ni de validité des octets image sur simple MIME déclaré. **Risque résiduel non accepté**, authentification/tenants à compléter en recette.
- Formats : remplacement d’espace par lui-même dans un **littéral de fixture**, sans input de production ; non-vulnérabilité contextualisée, assertions conservées.

L’inventaire SARIF courant observé contient **14 résultats dont 7 avec security-severity ≥ 7** : 13 correspondent encore aux emplacements initiaux, plus un résultat sur les codes de secours. **Ce n’est pas un inventaire officiel de 14 alertes GitHub ni une déclaration de résolution des 17.** Le résultat supplémentaire `biased-cryptographic-random` est traité séparément : alphabet réel de **32 symboles uniques**, 256 divisible par 32, exactement huit préimages par symbole. Preuve finie et tests crypto/store existants ; pas de biais modulo sur cet alphabet, pas une garantie universelle de sécurité des codes à 40 bits.

**Aucun dismiss, suppression d’alerte, exclusion de fichier/requête ou risque accepté par l’agent.**

## 6. Coût monétaire : zéro dépense, pas plafond positif vérifié

Le blocage CLI de l’évaluateur ne protégeait pas à lui seul le provider applicatif. Le point commun `request()` refuse maintenant **avant tout transport** classify/plan/interpret, même avec opt-in, clé et modèle configurés. Aucun repli sur `globalThis.fetch`.

- La factory d’application n’injecte jamais de transport.
- Le transport explicitement simulé est refusé hors `NODE_ENV=test`.
- Le setter de provider de test est également interdit hors test ; une ancienne override n’est pas réutilisée par la factory de production.
- L’évaluateur live reste bloqué par `LIVE_COST_ENFORCEMENT_VERIFIED=false` avant réseau.

Preuves non facturantes P04/P18/P27 : trois chemins directs, 100 appels concurrents/nouvelles instances, retries, annulation, fallback local, configuration absente/invalide, injection explicite en production et override de test : **zéro fetch**. Tests protocole : timeouts, annulations, erreurs HTTP/transport, réponse malformée/trop grande et circuit séparés de la validation métier.

Le ledger estimatif réserve synchroniquement avant dispatch, arrondit par excès au micro-euro et refuse états absents/invalides/négatifs/NaN, plafond dépassé et exceptions de comptabilité. 50 réservations concurrentes : seules deux autorisées selon le fixture ; aucun recrédit pour une panne/timeout incertain.

**Limite essentielle : ce ledger n’est pas un plafond fournisseur vérifié**, ni un compteur partagé inter-hôtes, ni une preuve de prix/facture/FX. Aucun plafond monétaire positif n’est donc déclaré efficace. **Mode payant désactivé ; pas d’appel réel sans consentement explicite ET contrôle strict effectivement démontré.**

## 7. Sémantique : référentiel figé et deuxième corpus absent

- Corpus SHA256 `7b23aa75f2f08b6b23e9bf65a64d1051c95aef0bac33168257f562feb1227092`, données et critères inchangés.
- **17/48 PASS, 31/48 FAIL**, exécution P09 exit 1 ; 31 classifications originales conservées. Aucun patch lexical ciblé sur ces échecs.
- Taxonomie primaire antérieure : fallback local 20, entité 1, contrainte perdue 3, information manquante 1, intention 1, clarification 4, outil 1. Les catégories secondaires et les ambiguïtés restent dans le fichier historique.
- [semantic-results.json](semantic-results.json) rapporte aussi TP/FP/FN de **sélection d’outils**, regroupés par catégorie gold : lookup TP3/FP0/FN16 ; diagnose 0/0/2 ; clarify 0/4/0 ; compare 0/0/4 ; autres 0/0/0. Ces comptes descriptifs ne mesurent pas la compréhension d’intention, les paramètres temporels complets, les faits ou la réponse finale.
- Intention sémantique mesurée : **0/48** ; faits métier et synthèses finales : **non évalués** ; assertions de permissions du runner ≠ preuve de connexion et d’isolation réelle.

**Deuxième corpus indépendant : NON CONSTITUÉ, score et FP/FN non mesurés.** Aucune question/gold d’un auteur/relecteur indépendant n’a été fournie ; en fabriquer ici puis le déclarer indépendant serait trompeur. L’intake existant attend 32 cas, quatre par dimension, distincts des corpus précédents ; ses contrôles de chevauchement exact/normalisé ne remplacent pas une revue de provenance et d’indépendance sémantique. Aucun résultat universel d’intelligence n’est revendiqué.

## 8. Démarrage, auth, données et préproduction

| Scénario | Preuve acquise | Ce qui manque |
|---|---|---|
| Modèle désactivé / indisponible | Tests de fallback, état modèle honnête, gate de transport fermé | Campagne réelle autorisée et cap fournisseur |
| Timeout / cancel / erreurs provider / ambiguïtés | Contrats simulés, annulation des reads, refus de dispatch suivant, schémas stricts | Mesures service réel et réseau de recette |
| Environnement invalide | 34 tests env/contrat dont assertEnv fail-closed | Démarrage standard `npm run start` dans une vraie configuration de préproduction |
| Readiness Copilote | Probes simulés succès/erreur/timeout explicitement identifiés | Sonde réelle sur instance démarrée et dépendances opérationnelles |
| Auth sur lecture/tool-open/tenant | RBAC199, middleware47, suites natives54 et tests négatifs de coût/quantités | Recette navigateur authentifiée complète, deux garages sous autorité réelle |
| Logs/sources/réponses | Régressions ciblées de redaction/refus/non-lecture et tests anti-injection | Validation exhaustive sur instance réelle, pas une preuve absolue d’absence de fuite |

L’environnement de recette approuvé, ses identités/licences synthétiques et dépendances externes ne sont pas disponibles ici. Aucune donnée/clé réelle n’a été inventée pour simuler un démarrage sain. Le gate staging refuse les entrées manquantes et reste obligatoire. Build, tests mockés et E2E responsive ne le remplacent pas.

## 9. Dépendances : npm et GitHub restent distincts

**npm 0 toutes sévérités** est reproduit sur l’arbre final. Aucun changement de package/lock/override dans cette phase. Les dépendances optionnelles/transitives restent dans la politique.

**P22** : les deux commandes officielles d’inventaire Code Scanning / Dependabot répondent **HTTP 403**, child exit 1. L’exit 0 du collecteur signifie uniquement que ce refus a été capturé : inventaire **BLOCKED**, pas résolu. Le warning GitHub de push mentionne toujours **151 alertes de la branche par défaut** ; ni sa sévérité, ni sa correspondance au candidat, ni sa résolution ne sont déduites de npm 0. Package/version/exposition/correctif de ces alertes officiels restent à obtenir et classifier avec les autorisations adaptées.

## 10. Non effectué et critères de sortie

**Non effectué** : appels LLM/fournisseur payants, campagne modèle réelle, facture/plafond fournisseur positif, deuxième corpus indépendant, démarrage standard et health réels de préproduction, recette authentifiée complète sous autorité réelle, validation exhaustive des sources/logs, classification officielle des 151 Dependabot, acceptation/dismiss CodeQL, rotation/révocation de secrets, réécriture d’historique ou preuves, merge, publication applicative ou déploiement. Des jobs CI de packaging candidat peuvent se lancer automatiquement ; ils ne sont pas une publication ni une preuve de recette signée.

Restent bloquants : risques historiques et photo-store non acceptés/clos, numéros/états officiels d’alertes et inventaire Dependabot non accessibles, plafond fournisseur positif non démontré, corpus réellement indépendant et préproduction opérationnelle/authentifiée non validés. Les correctifs généraux et tests ne justifient donc **aucun passage à « prêt pour production »**.
