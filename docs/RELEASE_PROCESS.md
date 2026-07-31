# Processus de publication (releases) — GarageFlow

Ce document décrit **comment une nouvelle version de l'application desktop est
publiée puis distribuée**, du service de releases du plan de contrôle
(`garagesite3`) jusqu'au client de mise à jour Electron (`GarageFlowsV2`). Tous
les mécanismes décrits sont **présents et testés dans le code** ; les réserves
(clés privées, domaines) sont signalées comme transferts d'actifs externes.

> Sous-système **Opérationnel** côté code : publication, canaux, déploiement
> progressif, manifeste signé Ed25519, résolution client. Les couvertures de
> test releases (manifest/rollout/semver) font partie des **140 tests cloud
> verts** de cette session.

---

## 1. Vue d'ensemble

`api.garageflows.fr` (le plan de contrôle `garagesite3`) est la **source de
vérité** des versions publiées. Le service `src/lib/releases/service.ts` porte
toute la logique métier directement sur Prisma (modèle `AppRelease`).

```
  Admin (back-office /admin/updates)
        │  x-gf-key (clé maître constant-time)
        ▼
  POST /api/admin/update/publish  ──►  publishRelease()  ──►  table AppRelease
        │                                                   (channel, version, sha256,
        │                                                    size, rolloutPercent, …)
        ▼
  (option) upload installateur via Vercel Blob (/api/admin/update/blob-upload)
        │
        ▼
  Client desktop  ──►  GET /api/update/latest?version&channel&hwid
                       resolveLatestForClient()  ──►  { hasUpdate, latest, manifest signé }
```

---

## 2. Modèle de données `AppRelease`

`garagesite3/prisma/schema.prisma:135-165`. Champs clés :

| Champ | Rôle |
|-------|------|
| `version` | Version sémantique (ex. `1.2.0`), unique par canal (`@@unique([channel, version])`) |
| `channel` | `stable` \| `beta` \| `pilot` (par défaut `stable`) |
| `title`, `changelog` | Titre affiché + notes de version |
| `fileUrl` (HTTPS), `fileName` | Emplacement et nom de l'installateur |
| `sha256`, `size` | Empreinte SHA-256 (hex) et taille — **vérifiées avant installation** |
| `mandatory`, `minVersion` | Mise à jour obligatoire / version minimale compatible |
| `status` | `published` \| `draft` \| `archived` |
| `rolloutPercent`, `targetCountry`, `targetVersion`, `rolledBack` | Déploiement progressif (voir `docs/ROLLOUT_AND_ROLLBACK.md`) |
| `notes` | Notes internes admin (non exposées au client) |

Chaque opération est tracée dans `ReleaseEvent`
(`published`/`updated`/`rolled_back`/`deleted`/`downloaded`) — l'audit ne casse
jamais l'opération (`service.ts:36-47`).

---

## 3. Publier une version

`publishRelease()` (`service.ts:105-157`), exposé par `POST
/api/admin/update/publish` (authentifié `x-gf-key` via `guardAdmin`).

**Validations (fail-fast, HTTP 400) :**
- version présente et **SemVer valide** ;
- `title`, `changelog`, `fileUrl` présents ; **`fileUrl` doit être HTTPS** ;
- `sha256` = 64 caractères hexadécimaux ; `size` > 0 ;
- `minVersion` (si fourni) SemVer valide ;
- conflit **409** si `(channel, version)` existe déjà.

Le `rolloutPercent` est borné 0–100 (défaut 100), `targetCountry` normalisé en
code ISO majuscule. À la création, un `ReleaseEvent` `published` est écrit avec
le détail `vX (canal) @N%`.

**Distribution de l'installateur :** l'installateur peut être hébergé via
**Vercel Blob** (`/api/admin/update/blob-upload`, admin-gated ; renvoie 501 si
`BLOB_READ_WRITE_TOKEN` absent). Le service expose une **URL de téléchargement
stable** `/{origin}/downloads/{version}?channel={channel}` qui redirige vers le
`fileUrl` réel (`toPublic`, `service.ts:65-79`).

---

## 4. Canaux (channels)

- **`stable`** — canal par défaut (`DEFAULT_CHANNEL = "stable"`), production
  générale.
- **`beta`** — pré-versions pour testeurs avancés.
- **`pilot`** — déploiement pilote restreint (petits groupes / garages pilotes).

Les versions sont **uniques par canal** ; la résolution de « la dernière
version » se fait **par comparaison SemVer** (pas par date), les suffixes de
pré-version (`-alpha` < `-beta` < `-rc`) étant antérieurs à la version stable
(`service.ts:257-265`, `getLatestRelease`). Un client ne reçoit que les versions
de **son** canal (`UPDATE_CHANNEL` côté desktop).

---

## 5. Manifeste signé Ed25519 (intégrité de bout en bout)

**Statut : Opérationnel côté code ; nécessite la clé privée de signature
(actif externe).**

