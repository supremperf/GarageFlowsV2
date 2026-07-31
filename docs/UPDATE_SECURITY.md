# Sécurité des mises à jour — GarageFlow

> Document de data room (due diligence technique). Décrit la chaîne de mise à
> jour automatique : manifeste signé Ed25519, vérification SHA-256 avant
> exécution, anti-downgrade, allowlist d'hôtes, et ordre de repli. Inclut la
> **note honnête** : les binaires Windows ne sont **pas** signés (code signing).

## 1. Modèle de menace et principe

Un SHA-256 servi par **le même serveur** que le binaire ne protège **pas** contre
la **compromission du serveur** : un attaquant ayant le contrôle du serveur peut
fournir un binaire piégé **et** son empreinte. GarageFlow répond par une
**signature Ed25519 du manifeste** vérifiée avec une clé **publique embarquée
côté client** ; la clé **privée** ne réside **que côté serveur** (variable
d'environnement) — commentaire `electron/update-verify.js:1-13`.

Deux couches indépendantes :

1. **Authenticité** — le manifeste est signé Ed25519 ; sans clé privée serveur,
   nul ne peut le forger.
2. **Intégrité** — le binaire téléchargé est haché SHA-256 et comparé (temps
   constant) à la valeur **signée** **avant toute exécution**.

## 2. Manifeste signé Ed25519

`electron/update-verify.js` :

- **Clés publiques connues** : dictionnaire `keyId → PEM SPKI`
  (`PUBLIC_KEYS`, lignes 20-25). Clé actuelle : `gf-update-2026`. La rotation se
  fait en **ajoutant** la nouvelle clé sans retirer l'ancienne tant que des
  releases signées par elle circulent (`update-verify.js:18-19`).
- **Sérialisation canonique déterministe** : `canonicalize` / `sortDeep`
  (lignes 36-45) — clés triées récursivement, `JSON.stringify` sans espaces —
  **identique** à `garagesite3/src/lib/releases/manifest.ts` (côté serveur), pour
  que la signature vérifie des deux côtés bit à bit.
- **Vérification de signature** : `verifySignature` (lignes 53-64) —
  `crypto.verify(null, canonicalize(manifest), publicKey, signature)`. Une clé
  `keyId` inconnue ⇒ **refus**. La fonction **ne lève jamais** (retourne `false`).
- **Validation complète** (`validateManifest`, lignes 70-104), refus si l'un des
  contrôles échoue :
  - clé de vérification configurée (`signingConfigured()`), sinon refus ;
  - signature valide ;
  - `signatureAlgorithm === "Ed25519"` ;
  - `product === "GarageFlow"` (`EXPECTED_PRODUCT`, ligne 27) ;
  - `platform` / `architecture` / `channel` compatibles avec le client ;
  - `sha256` = 64 hex valides, `size` fini et > 0 ;
  - **anti-downgrade** (voir §4) ;
  - **URL de téléchargement** HTTPS + hôte autorisé (voir §5).

## 3. Vérification SHA-256 avant exécution (obligatoire)

`ipcMain.handle('app:install-update', …)` (`electron/main.js:1987-2213`) :

- Si une clé de vérification est embarquée (`updateVerify.signingConfigured()`),
  un **manifeste signé VALIDE est OBLIGATOIRE** : absence de manifeste ⇒
  installation refusée (`main.js:2000-2003`) ; manifeste invalide ⇒ refus +
  rapport de crash `security` (`main.js:2010-2014`).
- Les valeurs **signées** (`downloadUrl`, `sha256`, `size`, `version`) **priment**
  sur toute valeur non signée transmise par ailleurs (`main.js:2016-2018`).
- Téléchargement **reprenable** (requête HTTP Range, reprise du `.part`, ré-essais
  avec backoff) — `main.js:2047+`.
- **Avant toute exécution** (`main.js:2138-2173`) :
  - le SHA-256 du fichier est calculé **en streaming** ;
  - contrôle de **taille** : `size` réelle ≠ `expectedSize` signée ⇒ suppression
    du fichier et refus (`main.js:2154-2158`) ;
  - **pas d'empreinte de confiance** ⇒ on **n'exécute pas** ; repli navigateur
    sûr (`main.js:2160-2166`) ;
  - comparaison **temps constant** `cp.sha256HexEqual(actual, expected)` ; en cas
    de divergence ⇒ suppression, refus, rapport de crash
    `update_sha256_mismatch` (`main.js:2168-2173`).
- L'installateur n'est lancé (processus **détaché**, puis fermeture de l'app pour
  libérer les fichiers verrouillés) **qu'après** vérification réussie
  (`main.js:2175+`).

Ainsi l'attaque « URL malveillante → installateur piégé » est bloquée : aucun
binaire non vérifié n'est jamais exécuté.

## 4. Anti-downgrade

`update-verify.js:87-90` : la version proposée doit être **strictement
supérieure** à la version installée, via comparaison **SemVer** (jamais
lexicographique — « 1.9.0 » < « 1.10.0 »), fonction `semver.isNewer`
(`electron/semver.js`). Une version ≤ installée est refusée.

## 5. Allowlist d'hôtes de téléchargement (anti open-redirect / SSRF)

`update-verify.js:29-33` + `92-101` :

- L'URL doit être **HTTPS** ; sinon refus.
- L'hôte doit appartenir à `ALLOWED_DOWNLOAD_HOSTS` :
  `api.garageflows.fr`, `garageflows.fr`, `app.garageflows.fr`. Tout autre hôte
  ⇒ refus.

> Ces domaines `garageflows.fr` sont **codés en dur** et font partie des actifs à
> transférer au closing (domaine + DNS + backend). Voir
> `docs/ACQUISITION_READINESS_AUDIT.md`.

## 6. Ordre de repli (fallback)

`fetchLatestUpdate` (`electron/main.js:182-258`), commentaire `main.js:183-185` :

1. **Serveur central** `${UPDATE_SERVER}/api/update/latest` (avec HWID pour le
   rollout progressif + **manifeste signé Ed25519**) — source de vérité
   (`main.js:189-217`). `UPDATE_SERVER` = `GF_UPDATE_SERVER`, sinon
   `GF_LICENSE_SERVER`, sinon l'URL officielle (`main.js:140-145`). Si le serveur
   central répond « pas de maj », **on s'y fie** (pas de repli GitHub qui créerait
   un faux positif).
