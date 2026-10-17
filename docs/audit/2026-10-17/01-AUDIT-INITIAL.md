# Audit GarageFlows — état initial du 17 octobre 2026

Référence : aa90f89c059db58a4a3fe3c339a2dffbfbf10fad. Branche arena/55edbdc1-garageflowsv2.
Rapport écrit avant toute correction applicative. Aucun accès production, déploiement, rotation ou migration exécuté. Les rapports antérieurs ne valent pas preuve d'exécution actuelle.

## Phase 0 : compréhension

Inventaire de 2 302 fichiers suivis : racine 47, .github 3, artifacts 1, docs 1 128, e2e 6, electron 24, prisma 30, public 10, scripts 125, src 888, tests 28, vendor 12. Lecture binaire/UTF-8 de tous les fichiers ; 2 292 fichiers textuels UTF-8. Ce recensement n'est PAS une revue sémantique exhaustive. 164 routes API, 364 fichiers test/spec identifiés.

Stack : Node 22 (ici 22.22.3), npm (ici 10.9.8), TypeScript strict, Next 15.5.27 App Router, React 18, Tailwind, Zustand, Electron 41, Prisma 5.16+, SQLite local / PostgreSQL serveur. Vitest, Playwright, tests Node/Python, ESLint, CI GitHub Actions / CodeQL / packaging Windows. Pas de conteneur Docker identifié (absence non assimilée à une panne).

Architecture hybride : Electron main/preload → Next local → services src/lib → Prisma SQLite. Cloud/PWA → Next → services → Prisma PostgreSQL. Licence GF2 ES256, session HS256, intégrité HMAC, appareils/sièges. Synchronisation poste/cloud authentifiée par licence garage. Intégrations configurables : Neon, Vercel, Upstash, Blob, SMTP, Anthropic et fournisseurs métier.

Fonctions présentes dans le code : planning/interventions, clients/véhicules, devis/factures, stock, portail client, mécaniciens, sauvegarde, facturation électronique, IA. Aucune certification fonctionnelle implicite.

Configurations : package.json et package-lock.json ; next.config.mjs ; tsconfig*.json ; .eslintrc.json ; vitest.config.ts ; playwright.config.ts ; tailwind.config.ts ; postcss.config.js ; perf-budget.json ; deux schémas et migrations Prisma ; .env.example et .env.storage.example ; .github/dependabot.yml et workflows ci.yml/codeql.yml ; .gitignore/.gitattributes/.gitleaks*/.semgrepignore/.vercelignore ; manifeste scripts/garageflow-env-manifest.json ; config Electron Builder dans package.json. LICENSE propriétaire cohérent avec UNLICENSED ; notices présentes, validation juridique externe non réalisée.

## Phase 1/2 — constats confirmés par lecture (lignes de la référence initiale)

