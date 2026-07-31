# Guide de build Windows — installateur NSIS x64

> Document de data room. Décrit la production de l'installateur Windows du client
> desktop GarageFlow (Electron), à partir du bloc `build` de `package.json` et des
> scripts `scripts/post-build.js`, `scripts/afterPack.js`, `scripts/keygen.py`.
>
> **Cible unique** : Windows **NSIS x64**. Aucun target macOS / Linux / arm64
> n'est configuré (bien que du code de MàJ référence `.dmg`/`.deb`/`.AppImage`).

## 1. Prérequis

- **Windows** (build réel de l'installateur `.exe`) ou machine de CI Windows.
- **Node.js** ≥ 20 + npm ; dépendances installées (`npm install`).
- **Python 3** + `pip install cryptography` (pour `scripts/keygen.py`).
- Une **paire de clés de licence ECC P-256** dans `keys/` (voir §2).

## 2. Clés de licence (répertoire `keys/` — requis)

Le dossier `keys/` est **git-ignoré** (`keys/private.pem`, `keys/*.pem`,
`keys/*.json`) : les clés **ne sont pas dans le dépôt**. La clé **publique** est
empaquetée dans le build (via `extraResources`, filtre `public.pem`) ; la clé
**privée** sert à émettre les licences et ne doit **jamais** être distribuée.

Génération de la paire (première fois) :

```bash
python scripts/keygen.py --init
```

`keygen.py` (ECDSA NIST P-256 / SECP256R1) produit :
- `keys/private.pem` (PKCS8, `chmod 600`) — **secret** ;
- `keys/public.pem` — empaquetée dans l'app.

Le script affiche aussi les lignes de clé publique à coller dans
`src/lib/license/verify.ts` (tableau `_K`) et `electron/main.js` (tableau `_PK`)
pour la vérification embarquée. Émission de licences ensuite :

```bash
python scripts/keygen.py --gen --customer CUST-001 --type premium --years 2
python scripts/keygen.py --admin           # licence admin
python scripts/keygen.py --verify <token>  # vérifier un token
python scripts/keygen.py --hwid            # HWID de la machine
```

> **Blocage P0 (transfert de deal).** Sans la **clé privée** de licence
> (`keys/private.pem`) et le backend qui la détient, l'acquéreur **ne peut pas
> émettre de nouvelles licences** ni monétiser le produit. C'est un actif externe
> à transférer, pas du code. Voir `docs/ACQUISITION_READINESS_AUDIT.md`.
>
> Si `keys/public.pem` est absente au build, `post-build.js` émet seulement un
> **avertissement** (n'échoue pas) — un build naïf peut donc livrer une
> vérification de licence côté serveur dégradée. Vérifier la présence de la clé
> avant de publier.

## 3. Chaîne de build

Commande unique (voir `package.json`) :

```bash
npm run dist        # = npm run build && node scripts/post-build.js && electron-builder --win --x64
```

Étapes détaillées :

1. **`npm run build`** — `prisma generate` (schémas desktop **et** serveur) puis
   `next build`. `next.config` est en `output: 'standalone'`.
2. **`node scripts/post-build.js`** — prépare `.next/standalone` pour
   l'empaquetage :
   - copie `.next/static` → `.next/standalone/.next/static` (échoue si absent) ;
   - copie `public/` ;
   - vérifie la présence de `server.js` ;
   - copie le client Prisma (`.prisma/client`) et le moteur de requête ;
   - copie `schema.prisma` + un **template SQLite** (`garageflow-template.db`,
     commité, valide) — à défaut, lance `prisma db push` pour en créer un ;
   - copie `keys/public.pem` (avertit si absent) ;
   - vérifie `icon.ico` (avertit si absent).
3. **`electron-builder --win --x64`** — assemble l'app (asar) et fabrique
   l'installateur NSIS.

### Hook `afterPack` (manifeste d'intégrité)

`scripts/afterPack.js` s'exécute **après** l'assemblage (asar + ressources) et
**avant** la fabrication de l'installateur. Il génère un **manifeste d'intégrité
HMAC-SHA256** (`electron/integrity.js`) couvrant les fichiers critiques
empaquetés (app.asar, modules déballés, ressources) — **pas** le `.exe`. En cas
d'erreur, le hook **n'échoue jamais** le build (avertissement seulement) : au
pire, pas de manifeste → vérification runtime inactive.

> L'intégrité est vérifiée en JavaScript à partir d'un secret embarqué : c'est de
> la **défense en profondeur**, extractible/contournable par un rétro-ingénieur
> déterminé (`electron/integrity.js`, `electron/secure-key.js` le documentent).
> À ne pas présenter comme du DRM fort.

## 4. Configuration de l'installateur (extrait `package.json`)

- `appId`: `com.garageflow.app` ; `productName`: `GarageFlow`.
- `asar: true` ; `asarUnpack` : moteur Prisma Windows
  (`query_engine-windows*`, `@prisma/engines/**`).
- `extraResources` : `.next/standalone` → `standalone/` ; `schema.prisma` + `*.db`
  → `prisma/` ; `keys/public.pem` → `keys/` ; `icon.ico`.
- `win.target` : **nsis**, arch **x64** uniquement ;
  `requestedExecutionLevel: asInvoker`.
- `nsis` : `oneClick: false`, `perMachine: false`, `allowElevation: false`,
  choix du dossier désactivé, raccourcis bureau + menu Démarrer, script
  `scripts/installer.nsh`.

Artefact produit : `dist/GarageFlow-Setup-<version>.exe` (version courante
`1.1.0`).

## 5. Signature de code — NON configurée (avertissement honnête)

**Le build Windows n'est PAS signé.** Aucun certificat de signature n'est
configuré dans `package.json` (`build.win`/`nsis`) ni dans `scripts/installer.nsh`
— pas de `certificateFile`, `cscLink`, `signtool`, ni `publisherName`.

Conséquences :

- À l'installation, Windows **SmartScreen / Defender** affiche un avertissement
  **« éditeur inconnu »**, ce qui dégrade le taux de conversion d'installation et
  génère du support.
- Cela **affaiblit** le récit d'anti-altération que le manifeste d'intégrité
  `afterPack` est censé soutenir.

**Remédiation (post-acquisition)** : procurer un certificat de signature de code
**OV ou EV**, puis le câbler dans le bloc `build.win` d'electron-builder
(`certificateFile`/`certificatePassword` ou variables `CSC_LINK`/`CSC_KEY_PASSWORD`).
Coût et délai à prévoir avant une distribution grand public sereine. Voir le
risque « installateur non signé » dans `docs/ACQUISITION_READINESS_AUDIT.md`.

## 6. Checklist de build

- [ ] `keys/public.pem` présent (clé publique de licence empaquetée).
- [ ] `icon.ico` présent.
- [ ] `npm run dist` réussit sans erreur (les avertissements `post-build.js` sont
      lus et compris).
- [ ] Installateur `dist/GarageFlow-Setup-<version>.exe` produit.
- [ ] Test sur poste Windows vierge : premier lancement crée la base depuis le
      template, écran de licence affiché, activation OK.
- [ ] Constat documenté : SmartScreen « éditeur inconnu » tant que la signature
      de code n'est pas configurée.

---
*Voir aussi : [`docs/ACQUISITION_READINESS_AUDIT.md`](./ACQUISITION_READINESS_AUDIT.md) pour l'audit complet de préparation à la cession.*
