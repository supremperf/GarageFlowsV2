# Licences & appareils — modèle de sécurité

## Vue d'ensemble

Chaque licence (`LicenseKey`, plafond `seats`) possède des appareils
(`LicenseDevice`). Un appareil = une machine physique identifiée par son HWID
(SHA-256 de l'empreinte matérielle, calculé par Electron). Le serveur délivre à
l'activation un **deviceToken** opaque que le client présente à chaque
heartbeat.

```
LicenseKey (licenseId unique, seats, status, expiryAt)
   └── LicenseDevice (deviceId opaque, hwidHash, tokenHash, status)
         @@unique([licenseId, hwidHash])   ← une machine = un siège, jamais deux
         tokenHash @unique
   └── LicenseDeviceEvent (audit : activated/rotated/revoked/… — pseudonymisé)
```

## deviceToken

- **Génération** : 32 octets CSPRNG (`crypto.randomBytes`) → base64url —
  256 bits d'entropie.
- **Stockage serveur** : JAMAIS en clair. Seul `tokenHash =
  HMAC-SHA256(DEVICE_TOKEN_PEPPER, "gf-device-token:" + token)` est persisté.
- **Retour** : une seule fois, à l'activation (création ou rotation).
- **Comparaison** : recherche par hash exact + `crypto.timingSafeEqual`
  (défense en profondeur).
- **Révocation** : `status = revoked` sur l'appareil → le jeton est refusé au
  heartbeat suivant. Une licence révoquée/suspendue/expirée invalide
  IMMÉDIATEMENT tous ses jetons (le statut licence est vérifié à chaque
  validation).
- **Rotation** : chaque ré-activation de la même machine remplace `tokenHash`
  (l'ancien jeton meurt). La rotation du pepper invalide tous les jetons — les
  clients se ré-activent automatiquement via `deviceRequired`.
- **Stockage client (Electron)** : fichier `gf_license.dat` chiffré
  AES-256-GCM (clé dérivée du HWID par PBKDF2) + enveloppe `safeStorage` de
  l'OS (DPAPI/Keychain/libsecret) quand disponible. Jamais journalisé, jamais
  exposé au renderer (aucune API preload ne le retourne).

## HWID

- Format strict : 64 caractères hexadécimaux (SHA-256), validé par
  `isValidHwidFormat`, normalisé (casse/espaces) avant tout usage.
- **Stockage serveur** : `hwidHash = HMAC-SHA256(pepper, "gf-hwid:" + hwid)` —
  jamais le HWID brut. (Le champ historique `LicenseKey.hwid` de liaison de
  licence reste inchangé pour compatibilité — c'est déjà un condensé.)
- Comparaisons à temps constant, correspondance EXACTE uniquement (aucune
  tolérance partielle).
- Le HWID n'est PAS un secret : il ne suffit jamais seul à obtenir un jeton.

## Activation (`POST /api/license/activate`)

1. Rate limit (catégorie `license_activate`, distribué en PWA).
2. Vérification cryptographique ECDSA-P256 du token de licence.
3. Contrôles base : intégrité HMAC du record (anti-tampering SQLite),
   `status` (revoked/suspended), **expiration**, liaison HWID stricte.
4. **Enregistrement d'appareil ATOMIQUE** (si HWID fourni — clients desktop) :
   - transaction unique ; sur PostgreSQL, verrou pessimiste
     `SELECT … FOR UPDATE` sur la ligne licence — les activations concurrentes
     d'une même licence sont sérialisées ;
   - machine déjà connue → rotation du jeton (jamais un second siège) ;
   - machine révoquée → refus `DEVICE_REVOKED` (seul un admin peut la
     réinitialiser) ;
   - sinon comptage des appareils `active` puis création, avec re-comptage de
     contrôle dans la même transaction (filet SQLite) — si
     `actifs ≥ seats` → refus `DEVICE_LIMIT_REACHED` (403) ;
   - preuve par tests de concurrence (CI) : 8 activations simultanées avec
     `seats=1` → exactement 1 admise ; 10 avec `seats=2` → exactement 2.
5. Réponse : `{ ok, …, deviceToken, deviceId }` — le jeton n'est retourné
   qu'ici.

Un simple `count()` puis `create()` sans verrou est explicitement interdit
(TOCTOU) — c'est ce que corrige cette implémentation.

## Heartbeat (`POST /api/license/check`)

- Avec `deviceToken` : validation stricte (hash, statut appareil, HWID lié,
  licence active et non expirée) → `allowed: true|false` + `status` précis.
  Jeton inconnu (rotation, base réinitialisée) → `{ deviceRequired: true }` :
  le client se ré-active, il n'est JAMAIS bloqué à tort.
- Sans jeton (anciens clients) : contrôle par `licenseId` + indication
  `deviceRequired` pour converger vers l'auth d'appareil.
- `GET /api/license/status` : même logique, pilotée par le cookie signé
  `gf_session` (UI/overlay).

## Routes de gestion

| Route | Auth | Effet |
|---|---|---|
| `POST /api/license/deactivate` | deviceToken | libère le siège (sans oracle d'existence) |
| `GET /api/license/devices` | cookie `gf_session` | liste pseudonymisée de SA licence |
| `GET /api/admin/licenses/[id]/devices` | session admin | liste admin |
| `POST /api/admin/licenses/[id]/devices/[deviceId]` | session admin | `revoke` (définitif côté client) ou `reset` (libère + ré-autorise) |

Règles métier : `revoke` = la machine ne peut plus se réactiver seule ;
`reset` = SAV/changement de poste, la machine repart de zéro si un siège est
libre.

## Politique fail-open / fail-closed

| Contexte | Politique |
|---|---|
| Electron, base locale indisponible (hors ligne, 1er démarrage) | fail-open documenté — l'app démarre ; verrous client 48 h/72 h + control plane distant restent l'autorité |
| Serveur/PWA, erreur DB | **fail-closed** : 503 générique, jamais de session ni de `allowed:true` sans vérification réussie |
| Rate limiter distribué indisponible (prod PWA) | **fail-closed** 503 sur les routes sensibles |
| Grâce hors-ligne Electron | sonde de connectivité = **serveur de licences** (pas 1.1.1.1) quand `GF_LICENSE_SERVER` est configuré — firewaller le seul serveur de licences n'entretient plus la grâce |

## Rotation des secrets

- `DEVICE_TOKEN_PEPPER` : rotation → tous les jetons invalidés → ré-activation
  automatique des clients (deviceRequired). À faire en heures creuses.
- `NEXTAUTH_SECRET` : invalide les cookies `gf_session` (ré-activation licence
  à l'ouverture). Voir docs/SECRETS_ROTATION.md.
- Jetons d'appareil individuels : rotation implicite à chaque ré-activation ;
  révocation immédiate par l'admin possible à tout moment.
