---
doc-numbers: journal
---

# GITLEAKS — état final MASTER 5

**Verdict : EXÉCUTÉ.** Working tree et historique scannés. **0 secret exploitable** dans le contenu versionné. Une limite d'environnement est nommée explicitement : l'historique disponible localement ne compte qu'un commit.

Aucune valeur secrète ne figure dans ce document ni dans les rapports JSON : tous les scans ont été lancés avec `--redact`.

## 1. État MASTER 4

`BLOCKED / NOT RUN` — Gitleaks, Go, Docker et Podman absents de l'hôte. Les scans n'avaient jamais été exécutés, et le rapport refusait à juste titre de revendiquer « zéro finding ».

## 2. Outil installé depuis sa source officielle

```
$ go install github.com/zricethezav/gitleaks/v8@latest   (go1.27.0 windows/amd64)
→ C:\Users\<user>\go\bin\gitleaks.exe  (24 998 912 octets)
```

L'homonyme NPM n'a pas été utilisé.

## 3. Scan du WORKING TREE — invocation canonique du projet

Commande identique à celle de `scripts/gitleaks-ci.cjs` (hors `--report-path`) :

```
gitleaks dir . --config .gitleaks.toml --redact --no-banner --report-format json
scanned ~133 530 935 octets (133,53 Mo) en 25,2 s
leaks found: 7            exit 1
```

Preuves : `MASTER5_EVIDENCE/logs/11-gitleaks-canonical.txt`, `MASTER5_EVIDENCE/gitleaks-canonical.json`.

## 4. Scan de l'HISTORIQUE GIT

```
gitleaks git . --config .gitleaks.toml --redact --no-banner --log-opts=--all
1 commits scanned.
scanned ~124 377 952 octets (124,38 Mo) en 1 min 7 s
leaks found: 6            exit 1
```

Preuves : `MASTER5_EVIDENCE/logs/29-gitleaks-history.txt`, `MASTER5_EVIDENCE/gitleaks-history.json`.

### Limite à ne pas lire de travers

Le dépôt local a été **initialisé pendant cette mission** (voir `AUDIT_COMPLET_GARAGEFLOWS.md §Dépôt`) : son historique compte **1 commit**, qui contient l'intégralité de l'arbre. Le scan d'historique couvre donc tout le CONTENU actuel, mais **pas** les révisions antérieures du projet.

L'historique de référence existe ailleurs : `scripts/check-github-security.cjs` et `scripts/restore-public-anchors.cjs` désignent le dépôt amont **`supremperf/GarageFlowsV2`**. Ce dépôt n'est pas présent sur ce poste et aucun accès n'a été fourni. Scanner son historique complet reste une action à mener là où il est cloné — c'est consigné dans `ACTIONS_MANUELLES_RESTANTES.md`.

Le commentaire d'en-tête de `src/lib/__tests__/secrets-jamais-distribues.test.ts` conserve par ailleurs le constat d'un scan antérieur sur 377 commits : trois valeurs avaient été exposées dans le premier commit historique (`NEXTAUTH_SECRET`/`GARAGEFLOW_API_KEY` partageant la même valeur, et un `MASTER_SECRET` codé en dur dans un script supprimé depuis). Ces valeurs ont été rotées et doivent rester considérées comme publiques à jamais. MASTER 5 ne rejoue pas ce scan — l'historique correspondant n'est pas disponible ici — et ne le revendique pas non plus.

## 5. Triage des 7 findings — aucun secret exploitable

| # | Règle | Emplacement | Classement |
|---|---|---|---|
| 1 | `generic-api-key` | `.env` : 63 (`NEXTAUTH_SECRET`) | **Secret LOCAL réel, jamais versionné.** Généré par `scripts/setup-dev.js` sur ce poste pendant cette mission. `.env` est gitignoré : absent du scan d'historique, absent de l'artefact Windows (`check:artifact-secrets` le confirme), absent du téléversement Vercel (`.vercelignore`). En CI ce fichier n'existe pas — d'où 6 findings et non 7. |
| 2 | `generic-api-key` | `configuation automatique/tests/03-synchronisation.test.js` : 124 | Fixture de test (`GF_DB_MAC_SECRET` factice). |
| 3 | `jwt` | `configuation automatique/tests/02-moteur.test.js` : 255 | Fixture de test (JWT factice). |
| 4 | `private-key` | `src/lib/__tests__/secrets-jamais-distribues.test.ts` : 128 | **Entrée de détecteur, pas une clé.** Bloc `-----BEGIN PRIVATE KEY-----` dont le corps est le base64 de la phrase « documentation, hash de contenu et données de test » ; le test prouve que le détecteur ne le confond PAS avec une clé. |
| 5 | `private-key` | `tests/private-key-material.test.cjs` : 79 | Même motif : base64 de « not ASN.1 key material ». |
| 6-7 | `generic-api-key` (×2, dont une variante décodée base64) | `tests/setup-dev-permissions.test.cjs` : 39 | Fixture : `Zm9vYmFyYmF6cXV4c2VjcmV0MTIzNDU2Nzg5MA==` = base64 de `foobarbazquxsecret1234567890`. |

Aucune de ces valeurs n'ouvre un accès. Aucune rotation n'est requise. Aucune clé de production n'a été révoquée.

## 6. `.gitleaksignore` n'a PAS été modifié

Les 6 findings versionnés ne sont pas ajoutés à la liste d'exemptions. `tests/secret-scan-policy.test.cjs` verrouille cette liste au fingerprint près (`assert.deepEqual`) et exige, pour chaque suppression, un reçu de triage verrouillé par SHA-256. Ajouter des entrées sans ce processus aurait affaibli un contrôle de sécurité pour obtenir un vert. Le choix retenu : **laisser le contrôle sortir en code 1 et documenter le triage ici**.

## 7. Vérification INDÉPENDANTE de la propriété GF-DUR-044

Le contrôle d'origine (`scanVersionedPrivateKeys`) s'appuie sur `git ls-files`. Avant l'initialisation du dépôt, il renvoyait **0 fichier** : le contrôle passait ses assertions de contenu sans rien inspecter. La même propriété a donc été vérifiée par un parcours du **système de fichiers**, avec le détecteur du produit (`scripts/lib/private-key-material.cjs`) :

```
fichiers rencontrés           : 3100
fichiers texte analysés       : 2715
fichiers binaires ignorés     : 385
fichiers .pem / .key / .p12 / .pfx : 0
anomalies de parcours         : 0
MATIÈRE DE CLÉ PRIVÉE         : 0
RESULT=PASS
```

Preuve : `MASTER5_EVIDENCE/logs/13-fs-private-key-scan.txt`.

Après l'initialisation du dépôt, le contrôle d'origine inspecte réellement **2 864 fichiers suivis** et passe.

## 8. Autres contrôles de secrets exécutés

| Contrôle | Résultat |
|---|---|
| `check:artifact-secrets` (win-unpacked 2 885 fichiers + Setup.exe) | aucune clé privée, aucune valeur de secret |
| `scripts/post-build.js` | `.env` retiré du paquet ; 0 clé privée dans `standalone` |
| `npm run test:secret-scan` (39 tests, OCR Tesseract réel inclus) | 39/39 OK |
| `scripts/verify-rotation.mjs` (porte de release, sur `.env` réel) | OK |
