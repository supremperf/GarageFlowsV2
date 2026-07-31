# Architecture de sécurité — GarageFlow

> Document de data room (due diligence M&A). Faits vérifiés sur le code source aux
> dates du 31/07/2026. Deux dépôts : `GarageFlowsV2` (application desktop Electron +
> Next.js 14 + SQLite) et `garagesite3` (plan de contrôle cloud + site vitrine,
> Next.js 15 + PostgreSQL). Chaque affirmation cite un fichier réel.

## 1. Synthèse de la posture

La sécurité et l'isolation multi-locataire sont la partie la plus aboutie des deux
bases de code — au-dessus du niveau habituel d'un SaaS développé par une petite
équipe. Les fondations cryptographiques sont asymétriques et correctement appliquées,
les secrets sont gérés en **fail-closed** (refus de démarrage plutôt que dégradation
silencieuse), et l'isolation renderer d'Electron est conforme aux recommandations.

| Domaine | Maturité | État |
|---|---|---|
| Isolation renderer Electron | Production-candidate | Opérationnel |
| Serveur applicatif loopback (127.0.0.1) | Production-candidate | Opérationnel |
| Licences ECDSA P-256 (vérification) | Production-candidate | Opérationnel |
| Mises à jour signées Ed25519 + SHA-256 | Production-candidate | Opérationnel |
| Sauvegardes/ressources AES-256-GCM | Production-candidate | Opérationnel |
| Empreinte matérielle (HWID) | Production-candidate | Opérationnel |
| Rate limiting distribué (fail-closed) | Production-candidate | Opérationnel |
| Validation d'environnement fail-closed | Production-candidate | Opérationnel |
| Modèle d'admin (clé unique partagée) | Beta | Opérationnel, non-IAM |

> Réserve matérielle : la vérification des licences et des mises à jour repose sur des
> **clés publiques embarquées** ; les clés privées correspondantes (ECC P-256 licences,
> Ed25519 mises à jour) sont **hors du dépôt** (côté serveur uniquement) et constituent
> un actif à transférer explicitement lors de la cession (voir §11).

## 2. Isolation du renderer Electron

Chaque `BrowserWindow` est durci selon l'état de l'art :

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
  `webSecurity: true`, `allowRunningInsecureContent: false`
  — `electron/main.js:1636-1638`, `1701-1718`, `1606`.
- Le preload n'expose qu'une API `contextBridge` minimale et nommée, sans accès Node
  brut ni `ipcRenderer` direct — `electron/preload.js:10-118`.
- Navigation verrouillée : `will-navigate` / `will-redirect` confinés à
  `http://127.0.0.1:PORT` — `electron/main.js:1825-1839`.
- `setWindowOpenHandler` refuse toute nouvelle fenêtre et n'ouvre via le shell qu'une
  allowlist HTTPS d'hôtes `garageflows.fr` — `electron/main.js:1808-1821`.
- Attachement de `webview` refusé — `electron/main.js:1841`.

## 3. Serveur applicatif en loopback

L'application embarque le serveur Next.js standalone via `utilityProcess.fork` du
`server.js` généré, lié strictement à la boucle locale (`HOSTNAME 127.0.0.1`, port
4028) — `electron/main.js:1519-1568`, `1547`. Le serveur n'est jamais exposé au LAN.
Les routes internes (export/migration) sont protégées par une clé aléatoire générée à
chaque exécution — `electron/main.js:281`, `1554`. Les en-têtes CSP/HSTS et sécurité
sont posés pour l'application servie — `next.config.mjs:9-44`.

## 4. Licences — ECDSA P-256

- Format de jeton `GF2.*`, vérifié en **ECDSA-SHA256 sur courbe P-256** contre une
  **clé publique réelle embarquée** (pas un placeholder — le bypass de développement est
  donc inactif) — `electron/main.js:98-104`, `389-439` ;
  `src/lib/license/verify.ts:96-226` ; `src/lib/license/public-key.ts:14-23`.
- La vérification est asymétrique : **seule la clé publique** est embarquée ; l'émission
  d'une licence exige la clé privée détenue côté serveur uniquement
  (`keys/private.pem`, gitignoré, absent du dépôt).
