---
doc-numbers: journal
---

# CORRECTIONS MASTER 5 — liste exhaustive

Toutes les modifications apportées au dépôt, avec leur motif mesuré. Aucune autre modification de code n'a été faite.

## 1. Fichiers de code et de configuration modifiés — 11

| Fichier | Nature | Motif mesuré |
|---|---|---|
| `.gitignore` | 1 bloc final ajouté | Quatre motifs `.env*` (lignes 119, 137, 184, 193) annulaient le `!.env.example` de la ligne 157 — c'est le **dernier** motif correspondant qui décide. `vercel link` en ajoute un à chaque exécution. Conséquence : `.env.example` (28 ko de contrat documenté, sans valeur) n'était pas suivi, et le contrôle GF-DUR-044 échouait sur son absence. Les deux négations sont réaffirmées **après** tous les `.env*`, avec la consigne de les y maintenir. |
| `.vercelignore` | 2 blocs ajoutés | `prisma/dev.db` et `prisma/e2e.db` étaient téléversés vers la plateforme de build (inutile, mauvaise hygiène) ; exception explicite pour le modèle committé, requis par `post-build.js`. Les dossiers de preuves et artefacts locaux sont exclus. |
| `scripts/gen-production-sbom.mjs` | résolution de l'exécutable npm + normalisation de l'identité racine | (a) `spawnSync('npx', …)` échoue en `ENOENT` sous Windows (`npx` y est `npx.cmd`) : toute la chaîne SBOM était inutilisable sur la plateforme cible. Le script JS de npm livré avec l'interpréteur est désormais résolu et lancé par `process.execPath`, **sans shell**. (b) `npm sbom` renseigne `metadata.component.name` avec le nom du **répertoire** de travail : la SBOM versionnée portait `GarageFlowsV2`, et `sbom:verify` ne pouvait réussir que dans un dossier portant exactement ce nom. Le nom est aligné sur `package.json` (`garageflow`), comme `purl` et `bom-ref` l'étaient déjà. |
| `scripts/gen-third-party-notices.mjs` | 4ᵉ source de texte, locale et verrouillée | Deux paquets de production ne publient aucun fichier de licence dans leur tarball. Ajout d'une dernière étape : le magasin local `docs/licenses/upstream/`, dont chaque texte est **vérifié contre son SHA-256** avant usage — une empreinte divergente fait ÉCHOUER la génération. La génération reste déterministe et hors-ligne. |
| `scripts/rapport-10-parcours.mjs` | condition de verdict + en-tête | Le script **exigeait** la présence d'une `PrismaClientInitializationError` pour valider un fichier mis en quarantaine. Prisma réparé, le fichier s'arrête proprement : le rapport échouait donc **parce que l'environnement avait été réparé**. Le critère est désormais « assertions vertes, aucun échec » ; l'erreur d'environnement est enregistrée quand elle survient, jamais réclamée. |
| `scripts/reproduce-keygen-roundtrip.mjs` | délai + résolution de l'interpréteur | Délai Python de 10 s dépassé par le **premier** démarrage de l'interpréteur sous charge parallèle (alias Windows Store + import de `cryptography`) : tout le fichier de tests échouait, de façon non déterministe. Porté à 60 s — garde-fou contre un blocage, pas une mesure de performance. Résolution élargie aux formes Windows (`.venv/Scripts/python.exe`, `python3`, `python`), chacune sondée avant usage. |
| `e2e/audit.mjs` | chemin du navigateur | `executablePath: process.env.CHROME_PATH \|\| '/opt/pw-browsers/chromium'` — chemin d'une image CI Linux codé en dur. Sur Windows, l'audit s'arrêtait sur « Failed to launch chromium » avant la moindre mesure. Repli désormais sur le Chromium installé par Playwright ; le chemin CI n'est retenu que s'il existe réellement. |
| `src/integration/purchase-order-receive-returned.test.ts` | 1 assertion | `expect(src).toContain("fetch('/api/purchase-orders')")` échouait sur du code **correct** : le produit passe un `AbortSignal`. La seule façon de verdir sans corriger l'assertion aurait été de **retirer l'annulation**. L'assertion porte maintenant sur l'appel, pas sur sa forme littérale ; la garantie est identique. |
| `tests/gitleaks-ci.test.cjs` | 1 assertion conditionnée à la plateforme | `assert.equal(fs.statSync(dir).mode & 0o777, 0o700)` : NTFS n'a pas de bits POSIX, la valeur mesurée est `0o666`. 5 tests échouaient **sur la plateforme cible du produit**. Le caractère « répertoire » est vérifié partout, le mode POSIX hors win32 seulement — même convention que les deux tests `setup-dev-permissions.test.cjs` déjà ignorés sous win32. |
| `THIRD_PARTY_NOTICES.md` | régénéré depuis la clôture **Linux** | Les deux textes manquants sont complétés (voir §3). 133 sections, **0 texte manquant**. Généré dans un conteneur Linux pour que la clôture corresponde au déploiement Vercel. |
| `docs/sbom/sbom-garageflowsv2.cdx.json` | **une seule ligne** | `metadata.component.name` : `"GarageFlowsV2"` → `"garageflow"`. Les 133 composants sont inchangés. |

