# Architecture desktop — GarageFlow (Electron + Next.js 14 + SQLite)

> Document de data room — diligence technique M&A. Factuel. Statut par composant :
> **Opérationnel** / **Partiel** / **Code seul, sans UI** / **NON CONSTRUIT**.
> Maturité globale de la surface desktop : *production-candidate*.

## 1. Vue générale

L'application desktop est une coquille **Electron 31** (`electron/main.js`,
~102 Ko) qui démarre un serveur **Next.js 14 en mode `standalone`** en boucle
locale, adossé à une base **SQLite/Prisma de 37 modèles**. La posture de sécurité
desktop est nettement au-dessus de la moyenne des produits desktop d'éditeur
indépendant : isolation renderer stricte, serveur loopback-only, auto-mise à
jour signée Ed25519 avec vérification SHA-256 obligatoire, manifeste d'intégrité
HMAC, et secret par installation.

## 2. Processus principal, préload et IPC

### 2.1 Processus principal (`electron/main.js`)
- Séquence de démarrage : validation environnement → secret par installation →
  intégrité → démarrage du serveur Next.js standalone → fenêtre.
- `PORT = 4028`, `HOSTNAME = '127.0.0.1'` (`electron/main.js:82`, `1547`).
- **27** canaux IPC exposés côté main (`ipcMain.handle` / `ipcMain.on`).

### 2.2 Durcissement du renderer — **Opérationnel**
Chaque `BrowserWindow` utilise (`electron/main.js:1636-1638`, `1701-1718`) :
`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
`webSecurity: true`, `allowRunningInsecureContent: false`.

Navigation verrouillée :
- `will-navigate` / `will-redirect` confinés à `http://127.0.0.1:PORT`
  (`main.js:1825-1839`).
- `setWindowOpenHandler` refuse toute nouvelle fenêtre et n'ouvre en shell
  qu'une liste blanche HTTPS d'hôtes `garageflows.fr` (`main.js:1808-1821`).
- Attachement de `webview` refusé (`main.js:1841`).

### 2.3 Bridge IPC (`electron/preload.js`) — **Opérationnel**
Le préload expose via `contextBridge.exposeInMainWorld('electronAPI', …)` une
API nommée et minimale — **aucun accès `ipcRenderer` brut ni Node** exposé au
renderer (`electron/preload.js:10-118`). Surfaces exposées : infos app,
sauvegarde, fenêtre de licence, contrôles de fenêtre.

## 3. Serveur Next.js standalone embarqué — **Opérationnel**

- Démarré via `utilityProcess.fork` du `server.js` standalone
  (`main.js:1519-1568`), lié strictement à `127.0.0.1:4028` (jamais exposé au
  LAN).
- Empaquetage câblé : `next.config.mjs` `output: 'standalone'` ;
  `scripts/post-build.js` copie `.next/static`, `public`, le moteur Prisma et un
  **template DB** dans le bundle ; `asarUnpack` pour le query engine Prisma
  Windows ; `binaryTargets` inclut `windows`.
- Endpoints internes (`/api/internal/migrate`, `/api/internal/export`) protégés
  par une **clé aléatoire par exécution** (`main.js:1344`, `1375`, `1554`).

## 4. Persistance SQLite / Prisma — **Opérationnel**

- **37 modèles** métier (`prisma/schema.prisma`, `provider = "sqlite"`).
- **Mono-garage par installation** : chaque modèle opérationnel est scopé par
  `garageId` ; garde de tenant typée (`src/lib/tenant.ts`). Il n'existe **pas**
  d'entité Organisation/Réseau au-dessus de `Garage` (limitation connue /
  roadmap).
- Amorçage : base copiée depuis un template livré au premier lancement ;
  quarantaine des bases corrompues ; sauvegardes horaires / quotidiennes /
  hebdomadaires (`main.js:837-892`).
- **Réserve d'auditabilité** : le schéma desktop n'est **pas reproductible
  depuis les migrations** — `prisma/migrations/` ne contient que 2 patchs
  incrémentaux (`add_record_mac`, `add_audit_log_and_indexes`), sans migration
  baseline ni `migration_lock.toml` ; le desktop repose sur `db push` + template.

## 5. Licence et mises à jour

### 5.1 Système de licence — **Opérationnel (côté client)**
- Tokens **ECC/ECDSA P-256** (`GF2.*`) vérifiés contre une **clé publique
  embarquée réelle** dans `electron/main.js:98-104` (clé réelle, pas un
  placeholder — le bypass dev est donc inactif).
- Stockage licence chiffré **AES-256-GCM** clé dérivée par PBKDF2(HWID) +
  enveloppe OS `safeStorage` (DPAPI/Keychain/libsecret), en-tête `GFS1`.
- **HWID** : SHA-256 de cpu/mac/plateforme/hostname/disque ; comparaison stricte
  `crypto.timingSafeEqual`.