- Comparaison HWID en temps constant (`crypto.timingSafeEqual`).
- Stockage local de la licence : **AES-256-GCM** avec clé dérivée par `PBKDF2(HWID)` et
  enveloppe OS `safeStorage` (DPAPI / Keychain / libsecret), marqueur de format `GFS1`
  — cf. `verified-facts.md`.

## 5. Mises à jour signées Ed25519 (SHA-256 avant exécution)

Lorsque la clé de signature est embarquée, un manifeste **Ed25519 valide est
OBLIGATOIRE** avant toute installation — `electron/main.js:1999-2020`. La chaîne :

1. Sérialisation canonique déterministe du manifeste (autorité pour version / taille /
   URL / SHA-256) — `electron/update-verify.js:70-104` ; `manifest.ts` (cloud).
2. Épinglage d'algorithme, anti-downgrade sémantique, et allowlist d'hôtes de
   téléchargement HTTPS — `electron/update-verify.js:20-33`, `88-101`.
3. Calcul en flux du **SHA-256** du binaire téléchargé, comparé en temps constant à la
   valeur du manifeste **AVANT** tout lancement de l'installeur — `electron/main.js:2144-2173`.
4. Refus d'exécuter un binaire non vérifié ou dont la taille ne correspond pas
   — `electron/main.js:2144-2173` ; `electron/control-plane.js:74-84`.

Ordre de repli : serveur central → admin local → GitHub (non vérifiable). Intégrité
préservée même en cas de compromission serveur/BDD grâce à la signature.

## 6. Chiffrement des sauvegardes et ressources (AES-256-GCM)

- Sauvegardes chiffrées authentifiées **AES-256-GCM**, dérivation de clé `scrypt` ;
  toute altération fait échouer le déchiffrement — `src/lib/backup/crypto.ts:33-74`.
  (Note produit : le service de backup est complet côté code mais **sans interface
  utilisateur** — voir l'audit value-gap ; ce n'est pas une faiblesse de sécurité mais
  une lacune d'exposition.)
- Module de ressources chiffrées AES-256-GCM (`secure-resources.js`) : chiffrement/
  déchiffrement en mémoire présent, mais aucun asset `.enc` livré dans l'arbre audité —
  utilitaire présent, usage non attesté (code-only).

## 7. Empreinte matérielle (HWID)

HWID = **SHA-256** de (cpu, mac, plateforme, hostname, disque). Le HWID **n'est jamais
stocké en clair** : seul son HMAC-SHA256 est persisté côté cloud
(`schema.prisma:81`, `service.ts:560-566`). Comparaison stricte en temps constant.
Un ancien mode de correspondance floue (≥48/64 caractères hex) subsiste sur le chemin
de la fiche licence (`verify.ts:146-157`), superséder par l'authentification exacte par
device-hash — à considérer comme dette (voir THREAT_MODEL).

## 8. Authentification des appareils (device tokens)

Jetons d'appareil opaques **signés HMAC** avec révocation par `tokenVersion`
(`device-token.ts:48-135`). Le heartbeat exige un jeton signé ; polling adaptatif
(2 min en régime normal / 20 s si bloqué). **Fail-open** sur erreur réseau : un
utilisateur hors ligne n'est jamais verrouillé par une erreur transitoire (à mettre en
regard du verrou dur 72h — voir §10 et THREAT_MODEL).

## 9. Rate limiting distribué (fail-closed)

Sur les routes sensibles (licence, admin), rate limiting distribué via **Upstash Redis**
avec politique **fail-closed explicite en production** : `activate` / `check` / admin
renvoient **503** plutôt que de dégrader silencieusement — `rate-limit-distributed.ts:96-129` ;
`src/app/api/license/activate/route.ts:19-74` ; `check/route.ts:42-90` ;
`src/lib/server/admin.ts:31-65`. Côté desktop, l'implémentation centralisée
`src/lib/security/rate-limit.ts:209-308` est fail-closed sur les catégories critiques.

