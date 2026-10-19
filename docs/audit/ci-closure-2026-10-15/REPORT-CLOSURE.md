# GarageFlows Copilote — clôture CI et validation préproduction

**PARTIELLEMENT VALIDÉ — NON PRÊT POUR LA PRODUCTION**

Date : 15 octobre 2026, Europe/Paris. Aucun merge, déploiement, appel facturable ou changement de droits pour obtenir du vert.

## 1. Candidat exact et portée de cette version

- Début de phase : **`fccac810be4ce6589831dfc2dadb9bd3f0f51128`**.
- Correction DNS + première instrumentation Windows : **`befc31e5551b6e0e61b8d1acb383e01e5a9fb39b`**.
- **Candidat source observé jusqu’au bout en CI : `df66ebb2a92263091a60206725f1fed8c9e3b87c`**. Il corrige l’intégration du shell de diagnostic en conservant la commande littérale et les assertions existantes.
- Branche unique : `arena/c9eaae15-garageflowsv2`, PR **9 ouverte et draft**. Cette version documentaire est préparée sur df66 ; sa publication produit un nouveau SHA et peut relancer une CI distincte. **Les PASS ci-dessous appartiennent à df66, jamais implicitement au futur HEAD documentaire.** Le SHA de publication et son état CI sont consignés dans la mise à jour GitHub de la PR.

Ce document et [CI-CLOSURE.md](CI-CLOSURE.md) sont les nouvelles versions de lecture. Les rapports, journaux, 31 classifications et manifests précédents ne sont pas réécrits : C17 vérifie **100 références de fichiers** des trois manifests historiques, toutes identiques. Leurs dates/SHA/limites restent applicables à leurs seules exécutions.

## 2. Résultat officiel sur df66 — terminé, mais globalement rouge

Détails exhaustifs, liens de jobs, SHA propres à chaque check/exécution et statuts historiques : [addendum CI](CI-CLOSURE.md), [snapshot officiel](df66-completed-push-observation-ci.json).

| Contrôle | Push | PR | Conclusion limitée |
|---|---|---|---|
| Suite complète unitaires + intégration | **116505383050 PASS** | **116505421830 PASS** | Les deux jobs complets réussissent sur ce candidat ; pas un passage d’un ancien SHA |
| Six suites Copilote natives / Prisma réel | 54/54, 0 skip, notice du job ci-dessus | 54/54, 0 skip, notice du job ci-dessus | Fixtures natives, sessions du harness simulées ; pas une connexion réelle |
| TypeScript + build standard + budget fixe | **116505383497 PASS** | **116505421878 PASS** | 3 612 476 octets / plafond inchangé 3 625 984 ; 237 fichiers JS client |
| Dépendances / audit complet | **116505382701 PASS** | **116505422238 PASS** | Ne ferme aucune alerte Dependabot par déduction |
| Gitleaks officiel complet | **116505383362 PASS, 0** | **116505421487 PASS, 0** | Aucun contrôle retiré, 959 triages individuels et 20 paires conservés |
| E2E public/responsive | **116505383085 PASS** | **116505422142 PASS** | Pas une recette authentifiée de tous les rôles/tenants |
| Packaging Windows réel | **116507743106 FAIL** | **116507945231 FAIL** | Commande officielle exécutée, compilation Next échouée avant paquet |
| Recette staging authentifiée | **116507743486 FAIL** | **116507944698 FAIL** | Préflight échoué ; navigateur et scénarios non exécutés |
| Gate obligatoire | **116508789948 FAIL** | **116508982443 FAIL** | Refus correct d’un candidat partiel |
| Final release gate | skipped | skipped | Condition workflow_dispatch ; pas un succès |

CodeQL : run **38759135102**, Analyze **116505421070 SUCCESS**, contrôle des résultats **116506483787 FAILURE**. L’analyse qui s’exécute correctement ne signifie pas absence d’alertes.

Runs CI df66 : push **38759124969**, PR **38759135140**. Le checkout PR observé par Gitleaks est **`e1ce72a94845d1f60eba101b44aac2d39064903e`**, différent de la tête df66, avec **arbre complet identique** selon les objets GitHub officiels. [Provenance](checkout-tree-provenance.json) distingue SHA de run/check/job, checkout observé et déduction de contexte ; pas d’attestation `git rev-parse` inventée pour chaque autre job.

## 3. Timeout e-invoicing : défaut démontré, causalité historique limitée

### Échec historique conservé