| ID | Catégorie / gravité | Fichiers et lignes | Description et impact | Solution proposée |
|---|---|---|---|---|
| INC-01 | D/H 🔴 | src/app/api/license/check/route.ts:73-112 ; status/route.ts:87-115 ; src/app/api/sync/portal/route.ts:53-78 (et autres sync) | Check/status retournent des refus métier en HTTP 200, sync utilise 403. Un client se fiant à HTTP seul peut ignorer un refus. | Conserver le contrat historique de heartbeat, le documenter/tester ; distinguer infra 500/503 et autorisation sync 403. |
| INC-02 | B/I 🔴 | scripts/reset-garageflow.ps1:1607-1788 | Ensure-LicenseActivationDiagnostics réécrit le code : stacks brutes, indicateurs secrets, lid en clair, contournement du fail-closed Upstash. Le script peut annuler la sécurité du dépôt au déploiement. | Supprimer l'injection ; no-op explicite ; garde de non-régression. |
| INC-03 | A/B/D 🔴 | src/app/api/license/activate/route.ts:113-122, 225-228, 464-474, 543-550 | DB indisponible Electron continue ou devient clé mécanicien non attribuée ; erreur appareil ignorée Electron. Session possible sans contrôles réussis. | Fail-closed commun Electron/PWA, appareil obligatoire hors exemption admin existante ; tests DB/appareil/siège. |
| INC-04 | A/D 🔴 | src/lib/license/verify.ts:130-150 ; src/lib/sync/garage-auth.ts:131-142 ; src/app/api/sync/*/route.ts | Clé publique mal configurée classée licence invalide ; authentification DB en dehors des try des handlers sync ; codes génériques hétérogènes. | Erreur de configuration typée, frontière commune pour chaque handler ; DB indisponible 503 DB_UNAVAILABLE, configuration 500 SERVER_MISCONFIGURED, erreur technique inconnue 500 INTERNAL_ERROR. |
| INC-05 | B/D 🟠 | src/app/api/admin/licenses/revoke-by-key/route.ts:34-70, 104-113, fin du fichier | Route activée sans flag, clé partagée seule, fail-closed du limiteur ignoré, audit incomplet/best-effort, 200 no-op ambigu. | Désactiver par défaut ; ne pas réactiver sans authentification forte conçue/validée ; supprimer le contrôle partagé et les écritures de ce point d'entrée tant que fermé. Réactivation à traiter comme développement séparé, pas par simple flag. |
| INC-06 | A/K 🟡 | src/components/LicenseRevokedOverlay.tsx:76,143,200 ; electron/heartbeat-policy.js:64 | Statut manquant/inconnu/expired/device_revoked rendu « Compte révoqué ». | Table explicite et repli neutre ; infra jamais présentée comme révocation. |
| INC-07 | A/B/D 🔴 | src/app/api/license/activate/route.ts:139,356-364 ; src/lib/sync/garage-auth.ts:140-146 | MAC invalide renvoyé LICENSE_INVALID à l'activation ; sync n'examine pas le MAC avant d'autoriser. | LICENSE_TAMPERED distinct, vérification MAC sync ; préserver le traitement de configuration manquante comme infra. |
| INC-08 | A/D/K 🔴 | electron/main.js:1817-1844 ; electron/activation-report.js:62-68 | Tout ok:false traité comme refus métier ; JSON infra sans ok:false peut autoriser repli local. Message Appareil non enregistré pour panne. | Classification pure testable, aucune activation locale de repli après absence/refus/erreur distante ; infra overlay neutre. |
| INC-09 | A/D 🔴 | license/check/route.ts:43-56 ; status/route.ts:58-66,117-130 ; deactivate/route.ts:56-62 ; devices/route.ts:48-57 | Fail-open technique et confusion secret JWT absent/session invalide, codes SERVICE_UNAVAILABLE génériques. | Supprimer les succès sur panne ; distinguer secret mal configuré avant vérification JWT ; enveloppe partagée. |
| DOC-01 | G 🟡 | README.md:96,108-126 | keygen_gui.py référencé mais absent ; initialisation manuelle des ancrages obsolète. | Pointer vers scripts/keygen.py et procédure existante de synchronisation, sans régénération automatique. |
| TXT-01 | C 🔵 | 11 fichiers TS/TSX dont src/app/page.tsx:1 ; PowerShell Windows | BOM initiaux et CRLF constatés. BOM PowerShell/CRLF CMD peuvent être intentionnels Windows, pas de corruption UTF-8 détectée. | Retirer uniquement BOM TS/TSX ; préserver scripts Windows et preuves historiques. Orthographe globale non validée. |

## Couverture A–K et limites initiales

A/B/D/I : revue ciblée incident ci-dessus ; pas encore audit sémantique complet des 164 routes. C : lecture UTF-8 globale, pas de contrôle linguistique exhaustif. E : manifestes/lock identifiés, installation/audit npm pas encore exécutés. F : licence/notices présentes, pas d'avis juridique ni garantie de provenance. G : documentation volumineuse et historique, exactitude globale non établie. H : nombreuses suites présentes, pas encore exécutées. J : deux moteurs/migrations présents, aucun accès DB production et aucune écriture autorisée. K : défaut overlay confirmé, accessibilité/responsive/E2E réels non encore validés.

## Incident : preuve et hypothèses

Aucun log de production corrélé ni état DB avant/après fourni. Tous les défauts ci-dessus sont des constats de code, PAS des causes racines prouvées d'un incident externe.

| Hypothèse | État | Preuve nécessaire pour falsifier/confirmer |
|---|---|---|
| Panne Prisma interprétée comme licence refusée | Compatible avec le code initial, non confirmée en production | Logs corrélés request ID + réponse HTTP/JSON + disponibilité DB à cet instant |
| Reset a introduit une version permissive en production | Compatible, non confirmée | SHA/artefact déployé et journal du reset ; comparaison de la route déployée |
| Altération réelle de licences/compromission | Non confirmée | Audit DB en lecture seule, historique admin et MAC sous configuration attestée ; un MAC invalide peut aussi suivre une mauvaise configuration |

Phase 0.5 côté incident production : **non vérifiable sans accès production**. Aucun pourcentage de confiance artificiel attribué.
