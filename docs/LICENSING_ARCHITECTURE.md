# Architecture de licence — GarageFlow

> Document de data room (due diligence technique). Décrit de bout en bout la
> chaîne de licence : émission de jetons, vérification client, authentification
> d'appareil, plafond de sièges, modules/entitlements et révocation. Sauf mention
> contraire, chaque affirmation renvoie à un fichier source réel du dépôt.

## 1. Vue d'ensemble

GarageFlow protège sa monétisation par une chaîne cryptographique à deux niveaux :

1. **Licence** — jeton signé ECDSA P-256 (courbe `secp256r1`, algorithme `ES256`),
   émis par le serveur (Keygen), vérifié hors-ligne par le client Electron avec
   une clé **publique** embarquée.
2. **Authentification d'appareil** — jeton opaque signé HMAC-SHA256, émis à
   l'activation, présenté à chaque heartbeat, révocable et à durée de vie limitée.

La **source de vérité** est le control-plane `api.garageflows.fr` (dépôt
`garagesite3`) : création, activation, validation, renouvellement, changement de
HWID, suspension, révocation, expiration et suppression y sont centralisés
(`src/lib/licenses/service.ts:1-8`). Le client desktop ne peut ni émettre ni
signer une licence : il ne détient que des clés **publiques**.

