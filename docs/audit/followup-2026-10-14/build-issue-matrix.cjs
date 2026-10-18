'use strict'
const fs = require('node:fs'), path = require('node:path')
const issues = []
function add(n, title, status, priority, cause, correction, validation, evidence, remaining, confidence = 'ÉLEVÉE sur la cause immédiate observée ; pas sur les chemins non exécutés') {
  issues.push({ id: `FUP-20261014-${String(n).padStart(3,'0')}`, requirement: title, status, priority, rootCause: cause, correction, validatingTest: validation, evidence, remaining, confidence })
}
add(1, 'B1 — Installation normale et natifs reproductibles', 'BLOQUÉ', 'P0',
  'Sur snapshot propre sans dépendances/caches/env locaux : npm ci normal termine 1 dans electron@41.10.6/install.js (fetch failed). Génération Prisma échoue sur récupération officielle du checksum, avant chargement du moteur.',
  'Installation JS diagnostique conservée distincte ; vraie installation normale tentée dans copie isolée, sans désactivation TLS ni faux moteur.',
  'npm ci --foreground-scripts --no-fund avec npm 11.16.0 : 1 ; clients normaux non validés.',
  ['evidence/normal-ci.log','evidence/normal-ci.exit','evidence/clean-install-source.json','evidence/native-results.json','evidence/prisma-generate.log'],
  'Autoriser chaîne de téléchargement officielle complète et intégrité ; refaire npm ci normal puis les deux prisma generate. Les changements postérieurs test/docs/CI ne constituent pas une seconde installation normale validée.')
add(2, 'B2 — Suite Vitest entière sans échec ni non-exécution critique', 'ÉCHOUÉ', 'P0',
  '3 assertions de prepare-test-db échouent sur db push ; 76 fichiers ont le même échec de préparation réseau, 1 autre échoue au chargement Query Engine. 808 corps non exécutés après hook ; 4 rejets Prisma non gérés.',
  'stderr du CLI conservé (pipe au lieu de ignore) ; reproduction complète et inventaire individuel, aucune assertion remplacée par skip ni faux ORM.',
  'Confirmation : 2895 passed / 3 failed / 844 skipped, 78 fichiers échoués et 4 erreurs, exit1. 36 skips déclarés sont séparés des 808 empêchés par setup.',
  ['evidence/vitest-latest.json','evidence/vitest-latest.log','tests-failed.jsonl','tests-skipped.jsonl','tests-setup-errors.jsonl','tests-unhandled-errors.jsonl'],
  'Rejouer les 3 cas et les 77 fichiers après installation des vrais moteurs ; diagnostiquer les échecs métier éventuellement révélés, sans supposer que le réseau explique tout comportement futur.')
add(3, 'B3 — Chromium officiel et E2E réels', 'BLOQUÉ', 'P0',
  'Installer officiel échoue TLS/ECONNRESET ; exécutable chromium_headless_shell-1234 absent.',
  'Vrai serveur Next de test lancé sans bootstrap secret local ; vraie commande Playwright sur copie SQLite de test, six projets, sans mock ajouté au harness.',
  '144 cas : 0 passé, 54 failed avant browser launch, 90 skipped faute fixtures authentifiées ; exit1. Serveur arrêté par le runner.',
  ['evidence/chromium-system-ca.log','evidence/e2e.json','evidence/e2e.log','tests-e2e.jsonl','playwright-attempt.config.ts'],
  'Installer Chromium et dépendances depuis sources officielles vérifiées, rejouer le harness puis les parcours authentifiés isolés. Aucun rendu fonctionnel n’est validé.')
add(4, 'B4 — Budget JS inchangé', 'RÉSOLU', 'P0',
  'JS émis initial 3632537 octets, plafond 3625984 : dépassement de 6553 ; duplication syntaxique des noms de 14 langues dans 562 objets UI.',
  'Représentation row à 14 paramètres typés et uniform pour deux valeurs identiques ; aucune chaîne/clé/langue supprimée.',
  'JS réel émis 3609457, gain23080, marge16527 ; budget après exit0. Empreinte JSON avant/après strictement identique et deux régressions Vitest passent.',
  ['evidence/budget-before.log','evidence/budget-after.log','evidence/bundle.json','evidence/next-before.log','evidence/next-after.log','../../../tests/fixtures/ui-content-sha256.json'],
  'Résolution bornée à la mesure comparative réelle. Les deux builds Next directs contiennent une erreur Prisma malgré exit0 ; standard build/dist toujours non validés. Le serveur dev E2E a ensuite réutilisé .next : refaire une mesure sur build standard neuf avant livraison.')
