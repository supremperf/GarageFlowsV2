'use strict'
// Deterministic inventory with explicit, manually maintained review notes.
// Reading/hash-enumerating a file does NOT grant it manual-review completion.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), cp = require('node:child_process')
const root = path.resolve(__dirname, '../../..')
const full = {
  '.github/workflows/ci.yml': ['Graphe des six prérequis, refus failure/cancelled/skipped, permissions, téléchargement/checksum Gitleaks, services isolés, Python hash-lock, cible de recette explicitement approuvée et paquet Windows. Aucun run distant ni protection de branche attestés.', ['008','009','015','016']],
  '.github/workflows/codeql.yml': ['Déclencheurs, requêtes security-extended, actions SHA et permission security-events limitée au job. Publier SARIF ne démontre pas une politique bloquant les alertes.', ['015']],
  '.gitleaks.toml': ['Extension des règles par défaut et liste des exemptions examinées ; exclusions intégrales de trois sources critiques supprimées. Exemptions fixtures/documentaires restantes et scan réel à vérifier.', ['009','020']],
  'package.json': ['Scripts lifecycle/build/dist et séquencement des contrôles, extraResources exacts, types/dépendances et overrides relus. Audit registry exécuté ; compatibilité native/SMTP et artefact Windows non prouvés.', ['001','006','014','018']],
  'electron/preload.js': ['Toutes les méthodes exposées et tous les abonnements relus ; neuf nettoyages removeAllListeners remplacés par retrait du seul handler. Événement Electron non transmis au renderer. Contrat testé sous EventEmitter, pas runtime Electron.', ['011','018','021']],
  'scripts/setup-dev.js': ['Création/maintien env, secret local, bootstrap DB et branche historique relus. Suppression récursive de prisma/prisma retirée ; aucune suppression de DB historique. Autres branches de bootstrap non toutes exercées.', ['001','010']],
  'scripts/lib/package-prisma-resources.cjs': ['Inspection SQLite en lecture seule, table names SQL échappés, rejet données applicatives/sources manquantes/sorties DB inattendues/liens et jonctions dans les parents. Sources non réinitialisées. Accès concurrent hostile au filesystem non couvert atomiquement.', ['006','019']],
  'scripts/lib/preserve-legacy-dev-db.cjs': ['Copie COPYFILE_EXCL, statuts ENOENT/EEXIST explicites, erreurs autres propagées, aucune suppression ni écrasement du DB canonique ou source.', ['010']],
  'scripts/materialize-build-public-key.cjs': ['SPKI/fingerprint, accord des deux ancres et référence, création exclusive wx, refus lien/type/mismatch. Ne signe rien, ne touche pas de clé privée et ne prouve pas l’identité externe de l’émetteur.', ['007']],
  'scripts/post-build.js': ['Toutes les étapes de copie, purge, présence serveur/public.pem, filtre DB et manifeste relues. Les copies/purges génériques restent distinctes du helper Prisma : certaines lectures best-effort et le scan initial de 4 KiB ne valent PAS inspection finale des artefacts.', ['006','007','013','018']],
  'src/lib/route-context.ts': ['Frontière Next 15 : params promis résolus, propriétés restantes préservées, rejection propagée ; tests des appels legacy/promis/rejet. Ne constitue pas un contrôle d’autorisation.', ['002']],
  'src/lib/api-helpers.ts': ['Session, licence DB, admin JWT/revalidation, rate limit et erreurs génériques relus. withAuth gère débit/erreurs mais requireSession reste une responsabilité des handlers : matrice des routes encore nécessaire.', ['002','005','007']],
  'src/lib/mechanic-api.ts': ['Session mécanicien revalidée, contexte tenant trusted, affectation + fenêtre de sync, no-store et journal best-effort relus. withMechanic seul ne remplace pas requireMechanic dans chaque route.', ['002','005']],
  'src/lib/portal/auth-helpers.ts': ['Cookie HttpOnly/SameSite, device-user binding, révocation/disabledAt, changement obligatoire mot de passe, contexte Promise et résolution garage unique relus. LastSeen best-effort ; dépendances crypto/chaque route non certifiées.', ['002','005']],
  'src/test-utils/prepare-test-db.ts': ['CLI local avec DATABASE_URL de test, cache de schéma, copies et nettoyage du test relus. stderr conservé à la place de ignore pour rendre la cause native visible. Ne remplace pas un moteur manquant.', ['002']],
  'src/test-utils/__tests__/prepare-test-db.test.ts': ['Les trois échecs de construction/réutilisation/remplacement et leur nettoyage examinés individuellement ; assertion statique restante validée. Aucun test rendu skip.', ['002']],
  'src/__tests__/integrity-diagnostics.test.ts': ['Fixtures A–G, I/O simulée explicitement distincte de l’artefact réel ; ancien faux pass sans artefact supprimé. Contrôle G obligatoire sous GF_REQUIRE_ARTIFACT_TEST=1, preuve négative exécutée, positive bloquée.', ['013']],
  'src/lib/license/__tests__/license-keygen-e2e.test.ts': ['Sept anciens retours sans assertion supprimés ; échec Python/sortie manquante explicite, répertoire de fixtures test-owned nettoyé. Vrai keygen Python + vérificateur Node exécutés avec clé publique éphémère injectée, pas avec l’autorité de production.', ['012','007']],
  'src/lib/license/__tests__/forgery-resistance.test.ts': ['Tests et conditions de clé relus. La clé dite sortante est générée aléatoirement pour une simulation ; ne pas la confondre avec une preuve utilisant une ancienne clé réellement compromise. Cinq cas émetteurs et une comparaison externe non exécutés.', ['007']],
  'src/lib/__tests__/route-context.test.ts': ['Trois tests : params Promise, compatibilité legacy/propriétés, rejet. Aucun mock de Prisma ni preuve de contrôle multi-tenant réel.', ['002']],
  'src/lib/__tests__/ui-lossless-compaction.test.ts': ['Empreinte JSON de toutes les valeurs/clefs, 562 entrées et quatorze langues vérifiées ; comparaison aux traductions fusionnées. Contrôle sans perte, pas une recette visuelle/langagière humaine complète.', ['004']],
  'src/lib/__tests__/i18n-rtl.test.ts': ['Quatre tests DOM-stub lang/dir, restauration globale et cas inconnu relus ; ne sont pas un rendu Chromium/Safari réel.', ['004']],
  'src/lib/__tests__/toolchain-node-version.test.ts': ['Trois contrôles majeur Node CI/package/runtime et disponibilité node:sqlite. Ne valide ni Electron embarqué ni la version effective d’une instance distante.', ['018']],
  'tests/package-prisma-resources.test.cjs': ['Sept cas réels filesystem/node:sqlite, source/données préservées, filtre exact et deux jonctions refusées. Fixtures temporaires possédées par les tests seulement.', ['006','019']],
  'tests/build-public-key.test.cjs': ['Trois cas : création publique seule/idempotence, mismatch préservé, ancres discordantes refusées. Clés synthétiques éphémères : pas attestation de l’émetteur réel.', ['007']],
  'tests/ci-required-gate.test.cjs': ['Bash réel : succès puis 18 combinaisons failure/cancelled/skipped ; graphe/SHA/politique contrôlés ; validateur staging testé avec entrées synthétiques, sans requête distante.', ['008','016']],
  'tests/preload-listeners.test.cjs': ['Neuf tests du source preload en VM avec pont simulé et vrai EventEmitter ; désabonnement répété, conservation de l’autre abonné et suppression finale. Pas un lancement Electron.', ['011']],
  'tests/preserve-legacy-dev-db.test.cjs': ['Quatre cas SQLite/FS réels dont exécution du vrai bootstrap dans un répertoire temporaire ; deux DB distinctes et fichier tiers restent identiques.', ['010']],
  'tests/secret-scan-policy.test.cjs': ['Régression de politique : règles par défaut gardées et aucune exemption globale des trois fichiers critiques. Parse ciblé, pas exécution Gitleaks.', ['020']],
  'tests/fixtures/ui-content-sha256.json': ['Référence avant transformation : SHA-256 du JSON, 562 clés et ordre des quatorze langues ; correspondance exacte exercée par Vitest.', ['004']],
  'vitest.config.ts': ['Include source TS/spec, environnement Node, timeout de hook inchangé et couverture V8 relus. Les fichiers tests/*.cjs sont exécutés séparément par Node.', ['002']],
  'playwright.config.ts': ['Six projets Chromium, serveur dev, session globale et reports relus. Gabarits Apple ne sont pas WebKit réel ; parcours authentifiés nécessitent compte/licence ; des specs utilisent des réponses de fixtures.', ['003','016']],
}
const partial = {
  'electron/main.js': { ranges: [[2910,3100],[3190,3485]], note: 'Fenêtres/activation/confinement/navigation et début IPC seulement. Pas de validation explicite senderFrame observée dans ces handlers ; confinement principal présent. Exploitabilité et politique IPC restent à examiner.', issues: ['005','018','021'] },
  'src/lib/i18n/ui.ts': { ranges: [[1,30]], note: 'Helper de représentation et transformation AST comparés ; digest de la totalité vérifié. Les 562 textes ×14 langues n’ont PAS été relus sémantiquement un par un.', issues: ['004','005'] },
  'scripts/garageflow-env-manifest.json': { ranges: [], note: 'Deux nouvelles variables E2E déclarées test-only/non-autoManage ; autres entrées conservées dans leur ordre, pas revue intégrale de tout le manifeste.', issues: ['008','016'] },
  'ENVIRONMENT-VARIABLES.md': { ranges: [], note: 'Régénération canonique des métadonnées sans valeurs, contrôle de cohérence exécuté ; pas revue sémantique exhaustive des autres variables.', issues: ['005'] },
  'package-lock.json': { ranges: [], note: 'Résolution/installation JS/audit/ls complets automatisés. Pas une lecture humaine exhaustive des milliers de lignes ni preuve native.', issues: ['001','014','018'] },
  'prisma/garageflow-template.db': { ranges: [], note: 'Copie réelle, quick_check, 43 tables applicatives sans lignes, source SHA identique avant/après. Ni revue binaire manuelle exhaustive ni Prisma runtime.', issues: ['006'] },
  'tests/requirements-keygen.txt': { ranges: [], note: 'Trois versions choisies et provenance PyPI examinées ; 161 hashes collectés automatiquement. Installation wheels réellement contrôlée --require-hashes, pas audit humain individuel de chaque distribution.', issues: ['012'] },
  'src/components/WorkOrderModal.tsx': { ranges: [[1,105]], note: 'Début du composant/signature seulement. getContext(2d)! suppose un contexte non nul : comportement navigateur en échec de contexte non validé.', issues: ['005','003'] },
  'scripts/check-artifact-fuses.mjs': { ranges: [[1,65]], note: 'Préconditions et décodage observés ; absence locale annonce NON EXÉCUTÉ mais exit0. Inspection réelle requise après dist ; pas contrôle effectif local.', issues: ['013','018'] },
  'scripts/check-artifact-secrets.mjs': { ranges: [[1,55]], note: 'Règles de nom/marqueurs et collecte de valeurs observées seulement ; inspection sur paquet réel non atteinte.', issues: ['009','018'] },
  'scripts/verify-artifact.mjs': { ranges: [[1,95]], note: 'Identité/version/env et mode repository examinés en partie ; source lu ne vaut pas contrôle d’un paquet produit.', issues: ['018'] },
}
const owned = 'docs/audit/followup-2026-10-14/'
const excluded = new Set(['docs/audit/inventory.jsonl','docs/audit/inventory-current.jsonl','docs/audit/module-map.jsonl','docs/audit/scope.json'])
const entries = cp.execFileSync('git', ['ls-files','-c','-o','--exclude-standard','-z'], { cwd: root }).toString().split('\0').filter(Boolean).filter(name => !name.startsWith(owned) && !excluded.has(name)).sort()
const { readGitEntry } = require(path.join(root, 'scripts/lib/file-snapshot.cjs'))
const rows = []
for (const name of [...new Set(entries)]) {
  const file = path.join(root, name); let bytes
  try { bytes = readGitEntry(file) } catch (error) { if (['ENOENT', 'EISDIR'].includes(error.code)) continue; throw error }
  const info = full[name], part = partial[name]
  const critical = /^(electron\/|prisma\/|src\/middleware|src\/app\/api\/|src\/lib\/(auth|db|env|security|license|portal|money|sync)|scripts\/(config|restore|.*migrat|.*release|afterPack|fuse))/.test(name)
  rows.push({ order: 0, path: name, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, automaticInventory: true,
    priority: critical ? 'P0' : name.startsWith('src/') || name.startsWith('scripts/') ? 'P1' : 'P2',
    manualReview: { status: info ? 'VALIDÉ' : part ? 'PARTIELLEMENT VALIDÉ' : 'EN ATTENTE DE REVUE', fullFileRead: !!info, ranges: info ? [[1, bytes.toString().split('\n').length - (bytes.at(-1) === 10 ? 1 : 0)]] : part?.ranges || [], notes: info?.[0] || part?.note || 'Inventorié uniquement dans ce suivi : revue sémantique complète et dépendances/permissions/flux encore à effectuer.' },
    issueIds: (info?.[1] || part?.issues || ['005']).map(id => `FUP-20261014-${id}`),
    runtimeValidation: { status: info || part ? 'PARTIELLEMENT VALIDÉ' : 'NON EXÉCUTÉ', note: 'Voir la matrice et les preuves ciblées. Une revue complète du source n’est pas une validation fonctionnelle complète.' },
  })
}
rows.sort((a,b) => a.priority.localeCompare(b.priority) || a.path.localeCompare(b.path, 'en'))
rows.forEach((row,index) => { row.order = index + 1 })
const totals = Object.fromEntries(['VALIDÉ','PARTIELLEMENT VALIDÉ','EN ATTENTE DE REVUE'].map(status => [status, rows.filter(r => r.manualReview.status === status).length]))
fs.writeFileSync(path.join(__dirname, 'review-ledger.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n')
fs.writeFileSync(path.join(__dirname, 'review-progress.json'), JSON.stringify({ date: '2026-10-14', branch: cp.execFileSync('git',['branch','--show-current'],{cwd:root}).toString().trim(), total: rows.length, manualReview: totals, nextBatch: rows.filter(r=>!r.manualReview.fullFileRead).slice(0,12).map(r=>({order:r.order,path:r.path,sha256:r.sha256,priority:r.priority})), exclusions: ['Git internal metadata and ignored dependencies/runtime/generated/private configuration (git ls-files --exclude-standard)', owned, ...excluded], limitation: 'Coverage is explicit SOURCE-reading progress only. No inferred certification from inventory, AST, test counts or digests; prior targeted work without durable per-file attestation remains pending here.' }, null, 2) + '\n')
console.log(JSON.stringify({ total: rows.length, manualReview: totals }, null, 2))
