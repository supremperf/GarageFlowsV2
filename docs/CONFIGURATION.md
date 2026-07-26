# Configuration du système de mises à jour GarageFlow

Guide de configuration de bout en bout : **serveur central** (`garagesite3`, sur
Vercel) et **client** (`GarageFlowsV2`, l'app Electron). Voir aussi
[SECURITY-HARDENING.md](SECURITY-HARDENING.md) pour le durcissement.

## Architecture

```
Client GarageFlow.exe  ──HTTPS──▶  garagesite3 (app.garageflows.fr / Vercel)
  (chez le garagiste)              ├─ Postgres (Neon)  : versions + licences
  /api/update/latest               └─ Vercel Blob      : fichiers .exe
  /downloads/:version
        ▲                                   ▲
   Utilisateur final              Vous (admin) → /admin/updates (clé admin)
```

Deux endroits à configurer : le **serveur** (variables Vercel) et le **client**
(au build).

---

## 1. Serveur central — variables d'environnement

**Où :** Vercel → projet `garagesite3` → **Settings → Environment Variables**
(portée *Production*). **Redéployer après ajout.** En dev : fichier `.env.local`.

| Variable | Rôle | Obtention |
| --- | --- | --- |
| `DATABASE_URL` | Base Postgres (versions + licences), lue par Prisma. | Fournie par Neon. |
| `LICENSE_ADMIN_API_KEY` | Protège **toute** l'API admin (`/api/admin/update/*`) et l'upload Blob. C'est la clé saisie dans `/admin/updates` (en-tête `x-gf-key`). | `openssl rand -hex 32`. **Même valeur** côté Vercel et côté page admin. |
| `BLOB_READ_WRITE_TOKEN` | Active l'**upload direct du .exe** vers Vercel Blob. | Vercel → **Storage → Create → Blob** → *Connect to project* (variable injectée automatiquement). Sans elle, l'option « Fournir un lien » reste disponible. |
| `NEXT_PUBLIC_API_URL` | *(optionnel)* Origine des URLs `/downloads/...`. Sans elle, déduite des en-têtes (OK sur Vercel). | `https://app.garageflows.fr` |
| `NEXTAUTH_SECRET`, `GARAGEFLOW_API_KEYS` | Déjà en place (session, API démo). | — |

**Base de données (une fois)** — crée la table `AppRelease` :

```bash
npx prisma migrate deploy
```

---

## 2. Client GarageFlow — variables (au build `npm run dist`)

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `GF_UPDATE_SERVER` | URL du serveur de mises à jour. | *(vide)* |
| `GF_LICENSE_SERVER` | Serveur licences **et** mises à jour. | *(vide)* |
| `GF_UPDATE_CHANNEL` | Canal : `stable` / `beta`. | `stable` |
| `GF_INTEGRITY_MODE` | Vérification d'intégrité : `audit` / `enforce` / `off`. | `audit` |
| `GF_ANTIDEBUG` | `1` = bloque si débogueur détecté (mode `enforce`). | `0` |

**URL du serveur par défaut.** Le `.env` n'est **pas** embarqué dans le paquet
installé. `electron/main.js` intègre donc une **valeur par défaut** :

```js
const UPDATE_SERVER = (process.env.GF_UPDATE_SERVER || process.env.GF_LICENSE_SERVER
    || 'https://app.garageflows.fr').replace(/\/$/, '')
```

→ l'app packagée contacte le serveur **sans configuration**, tout en restant
surchargeable par variable d'environnement (dev/staging). Si votre domaine
diffère, changez ce défaut.

---

## 3. Endpoints API

### Publics (appelés par le client, sans authentification)

| Endpoint | Méthode | Rôle |
| --- | --- | --- |
| `/api/update/latest?version=&channel=` | GET | Dernière version + `hasUpdate` + `mandatory` (comparaison SemVer). Appelé au démarrage puis toutes les heures. |
| `/api/update/changelog?channel=&limit=` | GET | Historique des versions publiées. |
| `/downloads/:version?channel=` | GET | URL de téléchargement stable → **302** vers le stockage (Blob/CDN, gère le Range/reprise). |

```bash
curl "https://app.garageflows.fr/api/update/latest?version=1.0.0"
```

### Admin (en-tête `x-gf-key: <LICENSE_ADMIN_API_KEY>`)

| Endpoint | Méthode | Rôle |
| --- | --- | --- |
| `/api/admin/update/publish` | POST | Publie une version (JSON). |
| `/api/admin/update/:id` | DELETE | Supprime une version. |
| `/api/admin/updates` | GET | Liste des versions (page admin). 401 si clé invalide. |
| `/api/admin/update/blob-upload` | POST | Jeton d'upload Vercel Blob (clé admin en `clientPayload`). |

```bash
curl -X POST https://app.garageflows.fr/api/admin/update/publish \
  -H "x-gf-key: <LICENSE_ADMIN_API_KEY>" -H "Content-Type: application/json" \
  -d '{"version":"1.2.0","title":"GarageFlow 1.2.0","changelog":"- Corrections",
       "fileUrl":"https://.../GarageFlow-Setup-1.2.0.exe","sha256":"<64 hex>",
       "size":123456789,"mandatory":false}'
```

---

## 4. Publier une mise à jour (procédure)

1. `npm run dist` → `dist/GarageFlow Setup X.Y.Z.exe`.
2. Ouvrir `https://app.garageflows.fr/admin/updates`.
3. Saisir la **clé admin** (= `LICENSE_ADMIN_API_KEY`).
4. Renseigner version, titre, changelog (+ obligatoire ? version min. ?).
5. Choisir **Téléverser le .exe** (si `BLOB_READ_WRITE_TOKEN` configuré) **ou**
   **Fournir un lien** (le SHA-256 et la taille sont calculés localement).
6. **Publier** → dans l'heure (ou au prochain démarrage), tous les clients voient
   la fenêtre de mise à jour et installent en un clic (vérification SHA-256 avant
   installation ; données conservées).

---

## Récapitulatif « prêt pour la production »

- [ ] Vercel : `LICENSE_ADMIN_API_KEY`, `BLOB_READ_WRITE_TOKEN` (+ `NEXT_PUBLIC_API_URL`).
- [ ] `npx prisma migrate deploy` (table `AppRelease`).
- [ ] Client : URL serveur par défaut vérifiée (`app.garageflows.fr`) ou surchargée.
- [ ] Après validation d'un build Windows : `GF_INTEGRITY_MODE=enforce`.
