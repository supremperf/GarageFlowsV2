<!-- doc-numbers: journal -->
# Sécurité — inventaire préalable, 18 octobre 2026

## Périmètres séparés et absence de fausse clôture

**Mission non terminée, NO-GO.** Aucun code applicatif/manifest/lock n’a été modifié pour cette mission avant ce relevé. Les modifications PHASE 6/7 préexistantes restent dans la branche de session `arena/55edbdc1-garageflowsv2` ; elles ne sont pas des corrections nouvellement réalisées aujourd’hui.

- Branche par défaut GitHub : **main**, commit `e3ac5f5a55284906531dcc5d4a620cb0ff072313` (merge du 3 août 2026).
- Branche de session publiée : `1aa860dd3fcf2b55224f127a0ab4878b20b74fc8` ; checkout local avec les mêmes travaux préexistants et base HEAD `aa90f89`.
- Avertissement GitHub lors du push précédent : **151 alertes, 2 critiques, 63 élevées, 71 modérées, 15 faibles**. Ce n’est pas un export nominatif.
- **API REST Dependabot HTTP403** : `Resource not accessible by integration`. Aucun ID d’alerte privée n’a été inventé. GraphQL retourne `totalCount:0`, contradictoire avec cette restriction et le message du push ; **zéro GitHub non validé**. [Preuve et action d’accès](github-access.json).
- Le rapprochement exact des **151** alertes reste bloqué tant que l’opérateur n’a pas rétabli le droit de lecture Dependabot dans la connexion GitHub Arena ou fourni un export JSON neutralisé. Ne jamais fournir un PAT, mot de passe, cookie ou autre secret dans le chat.

## Commandes réellement exécutées avant correction

Sur le candidat : `npm ci --ignore-scripts --no-fund --no-audit` (758 paquets), `npm audit` exit0, `npm audit --json` exit0, `npm outdated --json` exit1 (32 paquets outdated), `npm ls --all --json` exit0. Node 22.22.3 / npm 10.9.8 ; npm épinglé **11.16.0** vérifié disponible via `npx --yes npm@11.16.0 --version`. L’installation avec hooks et le build ne sont pas encore validés dans cette mission.

Sur une copie isolée des **package.json + package-lock.json exacts de main**, sans checkout/switch de branche ni données production : `npm ci --ignore-scripts` (787 paquets), `npm ls --all --json` exit0, `npm audit --json` exit1. Le package-lock n’a pas été réécrit pour masquer des alertes.

| Mesure | main exact | Branche candidate |
|---|---:|---:|
| Agrégats paquets npm critiques | 2 | 0 |
| Élevés | 34 | 0 |
| Modérés | 13 | 0 |
| Faibles | 1 | 0 |
| Total agrégats npm | **50** | **0** |
| Relations paquet/avis explicites | **174** | Comparaison aux versions candidates ci-dessous |
| GHSA uniques issus du bulk npm | **163** | Ne remplace pas l’export GitHub |

Ces métriques ne sont **pas** interchangeables : 50 paquets npm, 174 relations dont 3 critiques et 163 GHSA uniques ne sont pas « les 151 alertes GitHub ». Les bases d’avis et leur date de mise à jour peuvent différer. La raison précise de chaque écart nécessite les vrais IDs Dependabot.

## Inventaire nominatif complet accessible

- [50 paquets et toutes leurs instances/path d’introduction](package-inventory.json) : versions verrouillées, direct/transitif, parents directs, voies Node de résolution, métavulnérabilités, correctif npm proposé et état candidat. Inclut production, développement, optional et peer, toutes plateformes du lock. Un chemin minimal par dépendance directe et instance, pas tous les parcours cycliques possibles.
- [174 relations paquet/GHSA avec CVE, versions corrigées et chemins](advisory-inventory.json) ; [tableau TSV](advisory-inventory.tsv).
- [163 fiches officielles publiques récupérées de l’API GitHub](public-advisories.json), sans indisponibilité de fiche. Une absence de CVE affecté est explicitement `null` ; pas de CVE fabriqué.
- [Synthèse machine](inventory-summary.json) : zéro instance candidate **nom/version ordinaire** correspondant encore à ces plages npm connues ; tous les chemins des instances vulnérables de main identifiés.
- Rapports npm bruts : [main](main-npm-audit-before.json), [candidat](candidate-npm-audit-before.json), [outdated](outdated-before.json). Le code reproductible de rapprochement est [build-inventory.cjs](build-inventory.cjs).

**Exception essentielle à ce zéro machine :** `braces` est remplacé depuis des travaux antérieurs par un fork local borné `@garageflows/braces-bounded`. Ce nom n’est pas suivi automatiquement par npm/Dependabot pour les avis upstream. L’inventaire marque **LOCAL_FORK_MANUAL_REVIEW_REQUIRED**, jamais « non vulnérable grâce au renommage ». Le fork possède provenance, patch réel et 4 653 vecteurs de compatibilité ; examen source/tests et surveillance de GHSA upstream indispensables. Aucune nouvelle bibliothèque inconnue introduite dans cette mission.

## Critiques — priorité avant le reste

