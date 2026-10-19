# Licences & facturation électronique — corrections et preuves (2026-10-19)

<!-- doc-numbers: journal -->

> Portée honnête : ce document ne consigne que ce qui a été **exécuté** dans cet
> environnement. Les sections « non vérifié » ne sont pas des réserves de
> politesse : elles disent ce qui manque pour conclure.

## 1. Environnement de la session (mesuré)

| Élément | Valeur constatée |
|---|---|
| Dépôt | `supremperf/GarageFlowsV2`, branche `arena/7d755e35-garageflowsv2` |
| HEAD de départ | `b29efc7` (arbre propre) |
| Node / npm | v22.22.3 / 10.9.8 |
| Python | 3.11.2, venv `.venv` + `cryptography 50.0.2` (installation verrouillée par `tests/requirements-keygen.txt`) |
| Prisma | 5.22.0 ; le CDN `binaries.prisma.sh` est **injoignable** depuis ce bac à sable |
| Windows / wine | absent |
| Identifiants de plateforme agréée | absents |

Conséquence : les tests qui ouvrent une base passent par `prepareTestDb()` →
`prisma db push`, qui tente de télécharger le moteur de schéma. Ils ne peuvent
**pas** s'exécuter ici. Cela n'autorise ni à les déclarer verts, ni à les
déclarer en échec.

### Baseline réellement rejouée

- `npx tsc --noEmit` : **0 erreur** (37 s).
- `npx eslint src --ext .ts,.tsx` : **0 erreur** (23 s).
- Suite **hors base de données** (220 fichiers, liste construite en excluant
  tout fichier qui importe Prisma) :
  - fichiers : **219 réussis / 1 ignoré** ;
  - tests : **2 894 réussis / 14 ignorés** ;
  - code de sortie **1** à cause de rejets Prisma non gérés
    (`The adapter option for PrismaClient is required`) émis par trois fichiers
    qui mockent `@/lib/db` mais déclenchent une initialisation native. Le client
    Prisma de ce bac à sable a été généré en mode WASM (moteur natif
    indisponible) ; ce n'est pas une assertion en échec.
- Suite **avec base** : 132 fichiers de test dépendants de Prisma, non
  exécutables ici (moteur indisponible). Aucun résultat n'est inventé.

## 2. Défaut P1 corrigé — une licence liée au matériel était refusée à l'activation

### Symptôme signalé

« Il faut générer plusieurs licences avant d'en obtenir une valide » ; des
licences sont considérées comme invalides ou modifiées après génération.

### Cause réelle (démontrée)

Le GUI du keygen proposait un bouton **« Ce PC »** qui remplissait le champ
`HWID` avec `keygen_core.get_hwid()`. Or les deux empreintes ne sont **pas**
calculées de la même façon :

| Source | CPU | Plateforme | MAC |
|---|---|---|---|
| Application (Electron / Next) | `os.cpus()[0].model` | `os.platform()-os.arch()` → `win32-x64` | `os.networkInterfaces()` (première non-loopback) |
| Keygen Python | `platform.processor()` | `platform.system()-platform.machine()` → `Windows-AMD64` | `uuid.getnode()` (aléatoire si aucune MAC) |

La chaîne de plateforme diffère **toujours** ; le CPU et la MAC peuvent aussi
différer. Toute licence signée avec l'empreinte locale du keygen est donc
rejetée par `src/lib/license/verify.ts` à l'activation (`verifyHwid` compare
strictement). L'opérateur régénérait des licences jusqu'à en obtenir une
« valide » — en laissant finalement le champ vide.

Second défaut du même chemin : **aucun contrôle de format**. Un HWID tronqué,
entre guillemets, avec un espace interne ou du texte libre était signé sans
erreur, puis refusé à l'activation (« Licence invalide ou modifiée »).

### Correction