add(5, 'B5 — Revue sémantique exhaustive et durable par fichier', 'PARTIELLEMENT VALIDÉ', 'P0',
  'L’inventaire/AST précédent ne certifiait aucune revue humaine complète ; taille du dépôt et dépendances de sécurité non toutes examinées.',
  'Registre déterministe avec SHA, priorité, plages effectivement lues, notes manuelles et prochain lot ; aucun statut manuel inféré automatiquement.',
  '1243 fichiers : 32 revus intégralement comme sources, 11 partiellement, 1200 en attente. Les schémas 43/47 modèles et la matrice des 164 routes restent incomplets.',
  ['review-ledger.jsonl','review-progress.json','build-review-ledger.cjs'],
  'Continuer P0 puis P1/P2, contrôler le SHA avant reprise et relire si changement. Full source reading ne vaut pas validation fonctionnelle ou absence de défauts.')
add(6, 'Paquet Prisma sans DB locale/client ni reset destructeur', 'RÉSOLU', 'P0',
  'Ancien fallback du post-build pouvait utiliser une DB locale ; extraResources Prisma trop large et erreurs de manifeste masquées.',
  'Schéma + seul modèle exact, lecture SQLite read-only et refus des lignes applicatives, DB de sortie inattendue et erreur de manifeste propagée. Aucun reset ni suppression de source.',
  '7 tests packaging passent ; copie du modèle réellement commité vérifiée, 43 tables applicatives vides et SHA source inchangé.',
  ['evidence/package-tests.log','evidence/release-safety.log','evidence/real-template-copy.json'],
  'Ne certifie pas le paquet Windows complet ou les autres copies génériques ; voir 013/018/019.')
add(7, 'Authenticité indépendante de l’autorité de licence', 'BLOQUÉ', 'P0',
  '2 comparaisons publiques, 5 cas nécessitant la clé émettrice et 2 cas nécessitant un jeton émis sont déclarés skipped ; keys/public.pem reste absent.',
  'Outil de restauration publique seule depuis trois ancres déjà épinglées : wx, refus overwrite/mismatch/liens, aucune création de clé privée. Non exécuté dans les vrais keys/.',
  '3 tests de fixtures passent ; cohérence interne existante passe. Ce n’est PAS une authentification indépendante de l’émetteur.',
  ['evidence/public-key-tests.log','evidence/consistency.log','tests-skipped.jsonl','evidence/release-safety.log'],
  'Sur poste autorisé, attester empreinte/clé publique externe et exécuter cas nécessitant signature/jeton sans copier la clé privée dans CI/chat/dépôt. Aucune rotation effectuée.')
add(8, 'CI effectivement obligatoire', 'PARTIELLEMENT VALIDÉ', 'P0',
  'Absence de preuve d’exécution des nouveaux workflows ou de leur caractère requis ; lecture protection main renvoie403, rulesets [].',
  'Actions SHA, permissions read, checksum Gitleaks, SQLite URL corrigée, Python hash-lock, paquet Windows, E2E authentifié staging et agrégat always strict à six prérequis.',
  'Bash réel accepte 1 succès et refuse 18 combinaisons failure/cancelled/skipped ; graphe/YAML et validateur staging testés. Ce sont des tests locaux de configuration.',
  ['evidence/release-safety.log','evidence/action-refs.json','evidence/branch-protection.json','evidence/branch-protection.err','evidence/rulesets.json'],
  'Après autorisation de publication de la branche : exécuter la CI, configurer/attester la protection exigeant Required validation et examiner les logs. Aucun réglage distant modifié.')