| Paquet / avis officiel | main | Correctif officiel pertinent | Candidat préexistant | Surface GarageFlows / limites |
|---|---|---|---|---|
| next — [GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36), CVE-2026-75604 | 14.2.35 | 15.5.24 ou 16.3.3 selon ligne | **15.5.27** | RCE serveur sur système de fichiers Windows ; pertinent pour Next standalone/Electron Windows. Écoute loopback réduit l’exposition mais ne démontre pas une impossibilité d’exploitation. Pas de PoC dangereux exécuté. |
| next — [GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4), pas de CVE affecté dans la fiche | 14.2.35 | 15.5.24 ou 16.3.3 | **15.5.27** | RCE liée à libheif/optimisation AVIF ; route d’optimisation Next et Sharp concernées. Version corrigée neutralise le chemin AVIF en attendant propagation. Aucun test hostile sur un service réel. |
| tar — [GHSA-23hp-3jrh-7fpw](https://github.com/advisories/GHSA-23hp-3jrh-7fpw), CVE-2026-59873 | 6.2.1 via `electron-builder@24.13.3 → app-builder-lib@24.13.3` | 7.5.19 pour cet avis ; **7.5.21+** requis pour l’ensemble des autres avis tar du relevé | **7.5.22 via electron-builder 26.15.3** | Extraction d’archives dans les outils de build/package ; compromission/disponibilité du runner possible sur archive hostile. Pas une preuve d’endpoint applicatif upload→tar. Tests bornés sans bombes ni écriture hors répertoire temporaire à ajouter. |

Les « deux critiques » d’agrégats npm sont **next et tar**, mais next contient ici deux avis critiques. Sans export d’alertes, ne pas prétendre que ces trois avis sont exactement les deux IDs critiques du message GitHub.

## Audit source et configuration commencé — pas certification exhaustive

Reprise des inventaires PHASE 6/7, lecture des frontières staff/licence/admin/portail/mécanicien, permissions `authz.ts`, projections financières, clauses garage des catalogues et documents, headers Next, fetch/SSRF e-invoicing, endpoints IA et chaîne Electron. Inventaire source précédent : 164 routes, 240 handlers ; ce comptage n’est pas une preuve sémantique de toutes les branches.

Constats avant nouveaux patchs :

1. **SEC151-S01, défense d’isolation des relations** : `GET /api/parts?repairType=...` filtre `RepairTypePart.garageId`, puis `include: {part:true}` sans imposer `part.garageId`. Une association historique/corrompue vers une pièce d’un autre garage sortirait ses détails. Les API de création récentes vérifient des FK, mais cela ne certifie pas toutes les données importées/migrées. Ajouter la portée explicite de la relation, test de deux garages ; pas de réparation de données production.
2. **SEC151-S02, robustesse entrée** : pagination des pièces utilise des nombres finis mais peut envoyer une fraction comme `take`, ou un `skip` hors plage Prisma → exception/500. Utiliser le parseur strict commun, bornes/defaults existants préservés et rejets avant DB. Ce n’est pas étiqueté arbitrairement RCE/critique.
3. **SEC151-O01 ouvert, confidentialité financière** : `/api/parts` et `/api/parts/search` retournent les coûts d’achat sans projection `financial:read`, alors que documents et pièces d’intervention les expurgent. Une suppression seule casserait des snapshots monétaires : `QuoteInvoiceModal` récupère ce coût pour les lignes, et la création de devis consomme encore le coût fourni. Exiger ensemble une source de coût serveur, une projection par rôle et une recette UI/document/marge. Ne pas casser la facturation en retirant aveuglément le champ.
4. **SEC151-O02 ouvert, administration** : identité humaine/MFA et audit durable de la SPEC P1 non implémentés ; diagnostics par clé partagée exposent des métadonnées de secrets. La procédure PowerShell de convergence utilise leurs fingerprints : une suppression sans migration du protocole serait une régression d’exploitation. Le hash au domaine public n’empêche pas le dictionnaire hors ligne. Minimisation et workflow fort à réaliser avec compatibilité, pas réouverture de revoke-by-key.
5. Audit complet de toutes les politiques tenant/CSRF/SSRF/XSS/injections, workflows IA et artefacts non clos. Les wrappers et tests statiques ne remplacent pas les tests natifs de deux garages. Aucun secret/SQL de production consulté ; toute investigation ultérieure DB reste en transaction READ ONLY/ROLLBACK.

## Plan de correction/validation après cet inventaire

1. Vérifier matériellement les versions critiques et ajouter tests de non-régression bornés du correctif tar, du lock et du chargement des outils. Ne pas faire de mise à jour majeure supplémentaire inutile : le candidat a déjà les versions corrigées, main ne les a pas.
2. Rejouer l’audit complet avec npm épinglé, vérifier chaque plage des 163 avis, auditer explicitement le fork local et les overrides ; qualifier les 32 obsolescences et les warnings, pas les confondre avec CVE.
3. Corriger S01/S02 par tests d’abord, sans changement de design/fonction ni accès aux données réelles. Maintenir O01/O02 visibles jusqu’à correction complète, pas de prétendu audit source « zéro faille ».
4. Installation normale/hooks, types/lint, suite globale, build et CI existante ; erreurs réseau/native et tests ignorés doivent rester visibles. Préparer l’intégration sur main via une PR depuis **la seule branche de session** ; pas de push sur main ni merge/déploiement d’un candidat non validé.
5. Après intégration **approuvée et validée**, relecture REST des alertes GitHub, pagination complète, comparaison des IDs initiaux/résolus/nouveaux après traitement. Tant que l’accès/CI/intégration ou une revue restent ouverts : **mission non terminée**.
