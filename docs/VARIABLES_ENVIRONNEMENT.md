# Variables d'environnement — référence

> **Document stable — remplace les anciennes notes `RESET_GARAGEFLOW_Vxxx`.**
> Source de vérité : `scripts/garageflow-env-manifest.json` **recoupé avec
> l'usage réel du code**. Aucune valeur secrète ne figure ici : uniquement des
> placeholders.

Colonnes :
- **Scope** — `desktop` (Electron/SQLite), `server` (PWA/Vercel), `both`.
- **Prod ?** — obligatoire au démarrage en production (sinon échec fail-fast).
- **Générable** — l'outil `env:configure` peut la générer automatiquement.
- **Risque rotation** — impact d'un changement de valeur (voir
  [ROTATION_SECRETS.md](ROTATION_SECRETS.md)).

---

## 1. Bases de données

| Variable | Scope | Prod ? | Format | Générable | Risque rotation | Rôle |
|---|---|---|---|---|---|---|
| `DATABASE_URL` (desktop) | desktop | oui | `file:./dev.db` | non | élevé | Base SQLite locale mono-poste. **Aiguillage runtime par le schéma de l'URL.** |
| `DATABASE_URL` (serveur) | server | oui | PostgreSQL **poolée** (`…-pooler…`) | non | élevé | Requêtes runtime PWA/serveur via pooler. |
| `DIRECT_URL` | server | oui | PostgreSQL **directe** | non | élevé | Utilisée uniquement par les migrations (`prisma migrate`). |

> `DATABASE_URL` est une **seule** variable dont la *valeur* détermine le mode.
> Interdiction de `file:`/SQLite en production web.

## 2. Authentification & session

| Variable | Scope | Prod ? | Format | Générable | Risque rotation | Rôle |
|---|---|---|---|---|---|---|
| `NEXTAUTH_SECRET` | both | oui | secret fort (base64, ≥32 o) | oui | **critique** | Signature sessions/cookies ; sert aussi de repli crypto (portail, dérivations). |
| `NEXTAUTH_URL` | both | oui | URL http(s) | non | faible | URL publique de l'app. |

## 3. Licences & appareils

| Variable | Scope | Prod ? | Format | Générable | Risque rotation | Rôle |
|---|---|---|---|---|---|---|
| `GARAGEFLOW_API_KEY` | server | oui | hex 64 | oui | moyen | Auth Keygen → serveur de licences. Comparée en temps constant à l'en-tête **`x-gf-key`** (ex. `/api/admin/licenses/revoke-by-key`). |
| `GF_LICENSE_SERVER` | desktop | non | URL https | non | faible | URL du serveur de licences distant contacté par Electron. |
| `DEVICE_TOKEN_PEPPER` | server | oui | secret fort (base64) | oui | **critique** | Poivre des jetons d'appareil et hachages HWID. |
| `GF_DB_MAC_SECRET` | both | oui | secret fort (hex) | oui | **critique** | MAC des enregistrements `LicenseKey` (`recordMac`). Côté Electron, dérivé du HWID. |
| `GF_PRIVATE_KEY` | server | non | PKCS#8 EC P-256 (base64 PEM) | **non — jamais** | **critique** | Signe les licences émises (`/api/admin/licenses/generate`). Doit correspondre à la clé publique embarquée. **Jamais dans le dépôt, jamais générée automatiquement.** |

## 4. Portail & signatures

| Variable | Scope | Prod ? | Format | Générable | Risque rotation | Rôle |
|---|---|---|---|---|---|---|
| `GF_PORTAL_SECRET` | server | non (→ repli `NEXTAUTH_SECRET`) | secret fort (base64) | oui | élevé | JWT portail client + signature des devis. |
| `GF_SIGNATURE_SECRET` | server | non | secret fort (base64) | oui | **critique** | Dérive la clé de scellement des signatures. |
| `GF_BACKUP_KEY` | server | non | base64 décodant à **exactement 32 octets** | oui | **critique** | Chiffre les sauvegardes. Une rotation rend les sauvegardes brutes illisibles. |
| `GF_INTERNAL_EXPORT_KEY` | desktop-runtime | non | hex 64 | non (mémoire) | faible | Généré **en mémoire** par Electron pour chaque process (loopback interne). **Ne pas persister ni envoyer à Vercel.** |

