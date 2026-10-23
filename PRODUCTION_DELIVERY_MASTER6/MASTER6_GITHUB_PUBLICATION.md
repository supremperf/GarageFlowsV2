---
doc-numbers: journal
---

# PUBLICATION GITHUB — MASTER 6

**Le push a réellement eu lieu, sans force, sans rien écraser, et le SHA distant est vérifié.**

---

## 1. Les faits

| | |
|---|---|
| dépôt | **`supremperf/GarageFlowsV2`** |
| URL | **https://github.com/supremperf/GarageFlowsV2** |
| visibilité | **PUBLIC** |
| branche publiée | **`main`** |
| branche par défaut du dépôt | `arena/84940ac2-garageflowsv2` — **ce n'est pas `main`** |
| **commit distant AVANT** | **`483aae32d522ef0a31275ab863d9ed61b2996de3`** |
| **commit local final** | **`277e1f2f16a0ceb333fdfffcfe1a80b159dd33b0`** |
| **commit distant APRÈS** | **`277e1f2f16a0ceb333fdfffcfe1a80b159dd33b0`** |
| distant = local | **oui** |
| arbre distant | `a89298c63efd354b6a07fe2ee285d27a1c9d6cd5` — **identique à l'arbre local** |
| commits publiés | **51** |
| fichiers modifiés | **754** |
| **fichiers supprimés** | **0** |
| date (UTC) | **2026-10-23T13:39:51Z** |
| résultat | **`483aae3..277e1f2  HEAD -> main`**, code de sortie **0** |

Auteurs des 51 commits publiés : `Mathys` 21, `supremperf` 16, `Claude` 14. Aucun
commit n'a été réécrit, aucune identité Git n'a été modifiée.

## 2. Comment le push s'est fait sans force

`origin/main` n'était **pas** un ancêtre de la branche de travail : un push direct
aurait été refusé, et `--force` est interdit par le mandat.

Le commit distant `483aae3` est la fusion de la PR #13 (branche `arena/7ad7aa15`).
Son arbre est **identique à celui de la base commune** `e6710cf` — il n'apporte
aucune modification de contenu. Je l'ai donc fusionné dans la branche de travail :

```
git merge --no-ff origin/main
arbre avant fusion : a89298c63efd354b6a07fe2ee285d27a1c9d6cd5
arbre après fusion : a89298c63efd354b6a07fe2ee285d27a1c9d6cd5
=> arbre INCHANGÉ : aucune perte, aucun écrasement
git push origin HEAD:main          # aucune option --force
```

Le SHA d'arbre identique avant et après la fusion **prouve** que rien du distant
n'a été écrasé. `483aae32d` est préservé dans l'historique, comme second parent du
commit de fusion.

## 3. La vérification qui compte : un clone neuf

Un push vérifié par son propre auteur ne prouve pas grand-chose. J'ai donc cloné le
dépôt **depuis GitHub**, avec `core.autocrlf=true` — le défaut Windows, celui qui
cassait précisément la vérification des preuves :

```
git clone --branch main https://github.com/supremperf/GarageFlowsV2.git
clone HEAD : 277e1f2f16a0ceb333fdfffcfe1a80b159dd33b0
autocrlf   : true

✅ MASTER4_EVIDENCE                                       disque  69/69  versionné  69/69
✅ MASTER5_EVIDENCE                                       disque  48/48  versionné  48/48
✅ artifacts/verification/audit-2026-10-22                disque  26/26  versionné  26/26
✅ artifacts/verification/mission-3-2026-10-22            disque  57/57  versionné  57/57
✅ artifacts/verification/production-readiness-2026-10-22 disque  41/41  versionné  41/41
✅ artifacts/verification/production-readiness-master5    disque  32/32  versionné  32/32

✅ preuves : 273/273 sur disque, 273/273 versionnées — 6 manifestes
```

**N'importe qui peut désormais cloner ce dépôt et vérifier les 273 empreintes de
preuves.** Ce n'était vrai ni avant MASTER 6, ni pendant — voir
`MASTER6_FINAL_REPORT.md §9`.

## 4. Contrôles de sécurité avant publication

