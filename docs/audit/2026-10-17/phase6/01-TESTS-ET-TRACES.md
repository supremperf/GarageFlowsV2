# Blocage 1 — fichiers, assertions et pending (exécution initiale PHASE 6)

**Relevé historique initial conservé.** La dernière mesure est dans [validation.json](validation.json), les [traces finales](vitest-final-failures.json) et la [liste finale des pending](pending-tests-final.tsv). Un prérequis illégitime de clé privée sur le cas `alg: none` a ensuite été retiré : 848 pending finaux, dont 35 conditionnels. Les trois assertions et les 79 fichiers restent empêchés d’aboutir.

Les anciens logs bruts ont disparu ; les trois assertions reproduites ci-dessous ont les mêmes compteurs et le même fichier responsable que la synthèse conservée, sans prétendre reproduire bit à bit les anciennes traces.

## Trois assertions échouées — erreurs et stacks intégrales

### GF31-AUD-024 — modèle de base de test partagé produit une base exploitable, et le modèle porte l’empreinte du schéma

Fichier : `src/test-utils/__tests__/prepare-test-db.test.ts`

```text
Error: Command failed: /usr/local/bin/node /home/user/GarageFlowsV2/node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss
Error: request to https://binaries.prisma.sh/all_commits/605197351a3c8bdd595af2d2a9bc3025bca48ea2/debian-openssl-3.0.x/libquery_engine.so.node.sha256 failed, reason: Client network socket disconnected before secure TLS connection was established

    at genericNodeError (node:internal/errors:983:15)
    at wrappedFn (node:internal/errors:537:14)
    at checkExecSyncError (node:child_process:916:11)
    at execFileSync (node:child_process:952:15)
    at construireModele (/home/user/GarageFlowsV2/src/test-utils/prepare-test-db.ts:52:3)
    at prepareTestDb (/home/user/GarageFlowsV2/src/test-utils/prepare-test-db.ts:72:7)
    at /home/user/GarageFlowsV2/src/test-utils/__tests__/prepare-test-db.test.ts:28:7
    at file:///home/user/GarageFlowsV2/node_modules/@vitest/runner/dist/chunk-artifact.js:302:11
    at file:///home/user/GarageFlowsV2/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:26
    at file:///home/user/GarageFlowsV2/node_modules/@vitest/runner/dist/chunk-artifact.js:2326:20
```

### GF31-AUD-024 — modèle de base de test partagé le second appel réutilise le modèle au lieu de reconstruire

Fichier : `src/test-utils/__tests__/prepare-test-db.test.ts`

```text
Error: Command failed: /usr/local/bin/node /home/user/GarageFlowsV2/node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss
Error: request to https://binaries.prisma.sh/all_commits/605197351a3c8bdd595af2d2a9bc3025bca48ea2/debian-openssl-3.0.x/libquery_engine.so.node.gz.sha256 failed, reason: Client network socket disconnected before secure TLS connection was established

    at genericNodeError (node:internal/errors:983:15)
    at wrappedFn (node:internal/errors:537:14)
    at checkExecSyncError (node:child_process:916:11)
    at execFileSync (node:child_process:952:15)
    at construireModele (/home/user/GarageFlowsV2/src/test-utils/prepare-test-db.ts:52:3)
    at prepareTestDb (/home/user/GarageFlowsV2/src/test-utils/prepare-test-db.ts:72:7)
    at /home/user/GarageFlowsV2/src/test-utils/__tests__/prepare-test-db.test.ts:46:7
    at file:///home/user/GarageFlowsV2/node_modules/@vitest/runner/dist/chunk-artifact.js:302:11
    at file:///home/user/GarageFlowsV2/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:26
    at file:///home/user/GarageFlowsV2/node_modules/@vitest/runner/dist/chunk-artifact.js:2326:20
```

### GF31-AUD-024 — modèle de base de test partagé une base déjà présente est REMPLACÉE, jamais réutilisée telle quelle

Fichier : `src/test-utils/__tests__/prepare-test-db.test.ts`

