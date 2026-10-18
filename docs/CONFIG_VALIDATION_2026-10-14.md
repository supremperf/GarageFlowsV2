<!-- doc-numbers: journal -->
# Vérification locale de config — 14 octobre 2026

**Statut : PARTIELLEMENT VALIDÉ. Décision globale inchangée : NON PRÊT POUR LA PRODUCTION.**

Cette vérification porte sur le configurateur et ses lanceurs, pas sur une recette globale de GarageFlows. Aucun compte cloud, déploiement, migration réelle, rotation de secret ou publication GitHub n’a été exécuté. Les preuves historiques d’audit ne sont pas modifiées.

## Référence et périmètre

- Date du contrôle final : 2026-10-14T20:11:38.673855+02:00 (Europe/Paris).
- Répertoire : `/home/user/GarageFlowsV2` ; branche `arena/c9eaae15-garageflowsv2`.
- HEAD de départ et du contrôle : `77d7b30840aaa54775dce9db2b68991ce5269a66` ; corrections locales non committées.
- Node `v22.22.3`, Linux. Le lanceur exige désormais la plage déclarée par package.json : >=22.12.0 et <23.
- Empreinte agrégée des neuf fichiers relus/modifiés : `8ce7201ab60f92d9abc6edf393533a699d01638c0e80db16522ed47644709334` (SHA-256 du JSON trié des SHA-256, détails dans le reçu machine local).
- À la racine : `.env.example` seulement. Aucun `.env` ni `.env.server.local` réel à valider. Les fichiers privés utilisés par les tests sont des fixtures temporaires et sont supprimés.

## Couverture du contrat

- **48 noms du template, tous classés** : 46 applicatifs, un runtime Electron (`GF_INTERNAL_EXPORT_KEY`), un réservé au coffre de publication (`GF_UPDATE_SIGNING_KEY`).
- **54 paramètres applicatifs canoniques** au total : les paramètres absents du template sont également proposés, selon le profil compatible. Le manifeste comporte 120 entrées ; une classification explicite ne signifie pas qu’un compte externe est configuré.
- `node config --list` et `config.cmd --list` affichent les noms, profils et destinations, sans valeurs. Un nom du template non classé entraîne une sortie 1. Les overrides Next.js sont signalés mais ne sont pas modifiés.
- Les paramètres facultatifs sont accessibles dans les réglages avancés du mode complet (serveur puis desktop) et dans les profils ciblés. Les noms personnalisés déjà présents sont conservés et modifiables localement, avec valeurs masquées ; ils ne sont pas envoyés automatiquement à Vercel.
- Les secrets runtime/publication ne sont pas exportés dans les profils applicatifs. La publication conserve son coffre externe et son chemin/keyId dans `GarageFlow-configuration/publisher.json` ; le wrapper de signature injecte le chemin dans son propre processus.

## Corrections et régressions

1. Réglages facultatifs désormais proposés même lorsque la configuration est valide ; édition avant inspection de la base pour conserver les garanties de préservation des clés.
2. Chemins Windows normalisés pour sauvegardes/photos et SQLite ; préservation des valeurs personnalisées contenant guillemets, antislashs, dollars et dièses par un délimiteur dotenv compatible. Les noms personnalisés minuscules/avec points ou tirets ne disparaissent plus à la lecture.
3. Refus des identifiants/query/fragments dans les endpoints HTTP publics ; les URL PostgreSQL conservent leurs identifiants. Les valeurs d’URL sensibles ne sont pas affichées comme défaut de saisie.
4. Contrôle de profil et d’alias dans `--check` ; contrôles des overrides importés dans les profils ciblés ; séparation des variables runtime, maintenance et publication dans les sous-processus.
5. Refus d’un changement de cible après inspection et nouveau contrôle des empreintes compromises après une correction avancée.
6. Correction d’une course de saisie masquée : readline est prêt avant affichage du prompt, pour éviter qu’un collage immédiat ne soit affiché par le terminal. Régression unitaire et essai interactif réel Linux.
7. `config.cmd` conserve le code de sortie et ne bloque plus les invocations avec arguments sur `pause`. Le double-clic sans arguments garde la pause. Validation native Windows distincte ci-dessous.

