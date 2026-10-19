# `npm run dist` sous Windows — « Public anchors disagree » puis EPERM de traçage (2026-10-19)

<!-- doc-numbers: journal -->

Branche `arena/642ba7c2-garageflowsv2`, partie de `e6710cf` (contenu identique à
`main` `483aae3`). Commits : `8c982a5c` (ancres), `17fee5da` (traçage).

Verdict de la mission : **SUCCÈS PARTIEL** — chaîne complète exécutée et réussie
sur Windows réel (runner GitHub), **pas** sur le poste du signalement
(Windows 10 19045, Node 22.23.2, npm 10.9.8), dont la copie de travail n'est pas
accessible d'ici.

## 1. Erreur signalée : `Public anchors disagree; no key file written`

### Les trois ancres

| Ancre | Fichier | Rôle |
|---|---|---|
| `_PK` | `electron/main.js` | clé publique vérifiée par le processus principal Electron |
| `_LINES` | `src/lib/license/public-key.ts` | clé publique vérifiée par le serveur Next embarqué |
| `REFERENCE_FP` | `src/lib/license/__tests__/public-key-consistency.test.ts` | empreinte attendue, gelée par test |

`scripts/materialize-build-public-key.cjs` (appelé par `preflight:release`) les
compare après normalisation (SPKI DER → SHA-256) et n'écrit `keys/public.pem` que
si elles concordent.

### État du dépôt

Dans les 128 commits de l'historique, les trois ancres concordent. Valeur
actuelle : `bd8c08451489fb83cef0347b04801018c24cb026f88caffe8995bf9a7a9861e3`,
paire de licence de production depuis le 2026-08-16 (commit `2d15729c`).
La **référence légitime** est la clé privée de production, détenue sur le poste
de signature (`GF_PRIVATE_KEY` / `keys/private.pem`, jamais dans le dépôt) ; la
seule propagation prévue vers les ancres est `npm run keys:sync`.

### Cause

L'erreur ne vient pas du dépôt mais d'une **copie de travail divergente**. Les
outils du dépôt rendaient cette divergence facile à produire :

| Défaut | Effet | Correction |
|---|---|---|
| `keygen.py --init` réécrivait des clés existantes sans prévenir | nouvelle paire locale, ancres d'une autre clé | refus (exit 2) si des clés existent ; écriture exclusive |
| instructions de copier-coller (`keygen.py`, `keygen_ui.py`) sans `REFERENCE_FP` | deux ancres mises à jour sur trois | instructions remplacées par `keys:sync` |
| `keys:sync` écrivait fichier par fichier, premier motif trouvé | interruption → mélange ; déclaration dupliquée → mauvaise cible | écriture tout-ou-rien, refus des ambiguïtés |
| `reset-garageflow.ps1` : `[regex]::Replace(s, p, r, 1)` | le `1` est `RegexOptions.IgnoreCase`, pas « une seule occurrence » | remplacement unique explicite |
| message d'erreur sans détail ; trace brute dans `preflight-release` | impossible de savoir quelle ancre diverge | diagnostic par ancre (✓/✗, clé retirée, fichier modifié selon git, cause probable, remèdes) ; refus d'empaquetage clair, exit 1 |

La vérification reste **bloquante** ; son message garde le préfixe
`Public anchors disagree` (code `GF_PUBLIC_ANCHORS_DISAGREE`).

## 2. Étape suivante du même pipeline : EPERM dans `next build`