```text
Error: Command failed: /usr/local/bin/node /home/user/GarageFlowsV2/node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss
Error: request to https://binaries.prisma.sh/all_commits/605197351a3c8bdd595af2d2a9bc3025bca48ea2/debian-openssl-3.0.x/libquery_engine.so.node.gz.sha256 failed, reason: Client network socket disconnected before secure TLS connection was established

    at genericNodeError (node:internal/errors:983:15)
    at wrappedFn (node:internal/errors:537:14)
    at checkExecSyncError (node:child_process:916:11)
    at execFileSync (node:child_process:952:15)
    at construireModele (/home/user/GarageFlowsV2/src/test-utils/prepare-test-db.ts:52:3)
    at prepareTestDb (/home/user/GarageFlowsV2/src/test-utils/prepare-test-db.ts:72:7)
    at /home/user/GarageFlowsV2/src/test-utils/__tests__/prepare-test-db.test.ts:68:7
    at file:///home/user/GarageFlowsV2/node_modules/@vitest/runner/dist/chunk-artifact.js:302:11
    at file:///home/user/GarageFlowsV2/node_modules/@vitest/runner/dist/chunk-artifact.js:1903:26
    at file:///home/user/GarageFlowsV2/node_modules/@vitest/runner/dist/chunk-artifact.js:2326:20
```

## Les 79 fichiers en échec

E = premier obstacle observé : moteur natif/téléchargement réseau ; N = client sans moteur inapte à la requête native. Ce ne sont PAS des clients absents : le client est généré en mode typage. Les traces ne prouvent PAS que tous les tests sous-jacents passeraient avec un moteur. Aucune régression applicative démontrée par ces traces ; aucune non-régression DB attestée. Les messages complets par fichier sont dans `vitest-failures.json`.

