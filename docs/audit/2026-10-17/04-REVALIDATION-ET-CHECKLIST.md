<!-- doc-numbers: journal -->

# Revalidation, checklist et résumé — 17 octobre 2026

**Relevé antérieur à PHASE 6. État courant : [06 — verdict final](06-VERDICT-FINAL.md), avec [journal de résolution](05-RESOLUTION-BLOCAGES.md). Les mesures ci-dessous sont conservées comme historiques.**

## Verdict

**Promotion production bloquée. Audit exhaustif A–K non achevé. Aucun certificat de sécurité ou de fonctionnement intégral.**

Les corrections du parcours licence/sync sont implémentées et couvertes par des tests ciblés. Cela ne prouve ni le fonctionnement de la version déployée, ni la cause d'un incident de production. Phase 0.5 : **non vérifiable sans accès production**. Le seuil de preuve ≥90 % n'est pas atteint ; aucun pourcentage artificiel ne lui est substitué.

Aucun déploiement, rotation de secrets, migration ou changement de données de production effectué. Aucun accès DB de production utilisé. Les générations Prisma décrites ci-dessous ne constituent pas une migration.

## Livrables et périmètre réel

- [Inventaire initial](00-INVENTAIRE.tsv) : 2 302 fichiers suivis, y compris fichiers cachés suivis. Ce n'est pas une preuve de lecture sémantique exhaustive de chaque fichier. Les dépendances et répertoires ignorés générés ne sont pas ajoutés à cet inventaire Git.
- [Rapport initial, compréhension et défauts avant corrections](01-AUDIT-INITIAL.md) : stack, architecture, constats avec preuves et solutions proposées, couverture A–K et limites.
- [Contrats HTTP licence/sync](02-CONTRATS-LICENCE-SYNC.md) : six routes licence, treize routes sync, fermeture de revoke-by-key, comportement des clients.
- [Journal justifié, preuves et investigation incident](03-JOURNAL-ET-INCIDENT.md) : changements, tests, limites, traçage UI, hypothèses et plan P0/P1/P2 avec propriétaires proposés, échéances relatives, rollback et surveillance.
- [Preuves de validation structurées](04-PREUVES.json) : résultats agrégés, fichiers Vitest, classifications des échecs, dépendances obsolètes et sorties des contrôles supplémentaires. Pas de logs de production ni de secrets ajoutés.
- Le présent document : revalidation, écarts ouverts, checklist et conclusion.

L'inventaire et les contrôles transversaux ne remplacent pas une revue métier de toutes les routes, de tous les écrans, des droits de chaque rôle ou des intégrations externes. La priorité a été donnée à la phase 0.5 demandée. Les phases 4/5 restent partielles tant que les blocages ci-dessous persistent.

## Résultats exécutés

Environnement : Node 22.22.3, npm 10.9.8, Python isolé en `.venv`, Git shallow, base aa90f89c059db58a4a3fe3c339a2dffbfbf10fad. Aucun changement de branche.