Le runtime Prisma embarque `dotenv`, qui lit `path.join(os.homedir(), …)`. Le
traçage `@vercel/nft` de Next en fait un glob `<profil>/**/*` et ne l'abandonne
que si `path.relative(outputFileTracingRoot, glob)` commence par `..\`.

| Projet | Profil | Chemin relatif | Résultat |
|---|---|---|---|
| `C:\Users\Jean\Desktop\GarageFlowsV2` | `C:\Users\Jean` | `..\..\**\*` | ignoré |
| `D:\Projets\GarageFlowsV2` | `C:\Users\Jean` | `C:\Users\Jean\**\*` | **parcouru → EPERM** |
| `D:\a\GarageFlowsV2\GarageFlowsV2` (runner) | `C:\Users\runneradmin` | absolu | **parcouru → EPERM** |

Les jonctions héritées `Application Data` et `Cookies` refusent l'énumération à
tout utilisateur. L'ancien contournement CI (`USERPROFILE=D:\gf-build-home`)
marchait parce que ce dossier est sur le lecteur du projet. `outputFileTracingExcludes`
ne s'applique pas à ce traceur (exclusions codées en dur dans Next).

Correctif : `scripts/next-build.cjs`, appelé par `npm run build`. Uniquement quand
le profil est hors d'atteinte de l'exclusion, `next build` (et lui seul) reçoit un
dossier personnel vide sous `node_modules/.cache/gf-build-home`, déjà exclu par la
règle `**/node_modules/**` de Next. Aucun fichier du projet n'est exclu, le code de
sortie est conservé ; une trace incomplète serait détectée par `verify:standalone`
et `verify:installer`. Le contournement a été **retiré** du workflow.

## 3. Preuves d'exécution Windows (runner `windows-latest`, Node 22.23.3)

| Run | Commit | Contournement d'environnement | `npm run dist` | Installation éprouvée |
|---|---|---|---|---|
| 39245918102 | `8c982a5c` | oui (ancien workflow) | réussi | réussie |
| 39246744400 | `17fee5da` | **non** — `workspaceRoot=D:\a\…`, profil sur `C:` | réussi | réussie |

Étapes du run 39246744400, toutes réussies : `preflight:release`, `build`
(Prisma ×2, `next build`, `postbuild`), `verify:standalone`, `electron-builder`
26.15.3 (Electron 41.10.6, NSIS), `check:artifact-secrets`, `check:artifact-fuses`
(7 fusibles conformes au plan), `verify:installer`.

Reçu de livraison (run 39246744400) :

```json
{"file":"release/GarageFlows-Setup.exe","version":"1.1.0","commit":"17fee5da8e6856a3b9ed2bffa8b953f726147cfd","dirty":false,"size":231063932,"sha256":"200d9f86eceb08d857dcf5ebd177259098388f300541da4bbb7aeca6aab8f9e3","platform":"win32","arch":"x64","payloadFiles":3045,"payloadVerified":true,"offlinePayloadEmbedded":true,"extractionMode":"embedded-7z-sfx","authenticodeVerified":false,"cleanMachineLicensedBusinessWorkflowVerified":false}
```

Smoke d'installation : installeur exit 0, fenêtre d'activation ouverte, lancement
depuis un chemin restreint, sentinelle SQLite écrite, composants serveur installés
vérifiés, données conservées à la réinstallation et à la désinstallation.

**Non couvert** : signature Authenticode (`NotSigned`), parcours métier sous
licence, OS vierge sans outils de build, poste du signalement. Le job
« Authenticated browser validation » échoue aussi sur `main` :
`MISSING_INPUT:BASE_URL` (cible de staging approuvée non configurée).

## 4. Dépendances

`npm audit` et `npm audit --omit=dev` : 0 vulnérabilité à tous les niveaux. Les
dépréciations restantes sont transitives et de développement uniquement
(`glob@7`/`inflight` via electron-builder/asar, `rimraf@2` via
electron-winstaller, `eslint` 8) ; aucune montée de version majeure à l'aveugle.

## 5. Sur le poste du signalement

1. Récupérer la branche, puis `node scripts/materialize-build-public-key.cjs` :
   le diagnostic indique l'ancre divergente et si le fichier est modifié selon git.
2. Ancre modifiée sans rotation voulue :
   `git restore --source=HEAD -- electron/main.js src/lib/license/public-key.ts src/lib/license/__tests__/public-key-consistency.test.ts`.
   Rotation approuvée : `npm run keys:sync` avec la clé privée correspondante.
3. `npm ci`, puis `npm run dist`.

## 6. Pistes non traitées (hors périmètre, à décider)

- `EnableEmbeddedAsarIntegrityValidation` reste à `false` conformément au plan de
  fusibles ; electron-builder 26 écrit désormais la ressource d'intégrité ASAR
  (« updating asar integrity executable resource ») — l'activer serait un
  durcissement à éprouver séparément.
- Signature Authenticode : certificat requis.