Sur **`c1f6a5cc53a6ea4a7346f747567b8a585bc4a7de`**, check PR **116488851902**, étape `Tests (unit + integration)` :

```text
src/lib/einvoicing/__tests__/submit-chain.test.ts
> refus et pannes — distingués
> un rejet plateforme (422) est un REJET, pas une panne
Error: Test timed out in 5000ms.
❯ src/lib/einvoicing/__tests__/submit-chain.test.ts:321:3
```

La trace officielle complète disponible et son SHA sont conservés dans `../copilot-phase6/ci-post-publication-observation.json` (`additionalDiagnosis`). Les **5000 ms sont l’échéance rapportée du test**, pas une mesure de durée DNS. La trace ne montre pas la dernière opération réseau ni une pile du résolveur. P30 isolé 17/17 n’efface pas cet échec. Les deux suites complètes fcc sont déjà vertes **avant** le correctif présent : on ne peut donc pas attribuer avec certitude le timeout ancien au DNS, ni à une lenteur CPU/chiffrement sans preuve.

### Constat reproductible et correction générale

Les suites simulaient `fetch`, mais la vraie garde SSRF appelait encore `node:dns/promises.lookup` pour les noms de fixture. Dans l’adaptateur, l’attente DNS précédait le démarrage du timer 20 secondes : un DNS suspendu pouvait laisser l’appel sans échéance applicative et retarder un test ayant un plafond de 5 secondes.

- **C01, avant correctif produit : 3 FAIL / 1 PASS**, quatre nouveaux cas à horloge/DNS/fetch simulés, vraie garde et vrai adaptateur. Attente DNS sans fin ; budget réinitialisé après DNS ; envoi tardif ; refus DNS privé toujours actif.
- Correction dans `fetchAvecDelai` : **mêmes 20 secondes**, partagées entre DNS et fetch/jusqu’aux en-têtes, race d’expiration, abort et refus de dispatch après réponse DNS tardive ; nettoyage du timer. La garde SSRF et `redirect: 'error'` restent exécutés.
- Les trois suites à transport simulé (`submit-chain`, `submit-replay`, `generic-pa-adapter`) simulent désormais aussi DNS pour leurs seuls hôtes de fixture. Un hôte inattendu reçoit une réponse loopback, donc un refus par la vraie garde ; aucune garde globale mockée.
- **C02/C05 : chaîne isolée 17/17 + régression DNS 4/4 PASS**. C14 reprend ces tests, rejeu/concurrence 12/12 et adaptateur 36/36. Les deux suites CI complètes df66 passent ensuite réellement.
- Aucun `testTimeout` augmenté, test retiré, assertion relâchée, conditional skip ou timeout forcé à réussir. Premier cas renforcé par une assertion « encore en attente avant l’échéance » après le premier run rouge.

**Qualification** : dépendance externe involontaire des tests démontrée ; attente produit non bornée avant DNS démontrée et corrigée. **Cause exacte de l’unique timeout historique : non établie**, non reproduite avec les traces historiques. L’OS peut terminer une résolution en arrière-plan : ce n’est pas une annulation de `dns.lookup`. La lecture du corps JSON, après réception des en-têtes, reste hors de cette échéance ; aucune certification de timeout bout en bout n’est revendiquée.

## 4. Windows : exécuté sur Windows, échec de build avant packaging

Les deux runners Windows réels df66 utilisent Node **22.23.3**, génèrent les deux clients Prisma **5.22.0**, puis la commande officielle `npm run dist` rend **1** :

- push : `EPERM: operation not permitted, scandir 'C:\Users\runneradmin\Application Data'` ;
- PR : même opération sur `C:\Users\runneradmin\Cookies`.

Les diagnostics expurgés et leur provenance sont dans [CI-CLOSURE.md](CI-CLOSURE.md). Les premiers téléchargements de logs fcc ont échoué sur une redirection de blob inaccessible ; aucune URL signée n’est divulguée. Le nouveau shell n’accepte que le script exact `npm run dist`, conserve son exit et échoue si une commande supplémentaire lui est transmise. Les assertions de graphe initiales restent intactes.

**Établi** : un glob de compilation Next parcourt le profil Windows hors dépôt et est refusé. **Non établi** : le point précis qui produit ce parcours, la racine effective de traçage sur le runner et le correctif de build approprié. La configuration Next et son mécanisme de racine/traçage ont été examinés, mais aucune modification spéculative d’exclusion, de permissions, de dépendance ou d’environnement utilisateur n’a été faite pour cacher l’échec.

