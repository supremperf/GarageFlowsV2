# Rapport final de mission — GarageFlows V2 (2026-10-19)

**Branche** : `arena/7d755e35-garageflowsv2`
**Base** : `b29efc7` (aucune fusion vers `main` ; validation humaine requise)
**Environnement mesuré** : Node 22.22.3, npm 10.9.8, Python 3.11.2 +
`cryptography 50.0.2` (venv), Linux x64, 2 vCPU / 3 Go. **Pas de Windows, pas de
moteur Prisma natif, pas d'identifiants PDP.**

Ce document est le point d'entrée des livrables A–G. Il distingue à chaque
ligne : **développé**, **testé localement**, **testé en environnement réel**,
**nécessite des identifiants externes**, **restant à valider**.

---

## A. Audit du dépôt

| Livrable | Où |
|---|---|
| Constats, priorités et causes racines de cette session | [RAPPORT-LICENCES-ET-EINVOICING.md](RAPPORT-LICENCES-ET-EINVOICING.md) |
| Sécurité des dépendances et contrôles applicatifs | [RAPPORT-SECURITE-DEPENDANCES.md](RAPPORT-SECURITE-DEPENDANCES.md) |
| Tests des dix parcours métier | [RAPPORT-TESTS-10-PARCOURS.md](RAPPORT-TESTS-10-PARCOURS.md) |
| Blocages externes déjà recensés | [../../BLOCAGES_EXTERNES.md](../../BLOCAGES_EXTERNES.md) |
| Journal de reprise | [../../../AUDIT_PROGRESS.md](../../../AUDIT_PROGRESS.md) |

Trois défauts structurants ont été corrigés, chacun avec une cause démontrée et
un test qui échouait avant :

1. **Licence liée au matériel refusée à l'activation** (P1). Le keygen signait
   une empreinte matérielle qui n'était pas celle de l'application. Correction :
   refus avant signature + GUI qui ne fabrique plus l'empreinte.
2. **Facturation électronique affichée « À venir » partout** alors que le
   connecteur générique fonctionne. Correction : statut affiché dérivé du
   registre réel.
3. **Garde CI cassée** : 29 empreintes Gitleaks en dérive après modification
   d'un fichier de test. Correction par snapshot public gelé, sans élargir la
   règle.

Deux manques fonctionnels explicitement listés par la mission ont été comblés :
**webhooks signés** et **file de reprise avec backoff**.

## B. Rapport de modification

`git diff --stat` : **23 fichiers suivis modifiés, 620 insertions, 70
suppressions**, plus 15 fichiers nouveaux. Aucune dépendance ajoutée, retirée
ou mise à jour.

### Licences (P1)

| Fichier | Modification |
|---|---|
| `scripts/keygen_core.py` | `normalize_license_hwid`, `is_valid_license_hwid`, `_checked_hwid` ; refus **avant signature** dans `make_license` / `make_mechanic_license` ; `get_hwid()` documenté comme diagnostic local |
| `scripts/keygen_ui.py` | « Ce PC » → « Coller » / « Fichier… », validation avant génération, aide explicite |
| `scripts/keygen.py` | `--bind-hwid` validé ; `--hwid` explicitement local |
| `scripts/gen_test_licenses.py` | 8 cas de validation HWID exposés aux fixtures |
| `src/lib/license/__tests__/license-keygen-e2e.test.ts` | 11 tests (dont refus avant signature), venv prioritaire |
| `scripts/test_keygen_hwid_binding.py` | **nouveau** : 10 tests Python dédiés |
| `scripts/campagne-100-licences.mjs` | **nouveau** : campagne 100+5 licences, 20 négatifs, 40 cas HWID, re-vérification 110/110 |
| `docs/KEYGEN.md` | cause, correction, reproduction |

### Facturation électronique