| Contrôle | Résultat constaté | Portée / réserve |
|---|---|---|
| `npm ci --ignore-scripts --no-fund --no-audit` | Exit 0, 758 paquets installés | Installation sans scripts ; **pas** une installation complète avec postinstall/build/package. Avertissements de dépréciation ouverts. |
| `npm audit --json` | Exit 0, aucune vulnérabilité signalée | État du registre lors de l'exécution ; ne prouve pas l'absence de défaut applicatif, de supply-chain ou de licence. |
| `npm outdated --json` | Exit 1, **32 paquets signalés** | Rapport conservé dans 04-PREUVES.json. Une version plus récente n'est pas nécessairement une vulnérabilité. Mises à niveau majeures non appliquées sans validation de compatibilité. |
| `npm run lint` | Exit 0, dernière passe après corrections | ESLint sur `src`, pas une couverture universelle de Python/PowerShell/Electron. |
| `npm run type-check` | Exit 0, dernière passe après corrections | Clients Prisma générés pour le typage seulement ; pas de preuve DB. |
| `node --test tests/*.test.cjs` | **364/364 pass**, 0 fail, 0 skip | Dernière passe après corrections. Inclut les gardes de provenance Keygen et contrats de scripts. |
| Vitest global, dernière passe complète | **4 144 tests : 3 292 pass, 3 fail, 849 pending** ; **341 fichiers : 262 pass, 79 failed** | Exit 1. Les échecs de préparation de fichiers n'apparaissent pas tous comme assertions échouées ; ne jamais réduire ce résultat aux seules 3 assertions. |
| Vitest ciblé, après le dernier changement de mapping Electron | **252/252 pass**, 17 fichiers, 0 pending | `incident-*`, `electron-*`, `licence-changement-contrat`. Dont **117 tests incident**. Ne remplace pas la globale et les tests natifs. |
| `git diff --check` | Exit 0 | Espaces/conflits de patch, pas audit d'encodage métier ni de sécurité. |
| `node --check` sur Electron main / politique / ancre de confiance | Exit 0 | Analyse syntaxique, pas lancement Electron. |
| Python `py_compile` Keygen | Exit 0 | Syntaxe uniquement ; tests de contrat séparés. |
| `check:migration-safety`, `check:pg-migrations`, `check:converge-additive` | Exit 0 | Contrôles du code et du schéma attendu, **pas** exécution des migrations de production. |
| `check:sqlite-template` | Exit 0 | Modèle fourni : intégrité/FK, baseline 214 migrations, 0 pending, checksums conformes. Ne concerne pas les bases de postes réels. |
| `check:critical-files` | Exit 0 | Présence/cohérence interne, dont ancre publique embarquée. |
| `check:public-key`, `keys:check` | Exit 0 **mais SKIP explicite** | `keys/public.pem` absent. Aucune comparaison avec l'autorité émettrice : **non validé**. |
| `env:doc` | Exit 0, 125 variables / 8 alias / 48 variables plateforme | Documentation régénérée ; 3 gardes négatives déclarées, sans rendre leurs valeurs autorisées. |
| `check:env-consistency` | **Exit 1, 28 problèmes restants** | Alias fournisseur/non canoniques, détails ci-dessous. Le contrôle de cohérence global n'est donc pas vert. |
| `db:desktop:validate`, `db:server:validate` | **Exit 1** | Téléchargement des moteurs Prisma bloqué avant validation utile des schémas. |
| `npm run build` | **Exit 1** | Échec à l'étape Prisma, avant compilation Next. Aucune preuve de build Next réussi. |
| `check:perf-budget` | **Exit 1** | `.next/static` absent, conséquence du build non réalisé. |
| Démarrage applicatif, API réelle avec DB, E2E, packaging/signature Windows | **Non validés** | Pas de substitution de mocks à cette recette. |

### Attribution des échecs Vitest et précaution Prisma

Sur les 79 fichiers globaux en échec :

- **78** contiennent une erreur de téléchargement depuis `binaries.prisma.sh` (socket interrompue avant établissement TLS). Cela affecte notamment les préparations DB. La restriction réseau de cet environnement empêche de conclure à un défaut du moteur ou à une panne de production.
- **1** (`tenant-isolation.test.ts`) échoue avec un client généré sans moteur, qui réclame une URL `prisma://` lors d'une vraie requête. C'est une limite de la préparation locale utilisée pour le typage, pas une réussite du test d'isolation.

Les clients Prisma ont été générés avec `--no-engine` et des chemins binaires de substitution `/bin/true`, exclusivement pour rendre le contrôle TypeScript et les tests mockés possibles. **Ils ne doivent pas être utilisés comme clients opérationnels ni pris pour une preuve de fonctionnement SQLite/PostgreSQL.** Ne pas déployer les artefacts de dépendances de cet environnement. Refaire une installation et une génération normales dans un environnement autorisant les distributions Prisma, sans contournement TLS, puis relancer l'ensemble.