add(9, 'Scan de secrets officiel complet', 'BLOQUÉ', 'P0',
  'Téléchargement des checksums Gitleaks officiel redirigé sur release-assets.githubusercontent.com et échoue curl35 ; scanner absent.',
  'CI vérifie checksum officiel strict avant extraction ; aucune exécution de binaire non vérifié. Exemptions de sources critiques resserrées en020.',
  'Téléchargement exit35 ; aucun résultat de scan local. Tests de politique seulement.',
  ['evidence/gitleaks-download.log','evidence/available-tools.json','evidence/release-safety.log'],
  'Récupérer binaire et checksum officiels avec TLS/intégrité, exécuter gitleaks dir avec redaction et traiter chaque résultat. Ne pas déduire zéro secret du seul YAML.')
add(10, 'Bootstrap ne supprimant jamais une DB historique distincte', 'RÉSOLU', 'P0',
  'setup-dev copiait exclusivement, avalait EEXIST puis supprimait récursivement prisma/prisma, détruisant DB historique et fichiers tiers même avec DB canonique existante.',
  'Copie exclusive non destructive ; source et répertoire toujours conservés ; aucune suppression ni écrasement de l’existant.',
  'Reproduction originale exit0 détruit les deux fichiers historiques. Quatre tests passent, dont vrai setup-dev en fixture avec deux vraies DB SQLite différentes et contrôle octet par octet.',
  ['evidence/legacy-bootstrap-before.json','evidence/release-safety.log'],
  'Réconciliation de doublons laissée à une inspection autorisée, jamais effectuée automatiquement.')
add(11, 'Désabonnement IPC isolé par composant', 'RÉSOLU', 'P1',
  'Neuf callbacks de cleanup appelaient removeAllListeners(channel), retirant aussi les abonnements des autres composants.',
  'Chaque closure conserve son handler et appelle removeListener(channel,handler). API publique inchangée.',
  'Neuf tests échouent avant ; neuf passent après, avec double désabonnement et conservation du second abonné.',
  ['evidence/preload-before.log','evidence/release-safety.log'],
  'Preuve unitaire du bridge en VM/EventEmitter ; fumée Electron native encore requise en018.')
add(12, 'Sept tests keygen ne doivent pas réussir sans assertions', 'RÉSOLU', 'P0',
  'Cryptography absent : beforeAll renvoyait fixtures=null puis sept corps revenaient sans assertion et étaient comptés passed.',
  'Absence/erreur Python ou fixture fait échouer le hook ; retours vides supprimés ; dépendances officielles verrouillées avec161 SHA PyPI, installation isolée vérifiée.',
  'Absence Python/cryptography : exit1 ; environnement isolé réel : sept cas passent avec keygen_core.py officiel + vérificateur Node, sans clé de production.',
  ['evidence/keygen-missing-negative.log','evidence/python-install.log','evidence/python-dependencies.json','evidence/keygen-integrity.log','evidence/vitest-latest.json'],
  'Clé publique éphémère injectée dans le vérificateur pour cette preuve cross-language ; l’autorité réelle demeure007. Provisionnement Python3.12 en CI configuré, pas exécuté.')
add(13, 'Test d’intégrité réel non vert sans paquet', 'PARTIELLEMENT VALIDÉ', 'P0',
  'Le cas G retournait silencieusement et passait sans dist/win-unpacked/resources.',
  'Absence explicitement comptée skipped en local ; job Windows obligatoire impose GF_REQUIRE_ARTIFACT_TEST=1 et exécute la vérification après dist, sans skip possible sur absence.',
  'Contrôle obligatoire sans artefact : exit1 (11 autres cas passent). Contrôle local : 11 passent et1skip ; aucun échec rendu skip pour masquer un défaut.',
  ['evidence/artifact-required-negative.log','evidence/keygen-integrity.log','evidence/release-safety.log'],
  'Preuve positive sur resources réels et inspection binaire non exécutées puisque dist est bloqué. Le skip supplémentaire explique 844 contre843 antérieurs.')
add(14, 'Zéro vulnérabilité npm à tous niveaux', 'VALIDÉ', 'P0',
  'Dépendances initialement vulnérables et politiques partielles corrigées dans la campagne antérieure ; registre réellement joignable pour les mesures présentes.',
  'Dépendances/fork borné et politique complète conservés ; nouvelle mesure pinned npm11.16.0, ls complet et audit strict.',
  'npm audit JSON : info/low/moderate/high/critical/total tous0, exit0 ; npm ls exit0 ; neuf tests sécurité passent.',
  ['evidence/npm-audit.json','evidence/npm-ls.log','evidence/audit-strict.log','evidence/security.log'],
  'Résultat scanner daté, pas garantie universelle. Fork braces nécessite suivi explicite de l’advisory upstream ; natifs et compatibilité SMTP ne sont pas validés par npm audit.')