| Fichier | Modification |
|---|---|
| `src/lib/einvoicing/catalog.ts` | `presentIntegrationStatus()`, `isPlatformConfigurable()` |
| `src/app/api/einvoicing/status/route.ts` | statut **affiché**, `connectable`, `dedicatedAdapter` |
| `src/components/settings/EInvoicingTab.tsx` | messages dédié / générique / indisponible |
| `src/lib/einvoicing/webhook-signature.ts` | **nouveau** : HMAC-SHA256, fenêtre 5 min, `doitRemplacerStatut` |
| `src/lib/einvoicing/webhook.ts` | **nouveau** : réception, idempotence, isolation par garage |
| `src/app/api/einvoicing/webhooks/[providerId]/route.ts` | **nouveau** : route publique signée |
| `src/lib/einvoicing/queue.ts` | **nouveau** : backoff, sélection des candidats, reprise |
| `src/app/api/internal/einvoicing/queue/route.ts` | **nouveau** : cron protégé par jeton |
| `src/lib/einvoicing/adapters/generic-pa.ts` | `webhookSecret`, capacité `webhooks: true` |
| `src/app/api/einvoicing/connection/route.ts`, `src/app/api/sync/einvoicing/route.ts`, `EInvoicingConnectionForm.tsx` | champ secret de webhook |
| `src/lib/__tests__/routes-sans-appelant.test.ts`, `tenant-matrix-completude.test.ts` | inventaires mis à jour avec motifs |
| `scripts/garageflow-env-manifest.json`, `.env.example`, `ENVIRONMENT-VARIABLES.md` | `EINVOICING_QUEUE_TOKEN` |

### Outillage et documentation

`scripts/rapport-10-parcours.mjs` (**nouveau**, `npm run rapport:parcours`),
`package.json` (+3 scripts), `docs/EINVOICING_SECURITY.md` (**nouveau**),
`docs/EINVOICING_ARCHITECTURE.md`, `docs/audit/2026-10-19/*`,
`artifacts/verification/{campagne-100-licences,parcours-metier-10}.json`
(**nouveaux**), `AUDIT_PROGRESS.md`.

## C. Facturation électronique — état réel