- **Anti-tamper** : détection de recul d'horloge ; grâce offline **48 h (avert.)
  / 72 h (verrou)** ; sonde `/api/health` de l'autorité de licence si configurée.
- **Réserves de divulgation :** (a) l'**émission** de licences requiert la clé
  **privée** P-256, **absente du dépôt** (`keys/private.pem` gitignoré) et
  détenue côté serveur uniquement ; (b) l'application ne peut donc pas frapper de
  licence par elle-même ; (c) l'enforcement est **fail-open** sur erreur réseau
  (`main.js:1042`, `1054`) ; (d) le **verrou dur à 72 h** appelle `app.quit()`
  (`main.js:298-299`, `1193-1206`) — risque de disponibilité pour les garages à
  connexion intermittente.

### 5.2 Mises à jour signées (`electron/update-verify.js`) — **Opérationnel (code)**
- Manifeste signé **Ed25519** obligatoire quand une clé de signature est
  embarquée (`main.js:1999-2020`). Clé **publique** embarquée
  (`PUBLIC_KEYS['gf-update-2026']`, `update-verify.js:20-25`) ; clé **privée** =
  variable d'environnement serveur uniquement.
- Sérialisation canonique déterministe **identique** au serveur
  (`garagesite3/src/lib/releases/manifest.ts`) : clés triées récursivement.
- Anti-downgrade par semver, HTTPS + liste blanche d'hôtes de téléchargement
  (`update-verify.js:29-33`, `88-101`).
- **SHA-256** de l'installateur calculé en flux et comparé en temps constant
  **avant** de lancer l'installateur ; refus d'exécuter un binaire non vérifié ou
  de taille incohérente (`main.js:2144-2173`).
- Ordre de repli : serveur central → admin local → GitHub (non vérifiable).

## 6. Intégrité, secret et rapports de crash

- **Manifeste d'intégrité HMAC** généré au build dans le hook `afterPack`
  d'electron-builder (`electron/afterPack.js`) sur `app.asar`/unpacked/clés/
  schéma, vérifié au runtime par comparaison MAC temps constant
  (`electron/integrity.js:22-26`, `84-145`). **Réserve :** protection **JS
  uniquement**, patchable ; le code lui-même le documente. Le « secret
  fragmenté » (`electron/secure-key.js`) dérivant la clé HMAC est compilé dans le
  binaire et extractible par un reverse-engineer déterminé.
- **Secret NEXTAUTH par installation** : écriture atomique 0600, rejet des
  secrets faibles, démarrage fail-closed si aucun secret fort ne peut être
  produit (`electron/secret.js:33-146`).
- **Crash reporting** : opt-in (défaut OFF, RGPD), rédaction des secrets/tokens/
  JWT/tokens de licence/URLs de base et des noms d'utilisateur locaux avant
  envoi, file offline (`electron/control-plane.js:104-157`).

## 7. Build et distribution — **Partiel**

- **Cible unique : Windows nsis x64** (`package.json` build.win). Pas d'arm64,
  macOS ni Linux, bien que le code MAJ référence `.dmg`/`.deb`/`.AppImage`.
- **Aucune signature de code** configurée (pas de `certificateFile`/`cscLink`/
  `signtool`/`publisherName`) : chaque installation déclenche l'avertissement
  SmartScreen « éditeur inconnu ». **NON CONSTRUIT** (signature).
- `keys/public.pem` est référencé par `extraResources` mais le dossier `keys/`
  est gitignoré ; `post-build.js` **avertit seulement** (n'échoue pas) s'il
  manque — un build naïf peut dégrader la vérification serveur.
- Module ressources chiffrées AES-256-GCM (`secure-resources.js`) présent mais
  aucun asset `.enc` livré — **Code seul, sans usage évidencié.**

## 8. Qualité et CI

- CI (`.github/workflows/ci.yml`) : `tsc --noEmit`, ESLint, double validation de
  schéma Prisma, tests unitaires + intégration (Postgres 16 + Redis 7), scan de
  secrets **Gitleaks**, et **gate d'audit de dépendances bloquant** sur les vulns
  prod high/critical.
- `next.config.mjs` : **ni** `typescript.ignoreBuildErrors` **ni**
  `eslint.ignoreDuringBuilds` — TS et ESLint bloquent le build.
- **Réserve :** les fichiers `electron/*.js` **effectivement livrés** (dont la
  vérification de MAJ, sécurité-sensible) sont des **doublons non testés
  directement** ; les tests portent sur des copies parallèles dans `src/lib`.

## 9. Chiffres vérifiés (session 2026-07-31)

| Indicateur | Valeur |
|---|---|
| Modèles Prisma (desktop) | 37 |
| Routes API `route.ts` | 125 |
| Tests (hors intégration) | 678 passés / 0 échec (64 suites) |
| `tsc --noEmit` | exit 0 |
| `@ts-ignore`/`@ts-nocheck` (src+electron) | 1 au total |
| Canaux IPC (main) | 27 |

---
*Réf. croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md` pour la synthèse des risques classés et des scores de préparation.*