## Exécutions distinctes, sans addition des comptes

| Exécution | Résultat | Statut | Limite |
|---|---|---|---|
| Baseline avant correction | 49 tests, 49 réussis, 0 échec, 0 ignoré ; exit 0 | VALIDÉ | Tests existants, pas une couverture complète |
| Premières régressions avant correction | 56 tests, 49 réussis, 7 échecs, 0 ignoré ; exit 1 | ÉCHOUÉ | Démonstration des lacunes et des nouvelles attentes |
| Essai interactif initial | Valeur de fixture détectée dans le terminal ; exit 1 | ÉCHOUÉ | Diagnostic expurgé, aucune valeur enregistrée dans le journal ; corrigé ensuite |
| CFG-01, suite finale du configurateur | **65 tests, 65 réussis, 0 échec, 0 ignoré ; exit 0** | VALIDÉ | Tests unitaires et fournisseurs simulés |
| CFG-06, politique scanner | 2 tests, 2 réussis, 0 échec ; exit 0 | VALIDÉ | N’est pas un scan Gitleaks officiel |
| CFG-07, vrai chargeur Next | 18 cas compatibles avec @next/env 15.5.27 ; exit 0 | VALIDÉ | Chargement de fichiers uniquement, pas un build Next |
| CFG-08, vrai Node CLI interactif | Édition de chemin Windows et d’un champ personnalisé masqué ; clés préservées, permissions 0600 ; exit 0 | VALIDÉ | Pseudo-terminal Linux ; initialisation SQLite déclinée |

Le paquet `@next/env` provient de l’URL registry.npmjs.org du lockfile. Son SHA-512 a été vérifié avant extraction. Aucun package du projet ni lockfile n’a été modifié pour ce contrôle.

### Commandes finales et reçus locaux

Répertoire des journaux : `/home/user/config-validation/`. Le reçu machine `final-checks.json` conserve pour chaque commande : ID, horodatage Europe/Paris, cwd, commande exacte, HEAD/branche, empreinte des sources, code de sortie et SHA-256 du journal. Ces journaux de travail sont hors dépôt, non publiés.

| ID | Commande exacte | Exit / statut | Journal SHA-256 |
|---|---|---|---|
| CFG-01 | `node --test tests/config.test.cjs tests/config-full.test.cjs` | 0 / VALIDÉ | `cdd080712bf1cf056082e56caff6dac8c020d9801095eb565a15a9b6500d630b` |
| CFG-02 | `node config --help` | 0 / VALIDÉ | `5322046c3f800f6bcc0a4b3bba5366eb781d3fadc4d657abeb7bbff26e8b3043` |
| CFG-03 | `node config --list` | 0 / VALIDÉ | `aca2bdde30a9935a130bcc20d146a81b0596781fbb9447a9a878a8c9c30b9d44` |
| CFG-04 | `node scripts/check-env-consistency.mjs` | 0 / VALIDÉ | `7c863f142cb3af8d9f1d18914d24ca312fccbd00f978612d230f6a55ddf74e7f` |
| CFG-05 | `node scripts/check-docs-consistency.mjs` | 0 / VALIDÉ | `7163a0860c0bdfab24980f3df7a32fec22c5c347d8f59b80137628d2e2d723f4` |
| CFG-06 | `node --test tests/secret-scan-policy.test.cjs` | 0 / VALIDÉ | `3d31da475b676dabc60c5362f427599b93aedec3f43b72109b36f6e87f45a335` |
| CFG-07 | `node /home/user/config-validation/check-next-dotenv.cjs` | 0 / VALIDÉ | `787bff9b629892d57e01fc4e7abeb424e54966340455cff1481324569702c939` |
| CFG-08 | `python3 /home/user/config-validation/check-interactive.py` | 0 / VALIDÉ | `5271562cb9f67920dc406a6cce1da7c30c1238849c41c099dc3ffbd216b31cca` |
| CFG-09 | `git diff --check` | 0 / VALIDÉ | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

