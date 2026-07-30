# Licences multi-tenant (PWA) — appareils, sessions, révocation

Ce document décrit l'application des licences côté **serveur/PWA** (PostgreSQL,
multi-instance). Le desktop Electron (SQLite mono-poste) conserve son propre
contrôle local — voir `docs/LICENSE_DEVICE_SECURITY.md`.

## Principe

Sur la PWA, deux sessions coexistent :

- **Session utilisateur** (NextAuth, cookie chiffré) : identifie l'utilisateur
  et son `garageId`.
- **Session de licence** (`gf_session`, JWT HS256 HttpOnly) : porte `lid`
  (licenseId) et `did` (deviceId), émise par `/api/license/activate`.

Aucune des deux ne suffit seule. Chaque appel d'API métier est revalidé en base
(`requireSession` → `validateLicensedSession`, `src/lib/license/session.ts`).

## Appareils : Electron (HWID) et PWA (install id)

Un **siège** (`LicenseKey.seats`) = un appareil actif. Deux sources d'empreinte,
traitées identiquement (jamais stockées en clair — seul l'HMAC `hwidHash`) :

| Client   | Empreinte            | Format            | Domaine HMAC        |
|----------|----------------------|-------------------|---------------------|
| Electron | HWID matériel        | SHA-256 (64 hex)  | `gf-hwid:`          |
| PWA      | Identifiant d'install| base64url 43 (256 bits) | `gf-pwa-install:` |

L'install id PWA (`src/lib/pwa-install-id.ts`) est généré par le navigateur
(`crypto.getRandomValues`), persistant (localStorage), **non intrusif** (aucune
empreinte de navigateur), envoyé à l'activation. Effacer les données du
navigateur en régénère un (l'ancien appareil reste jusqu'à révocation/reset admin
ou libération d'un siège).

**Garantie clé** : en contexte serveur/PWA, une licence non-admin n'obtient
JAMAIS de session sans enregistrer un appareil valide (`DEVICE_REQUIRED`) — plus
de « siège fantôme » où plusieurs navigateurs partagent une licence. Le plafond
`seats` est appliqué dans une transaction atomique (verrou `SELECT … FOR UPDATE`
sur la licence) : activations concurrentes sérialisées, plafond jamais dépassé
(prouvé par test de concurrence sur PostgreSQL réel).

## Liaison licence ↔ garage (anti-cross-tenant)

`LicenseKey.garageId` (nullable) lie une licence à un garage. Politique
**bind-on-first-use** : la première session licenciée d'un garage rattache la
licence (mise à jour atomique `updateMany where garageId is null`) ; ensuite le
rattachement est immuable. Toute session présentant cette licence pour un autre
garage est refusée (`LICENSE_GARAGE_MISMATCH`). Une valeur `garageId` envoyée par
le client n'est jamais fiable : seule la relation en base fait foi.

## Validation par requête (`validateLicensedSession`)

Ordre des contrôles (échec = code structuré) :

1. `gf_session` valide (JWT signé) — sinon `LICENSE_SESSION_MISSING` (401) ;
2. licence existante — `LICENSE_UNKNOWN` (401) ;
3. non révoquée — `LICENSE_REVOKED` (403) ;
4. non suspendue — `LICENSE_SUSPENDED` (403) ;
5. non expirée — `LICENSE_EXPIRED` (403) ;
6. rattachement au garage de l'utilisateur — `LICENSE_GARAGE_MISMATCH` (403) ;
7. appareil (`did`) présent — `DEVICE_REQUIRED` (401, réactiver) ;
8. appareil connu et lié à la licence — `DEVICE_UNKNOWN` (401, réactiver) ;
9. appareil actif — `DEVICE_REVOKED` (403).

## Révocation immédiate

La validation lit l'état en base **à chaque requête sensible** : révoquer une
licence ou un appareil (ou faire expirer/suspendre) prend effet **au prochain
appel** (délai ≈ 0), même si l'utilisateur détient encore une session NextAuth,
un `gf_session` signé et une interface ouverte. La durée du `gf_session` est de
30 jours côté web (5 ans en Electron pour le hors-ligne) — mais elle ne
« blanchit » jamais un état révoqué puisque tout est revérifié en base.

## Politique de version des clients

`/api/license/check` exige une version client vérifiable :

- sous `GF_MIN_ELECTRON_VERSION` / `GF_MIN_PWA_VERSION` → `426 UPGRADE_REQUIRED` ;
- heartbeat **sans jeton d'appareil** : toléré uniquement pendant la fenêtre
  `GF_DEVICE_AUTH_DEADLINE` (date future) ; par défaut (non définie) le jeton est
  **exigé immédiatement** (`DEVICE_TOKEN_REQUIRED`, jamais `allowed:true`).
  Passé le délai, aucun client sans jeton n'est autorisé — fin du contournement
  du contrôle des sièges.

## Plan FREE / inscription

`POST /api/garages` crée un garage `FREE` + compte OWNER. Cette route est
**pré-licence** (elle n'exige pas de licence, sinon l'inscription serait
impossible) mais elle est **strictement limitée en débit** (5/h/IP). Politique
retenue : **activation de licence obligatoire pour utiliser le logiciel** — un
garage FREE peut s'inscrire et se connecter, mais toutes les API métier exigent
une session licenciée (`requireSession`). Il n'existe donc **aucun chemin
implicite** donnant accès au logiciel sans licence ni siège. Les permissions ne
sont jamais déduites d'une valeur de plan envoyée par le client.

## Contexte d'application (`licenseEnforcementEnabled`)

| Contexte                    | Enforcement licencié          |
|-----------------------------|-------------------------------|
| Electron (`ELECTRON=1`)     | **désactivé** (contrôle local — fenêtre native + heartbeat) |
| Production PWA              | **toujours actif** (jamais désactivable) |
| Dev (non-Electron)          | actif par défaut (`LICENSE_ENFORCEMENT=off` pour désactiver) |
| Test                        | inactif sauf `LICENSE_ENFORCEMENT=on` |

## Variables d'environnement associées

Voir `.env.example` : `DEVICE_TOKEN_PEPPER`, `UPSTASH_REDIS_REST_*`,
`LICENSE_ENFORCEMENT`, `GF_MIN_ELECTRON_VERSION`, `GF_MIN_PWA_VERSION`,
`GF_DEVICE_AUTH_DEADLINE`.

## Libérer un siège (procédure admin)

- **Révoquer** un appareil : `POST /api/admin/licenses/[id]/devices/[deviceId]`
  `{ action: 'revoke' }` — l'appareil ne peut plus se réactiver seul.
- **Réinitialiser** (SAV / changement de poste) : `{ action: 'reset' }` —
  supprime l'appareil (libère le siège) et ré-autorise la machine.
- Lister : `GET /api/admin/licenses/[id]/devices` (pseudonymisé).