La dernière globale précède le dernier affinage des statuts métier dans la politique/report Electron. Celui-ci a été retesté dans les 252 tests ciblés, puis lint/type-check/364 tests Node. Il n'est pas présenté comme couvert par une nouvelle globale complète.

## Défauts de code confirmés et corrigés — distincts de l'incident production

1. Frontières HTTP communes aux handlers licence/sync : `DB_UNAVAILABLE` 503, `SERVER_MISCONFIGURED` 500, `INTERNAL_ERROR` 500, réponse neutre avec request ID ; diagnostic sensible brut retiré de ces frontières.
2. Activation : les contrôles config/DB/appareil ne deviennent plus un succès Electron ; vérification MAC, dont licence parent mécanicien ; `LICENSE_TAMPERED` distinct. Pas de preuve d'atomicité de tous les effets annexes DB, ni de concurrence multi-processus.
3. Reset : anciennes injections de diagnostic/contournement rendues inopérantes, préservation du format Windows. Aucune exécution du reset sur machine réelle ni déploiement.
4. Admin `revoke-by-key` : **404 permanent**, aucune réactivation par flag ou secret, aucune écriture DB depuis cette route, audit de tentative. La couverture et la rétention réelles des logs d'infrastructure restent à vérifier.
5. Next/Electron : ancre publique invalide/inutilisable distinguée d'un jeton à signature non vérifiée. Une clé syntaxiquement valide mais ne correspondant pas à l'émetteur nécessite une attestation externe ; le code ne peut pas en déduire seul une panne de configuration.
6. Electron : activation distante exige HTTP 200 + `ok:true` + identifiants d'appareil, pas de nouvelle activation par repli local après échec distant ; attente localReady/rollback ; infrastructure rendue neutrement dans le report/overlay.
7. UI PWA/Electron : HTTP 200 + refus métier n'est pas un succès ; statuts connus expiré/révoqué/suspendu/altéré/appareil conservent leur sens, inconnu neutre et bloquant. Dernier ajout : les refus d'activation Electron `LICENSE_REVOKED`, `LICENSE_EXPIRED`, `LICENSE_SUSPENDED`, `LICENSE_TAMPERED`, `DEVICE_REVOKED`, `HWID_MISMATCH` gardent leur statut exact jusque dans l'overlay, avec six tests dédiés.
8. Tests/outillage/docs : configuration Vitest ESM compatible, contrats adaptés sans changer les empreintes historiques de secrets, snapshot public Keygen immuable, README/variables/BOM TS corrigés ; BOM/CRLF Windows intentionnels conservés.

Ces corrections ne prouvent **aucune cause racine de l'incident en production**. Les hypothèses et leur falsification restent dans le journal. Pour chacune : « Cette hypothèse est compatible avec le code mais NON CONFIRMÉE sans accès aux logs de production / à la base de données. »

## Écarts ouverts et justification — aucun passage silencieux au vert