add(15, 'SAST/CodeQL et blocage réel des alertes', 'BLOQUÉ', 'P0',
  'API code-scanning/alerts renvoie403 Resource not accessible by integration ; analyse configurée ne prouve ni absence d’alertes ni refus de fusion.',
  'Actions CodeQL épinglées, permissions minimales conservées, commentaire de prétendue clôture corrigé.',
  'Lecture seule403 ; aucun résultat SAST ni seuil distant bloquant attesté.',
  ['evidence/codeql-alerts.json','evidence/codeql-alerts.err','evidence/action-refs.json'],
  'Obtenir permissions de lecture nécessaires, exécuter CodeQL, traiter alertes et vérifier politique bloquant les niveaux requis. Ne pas confondre succès de publication SARIF et zéro alerte.')
add(16, 'Parcours navigateur authentifiés sans test de production', 'BLOQUÉ', 'P0',
  '90 cas E2E ignorés faute E2E_EMAIL/PASSWORD/LICENSE ; ancienne CI publique seule n’apportait aucune preuve authentifiée.',
  'Job obligatoire e2e-authenticated : environnement e2e-staging, entrées requises, HTTPS, refus URL credentials et quatre hôtes de production connus (y compris trailing dot), attestation non-production explicite ; pas upload des tokens/traces.',
  'Validateur Bash/Node local positif synthétique et13 refus passent ; aucune requête distante dans ces tests. Aucun parcours authentifié réel n’est validé.',
  ['tests-e2e.jsonl','evidence/e2e.json','evidence/release-safety.log','../../../scripts/garageflow-env-manifest.json'],
  'Configurer après autorisation environnement protégé et fixtures synthétiques sur backend réellement isolé. Le booléen E2E_NON_PRODUCTION ne prouve pas l’isolation du backend. Certaines specs simulent des API : ne pas y voir preuve transactionnelle intégrale.')
add(17, 'PostgreSQL/Redis réels isolés', 'BLOQUÉ', 'P0',
  'Pas de PostgreSQL/Redis/Docker exécutables disponibles ; variables de test absentes : 21 cas PG et5 Redis déclarés skipped.',
  'Aucun remplacement par mocks ni connexion à une DB productive ; services CI conservés et conditions inventoriées individuellement.',
  'Découverte des exécutables et JSON Vitest ; aucune migration/concurrence PG/Redis réellement exécutée localement.',
  ['evidence/available-tools.json','tests-skipped.jsonl'],
  'Provisionner services jetables avec droits minimaux nécessaires aux tests ; lancer migrations vides puis tests multi-instance, conserver résultats réels.')
add(18, 'Build/dist/compatibilité native et services externes', 'BLOQUÉ', 'P0',
  'Build et dist normaux s’arrêtent sur prisma generate avant Next/post-build/builder. Aucun paquet réel ; Electron41/fuses/Windows/SMTP et flux externes non éprouvés.',
  'Commandes build et dist existantes réellement tentées, contrôles d’artefact obligatoires maintenus, candidat Windows ajouté sans publication/signature privée.',
  'npm run build exit1 et npm run dist exit1. Les deux Next directs exit0 avec erreur native ne sont pas une preuve lifecycle normale.',
  ['evidence/normal-build.log','evidence/normal-build.exit','evidence/normal-dist.log','evidence/normal-dist.exit','evidence/next-after.log'],
  'Après001 : build/dist Windows, inspecter secrets/fuses/intégrité/manifeste/DB puis lancement/sauvegarde/migrations/proxy/MAJ. Recettes SMTP/IA/licences/configuration fournisseurs seulement avec accès autorisé non productif.')