| Fichier | Modification |
|---|---|
| `scripts/keygen_core.py` | `normalize_license_hwid()` / `is_valid_license_hwid()` (v0 64 hex, v1 `HWID1-` + 64 hex) ; `make_license` et `make_mechanic_license` **refusent avant de signer** ; normalisation identique au vérificateur ; `get_hwid()` documenté comme empreinte locale de diagnostic, **jamais** une liaison |
| `scripts/keygen_ui.py` | bouton « Ce PC » supprimé ; remplacé par **« Coller »** et **« Fichier… »** (la valeur vient du poste client) ; validation avant génération ; texte d'aide explicite |
| `scripts/keygen.py` | `--bind-hwid` validé avant signature ; `--hwid` annonce explicitement une empreinte **locale de diagnostic** |
| `docs/KEYGEN.md` | section « Liaison matérielle — ne JAMAIS calculer le HWID dans le keygen » avec le tableau des divergences |
| `scripts/test_keygen_hwid_binding.py` | **10 tests** : formats acceptés/refusés, normalisation, refus avant signature, mécanicien, garde source (le GUI n'appelle plus `get_hwid`) |
| `src/lib/license/__tests__/license-keygen-e2e.test.ts` | fixtures étendues : 8 cas HWID (2 valides signés normalisés, 5 refus, 1 champ vide non lié) ; le test utilise `.venv/bin/python` quand il existe |

### Preuves exécutées

```text
.venv/bin/python scripts/test_keygen_hwid_binding.py   → 10 tests, OK
.venv/bin/python scripts/test_keygen.py                → 20 tests, OK
.venv/bin/python scripts/test_keygen_issuer_recovery.py→ 17 tests, OK
node scripts/reproduce-keygen-roundtrip.mjs            → ok=true, 19/19 étapes
npx vitest run src/lib/license/__tests__/license-keygen-e2e.test.ts → 11/11
```

## 3. Campagne de 100 licences — résultats réels

`node scripts/campagne-100-licences.mjs` (nouveau, reproductible ; `npm run
licences:campagne`).

### Méthode

1. Une paire P-256 **de fixture** est créée dans un répertoire temporaire
   (jamais la clé de production, absente du dépôt), avec des ancres cohérentes.
2. La frontière de signature du GUI est utilisée telle quelle :
   `keygen_core.load_checked_private_key()` (clé privée + contrôle des ancres).
3. 100 licences garage distinctes (types `trial/premium/enterprise/admin`,
   durées 1–3 ans, 1–10 postes, libellés accentués), dont 20 liées au matériel
   (10 en v0, 10 en v1), plus **5 clés mécanicien** rattachées à un parent.
4. Chaque jeton est vérifié par le **vrai** `src/lib/license/verify.ts`
   (transpilé et exécuté, pas réimplémenté) : signature ES256, en-tête, payload,
   dates, droits, filigrane.
5. Contrôles négatifs : 10 altérations de payload, 5 vérifications avec une clé
   publique étrangère, 5 licences expirées.
6. « Redémarrage » : un **processus Node séparé** relit les jetons depuis un
   fichier et les revérifie.

### Résultats (fichier de preuve : `artifacts/verification/campagne-100-licences.json`)

| Indicateur | Résultat |
|---|---|
| Licences garage générées et valides | **100 / 100** |
| Clés mécanicien valides | **5 / 5** |
| Identifiants (`lid`) et jetons distincts | **110 / 110** |
| Contrôles négatifs conformes | **20 / 20** |
| Cas HWID (format, même machine, autre machine) | **40 / 40** |
| Re-vérification après « redémarrage » | **110 / 110** |
| Verdict global | **`allPassed: true`** |

### Limites explicites

- La clé est une **fixture** : la campagne prouve la chaîne
  génération→signature→vérification, pas l'acceptation par un serveur de
  production ni une clé de production (elle n'est pas dans le dépôt).
- L'**activation en base** n'est pas exécutée (moteur Prisma indisponible).
- L'**application Windows compilée** n'est pas testée (pas de Windows ici).

## 4. Facturation électronique — « À venir » corrigé

### Constat

Le module est réel : adaptateur `generic-pa` (HTTP réel, OAuth2/clé API,
timeout 20 s, garde SSRF), chiffrement des identifiants, idempotence
`sha256(garageId + invoiceId)`, relecture de statut, abandon à 15 min, tunnel
poste→cloud, UI de connexion et panneau de transmission.

Mais le catalogue fixait `integrationStatus: 'coming_soon'` pour **toutes** les
plateformes, et `isPlatformConnectable` exigeait un adaptateur **dédié**. Résultat
affiché : « À venir » sur les 135 plateformes, alors que le connecteur générique
permet réellement de configurer sa plateforme. C'est exactement l'écart signalé.

### Correction

| Fichier | Modification |
|---|---|
| `src/lib/einvoicing/catalog.ts` | `presentIntegrationStatus()` : dédié → `available` ; sinon générique disponible → `configuration_required` ; sinon statut du catalogue (et jamais `available` sans adaptateur réellement enregistré) ; `isPlatformConfigurable()` |
| `src/app/api/einvoicing/status/route.ts` | renvoie le statut **affiché**, `connectable`, `dedicatedAdapter` ; commentaires de « Phase 2 / lecture seule » corrigés |
| `src/components/settings/EInvoicingTab.tsx` | badge « Configuration requise » ; messages distincts dédié / générique / indisponible ; en-tête obsolète corrigé |
| `src/lib/einvoicing/__tests__/einvoicing-foundation.test.ts` | 4 tests du statut affiché (dont : adaptateur annoncé mais absent du registre → jamais `available`) |

Preuve : `npx vitest run src/lib/einvoicing/__tests__/einvoicing-foundation.test.ts src/lib/einvoicing/__tests__/catalog-provenance.test.ts`
→ **32/32 tests**, y compris les tests existants qui exigent que le catalogue
brut reste `coming_soon`.

### Ce qui reste OUVERT (non maquillé)

1. **Aucune transmission réelle** vers une plateforme agréée : aucun compte ni
   identifiant PDP n'est disponible. Le chemin HTTP réel est couvert par des
   tests avec serveur simulé, pas par un échange avec un service de production.
2. **Pas de déclenchement automatique à l'émission de la facture** :
   `envoyerFacture` est appelé par la route d'envoi et le tunnel de synchronisation,
   pas par la route d'émission. Une facture émise pendant une indisponibilité
   reste à transmettre jusqu'à une action explicite. Statut : **P2 ouvert,
   décision documentée** — l'auto-envoi exige une file durable (reprise après
   redémarrage, backoff) que le dépôt n'a pas ; le brancher en synchrone sur la
   publication d'une facture bloquerait la synchronisation jusqu'à 20 s et
   perdrait les échecs au redéploiement. On ne livre donc pas un bouton qui
   mentirait sur sa fiabilité.

### File de reprise — implémentée dans cette session

Le point « retries » de la mission est traité sans introduire de faux succès :

| Élément | Implémentation |
|---|---|
| Politique | `src/lib/einvoicing/queue.ts` — backoff 5 min / 15 min / 1 h / 4 h / 24 h, 5 tentatives |
| Déclencheur | `POST /api/internal/einvoicing/queue`, cron, `Authorization: Bearer` + `EINVOICING_QUEUE_TOKEN` (≥32 car., temps constant) |
| Périmètre | uniquement `error` **sans identifiant externe** ; jamais `unknown` (reçu possible), jamais `rejected` (contenu refusé) |
| Sécurité | fermé si `EINVOICING_ENABLED`/`OUTGOING_ENABLED` est faux ; jeton absent → 503, aucune action |
| Tests | **17/17** (`queue.test.ts`) : backoff, bornes, refus de statuts, exception isolée, route |

Ce qui reste **NON VÉRIFIÉ** : l'exécution réelle d'un cron chez l'exploitant,
et le comportement d'un envoi réellement repris vers une PDP.

### Webhooks — implémentés dans cette session

Le point 3 de la liste précédente est **traité** :

| Élément | Implémentation |
|---|---|
| Route publique | `POST /api/einvoicing/webhooks/[providerId]` |
| Authentification | HMAC-SHA256 du corps brut, en-têtes `X-GF-Timestamp` / `X-GF-Signature` |
| Secret | `webhookSecret` par connexion, chiffré AES-256-GCM avec les autres identifiants |
| Anti-rejeu | fenêtre de 5 minutes, comparaison à temps constant, `eventId` idempotent |
| Statuts | traduction par l'adaptateur ; une régression ou un statut inconnu n'écrase rien |
| Isolation | transmission retrouvée par `(providerId, externalId)` ; ambiguïté entre garages → 409 |
| Tests | **27/27** (`webhook-signature`, `webhook-route`) + **162/162** sur l'ensemble e-facturation |

Ce qui reste **NON VÉRIFIÉ** : un webhook réellement émis par une PDP. Le schéma
est documenté dans `docs/EINVOICING_SECURITY.md` ; aucune plateforme réelle ne
l'a encore utilisé.

## 4bis. Garde CI réparée — 29 empreintes Gitleaks en dérive

`npm run test:release-safety` échouait sur
`tests/secret-scan-policy.test.cjs` : **29 des 959** suppressions hash-lockées
pointaient vers `src/lib/license/__tests__/license-keygen-e2e.test.ts`, dont
l'empreinte avait changé avec l'ajout des tests HWID (commit `03611cc`).

Le mécanisme est volontairement strict : une suppression Gitleaks est liée à un
fichier, une ligne et une empreinte source exactes. La correction n'a **pas**
élargi la règle ni ajouté d'empreinte à l'ignore : un snapshot public du fichier
**avant** modification a été gelé dans
`docs/audit/2026-10-19/snapshots/license-keygen-e2e.before.ts.txt`
(SHA-256 `076b1a28…`, identique à l'empreinte du reçu F01), et les 29 entrées
référencent désormais ce snapshot (`sourceSnapshot`). Aucun reçu historique n'a
été réécrit ; aucune ligne du scan n'a été ajoutée ou retirée.

Preuve : `node --test tests/secret-scan-policy.test.cjs` → **4/4** ;
`npm run test:release-safety` → **166/166**.

## 5. Fichiers modifiés dans cette session

```
scripts/keygen_core.py
scripts/keygen_ui.py
scripts/keygen.py
scripts/gen_test_licenses.py
scripts/test_keygen_hwid_binding.py          (nouveau)
scripts/campagne-100-licences.mjs            (nouveau)
src/lib/license/__tests__/license-keygen-e2e.test.ts
src/lib/einvoicing/catalog.ts
src/app/api/einvoicing/status/route.ts
src/components/settings/EInvoicingTab.tsx
src/lib/einvoicing/__tests__/einvoicing-foundation.test.ts
src/lib/einvoicing/queue.ts                   (nouveau)
src/app/api/internal/einvoicing/queue/route.ts (nouveau)
src/lib/einvoicing/__tests__/queue.test.ts    (nouveau)
scripts/garageflow-env-manifest.json          (+ EINVOICING_QUEUE_TOKEN)
ENVIRONMENT-VARIABLES.md                      (régénéré)
src/lib/einvoicing/webhook.ts                 (nouveau)
src/lib/einvoicing/webhook-signature.ts       (nouveau)
src/app/api/einvoicing/webhooks/[providerId]/route.ts (nouveau)
src/lib/einvoicing/__tests__/webhook-signature.test.ts (nouveau)
src/lib/einvoicing/__tests__/webhook-route.test.ts     (nouveau)
src/lib/einvoicing/adapters/generic-pa.ts
src/app/api/einvoicing/connection/route.ts
src/app/api/sync/einvoicing/route.ts
src/components/settings/EInvoicingConnectionForm.tsx
src/lib/__tests__/routes-sans-appelant.test.ts
docs/EINVOICING_SECURITY.md                   (nouveau)
docs/EINVOICING_ARCHITECTURE.md
docs/KEYGEN.md
package.json                                (2 scripts)
artifacts/verification/campagne-100-licences.json (preuve générée)
```

## 6. Reste à valider (aucune de ces lignes n'est déclarée faite)

- Tests avec base SQLite/PostgreSQL réels (moteur Prisma) — bloqués ici.
- Installation NSIS Windows, exécution de l'`.exe`, redémarrage — nécessite Windows.
- Activation réelle en base d'une licence issue de la campagne.
- Transmission réelle vers une PDP et webhook réellement émis — nécessite un contrat.
- Déclenchement automatique de la transmission à l'émission (P2 ci-dessus, décision documentée).
- Audit PDF / UI multi-résolutions : non repris dans cette session.

## 7. Reproduire

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --require-hashes --only-binary=:all: \
  -r tests/requirements-keygen.txt

.venv/bin/python scripts/test_keygen_hwid_binding.py
.venv/bin/python scripts/test_keygen.py
.venv/bin/python scripts/test_keygen_issuer_recovery.py
node scripts/reproduce-keygen-roundtrip.mjs
node scripts/campagne-100-licences.mjs
npx vitest run src/lib/license/__tests__/license-keygen-e2e.test.ts \
  src/lib/einvoicing/__tests__/einvoicing-foundation.test.ts
```