## 2. Fichiers ajoutés — 4 scripts, 1 magasin de licences

| Fichier | Rôle |
|---|---|
| `scripts/refresh-upstream-licenses.mjs` | Récupère et **verrouille par SHA-256** les textes de licence des paquets qui n'en embarquent aucun. Séparé de la génération pour que celle-ci reste déterministe et hors-ligne. `--check` ne touche jamais le réseau. |
| `scripts/reconcile-windows-artifact-sbom.mjs` | Réconcilie le contenu **réellement empaqueté** (y compris l'intérieur de `app.asar`, lu par `@electron/asar`) avec la SBOM et les notices, **dans les deux sens**. Clôture la demande de `SBOM_WINDOWS_FINAL.md §4`. |
| `scripts/build-master5-readiness.mjs` | Assemble le dossier de preuves attendu par `readiness:final` : copie les journaux, calcule les empreintes, écrit le manifeste. Il ne juge rien et refuse d'assembler si une preuve déclarée est absente ou si un marqueur de réussite est introuvable. |
| `docs/licenses/upstream/sources.json` + 2 fichiers `.txt` | Magasin local des textes récupérés, avec provenance et empreinte. |

## 3. Les deux textes de licence incomplets — résolus

MASTER 4 : « `client-only` et `next-auth` restent sans texte local complet ». Les deux tarballs publiés ne contiennent effectivement aucun fichier de licence (vérifié fichier par fichier).

### `next-auth@4.24.15` — texte faisant foi

| | |
|---|---|
| licence déclarée | ISC |
| source | `https://raw.githubusercontent.com/nextauthjs/next-auth/next-auth%404.24.15/LICENSE` |
| référence | `refs/tags/next-auth@4.24.15` → commit `d857eec560fb99c8b18d3b22a2693b849a62d1c3` (tag résolu via l'API GitHub, daté du 2026-07-20) |
| SHA-256 du texte | `cf5c8f6c5d858d6b0f356ee78e1796639e8cfd4c48db4f18c21ea21a973887ae` |
| titulaires | « Copyright (c) 2018-2021, Iain Collins » et « Copyright (c) 2021-2025, Better Auth Inc. » |

Le dépôt amont est celui déclaré par le paquet lui-même, et le texte est pris **au tag exact de cette publication**.

### `client-only@0.0.1` — identifiant déclaré, titulaire non publié

| | |
|---|---|
| licence déclarée | MIT (champ `license` du `package.json` publié) |
| dépôt amont | **aucun** — le champ `repository` est absent de la publication npm |
| mainteneur npm | `sebmarkbage` ; page d'accueil déclarée : `https://reactjs.org/` |
| source du texte retenu | `https://spdx.org/licenses/MIT.txt` |
| SHA-256 du texte | `b85dcd3e453d05982552c52b5fc9e0bdd6d23c6f8e844b984a88af32570b0cc0` |

Aucun titulaire de droits n'a été inventé. La notice le dit explicitement :

> Texte de RÉFÉRENCE SPDX de l'identifiant « MIT » déclaré par l'éditeur dans son package.json.
> L'éditeur ne publie AUCUNE ligne de copyright : aucun titulaire de droits n'est donc affirmé ici.

**Ce point relève d'une relecture juridique** : il est consigné dans `ACTIONS_MANUELLES_RESTANTES.md`.

### Résultat

```
sections de texte : 133
textes MANQUANTS  : 0
tests SBOM/notices : 11/11
gen-production-sbom --check (sur Linux) : PASS — 133 composants, identités installées,
                                          graphe et notices concordants
```

## 4. Dépendances : aucune modification

`package.json` et `package-lock.json` sont **inchangés**. L'installation s'est faite par `npm ci`. Aucune mise à jour, aucun `npm audit fix`, aucun override ajouté ou retiré.

## 5. Opérations sur le dépôt — 2 commits locaux, autorisés, aucun push

| | |
|---|---|
| état initial | le dossier n'était suivi par **aucun** dépôt : le dépôt englobant était enraciné sur le dossier utilisateur, suivait 0 fichier GarageFlows sur 16 535, et ses 3 commits concernaient un autre projet |
| action | `git init -b main` dans le dossier du projet, puis 2 commits **locaux** |
| commit 1 | `7c93676cd904b80793ba642b3b46291354b6ac97` — instantané initial, 2 862 fichiers |
| commit 2 | corrections MASTER 5 + preuves (empreinte dans `PRODUCTION_FINAL_VERDICT.md`) |
| remotes | **0** — aucun push, aucune publication |
| exclusions vérifiées avant ajout | `node_modules`, `.next`, `dist`, `.env`, `.env.local`, `keys/*.pem`, `src/generated`, `prisma/*.db` : tous ignorés |

Pourquoi c'était nécessaire, en quatre conséquences mesurées : le contrôle de sécurité GF-DUR-044 était **inerte** (`git ls-files` → 0 fichier) ; Gitleaks n'avait aucun historique à scanner ; `post-build.js` produisait un `release-manifest.json` **sans `buildId`**, donc un artefact non rattachable ; et `readiness:final` exige un `baseCommit` SHA-1 que le projet n'avait pas.

## 6. Outils installés sur le poste

| Outil | Version | Source | Usage |
|---|---|---|---|
| moteurs Prisma | 5.22.0 (hash `6051973…`) | `binaries.prisma.sh` officiel, TLS vérifié | génération des clients |
| Chromium Playwright | Chrome for Testing 151.0.7922.34 (v1234) | `cdn.playwright.dev` officiel | tests E2E |
| Gitleaks | `v8@latest` | `go install github.com/zricethezav/gitleaks/v8` | scan de secrets |
| client PostgreSQL | psql 17.11 | archive binaire officielle PostgreSQL (EnterpriseDB), **extraite sans installation ni service** | porte PostgreSQL |
| Tesseract OCR | 5.4.0.20240606 | winget `UB-Mannheim.TesseractOCR` | test OCR réel du scanner de secrets |
| conteneurs jetables | `postgres:17-alpine`, `redis:7-alpine`, `node:22-bookworm` | Docker Hub officiel | PostgreSQL et Redis réels, vérification Linux |

`C:\Program Files\Tesseract-OCR` a été ajouté au PATH **utilisateur** pour que `npm run test:keygen` le trouve sans manipulation.

## 7. Sondes jetables créées, jamais livrées

Toutes dans des dossiers `.tmp-*/`, ignorés par git et exclus du téléversement Vercel :

| Dossier | Rôle |
|---|---|
| `.tmp-smtp-probe/` | envoi SMTP réel contre un serveur local jetable (5 contrôles) |
| `.tmp-func-audit/` | audit fonctionnel par les API HTTP réelles (40 contrôles) |
| `.tmp-linux-verify/` | vérification Linux en conteneur (Prisma natif, SBOM, notices) |
| `.tmp-diag-planning/` | sonde de diagnostic d'un faux positif de l'audit responsive |

## 8. Ce qui n'a PAS été modifié

- `tsconfig.json`, `tsconfig.scripts.json`, `tsconfig.seed.json` — `strict` reste actif ;
- `vitest.config.mts`, `playwright.config.ts` ;
- `perf-budget.json` — aucun plafond relevé ;
- `.gitleaks.toml`, `.gitleaksignore` — aucune exemption ajoutée ;
- `scripts/final-release-gate.mjs`, `scripts/production-readiness.cjs` — aucune porte affaiblie, aucun contrôle retiré de `REQUIRED_CHECKS` ;
- `src/lib/license/**` — HWID V1, clé publique, machine à états, vérification : intacts ;
- `electron/main.js`, `electron/preload.js`, `electron/user-data-path.js` ;
- `prisma/schema.prisma`, `prisma/server/schema.prisma`, les 22 migrations serveur, `prisma/garageflow-template.db` ;
- `prisma/dev.db` — non réinitialisée ;
- les preuves `MASTER4_EVIDENCE/` — intactes, 69/69 empreintes vérifiées au début de la mission.