| # | Fichier | Cause observée | Tests non exécutés |
|---|---|---|---|
| 1 | `src/integration/business-workflow-e2e.test.ts` | E : téléchargement moteur bloqué | 15 |
| 2 | `src/integration/catalog.test.ts` | E : téléchargement moteur bloqué | 9 |
| 3 | `src/integration/client-email-garage-portail.test.ts` | E : téléchargement moteur bloqué | 16 |
| 4 | `src/integration/copilot-conversation.test.ts` | E : téléchargement moteur bloqué | 9 |
| 5 | `src/integration/copilot-cout-achat.test.ts` | E : téléchargement moteur bloqué | 5 |
| 6 | `src/integration/copilot-ecusson-verifie.test.ts` | E : téléchargement moteur bloqué | 9 |
| 7 | `src/integration/copilot-financial-authz-v15.test.ts` | E : téléchargement moteur bloqué | 6 |
| 8 | `src/integration/copilot-portee-et-porte-financiere.test.ts` | E : téléchargement moteur bloqué | 18 |
| 9 | `src/integration/copilot.test.ts` | E : téléchargement moteur bloqué | 7 |
| 10 | `src/integration/dashboard.test.ts` | E : téléchargement moteur bloqué | 3 |
| 11 | `src/integration/devis-signature-depuis-un-poste.test.ts` | E : téléchargement moteur bloqué | 9 |
| 12 | `src/integration/document-integrity-v15.test.ts` | E : téléchargement moteur bloqué | 3 |
| 13 | `src/integration/fec-injection-v15.test.ts` | E : téléchargement moteur bloqué | 3 |
| 14 | `src/integration/finance-margin.test.ts` | E : téléchargement moteur bloqué | 1 |
| 15 | `src/integration/intervention-rattache-client-vehicule.test.ts` | E : téléchargement moteur bloqué | 8 |
| 16 | `src/integration/invoice-authz.test.ts` | E : téléchargement moteur bloqué | 7 |
| 17 | `src/integration/invoice-document-integrity-p3.test.ts` | E : téléchargement moteur bloqué | 15 |
| 18 | `src/integration/invoice-stock-sync.test.ts` | E : téléchargement moteur bloqué | 29 |
| 19 | `src/integration/licence-admin-durcissement.test.ts` | E : téléchargement moteur bloqué | 3 |
| 20 | `src/integration/loaner-availability.test.ts` | E : téléchargement moteur bloqué | 41 |
| 21 | `src/integration/mechanic-avatar-archive.test.ts` | E : téléchargement moteur bloqué | 19 |
| 22 | `src/integration/mechanic-avatar-sync.test.ts` | E : téléchargement moteur bloqué | 11 |
| 23 | `src/integration/mechanic-scope-realtime.test.ts` | E : téléchargement moteur bloqué | 14 |
| 24 | `src/integration/messagerie-client-garage.test.ts` | E : téléchargement moteur bloqué | 16 |
| 25 | `src/integration/part-deletion-history.test.ts` | E : téléchargement moteur bloqué | 3 |
| 26 | `src/integration/part-inventory-adjustment.test.ts` | E : téléchargement moteur bloqué | 13 |
| 27 | `src/integration/planning-journee-complete.test.ts` | E : téléchargement moteur bloqué | 5 |
| 28 | `src/integration/portail-2fa-cycle.test.ts` | E : téléchargement moteur bloqué | 20 |
| 29 | `src/integration/portail-2fa-idor.test.ts` | E : téléchargement moteur bloqué | 11 |
| 30 | `src/integration/portail-instantane-borne.test.ts` | E : téléchargement moteur bloqué | 5 |
| 31 | `src/integration/portail-lien-revoque-a-la-republication.test.ts` | E : téléchargement moteur bloqué | 7 |
| 32 | `src/integration/portail-mot-de-passe-provisoire.test.ts` | E : téléchargement moteur bloqué | 6 |
| 33 | `src/integration/portal-access-lifecycle.test.ts` | E : téléchargement moteur bloqué | 15 |
| 34 | `src/integration/portal-account-takeover-v15.test.ts` | E : téléchargement moteur bloqué | 2 |
| 35 | `src/integration/portal-email-sync.test.ts` | E : téléchargement moteur bloqué | 12 |
| 36 | `src/integration/portal-password-enforcement.test.ts` | E : téléchargement moteur bloqué | 10 |
| 37 | `src/integration/portal-rbac-p3.test.ts` | E : téléchargement moteur bloqué | 15 |
| 38 | `src/integration/portal-token-isolation.test.ts` | E : téléchargement moteur bloqué | 5 |
| 39 | `src/integration/pulse-boucle-de-synchronisation.test.ts` | E : téléchargement moteur bloqué | 6 |
| 40 | `src/integration/purchase-order-receive-returned.test.ts` | E : téléchargement moteur bloqué | 7 |
| 41 | `src/integration/pwa-fenetre-et-photos.test.ts` | E : téléchargement moteur bloqué | 13 |
| 42 | `src/integration/quote-acceptance-proof.test.ts` | E : téléchargement moteur bloqué | 10 |
| 43 | `src/integration/quotes-generate.test.ts` | E : téléchargement moteur bloqué | 7 |
| 44 | `src/integration/rbac-enforcement-e2e.test.ts` | E : téléchargement moteur bloqué | 5 |
| 45 | `src/integration/reglages-appliques.test.ts` | E : téléchargement moteur bloqué | 5 |
| 46 | `src/integration/reglages-enfin-lus.test.ts` | E : téléchargement moteur bloqué | 8 |
| 47 | `src/integration/reglages-logo-et-cout-achat.test.ts` | E : téléchargement moteur bloqué | 14 |
| 48 | `src/integration/rendez-vous-client-garage.test.ts` | E : téléchargement moteur bloqué | 16 |
| 49 | `src/integration/robustness-v15.test.ts` | E : téléchargement moteur bloqué | 4 |
| 50 | `src/integration/scenario-maitre.test.ts` | E : téléchargement moteur bloqué | 8 |
| 51 | `src/integration/statistiques-au-centime.test.ts` | E : téléchargement moteur bloqué | 9 |
| 52 | `src/integration/status-mass-assignment-v15.test.ts` | E : téléchargement moteur bloqué | 3 |
| 53 | `src/integration/stock-money-p3.test.ts` | E : téléchargement moteur bloqué | 11 |
| 54 | `src/integration/stock-suppression-et-entrees.test.ts` | E : téléchargement moteur bloqué | 8 |
| 55 | `src/integration/stock-tracabilite-et-suppression.test.ts` | E : téléchargement moteur bloqué | 10 |
| 56 | `src/integration/supplier-linkage.test.ts` | E : téléchargement moteur bloqué | 6 |
| 57 | `src/integration/suppliers.test.ts` | E : téléchargement moteur bloqué | 18 |
| 58 | `src/integration/synchro-voie-de-retour.test.ts` | E : téléchargement moteur bloqué | 24 |
| 59 | `src/integration/tenant-idor-patch.test.ts` | E : téléchargement moteur bloqué | 4 |
| 60 | `src/integration/tenant-isolation-matrix.test.ts` | E : téléchargement moteur bloqué | 42 |
| 61 | `src/lib/__tests__/tenant-isolation.test.ts` | N : client --no-engine, URL prisma:// requise | 7 |
| 62 | `src/test-utils/__tests__/prepare-test-db.test.ts` | E : téléchargement moteur bloqué | 0 |
| 63 | `src/lib/backup/__tests__/restore-roundtrip.test.ts` | E : téléchargement moteur bloqué | 6 |
| 64 | `src/lib/einvoicing/__tests__/desktop-bridge.test.ts` | E : téléchargement moteur bloqué | 20 |
| 65 | `src/lib/sync/__tests__/job-tombstones.test.ts` | E : téléchargement moteur bloqué | 6 |
| 66 | `src/lib/sync/__tests__/mechanic-rattrapage.test.ts` | E : téléchargement moteur bloqué | 9 |
| 67 | `src/lib/sync/__tests__/messages-voie-de-retour.test.ts` | E : téléchargement moteur bloqué | 9 |
| 68 | `src/lib/sync/__tests__/passe-lecture-seule.test.ts` | E : téléchargement moteur bloqué | 5 |
| 69 | `src/lib/sync/__tests__/quote-return.test.ts` | E : téléchargement moteur bloqué | 10 |
| 70 | `src/lib/sync/__tests__/rendez-vous-voie-de-retour.test.ts` | E : téléchargement moteur bloqué | 10 |
| 71 | `src/app/api/clients/__tests__/portal-access-publication.test.ts` | E : téléchargement moteur bloqué | 14 |
| 72 | `src/app/api/internal/__tests__/backup-coherent.test.ts` | E : téléchargement moteur bloqué | 9 |
| 73 | `src/app/api/parts/__tests__/parts-pagination.test.ts` | E : téléchargement moteur bloqué | 4 |
| 74 | `src/app/api/sync/__tests__/appointments-sync.test.ts` | E : téléchargement moteur bloqué | 6 |
| 75 | `src/app/api/sync/__tests__/einvoicing-tunnel.test.ts` | E : téléchargement moteur bloqué | 13 |
| 76 | `src/app/api/sync/__tests__/invoice-publication.test.ts` | E : téléchargement moteur bloqué | 13 |
| 77 | `src/app/api/sync/__tests__/portal-account-publication.test.ts` | E : téléchargement moteur bloqué | 9 |
| 78 | `src/app/api/sync/__tests__/quote-publication.test.ts` | E : téléchargement moteur bloqué | 11 |
| 79 | `src/app/api/sync/__tests__/tickets-sync.test.ts` | E : téléchargement moteur bloqué | 9 |