| Priorité / catégorie | Écart et preuves | Risque / justification de non-correction ici | Suite requise |
|---|---|---|---|
| P0 — H/I/J | Build, Prisma runtime, 79 fichiers de tests en échec ; rapport ci-dessus | Génération sans moteur uniquement utilisable pour typage. Pas d'environnement DB opérationnel certifié. Aucun contournement TLS ou masquage de tests. | CI propre avec accès moteurs, DB isolées SQLite/PostgreSQL, installation complète, globale, build et smoke API. |
| P0 — B/I | Autorité de signature non attestée ; contrôles clés SKIP | Une cohérence interne ne prouve pas l'accord avec l'émetteur ou les variables déployées. | Propriétaire des clés : fournir l'ancre publique/empreinte officielle via canal approprié, sans communiquer de clé privée ; contrôles de correspondance en environnement de build. Aucune rotation sans autorisation. |
| P0 — D/I/K | `revoke-by-key` fermé et contrôle reset volontairement bloquant | Rupture de l'ancien workflow Keygen/reset : rouvrir par secret partagé réintroduirait le risque. Pas de nouveau workflow admin fortement authentifié livré. | Concevoir/protéger/recetter le remplacement, mettre à jour les procédures avant promotion. Voir plan 03. |
| P0 — incident | Absence de logs bruts corrélés, JSON exact, états DB avant/après et SHA réellement déployé | Impossible de déterminer la cause réelle ou d'atteindre ≥90 %. | Collecte en lecture seule encadrée et expurgée. SQL production uniquement `BEGIN TRANSACTION READ ONLY; ... ROLLBACK;`. |
| P1 — E/G/I | `check:env-consistency` : 28 constats ; `scripts/config-{core,full,manager,rebuild}` et `scripts/lib/config-credentials.cjs`, `scripts/compromised-secrets.json`, `docs/CONFIG.md:330`, `.env.storage.example` | Le code d'import fournisseur reconnaît intentionnellement des alias, tandis que la garde les interdit aussi dans cet import et sa documentation. Remplacement textuel aveugle casserait l'import et/ou les preuves historiques de secrets. Aucune extension d'ignore ou désactivation de garde faite pour cacher cela. | Séparer contrat d'entrée fournisseur et configuration runtime canonique, concevoir le périmètre de la garde, tests d'import/export et non-persistance des alias ; ensuite régler chaque constat et régénérer les docs. |
| P1 — B/E | Scan gitleaks officiel/historique non exécuté ; outil absent, Git shallow | Les tests de politique des empreintes n'équivalent pas à un scan des secrets actuels et historiques. | CI avec historique complet + gitleaks/CodeQL/SAST ; remédiation/rotation uniquement après approbation humaine. |
| P1 — H/J | Migrations et sauvegardes de vrais postes/serveur non exercées | Contrôles statiques et template conformes, mais pas preuve de migration, restauration, isolation tenant ou atomicité/concurrence runtime. | DB isolée, jeux anonymisés, restauration éprouvée ; aucune migration production automatique. |
| P1 — A/K | Recette native Electron/PWA, cookies, droits admin/MFA, hors ligne, responsive/accessibilité non faite | Tests de fonctions et gardes de source ≠ parcours utilisateur réel. Ancienne grâce hors ligne non entièrement reconçue. | E2E + matrice rôles/statuts/réseau ; poste Windows empaqueté ; contrôle reprise après refus et expiration. |
| P1 — A–K | Revue sémantique générale incomplète : 164 routes et 2 302 fichiers initiaux | Ne pas confondre lecture UTF-8, inventaire ou tests avec audit exhaustif du métier. | Revue par domaines (stock/factures/planning/portail/IA), autorisations/IDOR, injections, performances, règles métier, intégrations et infra déployée. |
| P2 — E/H | 32 dépendances signalées obsolètes ; warnings npm, SQLite expérimental et `MODULE_TYPELESS_PACKAGE_JSON` sur migrations.ts | `npm audit` vert n'annule pas l'obsolescence. Migration générale vers ESM ou mises à niveau majeures risqueraient scripts CommonJS, Prisma, Electron et React. Aucun warning simplement supprimé. | Lots de maintenance compatibles et testés ; normaliser la frontière ESM de migrations sans basculer globalement `type:module` à l'aveugle. |
| P2 — C/F/G | Orthographe/copywriting de tout le produit, exactitude de 1 128 fichiers docs et conformité juridique des dépendances non certifiées | Encodage valide et présence des notices ne sont pas une relecture ou une licence juridique validée. | Relecture éditoriale, tri docs actives/historiques, SBOM/notices et validation juridique si nécessaire. |
| P2 — K | `PostesActives` masque silencieusement une panne de chargement appareils | Amélioration UX identifiée et non livrée ; ne pas confondre une liste vide avec disponibilité prouvée. | Ajouter état d'erreur neutre/retry, puis test rendu et recette. |

### Rollback et maîtrise du risque

Aucune correction n'est déployée. Le journal 03 détaille les plans par priorité. Les durées sont des propositions relatives, pas des engagements d'une équipe contactée. Avant toute promotion, faire valider les ruptures de contrat et le remplacement administratif. Un rollback de la fermeture admin, du fail-closed ou des gardes MAC réintroduirait des failles : préférer un correctif en avant et ne jamais réactiver automatiquement une voie non authentifiée. Ne pas retirer les tests pour faire passer la CI.

