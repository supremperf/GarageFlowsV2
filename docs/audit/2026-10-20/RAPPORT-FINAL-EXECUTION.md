# GarageFlows — rapport final d'exécution (2026-10-20)

**Branche :** `arena/74f9663f-garageflowsv2` · **Base :** `3304675`
**Environnement :** Linux 6.1 · Node 22.22.3 · Python 3.11.2 · pas de Wine · pas de Tesseract
**Périmètre :** Axe A (licences, keygen, HWID, mises à jour, OCR, packaging)
et Axe B (environnement, rotation sélective, preuves).

> Aucune valeur de secret, clé privée ou jeton n'apparaît dans ce rapport.
> Les statuts sont strictement **VALIDÉ / ÉCHEC / BLOQUÉ / NON TESTÉ**. Un statut
> BLOQUÉ ou NON TESTÉ n'est jamais requalifié en VALIDÉ.

---

## 1. Livrables

### 1.1 Keygen — interface et offres

| Livrable | Fichier | État |
|---|---|---|
| 10 sections réelles, entièrement en français | `scripts/keygen_ui.py` | VALIDÉ (logique), NON TESTÉ (rendu Tk) |
| Offres commerciales **PREMIUM / ADMIN** uniquement | `scripts/keygen_core.py`, `scripts/keygen_ui.py` | VALIDÉ |
| Types historiques décodables, signables seulement via `--legacy-type` | `scripts/keygen.py` | VALIDÉ |
| Agrégations clients / appareils / tableau de bord | `scripts/keygen_db.py` | VALIDÉ |
| Normalisation `expiryAt → expiresAt` du serveur | `scripts/keygen_server.py` | VALIDÉ |
| Diagnostic `--verify-key-match` | `scripts/keygen_ui.py` | VALIDÉ |
| Tests | `scripts/test_keygen.py` (20), `scripts/test_keygen_hwid_binding.py` (10), `scripts/test_keygen_v2.py` (88) | VALIDÉ |

Les dix sections : Tableau de bord · Générer une licence · Gérer les licences ·
Clients · Appareils et HWID · Clés ECC · Mises à jour · Détection des secrets ·
Journaux et diagnostics · Paramètres et serveur.

Aucune clé privée n'est affichée, recherchée ni reconstruite. Le keygen ne calcule
jamais de HWID : il valide et signe celui fourni par Electron.

### 1.2 HWID V1 et activation

- Format `HWID1-<64 hex>`, préfixe `GF-HWID-V1\n`, champs
  `cpu,diskSerial,mac,machineId,platform` normalisés NFC, ordre fixe.
- Implémentations alignées : `electron/main.js`, `src/lib/license/hwid-v1.ts`,
  `scripts/keygen_core.py` (validation), vecteurs partagés
  `tests/fixtures/hwid-v1-vectors.json`.
- Electron reste l'autorité ; le serveur décide de l'association et du plafond
  `seats`. Aucun HWID n'est recalculé côté Python.
- Tests : `src/lib/license/__tests__/hwid-v1.test.ts` (7) et
  `scripts/test_keygen_hwid_binding.py` (10) → **VALIDÉ**.

### 1.3 Mises à jour signées (Ed25519)

| Livrable | Fichier |
|---|---|
| Commande unique | `scripts/gf_sign_update.js`, `npm run sign-update` |
| Signeur unique | `scripts/sign-release-manifest.mjs` |
| Vérificateur client réel | `electron/update-verify.js` via `scripts/keygen-verify-update.cjs` |
| Tests | `tests/update-signing-cli.test.cjs` (8/8), `src/lib/__tests__/release-signing-chain.test.ts` (20), `src/lib/__tests__/update-verify.test.ts` (28) |

Contrôles effectifs : type Ed25519, correspondance avec l'ancre publique du
`keyId`, produit/plateforme/canal, SHA-256, taille, anti-downgrade, URL HTTPS et
domaine autorisé, vérification immédiate du manifeste par le module client.

Preuve en conditions réelles : une clé Ed25519 étrangère présentée pour
`gf-update-2026-2` est refusée (code 1) avec un message explicite, sans jamais
afficher la clé. **VALIDÉ**.

Limite : aucune clé privée de production n'est présente dans cet environnement ;
la signature d'un vrai installeur n'a donc pas été rejouée.

### 1.4 Détection de secrets par OCR