Les contrôles de syntaxe `node --check` ont également réussi sur `config`, les quatre helpers de configuration modifiés et les deux fichiers de tests. Le contrôle documentaire a été répété après création de ce rapport : 180 documents parcourus, sortie 0. Les sorties exactes sont conservées dans les reçus locaux.

## Fichiers et empreintes de la relecture ciblée

Relecture des modifications, de leurs flux appelants et des tests associés ; cette table ne revendique pas une validation fonctionnelle de chaque ligne historique du fichier. Les SHA-256 identifient précisément les sources des contrôles finaux.

| Fichier | Lignes | SHA-256 |
|---|---:|---|
| `config` | 575 | `f396e8515cdc126a7cca5f3098113087d56ed4810268012909d7bd0ca20dc846` |
| `config.cmd` | 15 | `0ff4e64e3b660a99e31c6093284da5fa0161e179acad375b48b177ab4d9a6671` |
| `scripts/config-core.cjs` | 231 | `d0e16bb07f9ef0de33d26b201963d7888a9e390301493efbe54d99805278b370` |
| `scripts/config-full.cjs` | 327 | `373df7838a299c04246e068c59257eddea4b90556d8ce65f8dcfa3a556ffb8b5` |
| `scripts/config-policy.cjs` | 40 | `2b1b7a3ab6c52cd9cc16f483f2dfdce7595a7a166d437975ac857e8842d71c2c` |
| `scripts/config-env-coverage.cjs` | 59 | `d47eaf80785ea35d9f601c049e8d5bc99635f38f037dfb7fed1e84f7f5da9707` |
| `tests/config.test.cjs` | 490 | `4b8764692a5b17aa5cfdf9623b814fff6f114d77959a51080ede6f9a28adc0d2` |
| `tests/config-full.test.cjs` | 452 | `9288f10fe64a45b15c4626385b5c0d48ceca9d6578b56b0f0e4230df6a2f432c` |
| `docs/CONFIG.md` | 154 | `a16a8e48aca5d0f8935c6b2d1eed8f43ed0f9cf93d07a42a8b3a2ce047842a42` |

## Vérifications restantes

- **BLOQUÉ** — validation des valeurs et connexions de votre environnement : les fichiers privés sont absents. Aucun secret n’est demandé dans la conversation.
- **BLOQUÉ** — exécution native de `config.cmd` : pas de runner Windows isolé disponible ici. Son contenu/délégation/gestion du code de sortie est testé statiquement ; cela ne valide ni CMD natif, ni les ACL, ni les chemins réellement montés sur Windows.
- **BLOQUÉ** — connexions Neon/Vercel/Upstash, Prisma avec de vraies bases, keygen avec autorité réelle, signature et déploiement : non exécutés sur vos comptes. Le plan complet automatisé est couvert par des fixtures ; ce n’est pas une preuve d’intégration cloud.
- **EN ATTENTE DE REVUE** — corrections locales, sans commit/push ni modification de la PR. La CI officielle du HEAD publié reste historiquement négative ; elle n’est ni relancée ni corrigée par ces seules vérifications locales.
- **PARTIELLEMENT VALIDÉ** — le configurateur est couvert localement par les contrôles ci-dessus ; les prérequis de production de l’audit global restent ouverts. Budget JS, règles de scan et preuves historiques inchangés.

Guide opérateur : [CONFIG.md](CONFIG.md). Pour une vérification sans écriture : `node config --list`, puis `node config --check --profile desktop` ou `node config --check --profile licences --vercel` sur le poste qui possède les fichiers privés. Un succès de `--check` ne vérifie pas les connexions.

Note de méthode : les appels `git diff --no-index --check /dev/null <nouveau fichier>` (CFG-FINAL-10/11) ont renvoyé 1 sans diagnostic, car `--no-index` signale aussi la présence de différences. Le premier reçu les classe ÉCHOUÉ ; ce résultat technique est conservé, pas transformé en réussite. Un contrôle indépendant des espaces sur les dix fichiers du changement est consigné dans `final-whitespace.json`, et le contrôle documentaire final dans `final-docs.json`.