| Contrôle | Résultat |
|---|---|
| gitleaks sur l'arbre **exactement publié** (3 210 fichiers, 131 Mo) | **6 signalements** |
| ... dont dans des fichiers **identiques à l'amont** | **6 / 6** |
| ... introduits par MASTER 5 ou MASTER 6 | **0** |
| dossier `keys/` versionné | **rien** |
| fichiers `.pem` / `.key` / `.pfx` / `.p12` versionnés | **aucun** |
| `prisma/dev.db` (vos données réelles) versionné | **non** |
| fichiers `.env` versionnés | **`.env.example` et `.env.storage.example` seulement** |
| `prisma/garageflow-template.db` | versionné, **identique à l'amont** (gabarit vierge) |

**Une correction a été nécessaire avant de publier.** Le scan a trouvé, dans deux de
mes propres journaux de preuves, l'en-tête `cookie:` d'une requête Playwright en
échec : `next-auth.session-token`, `gf_session` et `next-auth.csrf-token`. Serveur
local, licence de test dont l'ancrage de clé publique diffère de celui de production
— ces valeurs n'ouvrent rien en production. Elles ont néanmoins été expurgées : le
dépôt est public et le mandat interdit de publier des secrets, y compris de test.
Détail dans `MASTER6_EVIDENCE/logs/24-secrets-arbre-publie.txt`.

Les deux signalements `private-key` restants sont des matériels factices dans des
tests dont l'objet est précisément de vérifier qu'aucune clé privée n'est distribuée.

## 5. Validation du contenu publié

Exécuté sur l'arbre exact qui a été publié, arbre propre :

| Porte | Résultat |
|---|---|
| **`release:gate`** | **16 / 16**, code 0 — avec PostgreSQL 17 et Redis 7 réels |
| TypeScript / ESLint | 0 / 0 |
| Vitest | 4 390 réussis, 0 échec, 34 ignorés |
| `test:release-safety` | 190 / 0 / 3 |
| intégrité des preuves | **273 / 273** |
| `readiness:final` | **aucune erreur d'intégrité** — 25 pass, 8 bloqués |

Preuve : `MASTER6_EVIDENCE/logs/25-release-gate-arbre-publie.txt`.

## 6. GitHub Actions

Le push a déclenché deux workflows (`ci.yml`, `codeql.yml`).

| Workflow | Résultat | Identifiant |
|---|---|---|
| **CodeQL** | **succès** | `39963071697` |
| **CI** | **échec** — voir §6.1 et §6.2 | `39963071669` |

Détail des jobs du run CI `39963071669`, pour le commit `277e1f2` :

| Job | Résultat |
|---|---|
| Type-check, Lint & Test (desktop SQLite + serveur PostgreSQL) | **succès** (3 min 55 s) |
| Full dependency tree — zero vulnerabilities | **succès** |
| E2E (Playwright — responsive, auto-démarrage) | **succès** |
| Native base (TypeScript, standard build, fixed JS budget) | **succès** |
| **Secret scan (Gitleaks)** | **échec** — 5 signalements « en attente de revue » (§6.2) |
| Final release gate (full) | ignoré |
| Windows candidate packaging and inspection | ignoré (dépend du scan) |
| Authenticated browser validation (approved staging only) | ignoré (dépend du scan) |
| Required validation | **échec** par propagation |

**Les quatre jobs de fond passent.** Le compilateur, le lint, la suite de tests
complète, l'audit de dépendances, les tests E2E et la construction native sont
verts sur le commit publié.

### 6.1 La CI de `main` était déjà rouge AVANT ce push

C'est un point que je ne veux pas laisser ambigu. Le dernier run CI sur `main` avant
mon push — `39193727183`, pour le commit `483aae3` du 2026-10-19 — était **déjà en
échec**, pour une raison de configuration et non de code :

```
✓ Full dependency tree — zero vulnerabilities
✓ Type-check, Lint & Test (desktop SQLite + serveur PostgreSQL)
✓ Native base (TypeScript, standard build, fixed JS budget)
✓ E2E (Playwright — responsive, auto-démarrage)
✓ Secret scan (Gitleaks)
- Final release gate (full)                                   ignoré
✓ Windows candidate packaging and inspection
✗ Authenticated browser validation (approved staging only)    ÉCHEC en 5s
    ✗ Require explicitly approved non-production test target and fixtures
✗ Required validation
    ✗ Refuse failed, cancelled or skipped mandatory jobs
```