| Livrable | Fichier |
|---|---|
| 22 règles versionnées | `patterns.toml` |
| Détection, masquage, OCR, service HTTP, CLI | `scripts/secret_scan.py` |
| 32 tests | `scripts/test_secret_scan.py` |
| Écran Keygen | `PageSecrets` dans `scripts/keygen_ui.py` |
| Documentation | `docs/SECRET_SCAN.md` |

Comportements prouvés :

- texte avec clé OpenAI → `blocked=true`, valeur `sk-****` (VALIDÉ) ;
- capture PNG sans Tesseract → **HTTP 503 `OCR_UNAVAILABLE`** (fail-closed) ;
- `Origin` non locale → **403** ; format non supporté → **415** ;
- bind `0.0.0.0` → refus `ScanError` ;
- `GF_SCREENSHOT_SCAN_PERSIST=true` → refus au démarrage ;
- aucune image écrite sur disque ; aucun texte OCR brut renvoyé.

**VALIDÉ** pour le pipeline et le service. **BLOQUÉ** pour l'OCR réel : le binaire
Tesseract est absent de l'environnement, donc aucune capture réelle n'a été lue.

### 1.5 Environnement et rotation

- `scripts/garageflow-env-manifest.json` : **142 variables canoniques**,
  8 alias interdits, 53 variables plateforme.
- `ENVIRONMENT-VARIABLES.md` régénéré ; `check:env-consistency` → **exit 0**.
- `.env.example` documente les 8 variables `GF_SCREENSHOT_*` et
  `GF_UPDATE_DOWNLOAD_BASE_URL`.
- Plan Phase 2 détaillé dans `docs/ROTATION_SECRETS.md` §3 :
  `GF_SMTP_CIPHER_KEY` + `_OLD`, re-chiffrement, retrait contrôlé ; rotation
  groupée des sessions/appareils/API ; secrets à ne jamais roter aveuglément.
- `config-rebuild.cjs` continue de refuser une base non vide (aucune donnée
  effacée pour « simplifier »).

Les preuves d'une campagne antérieure (8 secrets rotés, 11 `recordMac`
recalculés, 5 appareils désactivés, déploiement Vercel vérifié) sont conservées
dans `docs/audit/2026-10-20/`. Elles n'ont **pas** été rejouées dans cette
session : aucun accès Vercel/Neon n'était disponible.

---

## 2. Résultats des tests

| Contrôle | Commande | Résultat | Statut |
|---|---|---|---|
| Keygen historique | `python3 scripts/test_keygen.py` | 20/20 | **VALIDÉ** |
| HWID V1 | `python3 scripts/test_keygen_hwid_binding.py` | 10/10 | **VALIDÉ** |
| Keygen V2 (IHM, offres, serveur, updates) | `python3 scripts/test_keygen_v2.py` | 88/88 | **VALIDÉ** |
| Détection de secrets | `python3 scripts/test_secret_scan.py` | 32/32 | **VALIDÉ** |
| Chaîne de release (Node) | `npm run test:release-safety` | 166/166 | **VALIDÉ** |
| Configuration / rotation | `npm run test:config` | 245/245 | **VALIDÉ** |
| Ciblé licences, updates, env, chiffrement | `npx vitest run` (9 fichiers) | 108 réussis, 2 ignorés | **VALIDÉ** |
| TypeScript | `npx tsc --noEmit` | 0 erreur | **VALIDÉ** |
| ESLint | `npx eslint . --max-warnings=0` | 0 erreur | **VALIDÉ** |
| Audit npm | `npm audit` | 0 vulnérabilité (toutes sévérités) | **VALIDÉ** |
| Cohérence dépôt + env | `npm run check:consistency` | exit 0 (comparaison PEM ignorée, `keys/public.pem` absent) | **VALIDÉ** |
| Build Next de production | `node scripts/next-build.cjs` | exit 0 | **VALIDÉ** (voir réserve) |
| Vitest complet | `npx vitest run` | 3 521 réussis · **3 échecs** · 855 ignorés · 81 suites bloquées | **ÉCHEC** |
| `npm run build` complet | `npm run build` | échec `prisma generate` (téléchargement moteur) | **BLOQUÉ** |
| `npm run dist` | — | pas de binaire Electron, pas de Wine, cible Windows | **BLOQUÉ** |
| Installation réelle de l'installeur | — | aucun installeur produit | **NON TESTÉ** |
| Rendu graphique Tk | — | pas d'affichage dans le conteneur | **NON TESTÉ** |
| OCR réel sur capture | — | Tesseract absent | **BLOQUÉ** |
| Activation réelle Neon/Vercel | — | aucun identifiant de production dans cette session | **NON TESTÉ** |
| Signature Authenticode | — | aucun certificat | **NON TESTÉ** |