> **Suite (2026-10-19) — point établi.** Origine du parcours : `dotenv` embarqué par le runtime Prisma (`readFileSync(path.join(os.homedir(), …))`), que nft transforme en glob `<profil>/**` ; racine de traçage effective : la racine du projet (`outputFileTracingRoot`) ; le glob n’est écarté que si le profil est sur le même lecteur que le projet, ce qui n’est pas le cas sur le runner (`D:` / `C:`). Correctif dans le dépôt, éprouvé sur Windows sans substitution d’environnement : [../windows-dist-2026-10-19/RAPPORT.md](../windows-dist-2026-10-19/RAPPORT.md).

| Vérification réelle Windows | État |
|---|---|
| npm ci, ancre publique existante, cohérence clés, quatre tests de ressources/compatibilité préalables | étapes CI réussies, **pas** vérification de contenu d’un paquet |
| Six tests du diagnostic de commande/exit/expurgation | réussis sur Windows |
| Commande officielle dist / compilation Next | **FAIL**, deux jobs |
| Post-build / copie standalone / Electron Builder / création installateur | non atteints |
| Dépendances et ressources effectivement embarquées | non vérifiées sur un artefact produit |
| Scan secrets, fuses, budget Windows, intégrité et release:verify-artifact | non atteints |
| Installation/démarrage/erreurs de lancement/configuration réelle du binaire | **NON EXÉCUTÉS** |

Prochaine preuve : diagnostic ciblé de la racine/glob sur un runner Windows, correction fondée sur cette observation, puis **même commande officielle** et tous ses contrôles, inspection du paquet et lancement contrôlé. Le build Linux vert ne remplace aucune de ces étapes.

## 5. Recette authentifiée : blocage explicite et couverture à compléter

[AUTHENTICATED-ACCEPTANCE.md](AUTHENTICATED-ACCEPTANCE.md) énumère **A01–A17, tous NON EXÉCUTÉS** : connexion/session, rôles/refus, deux garages, parcours métier, confirmation/écriture, erreurs, confidentialité et déconnexion.

Les deux jobs échouent à la validation des entrées staging avant navigateur. Aucun compte, licence, DSN ou état de santé n’a été inventé. Il faut une cible non-production autorisée et des comptes/fixtures configurés dans l’environnement GitHub `e2e-staging`, sans secret dans le chat. Même configurée, la suite actuelle responsive/planning ne couvre pas à elle seule toute la matrice ; des résultats par scénario et oracles restent nécessaires.

## 6. Contrôles de sécurité et de coût conservés

C14, sur HEAD df66 : **682/682 tests Vitest, 29 fichiers**, puis **37/37 tests Node ciblés**, **config 78/78**, **release-safety 58/58**, **audit 9/9**, `npm ls --all` et audit registry strict **LOW=0 MODERATE=0 HIGH=0 CRITICAL=0 TOTAL=0**, exit 0. Ne pas additionner des répétitions comme de nouveaux cas.

Les 682 incluent les **613** de la phase précédente (207 Copilote/provider, dont les 202 contrats initiaux et 40 sémantiques ; RBAC 199 ; middleware 47 ; env 34 ; photo/portail/formats 75 ; Electron 51) et **69** assertions de chaîne/adaptateur/rejeu/DNS. Les contrôles de droits MECHANIC/UNKNOWN, consentement, redirections, dotenv Next/Electron et concurrence fichiers restent présents. C17 confirme l’absence de modification depuis c1 des sources Copilote/provider, authz, budget, Gitleaks, dépendances/lock et configuration Vitest.

Inspection du point commun `AnthropicClassifier.request` : aucun transport de production ; `classify`, `plan`, `interpret` retournent `budget_blocked`, y compris appel direct/opt-in/clé. Injection du transport et de la factory interdite hors runtime de test. C14 réexécute les refus, appels concurrents/retries, timeout/abort/fallback et les tests d’estimation/ledger absent, invalide, dépassé ou comptabilité en erreur. Ce sont **des simulations gratuites et une fermeture à zéro dépense**, pas une intégration facturée.

**Plafond fournisseur monétaire positif réellement imposé : NON DÉMONTRÉ.** Le flag CLI, un document d’accord, un nombre de tokens, le ledger local et des tarifs estimés ne suffisent pas. Aucun appel payant ne doit être autorisé avant preuve d’enforcement effectif et consentement explicite ; aucun n’a été effectué ici.

## 7. CodeQL et Dependabot — aucun effacement pour obtenir du vert