La collecte de preuves ne nécessite pas d'envoyer des secrets en chat. Request ID, timestamp UTC, codes HTTP/JSON expurgés, SHA d'artefact et attestations d'empreintes suffisent à organiser l'investigation ; toute consultation DB reste soumise aux contraintes de lecture seule.

## Checklist finale explicite — Done When

### Livré / vérifié localement

- [x] Rapport initial de compréhension et défauts rédigé avant correction applicative.
- [x] Inventaire des fichiers suivis et stack/architecture documentés, limites indiquées.
- [x] Journal de corrections et raisons, contrats HTTP, tableau de constats et plan P0/P1/P2.
- [x] Frontières sur six routes licence et treize routes sync, codes infra séparés des refus métier.
- [x] Cas Prisma `{ kind: Closed }` → `DB_UNAVAILABLE`, activation DB down fail-closed, secret/config manquants → `SERVER_MISCONFIGURED`, clé publique inutilisable distincte du jeton invalide, MAC invalide → `LICENSE_TAMPERED` testés.
- [x] HTTP 200 `allowed:false` reste un refus pour les clients ; fermeture admin testée indépendamment de flags et de l'environnement.
- [x] Traçage des points UI licence documenté ; tests ciblés de mapping PWA/report Electron/overlay et repli neutre.
- [x] 252 tests ciblés dont 117 incident, 364 tests Node, lint/type-check et diff-check passent.
- [x] Résultats en échec, SKIP, pending, avertissements et limites consignés sans certification trompeuse.
- [x] Aucune opération de production destructive ; aucune attribution de cause sans preuve.

### Toujours ouverts / bloquants selon le périmètre

- [ ] Installation propre **avec** scripts et génération Prisma runtime normale.
- [ ] Suite globale verte ; 79 fichiers échoués et 849 pending expliqués/résolus, sans désactivation pour améliorer les chiffres.
- [ ] Build production réussi, démarrage et smoke HTTP/API avec DB réelle isolée.
- [ ] Budget performance, E2E et packaging/signature Windows réussis.
- [ ] Cohérence env verte après résolution testée du contrat d'import fournisseur.
- [ ] Ancre publique attestée contre l'émetteur et vérifiée sur l'artefact de build ; aucun SKIP.
- [ ] Remplacement admin authentifié et procédures Keygen/reset validés.
- [ ] Scan secrets officiel sur historique complet et contrôles CI de sécurité exécutés.
- [ ] Restauration/sauvegardes et migrations éprouvées hors production, validation humaine avant tout changement production.
- [ ] Recette licence exhaustive PWA/Electron et toutes variantes UI, rôles, DB down, config invalide, refus et hors ligne.
- [ ] Audit métier/sécurité/UI/documentation/licences A–K réellement complet, écarts restants clos ou acceptés explicitement par les propriétaires.
- [ ] Incident : request ID / logs bruts expurgés / JSON / SHA / états DB corrélés ; hypothèses falsifiées, seuil ≥90 % démontré **ou maintien de la mention « non vérifiable sans accès production »**.
- [ ] Décision humaine de promotion, monitoring/alertes et rollback éprouvés.

## Résumé de clôture de cette passe

Le parcours sensible a été durci : les erreurs de service ne se présentent plus comme une révocation dans les cas corrigés/testés, une nouvelle activation ne repose plus sur une panne transformée en succès, les MAC sont vérifiés et la route administrative héritée est fermée. Les tests ciblés et statiques sont verts.

**La remise en état production n'est pas terminée.** Les preuves locales ne valident pas le runtime DB, le build, les déploiements, l'exhaustivité A–K ou la cause d'un incident externe. Tant que les cases bloquantes ne sont pas closes, le verdict reste **NO-GO production** ; pour la cause d'incident, **non vérifiable sans accès production**.