add(19, 'Copie Prisma ne suivant pas les jonctions de sortie/source', 'RÉSOLU', 'P0',
  'lstat sur les seuls fichiers sources ne refusait pas un parent/jonction de source ou destination ; copyFileSync pouvait écraser un fichier tiers via une jonction de sortie.',
  'Inspection de chaque composant existant de chaque chemin source/destination ; refus des liens/jonctions avant lecture/copie.',
  'Deux régressions réelles junction échouent avant ; sept tests packaging passent après. Fichier tiers cible et bytes DB restent intacts.',
  ['evidence/packaging-links-before.log','evidence/release-safety.log','evidence/real-template-copy.json'],
  'Pas de garantie atomique contre un utilisateur hostile modifiant le filesystem simultanément ; le workspace de build doit rester contrôlé.')
add(20, 'Éviter les exclusions intégrales des sources de sécurité', 'PARTIELLEMENT VALIDÉ', 'P1',
  'Allowlist Gitleaks excluait en entier auth-secret.ts, health/route.ts et .*public-key.ts alors que seuls quelques littéraux publics/faibles étaient justifiés.',
  'Trois exemptions de chemin retirées ; regexes de littéraux connues et règles par défaut conservées.',
  'Test de politique passe dans les27 Node tests ; scanner officiel non exécuté (009), faux positifs éventuels à traiter précisément.',
  ['evidence/release-safety.log'],
  'Exécuter scanner réel et traiter chaque alerte sans réintroduire d’exclusion globale. Exemptions résiduelles fixtures/doc restent explicites, pas certification zéro secret.')
add(21, 'Politique d’autorisation des appelants IPC Electron', 'EN ATTENTE DE REVUE', 'P1',
  'Dans les portions IPC lues, pas de validation explicite senderFrame observée. Confinement de navigation principal présent ; exploitabilité non démontrée.',
  'Observation enregistrée sans transformer une hypothèse de durcissement en vulnérabilité démontrée ; aucun changement global risqué des canaux sans revue du reste du main.',
  'Revue partielle des lignes2910–3100 et3190–3485 ; aucune preuve native d’appel cross-frame/origine.',
  ['review-ledger.jsonl'],
  'Revoir tous producteurs/consommateurs, fenêtres licence/repli et frames ; définir politique de confiance, ajouter tests refus/acceptation puis valider sous Electron réel.',
  'ÉLEVÉE sur l’absence de contrôle explicite dans les portions lues ; FAIBLE sur l’exploitabilité tant que la revue complète manque')
const initialProofs = {
  2: 'evidence/vitest.json', 3: 'evidence/chromium-install.log', 5: '../scope.json',
  6: 'evidence/packaging-before-source.txt', 7: 'evidence/vitest.json',
  8: 'evidence/branch-protection.json', 12: 'evidence/vitest-final.log', 13: 'evidence/vitest-final.log',
  14: '../evidence/npm-before.json', 16: 'evidence/e2e.json', 17: 'evidence/vitest.json',
  20: 'evidence/gitleaks-policy-before.toml', 21: '../../../electron/main.js',
}
for (const issue of issues) {
  issue.initialProof = initialProofs[Number(issue.id.slice(-3))] || issue.evidence[0]
  issue.supportingEvidence = issue.evidence
  issue.contraryOrLimitingEvidence = issue.remaining
}
fs.writeFileSync(path.join(__dirname, 'issue-matrix.json'), JSON.stringify(issues, null, 2) + '\n')
const lines = ['<!-- doc-numbers: journal -->','', '# Matrice de suivi — 14 octobre 2026','', 'IDs uniques stables ; preuve de code/test/configuration séparée de la preuve fonctionnelle distante. Les statuts portent sur l’exigence bornée décrite, pas sur toute la production.','', '| ID | Exigence | Statut | Cause / correction | Validation et limite |', '|---|---|---|---|---|']
for (const i of issues) lines.push(`| ${i.id} | ${i.requirement} | **${i.status}** | Preuve initiale : [${i.initialProof}](${i.initialProof}). ${i.rootCause} **Correction :** ${i.correction} | ${i.validatingTest} **Reste :** ${i.remaining} Preuves : ${i.evidence.map(e=>`[${e}](${e})`).join(', ')} |`)
fs.writeFileSync(path.join(__dirname, 'ISSUE-MATRIX.md'), lines.join('\n') + '\n')
console.log(`${issues.length} issues written`)