[codeql-closure-review.json](codeql-closure-review.json) reprend **individuellement les 17 revues locales**, leurs risques/justifications, hashes et correspondances de flux courants. Les **7 emplacements initialement hauts** sont priorisés ; les sources correspondantes sont identiques à celles de la revue c1. Ce contrôle de provenance n’est pas vendu comme une nouvelle revue exhaustive de tout le programme.

- `scripts/config-core.cjs:97`, `js/incomplete-sanitization`, **7.8** : contexte dotenv, compatibilité des consommateurs corrigée précédemment ; consommateurs réels testés C14. Pas de preuve universelle d’encodage, alerte conservée.
- Cinq résultats courants `js/file-system-race`, **7.7**, dans les scripts d’audit historiques : **quatre courses locales restent ouvertes/non acceptées**. Le cas `closure-2026-10-14/run-command.cjs` utilise bien `flag: 'wx'`, ce qui réfute la course d’écrasement de cette cible, sans prouver tous les parents. Aucun de ces scripts historiques n’est relancé pour écraser une preuve.
- L’ancien emplacement d’ancre publique utilise déjà descripteur/fstat/création exclusive, tests relancés C14 ; absent du SARIF courant, pas de dismissal ni certification de toute course sur les parents.
- Résultat supplémentaire `backup-codes.ts:29`, **7.5** : alphabet actuel exactement 32, chaque symbole a huit préimages sur 256 octets ; biais modulo réfuté dans ce cas précis, pas certification de tout le protocole MFA.
- Les autres flux initialement examinés (Electron diagnostics/crash/licence, config fournisseur, synchronisation, photo-store, fixture et logs middleware) gardent leurs justifications et leurs limites. **Confiance filesystem/photo-store et transferts partiellement validés restent des risques résiduels**.

SARIF df66 projeté : **14 résultats, 7 avec security-severity numérique >=7** ; aucune règle retirée, alerte dismissée ou risque accepté. Les identifiants `P6-CQ-xx` sont locaux, pas des numéros GitHub inventés.

C09 : **APIs officielles CodeQL et Dependabot HTTP 403** ([relevé](official-alert-access.json)). Inventaire/nombres/états officiels détaillés **inconnus**. Demande : export officiel par le responsable sécurité ou accès de lecture autorisé. Le warning du push reste **151 sur la branche par défaut** (2 critiques/63 hauts/71 modérés/15 bas) ; ce n’est pas le résultat npm du candidat. La matrice précédente par paquet/version/exposition/correctif reste dans `../copilot-phase5/dependency-default-candidate-matrix.json` avec ses propres dates et limites : elle ne devient pas un inventaire officiel actuel des 151 alertes.

## 8. Sémantique : deux ensembles, aucun score fictif

**Corpus historique gelé : 17/48, 31 échecs classifiés, inchangé.** SHA-256 `7b23aa75f2f08b6b23e9bf65a64d1051c95aef0bac33168257f562feb1227092`. Pas de modification des cas/critères, pas de 31 rustines lexicales, pas de nouvelle exécution présentée à tort comme un nouveau score. Intention/faits/réponse finale ne sont pas validés universellement par ces contrats de sélection.

**Deuxième ensemble préparé : [32 nouveaux brouillons réservés](second-corpus-draft.json), quatre par dimension** : intention nouvelle, composé, conversation, période/statut, informations manquantes, hors-scope, outils/paramètres, permissions/faits. Chaque cas décrit intention, entités, contraintes, informations manquantes, opérations candidates et comportements interdits. C08 vérifie unicité et absence de chevauchement textuel normalisé avec les corpus existants ; [manifest de préparation](second-corpus-preparation.json).

**Indépendance éditoriale/externe NON ÉTABLIE** : rédigés par l’agent déjà familier de l’implémentation, sans auteur/relecteur externe ni oracles natifs. Flags de provenance laissés à `false`, aucune fausse attestation d’indépendance pour passer l’intake strict existant. Le gold est un brouillon à revoir, pas une sortie du moteur utilisée pour calibrer les règles. Les sources sémantiques n’ont pas changé et ces cas ne sont utilisés ni pour ajustement ni pour exécution. **Score, faux positifs, faux négatifs, régressions et exactitude factuelle : null / non mesurés**, pas zéro.

La réception d’un corpus réellement indépendant et sa revue/oracles restent bloquantes ; le runner actuel reste lié aux 48 anciens cas. Qualité conversationnelle et sûreté/permissions sont deux axes distincts : des tests de refus verts ne démontrent pas la compréhension linguistique.