### Réserve sur le build Next

Le build a réussi après copie **locale et non commitée** des artefacts wasm
Prisma (`query_engine_bg.*`), absents parce que `prisma generate` ne peut pas
télécharger ses moteurs depuis `binaries.prisma.sh` dans ce bac à sable. Cette
copie est dans des dossiers ignorés par Git (`src/generated/`, `node_modules/`).
Le build valide la compilation du code, **pas** une chaîne de génération Prisma
complète hors ligne.

### Les 3 échecs vitest

`src/test-utils/__tests__/prepare-test-db.test.ts` échoue trois fois parce que
`prisma db push` tente de télécharger `libquery_engine` et que le réseau du bac à
sable refuse la connexion TLS. Les 80 autres suites bloquées ont la même cause
(`beforeAll` interrompu). Aucun test produit n'a échoué pour une raison
fonctionnelle : le correctif du keygen (`ENTREPRISE` → `ADMIN`) et la
normalisation `expiryAt` sont couverts et verts.

---

## 3. Interdictions respectées

| Interdiction | Respect |
|---|---|
| Activation ou licence simulée | Aucune. Le keygen signe de vrais jetons ECDSA ou refuse. |
| `success` artificiel | Aucun. Les erreurs sont remontées telles quelles. |
| Contournement de crypto | Aucun. Le vérificateur client réel est utilisé. |
| Clé privée exposée / commitée | Aucune clé dans Git ; `.gitignore` couvre `keys/*.pem`. |
| Rotation destructive sur données réelles | Aucune exécutée dans cette session. |
| Suppression de données pour migrer | Aucune ; `config-rebuild.cjs` refuse une base non vide. |
| Type `ENTREPRISE` réintroduit | Non : PREMIUM et ADMIN seulement. |
| Modification des identifiants SMTP/tiers | Aucune. |
| Valeur de secret dans le rapport | Aucune. |

---

## 4. Blocages restants, nommés

1. **Moteurs Prisma indisponibles hors ligne** — `binaries.prisma.sh` n'est pas
   dans la liste des hôtes autorisés. Conséquence : 81 suites de tests et
   `npm run build`/`npm run dist` ne peuvent pas s'exécuter intégralement ici.
2. **Packaging Windows** — Electron n'est pas installé (téléchargement refusé) et
   Wine est absent. `npm run dist` doit être exécuté sur Windows ou sur une CI
   disposant du réseau.
3. **Tesseract absent** — l'OCR réel reste non prouvé. Le refus 503 est prouvé.
4. **Clés absentes** — `keys/private.pem` et `keys/public.pem` ne sont pas dans
   le dépôt (volontaire). `check:public-key` et `sync:public-key --check`
   affichent donc « NON EXÉCUTÉ », pas « VALIDÉ ».
5. **Accès production** — aucun jeton Vercel/Neon/Upstash dans cette session :
   les rotations antérieures ne sont ni rejouées ni re-vérifiées.
6. **Verdict global** — `docs/CONFIG.md` et le verdict du 17/10/2026 restent
   **NO-GO**. Ce rapport ne les promeut pas.

---

## 5. Commandes de construction (poste Windows connecté)

```cmd
npm install
npm run dist
Installer : dist/GarageFlows Setup x.y.z.exe
```

> Le `artifactName` réellement configuré est `GarageFlows-Setup.exe`
> (`package.json`, `build.nsis.artifactName`), nom stable exigé par la chaîne de
> vérification et de mise à jour. Le nom versionné demandé n'est donc pas produit
> tel quel : `npm run dist` écrit `dist/GarageFlows-Setup.exe`, puis
> `verify:installer` copie le fichier vérifié dans `release/GarageFlows-Setup.exe`.
> Signer ensuite avec `npm run sign-update -- --file release/GarageFlows-Setup.exe`.

---

## 6. Conclusion

Les fonctionnalités demandées sont implémentées et testées là où l'environnement
le permet : **669 tests Python/Node ciblés réussis** (20 + 10 + 88 + 32 + 166 +
245 + 108), **3 521 cas vitest réussis** sur la suite complète (3 échecs
d'environnement Prisma, 855 ignorés), build Next compilé, service de scan prouvé
fail-closed, signature Ed25519 refusant une clé étrangère. Les points non
prouvables ici (packaging Windows, OCR réel, rotations distantes) sont déclarés
**BLOQUÉ** ou **NON TESTÉ**, sans promotion.