| Élément | Rôle | Emplacement de la clé | Statut |
|---|---|---|---|
| Clé privée de licence (P-256) | Signe les jetons `GF2.*` | **Serveur uniquement**, hors dépôt (P0) | Absente du dépôt |
| Clé publique de licence (P-256) | Vérifie les jetons côté client | Embarquée `electron/main.js:98-104` | Présente (clé réelle) |
| Clé publique de licence (miroir serveur) | Vérifie côté control-plane | Embarquée `garagesite3/src/lib/licenses/public-key.ts:8-13` | Présente (clé réelle) |
| Secret de jeton d'appareil (HMAC) | Signe/vérifie les device tokens | Variable d'env serveur `DEVICE_TOKEN_SECRET` | Hors dépôt (secret d'exploitation) |

> **P0 — transfert d'actif externe, pas de code.** La clé **privée** de licence
> (`keys/private.pem`, `.gitignore`) et le secret `DEVICE_TOKEN_SECRET` ne sont
> **pas** dans le dépôt. Sans leur transfert explicite (plus le backend qui les
> héberge et les domaines `garageflows.fr`), l'acquéreur **ne peut ni émettre de
> licences ni faire fonctionner l'activation**. Ce point est un transfert
> d'actifs externes à négocier au closing, non un développement logiciel.

## 2. Émission des jetons de licence (serveur — clé privée absente du dépôt)

L'émission se fait dans `garagesite3/src/lib/licenses/service.ts`
(`signToken`, lignes 150-175) :

- Chargement de la clé privée via `loadPrivateKeyPem()` (`service.ts:127-138`) :
  soit `GF_PRIVATE_KEY` (PEM encodé base64 en variable d'env), soit
  `keys/private.pem` sur disque. **Les deux sont absents du dépôt public** — sans
  clé, `createLicense` échoue explicitement (`service.ts:198-199`).
- Structure du jeton : `GF2.<headerB64url>.<payloadB64url>.<signatureB64url>`.
  - En-tête : `{ alg: "ES256", typ: "GF-LIC", v: 2 }`.
  - Charge utile (`LicensePayload`) : `lid` (identifiant licence, UUID), `cid`
    (client), `typ` (`trial|premium|enterprise|admin`), `iss`/`exp` (epoch s),
    `seats` (nombre de postes), `wm` (filigrane opaque), `ver: "2.0"`, et
    optionnellement `hwid`.
  - Signature : `crypto.createSign("SHA256").sign(privKeyPem)` sur
    `headerB64.payloadB64` (`service.ts:171-174`).
- Durée bornée : 1 à 10 ans (`service.ts:202`), sièges ≥ 1 (`service.ts:203`).

Le jeton émis est enregistré en base (modèle `LicenseKey`) avec son statut, sa
date d'expiration, ses sièges et son type (`service.ts:220-234`), et un événement
d'audit `created` est journalisé (`service.ts:235`).

## 3. Vérification côté client (clé publique embarquée)

### 3.1 Desktop Electron

`electron/main.js:verifyEccToken` (lignes 388-441) :

- Rejette tout jeton ne commençant pas par `GF2.` ou n'ayant pas 4 segments.
- Vérifie l'en-tête (`alg === "ES256"`, `typ === "GF-LIC"`).
- Vérifie la signature ECDSA-SHA256 contre `PUBLIC_KEY_PEM`
  (`crypto.createVerify("SHA256").verify`), avec la clé publique **réelle**
  embarquée (`main.js:98-104`). La clé n'étant pas le placeholder
  `REPLACE_WITH_YOUR_PUBLIC_KEY`, le **bypass développeur** (`GF2.DEV.DEV.DEV`)
  est **inactif** en production (`main.js:398-406`).
- Contrôle d'expiration (`payload.exp < now`) et présence des champs obligatoires
  `lid`/`cid`/`typ`.
- La fonction **ne lève jamais d'exception** : toute erreur retourne `null`
  (rejet propre).

**Stockage de la licence** : chiffrée AES-256-GCM avec une clé dérivée par
PBKDF2 du HWID, elle-même enveloppée par le coffre OS (`safeStorage` :
DPAPI Windows / Keychain macOS / libsecret Linux), en-tête de format `GFS1`
(`verified-facts.md`; `main.js` section « License storage »). Un déchiffrement
réussi exige donc déjà un HWID exact.

### 3.2 Miroir serveur

Le control-plane revérifie les jetons avec sa propre copie de la clé publique
(`garagesite3/src/lib/licenses/verify.ts` via
`public-key.ts:getPublicKeyPem()`), garantissant que l'activation ne s'appuie pas
seulement sur la déclaration du client.

## 4. Liaison matérielle (HWID)

- Le HWID est un **digest SHA-256** de caractéristiques machine (CPU, MAC,
  plateforme, nom d'hôte, disque) — `verified-facts.md`.
- Comparaison **stricte, en temps constant** : `hwidMatches` (`main.js:445-458`)
  n'accepte que deux chaînes hex de 64 caractères identiques via
  `crypto.timingSafeEqual`. **Aucune tolérance partielle** — un digest SHA-256
  a un effet d'avalanche, une tolérance de N % n'aurait pas de sens et
  affaiblirait le lien (commentaire `main.js:442-444`).
- Côté serveur, le HWID **brut n'est jamais stocké** : seul son HMAC-SHA256
  (`hashHwid`) est persisté (`service.ts:422`, modèle `Device.hwidHash`).
- Un chemin **hérité** de correspondance floue (`verifyHwid`, ≥ 48/64 caractères
  hex communs) subsiste sur l'enregistrement `LicenseKey` pour l'affichage admin
  (`verify.ts:146-157`, invoqué en `service.ts:623-624`), mais l'autorité réelle
  est désormais l'appareil enregistré à hash exact (voir §5).

## 5. Authentification d'appareil (device tokens)

Émis à l'activation (`registerDeviceAndIssueToken` → `issueDeviceToken`) puis
présentés à chaque heartbeat.

- **Format** : `GFD1.<payloadB64url>.<sigB64url>` — jeton **opaque** signé
  HMAC-SHA256, pas un JWT (`device-token.ts:1-16`). Le client n'a qu'à le stocker
  et le présenter ; le serveur est seul juge.
- **Charge utile** (`DeviceTokenPayload`, `device-token.ts:20-33`) : `did`
  (identifiant public opaque de l'appareil), `lid` (licence), `hh` (préfixe 16
  hex du `hwidHash` pour un contrôle bon marché), `tv` (`tokenVersion` — clé de
  révocation), `iat`/`exp`.
- **Secret** : `DEVICE_TOKEN_SECRET` (≥ 32 en prod ; repli `NEXTAUTH_SECRET`) —
  refus de signer si absent/trop court (`device-token.ts:52-57`).
- **TTL** : 30 jours par défaut (`DEFAULT_DEVICE_TOKEN_TTL_SEC`,
  `device-token.ts:40`).
- **Vérification** en temps constant, sans exception (`verifyDeviceToken`).

### Heartbeat strict (`service.ts:heartbeat`, 539-581)

Un heartbeat **n'accepte jamais un simple `licenseId`**. Il exige le device token
**et** le HWID, vérifiés atomiquement contre l'état en base :

1. Signature et validité du jeton (`verifyDeviceToken`).
2. HWID plausible présent (sinon rejet).
3. Appareil existant et `status === "active"` (sinon révoqué).
4. `device.licenseId === payload.lid` (cohérence).
5. `device.tokenVersion === payload.tv` — un `tv` obsolète force une
   ré-activation (`deviceRequired: true`), pas une révocation.
6. Le HWID présenté doit correspondre **exactement** au `hwidHash` stocké
   (`crypto.timingSafeEqual`, `service.ts:559-566`) ; sinon événement
   `hwid_mismatch` et rejet.
7. La licence elle-même doit rester valide (`evaluate` : ni révoquée, ni
   suspendue, ni expirée).

Côté client, le heartbeat est en **fail-open sur erreur réseau** : si serveur
distant et vérification locale sont tous deux injoignables, l'état courant est
conservé — on ne verrouille jamais un utilisateur légitime hors ligne
(`main.js:1040-1042`). Un `deviceRequired` déclenche une ré-activation
automatique (`main.js:1046-1052`). Un `allowed:false` (révocation/suspension)
affiche un overlay bloquant **sans quitter l'application** ni perdre le travail
non sauvegardé (`main.js:1054-1060`).

## 6. Plafond de sièges (enforcement anti-TOCTOU)

`registerDeviceAndIssueToken` (`service.ts:416-499`) garantit qu'on ne peut jamais
dépasser le nombre de sièges, même sous forte concurrence multi-instances :

- Toute la séquence (relecture de la licence, recherche de l'appareil, comptage
  des actifs, création/réactivation, **re-comptage de contrôle**) s'exécute dans
  **une seule transaction Prisma**.
- La transaction est ouverte par un **verrou pessimiste**
  `SELECT "id" FROM "LicenseKey" WHERE "licenseId" = … FOR UPDATE`
  (`service.ts:430`), qui **sérialise** toutes les activations concurrentes de la
  même licence.
- Un nouvel appareil n'est créé que si `activeCount < maxSeats`
  (`service.ts:440-441`) ; sinon `SeatLimitError` provoque le **rollback** complet.
- Un **re-comptage de contrôle** en fin de transaction (`service.ts:465-466`)
  annule tout si un état imprévu (ex. réactivation d'un appareil révoqué sièges
  pleins) faisait dépasser le plafond.
- Réactiver la **même** machine (même `hwidHash`) ré-arme le statut et fait
  tourner le jeton (`tokenVersion++`) — jamais un second siège (`service.ts:446-460`).
- Marges de contention larges (`maxWait: 10 s`, `timeout: 15 s`,
  `service.ts:471`).

Le dépassement renvoie un `device_limit` explicite invitant à révoquer un
appareil (`service.ts:481-485`), et journalise l'événement.

> **Vérification indépendante.** Ce chemin est couvert par des tests
> d'intégration sur PostgreSQL réel (`*.postgres.int.test.ts` /
> `device-seats.integration.test.ts`), exécutés en CI (postgres:16), auto-skippés
> en local. Voir `docs/ACQUISITION_READINESS_AUDIT.md`.

## 7. Modules / entitlements

- Les modules autorisés d'une licence sont calculés par
  `effectiveModulesForLicense` (`src/lib/modules/service.ts`), joints aux réponses
  `activate` et `heartbeat` (`service.ts:579`, `642`).
- Modèles Prisma : `Module` + `LicenseModule` (control-plane, 13 modèles au
  total). Administration via l'UI `/admin/modules`.
- Statut : **opérationnel** (DB-backed, servi dans activate/check, UI présente) —
  cf. audit domaine cloud-control-plane.

## 8. Révocation et cycle de vie

Modèle d'états d'une licence : `active | revoked | suspended`, plus les états
dérivés `expired`/`unknown` évalués à la volée (`service.ts:65`, `evaluate`
78-92).

- **Révoquer/suspendre/réactiver** : `setStatus` (`service.ts:240-271`) —
  écrit le statut, `revokedAt`, et journalise. Peut créer une **tombstone**
  (`pending:<licenseId>`) pour révoquer/suspendre une licence **avant** sa
  première activation (`service.ts:246-262`), réconciliée à l'activation
  (`service.ts:592-607`).
- **Révoquer par la clé** (token) : `setStatusByKey` (`service.ts:274-280`).
- **Révoquer un appareil** : `revokeDevice` (`service.ts:517-526`) — passe le
  `status` à `revoked` et **incrémente `tokenVersion`**, ce qui fait échouer
  **immédiatement le prochain heartbeat** (le `tv` du jeton client devient
  obsolète).
- **Effet client** d'une révocation de licence : overlay bloquant, sans quitter
  l'app (`main.js:1054+`), levé instantanément dès réactivation.
- **Audit** : chaque transition écrit un `LicenseEvent`
  (`created|activated|revoked|suspended|reactivated|renewed|hwid_changed|device_activated|device_revoked|device_limit|hwid_mismatch`).
  L'audit ne casse jamais l'opération (`recordEvent`, `service.ts:104-120`).

## 9. Limites et points d'attention (honnêteté data room)

- **Clé privée + secret device absents du dépôt (P0)** — transfert d'actif externe
  obligatoire au closing (§1).
- **Anti-tamper local en JavaScript** — le contrôle d'intégrité et la clé HMAC
  dérivée d'un secret fragmenté embarqué sont, de l'aveu même du code,
  extractibles/patchables par un rétro-ingénieur (`electron/integrity.js:22-26`,
  `electron/secure-key.js`). C'est de la défense en profondeur, **pas du DRM
  fort** ; combiné au binaire Windows non signé (cf. `docs/UPDATE_SECURITY.md`),
  le contournement reste réalisable pour un attaquant compétent.
- **Fail-open réseau** — choix délibéré de disponibilité (ne jamais bloquer un
  client légitime hors ligne), borné par la politique hors-ligne
  (cf. `docs/OFFLINE_LICENSE_POLICY.md`).
- **Pas de RBAC multi-admin** côté control-plane : une unique clé maître
  (`LICENSE_ADMIN_API_KEY`) gouverne toute la surface `/api/admin`.

---
Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md`.