## 9. Journaux locaux, échecs conservés et reproductibilité

Chaque `Cxx.json` contient commande exacte, cwd, dates Europe/Paris, versions Node/npm, HEAD et empreintes de l’arbre effectivement présent, exit, durée et hashes du log public normalisé/original privé. Les champs source/HEAD ne transforment pas un arbre modifié non commité en test du commit suivant. Les scripts de collecte/authoring privés ne sont pas des outils produit ; les endpoints et commandes publiques des reçus permettent de reproduire les contrôles correspondants. Les inventaires/hashes ne valent pas preuve fonctionnelle.

| Preuve | Résultat réel |
|---|---|
| C01 | DNS régression avant correctif : 3 FAIL / 1 PASS, exit 1 |
| C02 / C05 | Chaîne 17 + DNS 4 PASS ; C05 inclut diagnostic initial 5 tests et diff |
| C03 | Diagnostic 5 PASS puis TypeScript **exit 2** : clients Prisma locaux non générés ; pas un build validé |
| C04 | Suite e-invoicing complète tentée : **9 fichiers PASS / 1 suite setup FAIL**, 151 PASS / 20 non exécutés affichés skipped par Vitest ; téléchargement du moteur officiel Prisma inaccessible |
| C06 | Vitest 682 PASS, Node/config PASS ; release-safety **57/58**, assertion de graphe conservée détectant la première instrumentation ; suite shell arrêtée avant audit |
| C07 | Même chaîne corrigée, PASS ; HEAD befc + empreintes de travail correspondant à la correction df66, pas CI df66 |
| C08 / C09 | Préparation du brouillon (pas benchmark) / constat des deux 403 (pas absence d’alertes) |
| C10 | HEAD df66, ESLint des 7 fichiers JS/TS changés, diagnostic 6 + gate 3 PASS ; pas de masquage de types |
| C11 | Première collecte metadata **FAIL JSON parsing**, aucun snapshot complet produit ; conservée |
| C12 / C15 / C16 | Collectes officielles corrigées : df66 en cours, puis terminé ; befc terminé, échecs compris |
| C13 | Revue/mapping/hash des 17 alertes et SARIF projeté ; pas preuve de disparition officielle |
| C14 | Régression élargie sur HEAD df66 : 682 + 37 + 78 + 58 + 9, arbre npm et audit strict zéro, exit 0 |
| C17 | 100 références historiques inchangées, sources/contrôles gelés préservés ; pas certification fonctionnelle |
| C18 | Vérification des 17 reçus antérieurs/logs/hashes privés-publics, 8 hashes de revue, 3 snapshots CI complets, deux échecs Windows conservés et diff staged ; exit 0, preuve metadata uniquement |

Le blocage local Prisma n’a pas été contourné par un faux client, une déclaration diagnostique ou une désactivation TLS. Les preuves CI natives sont distinctes. Aucune exécution Windows locale Linux n’est présentée comme équivalente.

## 10. Décision et preuves encore nécessaires

1. **Windows** : origine du glob hors dépôt, correction justifiée, dist complet et contrôles d’artefact, installation/lancement réels.
2. **Préproduction authentifiée** : cible/comptes/fixtures approuvés et exécution effective de A01–A17, dont deux garages et confidentialité.
3. **Alertes** : export officiel CodeQL/Dependabot ; traitement explicite des courses historiques sans réécriture de preuves, risques photo/transferts encore ouverts ; pas de fermeture par déduction npm.
4. **Sémantique** : auteur/revue indépendants et oracles, score par catégorie et FP/FN/régressions seulement après exécution réelle du second corpus.
5. **Coût** : enforcement monétaire effectif vérifié et consentement avant toute campagne payante ; rester fail-closed entre-temps.
6. **CI du SHA courant après publication** : observer ses propres résultats, sans réutiliser ceux de df66. Les checks obligatoires doivent réellement réussir sur le candidat retenu avant toute promotion.

**Non effectués** : merge, déploiement, release manuelle, création de compte/ressource externe, rotation/révocation ou réécriture d’historique, écrasement de preuve, accès à données de production, appel LLM/fournisseur facturable, validation d’un plafond positif, recette authentifiée réelle, paquet Windows démarré, résolution officielle de toutes les alertes, score indépendant.

**Conclusion inchangée : PARTIELLEMENT VALIDÉ — NON PRÊT POUR LA PRODUCTION.**