> Limite connue : le rate limiter de l'API publique `/api/v1` (cloud) est un `Map`
> **par instance**, non distribué (`src/lib/api/auth.ts:48-67`), donc inefficace en
> serverless multi-instances. L'API `/api/v1` étant par ailleurs un bac à sable en
> mémoire, la surface d'abus reste limitée aujourd'hui.

## 10. Validation d'environnement fail-closed & anti-tamper

- **Refus de démarrage en production** si des secrets sont manquants, trop courts ou
  correspondent à des valeurs d'exemple — `src/lib/env.ts:19-104` (desktop) ;
  `garagesite3/src/lib/env.ts:63-103` câblé via `instrumentation.ts`. En production le
  cloud EXIGE `DEVICE_TOKEN_SECRET`(≥32), `HWID_HMAC_SECRET`(≥32),
  `UPSTASH_REDIS_REST_URL/TOKEN`.
- Rejet des secrets faibles/hérités connus (`auth-secret.ts:19-51`,
  `session-secret.ts:20-48`) ; secret `NEXTAUTH` par installation, écriture atomique
  0600, fail-closed si aucun secret fort ne peut être produit (`electron/secret.js:33-146`).
- Manifeste d'intégrité **HMAC** généré au `afterPack` (electron-builder) sur
  app.asar / unpacked / keys / schema, vérifié au runtime par comparaison MAC en temps
  constant — `electron/integrity.js:22-26`, `84-145` ; `electron/afterPack.js:21-39`.
  Le code **documente lui-même** que cette protection est en JavaScript et donc
  contournable (défense en profondeur, pas du DRM fort).
- Détection de recul d'horloge ; grâce hors ligne 48h (avertissement) / verrou dur 72h
  (`app.quit()`) — `electron/main.js:298-299`, `1179-1219`. **Ce verrou 72h est un
  risque produit/disponibilité** documenté dans l'audit (churn potentiel), pas une force.
- Rapports de crash : opt-in (OFF par défaut, RGPD), redaction des secrets/tokens/JWT/
  jetons de licence/URL de BDD et noms d'utilisateurs locaux avant transmission —
  `electron/control-plane.js:104-157`.

## 11. Modèle d'administration (clé unique — limite connue)

Toute la surface `/api/admin` du plan de contrôle est protégée par **une seule clé
maître partagée** (`LICENSE_ADMIN_API_KEY` / `GARAGEFLOW_API_KEY`), comparée en temps
constant côté serveur — `garagesite3/src/lib/licenses/auth.ts:9-41` ;
`src/lib/server/admin.ts:60-64`. Le back-office la conserve dans `sessionStorage` du
navigateur et l'envoie en en-tête `x-gf-key` à chaque requête
(`src/app/admin/_lib/client.ts:9-52`). Conséquences : pas d'identité par opérateur, pas
de MFA, pas de rotation sans redéploiement, exposition XSS. À traiter comme travail de
durcissement IAM post-acquisition (voir THREAT_MODEL et VULNERABILITY_MANAGEMENT).

## 12. Clés cryptographiques — inventaire de transfert

| Clé | Rôle | Emplacement | À transférer |
|---|---|---|---|
| ECC/ECDSA P-256 (privée) | Émission des licences | Serveur (`keys/private.pem`, gitignoré) | **Oui — bloquant** |
| ECC P-256 (publique) | Vérification licences | Embarquée `electron/main.js:98-104` | Déjà dans le code |
| Ed25519 (privée) | Signature des mises à jour | Variable d'env serveur | **Oui — bloquant** |
| Ed25519 (publique) | Vérification mises à jour | Embarquée `electron/update-verify.js:20-25` | Déjà dans le code |
| `LICENSE_ADMIN_API_KEY` | Accès admin plan de contrôle | Variable d'env serveur | **Oui** |
| Secrets rate-limit / device / HWID HMAC | Runtime cloud | Variables d'env serveur | **Oui** |

Sans transfert des clés privées, du backend et des domaines `garageflows.fr`,
l'acquéreur **ne peut ni émettre de licence ni publier de mise à jour signée**. C'est un
transfert d'actifs externes (P0), pas du code.

---

*Référence croisée : voir [docs/ACQUISITION_READINESS_AUDIT.md](./ACQUISITION_READINESS_AUDIT.md).*