## Les 849 pending — ventilation exhaustive

**813** tests marqués skipped après échec du hook de leur fichier (dont 5 tenant-isolation). Ils ne sont PAS des `.skip` volontaires. **36** sont explicitement conditionnels ; **0 todo**. Aucun `.skip` inconditionnel oublié identifié dans les sites de déclaration lus. Les cinq positifs cryptographiques historiques nécessitent la clé privée réelle car ils visent l’ancre embarquée : ne pas les « activer » avec une clé étrangère ; un test indépendant avec fixture est ajouté au blocage 4.

| Fichier conditionnel | Nombre | Prérequis manquant |
|---|---|---|
| `src/__tests__/integrity-diagnostics.test.ts` | 1 | dist/win-unpacked integrity manifest |
| `src/lib/__tests__/document-numbering.postgres.int.test.ts` | 1 | TEST_POSTGRES_URL + psql + engines |
| `src/lib/__tests__/license-devices.postgres.int.test.ts` | 13 | TEST_POSTGRES_URL + psql + engines |
| `src/lib/__tests__/license-public-key.test.ts` | 1 | keys/public.pem and/or issuer private key (see individual source guards) |
| `src/lib/__tests__/licensed-session.postgres.int.test.ts` | 6 | TEST_POSTGRES_URL + psql + engines |
| `src/lib/__tests__/rate-limit-multi-instance.int.test.ts` | 5 | TEST_REDIS_URL |
| `src/lib/__tests__/stock-concurrency.postgres.int.test.ts` | 1 | TEST_POSTGRES_URL + psql + engines |
| `src/lib/license/__tests__/forgery-resistance.test.ts` | 6 | keys/public.pem and/or issuer private key (see individual source guards) |
| `src/lib/license/__tests__/public-key-consistency.test.ts` | 2 | GF_TEST_LICENSE signed by real issuer |