| Élément exigé | Statut |
|---|---|
| Adaptateurs multi-agrégateurs | 1 connecteur **générique réel** (`generic-pa`, HTTP, OAuth2/clé API) + registre extensible. Aucun adaptateur dédié à une PDP nommée |
| Isolation configuration/identifiants par garage | **Fait et testé** — chiffrement AES-256-GCM, `garageId` de session/licence, projection sans secrets |
| Transmission réelle | **Codée et testée contre serveur simulé** ; jamais exécutée vers une PDP réelle (pas d'identifiants) |
| Idempotence | **Fait et testé** — clé déterministe, contrainte unique, rejeu exclusif en base |
| File et reprises | **Fait et testé** — `queue.ts`, backoff 5 min → 24 h, 5 tentatives, cron à jeton |
| Webhooks signés | **Fait et testé** — HMAC-SHA256, anti-rejeu, idempotence, isolation ; jamais émis par une PDP réelle |
| Statut uniquement depuis une réponse réelle | **Fait** — aucune écriture de statut sans réponse d'adaptateur ou webhook vérifié |
| Séparation sandbox / production | **Fait** — `sandboxOnly` verrouille l'environnement, jamais fourni par le poste |
| Cycle devis ≠ facture | **Fait** — devis et facture ont des routes, statuts et numérotations distincts |

**Reste ouvert (P2 assumé)** : aucun envoi automatique au moment de l'émission
d'une facture. Une file durable et un déclencheur fiable existent désormais ;
les brancher sur l'émission est une décision produit qui exige un test en
charge et une convention d'exploitation — elle n'est pas prise à la place du
client.

## D. Licences — état réel

| Preuve | Résultat |
|---|---|
| Campagne 100 licences garage + 5 mécanicien | **100 % valides**, 20/20 négatifs, 40/40 cas HWID, **110/110** après redémarrage |
| Tests Python keygen | **10/10**, **20/20**, **17/17** |
| Test E2E keygen → `verify.ts` | **11/11** |
| Round-trip reproduction | **19/19**, `ok: true` |
| Activation en base réelle | **NON EXÉCUTÉE** (moteur Prisma absent) |
| Exécution de l'installateur Windows | **NON EXÉCUTÉE** (pas de Windows) |

L'asymétrie de signature est conservée : la clé privée n'est jamais dans le
paquet livré ; seule la clé publique est embarquée.

## E. Portail client et abonnements

**Constat mesuré, pas une opinion** : aucune dépendance Stripe, aucun modèle
d'abonnement, aucune route de paiement récurrent, aucun webhook de paiement
dans le dépôt. Le seul droit payant modélisé est la **licence**.

Le portail client existe et fonctionne (authentification dédiée PortalUser,
2FA, tickets, rendez-vous, devis) ; ses suites non base sont vertes, ses
suites en base n'ont pas été exécutées.

Il n'y a donc **rien à auditer côté Stripe** : prétendre l'inverse serait
inventer un module. Si un abonnement doit être vendu, c'est un développement
neuf, avec ses propres choix de fournisseur et de facturation.

## F. Tests — résultats bruts

| Commande | Résultat |
|---|---|
| `npx tsc --noEmit` | **0 erreur** |
| `npx eslint src` | **0 erreur** |
| `npm run build` (étape Next) | **exit 0**, 18 pages, route webhook et file présentes |
| `npm run rapport:parcours` | **890/897** assertions, 0 échec, 7 ignorées |
| Baseline hors base élargie | **3 439/3 460**, 0 échec, 21 ignorées ; 1 suite non chargée (Prisma) |
| `npm run test:release-safety` | **164/164** |
| `npm run test:audit` | **21/21** |
| `npm run check:consistency` | **exit 0** (13 contrôles) |
| `npm audit` (dev+optional+peer) | **0** vulnérabilité sur 832 paquets verrouillés |
| `node scripts/package-artifact.mjs --verify` | **exit 0**, ZIP 2 622 fichiers sans `.git` |
| `npm run release:gate:fast` | **ÉCHEC** — 1 contrôle rouge (vitest), cause environnementale ci-dessous |

Limites mesurées, aucune n'est maquillée :

- Le moteur Prisma **natif** ne peut pas être téléchargé dans cet
  environnement (`binaries.prisma.sh` : TLS interrompu). Conséquence exacte sur
  la suite complète : **79 fichiers de test refusés à l'import** (78 via le
  `globalSetup` qui lance `prisma db push`, 1 fichier de test dédié) et
  **3 assertions en échec** dans `src/test-utils/__tests__/prepare-test-db.test.ts`
  — toutes les trois parce que `prisma db push` échoue au téléchargement. Le
  reste de la suite : **3 475 succès, 0 échec applicatif, 851 sautées**
  (suites conditionnelles PostgreSQL/Redis). Ce n'est **pas** un vert, et ce
  n'est pas un défaut du code : la preuve est dans le message d'erreur
  (`libquery_engine.so.node.gz.sha256`, TLS).
- Le build Next a nécessité le moteur Prisma **WASM** et un client régénéré
  localement, pour la même raison.

### F bis. Porte de release — ce qui a été corrigé, ce qui reste rouge

`npm run release:gate:fast` a été exécuté deux fois, sans complaisance.

**Défaut réel trouvé et corrigé.** La première exécution échouait à l'étape
« Empaquetage + vérification d'artefact RÉEL » avec :

```
Fuite de secrets : .env.storage.example présent dans l'artefact.
```

`.env.storage.example` est un **modèle fournisseur** tracké, dont toutes les
valeurs sont vides (`DATABASE_URL=`, `DIRECT_URL=`, …). Le vérificateur ne
reconnaissait que les noms **exacts** `.env.example|sample|template`, donc tout
artefact de release était refusé — un faux positif qui bloquait la livraison.

La correction (`scripts/lib/env-artifact-check.mjs`) n'élargit **pas** la garde :
un nom étendu `.env.<qualificatif>.example|sample|template` n'est accepté que si
son **contenu** le prouve — uniquement des commentaires, des lignes vides et des
affectations sans valeur. Un `.env.production.example` contenant un secret
reste une fuite, et 9 tests le vérifient, dont le refus d'un gabarit étendu
avec valeur, d'un `export`, d'une ligne de continuation, et le scan forcé des
dossiers `standalone` même en mode dépôt.