Le job de validation authentifiée **refuse de démarrer** faute des secrets de dépôt
`BASE_URL`, `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_LICENSE` et de la variable
`E2E_NON_PRODUCTION`. Il échoue en 5 secondes sur un code `MISSING_INPUT`, avant
toute requête. C'est un refus **volontaire, *fail-closed*** : le workflow interdit de
lancer des tests authentifiés contre une cible qui n'a pas été explicitement
approuvée comme non-productive. Le job `Required validation` échoue ensuite par
propagation.

Cette capacité n'est pas en défaut pour autant : les **135 tests Playwright
authentifiés** ont été exécutés et sont verts, localement, contre une cible locale
avec une licence de test (`MASTER6_PLAYWRIGHT_REPORT.md`). Seul le **câblage CI**
manque.

→ Action portée dans `MASTER6_MANUAL_ACTIONS.md`.

### 6.2 Ce que MON push a ajouté : le scan de secrets passe de 0 à 5 signalements

Je ne le présente pas autrement : **ce job était vert avant mon push, il est rouge
après.** Voici exactement pourquoi.

Ce n'est pas une régression de configuration : `.gitleaksignore` est **identique**
entre les deux commits (972 lignes de part et d'autre), et `.gitleaks.toml` ne
diffère que d'une ligne, qui **ajoute** une entrée d'allowlist. La cause est que
les cinq fichiers concernés **n'existaient pas**, ou pas sous cette forme, au
commit `483aae3` — ce sont des tests apportés par les 51 commits publiés, dont
plusieurs ont précisément pour objet de vérifier qu'un faux matériel de clé n'est
pas pris pour un vrai.

Les cinq signalements ont été examinés, puis chacun soumis à une **tentative de
réfutation indépendante**, chargée de démontrer que la conclusion « fixture
inoffensive » était fausse, avec consigne de trancher en faveur du risque en cas
de doute. **5 / 5 confirmés inoffensifs ; 5 tentatives de réfutation, 0 aboutie.**

| Signalement | Ce que la valeur est réellement |
|---|---|
| `02-moteur.test.js:255` *(jwt)* | faux JWT : le segment de signature décode vers le mot ASCII `signature`, **9 octets** — un RS256 en exige 256. Charge utile `{"sub":"test"}`, sans `iss`/`aud`/`exp` |
| `03-synchronisation.test.js:124` *(generic-api-key)* | **aucun littéral sur la ligne** : gitleaks a capturé le texte de l'expression `aides.VALEURS_TEST.hex_32`. La valeur est calculée à l'exécution par une suite arithmétique |
| `secrets-jamais-distribues.test.ts:128` *(private-key)* | seul l'en-tête PEM ; le corps est du base64 de prose française. `crypto.createPrivateKey` échoue en `ERR_OSSL_UNSUPPORTED` |
| `private-key-material.test.cjs:79` *(private-key)* | variable nommée `falsePositive` ; corps = base64 de « not ASN.1 key material ». Le test **échouerait** si c'était une vraie clé |
| `setup-dev-permissions.test.cjs:39` *(generic-api-key)* | base64 de bourrage `foobarbaz…`. `grep` dans le vrai `.env` : **0 occurrence** — le secret local est autre |

**Aucun secret réel n'est exposé.** Détail et citations de code dans
`MASTER6_EVIDENCE/logs/27-triage-gitleaks-ci.txt`.

**Et pourtant je n'ai pas ajouté ces cinq empreintes à l'allowlist.** C'est
délibéré. `tests/secret-scan-policy.test.cjs:35` impose que `.gitleaksignore` soit
*exactement* l'union de registres de triage hash-verrouillés, validés un à un par
`verifyFinding`, avec des compteurs assertés en dur (`669`, `290`, `957`, `2`,
`rows.length === summary.triagedTotal`) et un ensemble **fermé** de classifications
autorisées. Triager ces cinq signalements exigerait d'étendre cet ensemble dans une
bibliothèque de sécurité, d'ajouter cinq lignes hash-verrouillées et de corriger un
compteur de synthèse.

Autrement dit : faire passer ce job au vert reviendrait à **modifier un contrôle de
sécurité pour transformer un échec en succès**. Le mandat l'interdit explicitement,
et c'est une décision qui vous appartient. L'analyse est faite, les cinq empreintes
sont prêtes : le triage peut être conduit en une passe.

## 7. Vercel

**Un push sur `main` ne déclenche aucun déploiement, et ce n'est pas un échec.**

Vérifié à l'instant, en lecture seule :

```
vercel project inspect app.garageflows.fr
  -> aucune section Git : le projet n'est relié à aucun fournisseur Git
vercel ls app.garageflows.fr
  -> Age 2d | app.garageflows.fr | ● Ready | Production
```

Le seul déploiement de production reste celui d'il y a deux jours. Mon push n'en a
créé aucun, comme attendu.

| | |
|---|---|
| **adresse de production** | **https://app.garageflows.fr** |
| état | **en ligne** — `GET /` 307 vers `/login`, `GET /api/health` 200 `{"status":"ok"}` |
| commit déployé | **inchangé par cette mission** — déploiement antérieur de 2 jours |
| commit publié sur GitHub | `277e1f2` — **non déployé**, faute de liaison Git |

La production **n'a pas été modifiée** par cette mission. Pour que `main` déploie
automatiquement, il faut `vercel git connect` — c'est une modification de votre
configuration, qui changerait le comportement de tous les futurs push, et je ne l'ai
pas faite.

## 8. Anomalies restantes

| # | Anomalie | Nature |
|---|---|---|
| 0 | **CI rouge** : scan de secrets, 5 faux positifs vérifiés en attente de triage formel | **introduite par ce push** — §6.2 ; aucun secret réel, triage réservé au propriétaire |
| 1 | **CI rouge** sur `main` : job de validation authentifiée sans cible approuvée | configuration de dépôt — préexistante |
| 2 | **2 alertes Dependabot** (1 critique, 1 modérée) signalées par GitHub au push | portent sur un fichier `pip` d'un environnement d'audit figé, **pas** sur les dépendances du produit — voir `MASTER6_EVIDENCE/logs/21-dependabot.txt` |
| 3 | la **branche par défaut** du dépôt est `arena/84940ac2-garageflowsv2`, pas `main` | choix de configuration à trancher |
| 4 | **secrets exposés dans l'historique public** (3 fichiers retirés depuis) | rotation requise — P0 n°1 |
| 5 | **aucune liaison Git Vercel** : un push ne déploie pas | décision |
| 6 | chemins longs : un clone dans un répertoire profond échoue sous Windows | `git config --global core.longpaths true`, ou cloner dans un chemin court |

L'anomalie n°0 **a été introduite par cette publication** : le job de scan de
secrets était vert avant, il est rouge après. Elle ne porte sur aucun secret réel
(§6.2), mais elle est réelle et elle est la mienne. Les anomalies 1 à 6 sont
antérieures et indépendantes.

## 9. Ce que je n'ai pas fait

- **aucun `git push --force`**, aucun `reset --hard`, aucun `git clean -fd` ;
- **aucun historique réécrit**, aucun commit réécrit, aucune identité Git modifiée ;
- **aucune modification distante écrasée** : `483aae32d` est préservé et l'arbre est
  inchangé par la fusion ;
- **aucun secret publié** ;
- **aucune modification de la production** ni de la configuration Vercel ;
- **aucun manifeste de preuve régénéré** pour masquer un écart.

---

## 10. Note de traçabilité : deux push, et pourquoi

Un document qui enregistre le SHA d'une publication ne peut pas se trouver dans le
commit qu'il décrit. La publication s'est donc faite en deux temps, tous deux réels
et sans force :

| Push | Plage | Contenu |
|---|---|---|
| 1 | **`483aae3..277e1f2`** | **la totalité du travail validé** — code, preuves, 51 commits. C'est ce commit qui a passé `release:gate` 16/16 et que la CI a évalué (run `39963071669`) |
| 2 | **`277e1f2..cf8f8f1`** | **ce document** et le triage gitleaks — de la documentation uniquement, aucun changement de code |

Le commit de référence pour le **contenu** est donc `277e1f2`. Le second push
n'ajoute que des fichiers Markdown et un journal de preuves.

Le SHA final de `main` se lit à tout moment par :

```
git ls-remote origin refs/heads/main
gh api repos/supremperf/GarageFlowsV2/commits/main -q .sha
```

Si ce fichier a lui-même été amendé après `cf8f8f1`, c'est pour la même raison, et
la commande ci-dessus reste la source de vérité.