## 5. Limitation de débit (Upstash)

| Variable | Scope | Prod ? | Format | Générable | Risque rotation | Rôle |
|---|---|---|---|---|---|---|
| `UPSTASH_REDIS_REST_URL` | server | oui | URL https | non | moyen | Endpoint REST Upstash (rate limiting, mode fail-closed en prod). |
| `UPSTASH_REDIS_REST_TOKEN` | server | oui | secret non vide | non | moyen | Jeton Upstash associé. |

## 6. Intégrations & IA

| Variable | Scope | Prod ? | Format | Générable | Risque rotation | Rôle |
|---|---|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | server | non | secret non vide | non | faible | OCR plaque / lookup (désactivé si absent). |

## 7. Mises à jour desktop

| Variable | Scope | Prod ? | Format | Générable | Risque rotation | Rôle |
|---|---|---|---|---|---|---|
| `GF_UPDATE_SERVER` | desktop | non | URL https | non | faible | Serveur de mises à jour (repli sur `GF_LICENSE_SERVER` puis défaut codé). |
| `GF_UPDATE_CHANNEL` | desktop | non | `stable` \| `beta` | non | faible | Canal de mise à jour. |
| `GF_UPDATE_SIGNING_KEY` | publisher-only | non | clé privée | **non** | **critique** | *Déclarée mais **sans consommateur dans ce dépôt** (éditeur uniquement).* |

---

## 8. Variables déclarées **sans consommateur** dans ce dépôt

Présentes dans le manifeste ou l'historique, mais **aucun code de ce dépôt ne
les lit** (`absent-consumer`). À traiter comme documentaires ici — leur vrai
consommateur est ailleurs (serveur de licences séparé, build white-label, ou
non implémenté).

| Variable | Statut | Remarque |
|---|---|---|
| `GF_APP_URL` | absent-consumer | L'URL effective vient de `NEXTAUTH_URL`. |
| `GF_TOTP_ENC_KEY` | absent-consumer | Aucun code TOTP actif ne la lit ici. Si un jour utilisée : rotation = données `gtotp1.k1` illisibles. |
| `GF_SMTP_CIPHER_KEY` | absent-consumer | Les seules occurrences sont dans le client Prisma **généré** (faux positifs). Si un jour utilisée : rotation = secrets `gsmtp1.k1` illisibles. |
| `GF_BRAND_*` (et `NEXT_PUBLIC_GF_BRAND_*`) | absent-consumer | Configuration white-label de build. Non secrètes. |

---

## 9. Réconciliation des noms proches (à ne pas confondre)

Trois noms se ressemblent et sont **distincts** ; le client (ce dépôt,
`GarageFlowsV2`) et le **serveur de licences `garagesite3`** sont deux projets
séparés.

| Nom | Où | Rôle |
|---|---|---|
| **`GARAGEFLOW_API_KEY`** (singulier) | **ce dépôt** (client) | Auth Keygen → serveur, comparée à l'en-tête `x-gf-key`. C'est la seule des trois réellement lue par le code de `GarageFlowsV2`. |
| **`GARAGEFLOW_API_KEYS`** (pluriel) | serveur `garagesite3` | Clés de session / API démo côté serveur. **Aucun consommateur dans ce dépôt.** |
| **`LICENSE_ADMIN_API_KEY`** | serveur `garagesite3` | Protège toute l'API admin (`/api/admin/update/*`, upload Blob), saisie dans `/admin/updates`. **Aucun consommateur dans ce dépôt** (voir [CONFIGURATION.md](CONFIGURATION.md)). |

> À retenir : dans `GarageFlowsV2`, seule `GARAGEFLOW_API_KEY` (singulier) est
> active. Les deux autres appartiennent au serveur de licences distinct.