Un SHA-256 servi par le même serveur que le binaire ne protège pas d'une
compromission serveur/DB (l'attaquant remplacerait binaire **et** hash). La
protection réelle est un **manifeste signé Ed25519**
(`src/lib/releases/manifest.ts`) :

- Le manifeste couvre `version`, `channel`, `platform`, `architecture`,
  `downloadUrl`, `sha256`, `size`, `publishedAt`, `minimumSupportedVersion`,
  `mandatory`, `rolloutPercentage`, `releaseId`, `keyId`, `signatureAlgorithm`.
- Signature sur une **sérialisation canonique déterministe** (clés triées
  récursivement, `JSON.stringify` sans espaces) — **identique côté serveur et
  côté client Electron** (`manifest.ts:39-56` ↔ `electron/update-verify.js:35-45`).
- La **clé privée ne quitte jamais le serveur** : chargée depuis
  `UPDATE_SIGNING_PRIVATE_KEY` (base64 du PEM PKCS8) + `UPDATE_SIGNING_KEY_ID`
  (`loadSigningKey`, `manifest.ts:82-94`). **Si aucune clé n'est configurée, le
  manifeste vaut `null`** (pas de signature émise).
- Rotation supportée : le client connaît un dictionnaire `keyId → PEM`
  (`update-verify.js:20-25`) ; on ajoute la nouvelle clé sans retirer l'ancienne
  tant que des releases signées par elle circulent.

> **Transfert d'actif (P0) :** la **clé privée de signature Ed25519** est un
> secret serveur absent du dépôt. Sans son transfert (et celui de la clé privée
> de licence ECC P-256), l'acquéreur ne peut **pas signer de nouvelles mises à
> jour**. Voir l'audit d'acquisition, blocages P0.

---

## 6. Résolution côté client — `GET /api/update/latest`

`resolveLatestForClient()` (`service.ts:312-345`), route publique
`/api/update/latest?version&channel&hwid`
(`src/app/api/update/latest/route.ts`) :

1. Charge les versions `published`, **non `rolledBack`**, du canal demandé.
2. Filtre par **éligibilité** (déploiement progressif + ciblage pays/version —
   `isEligible`, voir `docs/ROLLOUT_AND_ROLLBACK.md`).
3. Prend la plus récente **en SemVer**.
4. Calcule `hasUpdate`, `mandatory` (release obligatoire **ou** version
   installée < `minVersion`), et joint le **manifeste signé** si une clé est
   configurée.
5. `Cache-Control: no-store`. **En cas d'erreur serveur, renvoie « pas de maj »**
   — ne bloque jamais le client (`latest/route.ts:37-38`).

Le changelog public est servi par `/api/update/changelog`
(`getChangelog`, tri SemVer décroissant).

---

## 7. Client de mise à jour desktop (Electron)

`electron/main.js` — `fetchLatestUpdate()` (`main.js:186-259`) puis
`ipcMain.handle('app:install-update')` (`main.js:1987+`).

**Ordre de résolution (replis) :**
1. **Serveur central** `${UPDATE_SERVER}/api/update/latest` avec
   `version`, `channel`, **`hwid`** (le HWID permet le bucketing du déploiement
   progressif). Si le serveur répond « pas de maj », on s'y fie (pas de faux
   positif via GitHub).
2. **Fichier local admin** `gf_update.json` (mono-poste / hors-ligne).
3. **GitHub Releases** — repli **non vérifiable** (pas d'empreinte) : ouverture
   navigateur uniquement, jamais d'installation silencieuse.

**Installation sécurisée** (`app:install-update`, `main.js:1987-2173`) :
- Si une clé de vérification est embarquée (`signingConfigured()`), un
  **manifeste signé VALIDE est OBLIGATOIRE** — installation refusée sinon
  (`main.js:1999-2003`).
- `validateManifest()` vérifie : signature Ed25519 + `keyId` connu, algorithme
  `Ed25519`, produit `GarageFlow`, plateforme/arch/canal compatibles, `sha256`
  format valide, `size` > 0, **anti-downgrade** (version strictement
  supérieure), URL **HTTPS** et **domaine dans l'allowlist**
  (`api.garageflows.fr`, `garageflows.fr`, `app.garageflows.fr`) —
  `update-verify.js:70-104`.
- Les valeurs **signées font autorité** : `downloadUrl`, `sha256`, `size` du
  manifeste priment sur toute valeur non signée (`main.js:2015-2019`).
- Après téléchargement, le **SHA-256 du fichier est recalculé en streaming et
  comparé en temps constant AVANT tout lancement de l'installateur** ; un
  mismatch refuse l'exécution et émet un crash `security` (`main.js:2143-2173`).

---

## 8. Réserves de transfert (actifs externes, non-code)

| Élément | Nature | Impact |
|---------|--------|--------|
| Clé privée de signature `UPDATE_SIGNING_PRIVATE_KEY` | Secret serveur, absent du dépôt | **Bloquant P0** : sans elle, aucune mise à jour signable |
| Domaines `garageflows.fr` / `api.garageflows.fr` | DNS + allowlist codée en dur | À transférer : les URLs de téléchargement doivent rester dans l'allowlist |
| Hébergement du plan de contrôle (Vercel) + `BLOB_READ_WRITE_TOKEN` | Infra + stockage installateurs | À transférer pour héberger les binaires |
| Certificat de signature de code Windows | **Non configuré** dans `electron-builder` | Les installateurs déclenchent SmartScreen « éditeur inconnu » (risque go-to-market) |

---

*Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md` pour l'analyse de maturité et les risques classés.*