2. **Fichier local admin** `APP_DATA/gf_update.json` (déploiement mono-poste /
   hors ligne) — `main.js:220-239`.
3. **Releases GitHub** (`api.github.com/repos/garageflow/garageflow/releases/latest`)
   — **repli non vérifiable** (`main.js:240-256`) : `sha256: null`. Sans empreinte
   signée, `app:install-update` **refuse d'exécuter** et se rabat sur l'ouverture
   navigateur (`method: browser-unverified`, `main.js:2160-2166`). Ce repli ne
   peut donc **jamais** aboutir à l'exécution d'un binaire non vérifié.

## 7. Note HONNÊTE : binaires Windows non signés (code signing)

> **Classement audit : risque ÉLEVÉ (high).** Voir domaine
> `desktop-architecture` dans `docs/ACQUISITION_READINESS_AUDIT.md`.

La configuration `electron-builder` (`package.json`, bloc `build.win` / `nsis`,
lignes ~132-157) **ne configure aucun certificat de signature de code** : ni
`certificateFile`, ni `cscLink`, ni `signtool`, ni `publisherName`. Le script
`scripts/installer.nsh` n'en configure pas non plus.

Conséquences :

- Chaque installation déclenche l'avertissement **SmartScreen / Defender
  « éditeur inconnu »**, ce qui **dégrade le taux de conversion** à l'installation
  et alourdit le support.
- Cela **affaiblit le récit d'intégrité/anti-tamper** que le manifeste HMAC
  `afterPack` et la vérification Ed25519 cherchent à construire : la signature du
  **contenu de mise à jour** est solide, mais l'**exécutable distribué** n'a pas
  de signature d'éditeur reconnue par l'OS.

**Distinction importante à ne pas confondre :**

| Mécanisme | Statut | Portée |
|---|---|---|
| Signature **Ed25519 du manifeste** de mise à jour | **Opérationnel** (code présent, testé) | Authentifie le **contenu** de la MAJ |
| Vérification **SHA-256** avant exécution | **Opérationnel** | Intègre le **binaire téléchargé** |
| **Code signing Windows** (certificat éditeur) | **NON configuré** | Signe l'**installateur distribué** (SmartScreen) |

**Remédiation** : procurer un certificat de signature de code **EV ou OV**, puis
le câbler dans le bloc `build.win` d'`electron-builder` (variables `CSC_LINK` /
`CSC_KEY_PASSWORD` ou `certificateFile`). C'est un **achat + configuration**
(actif externe / go-to-market), non un développement lourd. Cf. aussi la limite
du seul target **Windows x64 nsis** (pas d'arm64 / macOS / Linux).

## 8. Périmètre de confiance résiduel

- La vérification côté client est **complète en dépôt** ; sa **correction en
  production dépend du backend** qui sert des manifestes correctement signés — ce
  backend et sa **clé privée Ed25519** (variable d'env serveur) sont **hors
  dépôt** (P0, transfert d'actif externe).
- Le contrôle d'intégrité local (`electron/integrity.js`) est **JS uniquement** et
  admet lui-même être patchable — défense en profondeur, pas DRM fort
  (cf. `docs/LICENSING_ARCHITECTURE.md` §9).

---
Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md`.