Preuve après correction : `node scripts/package-artifact.mjs --verify` →
**exit 0**, ZIP de 2 622 fichiers extrait **sans `.git`**, manifeste
`1.1.0+dba42a65a`, « Aucun .env réel embarqué (gabarits sans valeur
acceptés) ». À la seconde exécution du gate, l'étape d'empaquetage passe en 3 s.

**Ce qui reste rouge, et pourquoi.** La seconde exécution du gate :
9 contrôles obligatoires OK (tsc, ESLint, cohérence, audit dépendances, audit
runtime desktop, manifeste, vérification d'artefact, empaquetage réel), 1 rouge
— la suite vitest — et 6 non exécutés (PostgreSQL/Redis absents, `--fast`
saute build et budget de performance). Le rouge vitest est intégralement
environnemental :

- `prisma db push` télécharge `libquery_engine.so.node.gz` depuis
  `binaries.prisma.sh` ; la connexion TLS est coupée dans ce bac à sable ;
- 79 fichiers refusés à l'import + 3 assertions en échec, toutes avec cette
  même erreur de téléchargement ;
- 3 475 succès d'assertions, aucun échec applicatif.

`@prisma/engines` ne contient pas les binaires (95 Ko, simple téléchargeur) et
aucun paquet npm ne les publie : il n'existe **aucun moyen honnête** de rendre
ce contrôle vert ici. Le déclarer vert serait un mensonge ; le contourner
(`/bin/true` comme moteur) produirait de fausses bases. En CI avec réseau, le
même gate doit pouvoir télécharger le moteur — c'est une hypothèse, pas une
preuve, et elle est présentée comme telle.

## G. Version finale

- Source corrigée, tests ajoutés, scripts de build inchangés.
- `package.json` : `licences:campagne`, `test:keygen-hwid`,
  `rapport:parcours` (3 lignes).
- Documentation : `docs/EINVOICING_SECURITY.md`, rapports datés, journal de
  reprise.
- **Artefacts Windows : NON PRODUITS.** `electron-builder` ne peut pas
  fabriquer un installateur vérifié sans Windows/wine, et les tests de
  livraison ne remplacent pas une exécution. Aucun fichier `.exe` n'est déclaré.

---

## Matrice de vérité

| Élément | Développé | Testé localement | Testé en réel | Credentials externes | Reste à valider |
|---|:---:|:---:|:---:|:---:|---|
| HWID / keygen | ✅ | ✅ | ❌ | — | activation en base |
| Campagne 105 licences | ✅ | ✅ | ❌ | — | activation, Windows |
| Catalogue e-facturation | ✅ | ✅ | ❌ | PDP | affichage en production |
| Transmission PDP | ✅ | ✅ (simulé) | ❌ | **oui** | acceptation réelle |
| Webhooks | ✅ | ✅ | ❌ | **oui** | émission par une PDP |
| File de reprise | ✅ | ✅ | ❌ | cron | exécution planifiée |
| Portail client | ✅ | partiel | ❌ | — | suites en base |
| Abonnement / Stripe | ❌ | — | — | — | **module inexistant** |
| PDF | ✅ | ✅ | ❌ | — | rendu imprimé réel |
| Installateur Windows | ✅ | gardes ✅ | ❌ | — | **Windows requis** |

Aucune ligne « ❌ » n'est compensée par une affirmation de conformité. Aucun
modèle non disponible n'est revendiqué : cette session n'a pas utilisé Opus.

## Reproduire l'ensemble

```bash
npx tsc --noEmit
npx eslint src
npm run check:consistency
npm run test:release-safety
npm run test:audit
npm run release:gate:fast
node scripts/package-artifact.mjs --verify
npm run rapport:parcours
node scripts/campagne-100-licences.mjs
.venv/bin/python scripts/test_keygen_hwid_binding.py
.venv/bin/python scripts/test_keygen.py
.venv/bin/python scripts/test_keygen_issuer_recovery.py
node scripts/reproduce-keygen-roundtrip.mjs
PRISMA_SCHEMA_ENGINE_BINARY=/bin/true PRISMA_QUERY_ENGINE_LIBRARY=/bin/true \
  PRISMA_CLIENT_FORCE_WASM=1 GF_PACKAGE_DESKTOP=1 node scripts/next-build.cjs
```
