# GarageFlow — Reconstruction du système de licences

Audit + reconstruction complète vers une architecture **centralisée** où le
**serveur est l'unique source de vérité**.

```
Keygen GUI / CLI
      │  HTTPS (clé LICENSE_ADMIN_API_KEY)
      ▼
app.garageflows.fr  (Next.js + Prisma)   ← SOURCE DE VÉRITÉ
      │
      ▼
PostgreSQL  (LicenseKey + LicenseEvent)   ← base centrale des licences
      ▲
      │  HTTPS (GET/POST /api/license/check | activate)
Logiciels GarageFlow (Electron)  ← clients, jamais autorité
```

Deux dépôts :
- **supremperf/GarageFlowsV2** — le logiciel de bureau (Electron) **et** le
  serveur central (le même code Next.js déployé sur `app.garageflows.fr`).
- **supremperf/garagesite3** — le site vitrine (n'est **jamais** une autorité de
  licences ; proxy optionnel vers le serveur central).

Branche de travail : `claude/garageflow-licenses-audit-4w283n` (les deux dépôts).

---

## 1. Modèle de sécurité — 3 familles de secrets DISTINCTES

| Secret | Rôle | Où |
|---|---|---|
| `NEXTAUTH_SECRET` | Signe les sessions / le cookie `gf_session` | Serveur + Electron |
| `LICENSE_ADMIN_API_KEY` | Authentifie le **Keygen** sur `/api/admin/licenses/*` | Serveur + Keygen |
| `keys/private.pem` (ou `GF_PRIVATE_KEY`) | Clé ECC qui **signe** les tokens | Keygen (idéalement pas sur le serveur) |

> ⚠️ **Avant** l'audit, une **seule** valeur servait aux trois usages **et** était
> commitée (`keys/server_config.json`, les deux `.env.example`). Cette valeur
> `3jvKZFYUKLjGTI/…` est **compromise** (présente dans l'historique git) :
> **rotationnez `NEXTAUTH_SECRET` et générez un `LICENSE_ADMIN_API_KEY` neuf.**

---

## 2. Base de données centrale (PostgreSQL)

Schéma : `prisma/license/schema.prisma` (client généré séparé → `src/generated/license-client`).

- **LicenseKey** : `licenseId` (=`lid`, unique) + `token` (unique) ; index sur
  `status`, `customerId`, `expiryAt`, `hwid`, `(status,expiryAt)`.
- **LicenseEvent** : journal d'audit de tout le cycle de vie (FK cascade).

Migration initiale : `prisma/license/migrations/0_init/migration.sql`.

```bash
# Sur le serveur central uniquement :
export LICENSE_DATABASE_URL="postgresql://USER:PWD@HOST:5432/garageflow_licenses"
npm run license:generate      # prisma generate (client licence)
npm run license:migrate       # prisma migrate deploy (crée les tables + index)
```

---

## 3. API des licences (toutes sur Prisma, sécurisées, gérées)

| Route | Méthode | Auth | Rôle |
|---|---|---|---|
| `/api/admin/licenses/create` | POST | clé API **ou** session admin | Enregistre un token signé (ou signe côté serveur) |
| `/api/admin/licenses/update` | POST | idem | label/notes/seats/**HWID**/**renouvellement** |
| `/api/admin/licenses/revoke` | POST | idem | `status: revoked \| suspended \| active` |
| `/api/admin/licenses/delete` | POST | idem | suppression définitive |
| `/api/admin/licenses` | GET/POST | idem | liste / alias de create |
| `/api/license/activate` | POST | rate-limit | active un token (le serveur doit déjà le connaître) |
| `/api/license/check` | GET+POST | rate-limit | heartbeat de validation (avec expiration) |
| `/api/license/status` | GET | cookie | validation via `gf_session` |

Toute la logique vit dans **un seul service** : `src/lib/license/service.ts`
(`createLicense`, `activate`, `validateById`, `setStatus`, `updateLicense`,
`deleteLicense`, `evaluate` + audit). Les routes sont de fines enveloppes.

---

## 4. Synchronisation (Étape 7) — le serveur a toujours le dernier mot

| Opération | Déclencheur | Flux garanti |
|---|---|---|
| **Création** | Keygen | signe → `POST /create` → **PostgreSQL** ; le Keygen **vérifie** la réponse (201/409) et **avertit** en cas d'échec. Cache local seulement. |
| **Activation** | Logiciel | `POST /activate` ; **refusée** si le serveur ne connaît pas la licence (le client n'est jamais autorité). Réconcilie les tombstones. |
| **Validation** | Logiciel (2 min) | `GET/POST /check` ; verdict définitif révoquée/suspendue/**expirée**/inconnue → blocage overlay ; retour actif → déblocage. |
| **Renouvellement** | Keygen/Admin | `POST /update {token}` (re-signé, même `lid`) **ou** `{years}` (re-signe serveur) → nouveau token + `expiryAt`, event `renewed`. |
| **Changement HWID** | Admin | `POST /update {hwid}` → event `hwid_changed` ; liaison auto au 1er `activate` si non lié. |
| **Suspension** | Keygen/Admin | `POST /revoke {status:suspended}` → blocage à la prochaine vérif (≤ 2 min). |
| **Révocation** | Keygen/Admin | `POST /revoke {status:revoked}` (+ tombstone si pas encore activée). |
| **Expiration** | Automatique | `evaluate()` compare `expiryAt` à l'instant → bloquée sans intervention. |
| **Suppression** | Admin | `POST /delete` → licence introuvable → bloquée à la prochaine vérif. |

**Hors-ligne sans désynchronisation** : réseau injoignable = état conservé
(jamais de faux blocage) ; le grace 48/72h impose la reconnexion ; dès que le
serveur répond, son verdict prime.

---

## 5. Keygen (Étape 5)

Après signature, le Keygen **envoie automatiquement** la licence au serveur,
**attend** la réponse, **vérifie** l'enregistrement et **affiche** les erreurs.

- GUI : onglet *Serveur GarageFlow* → URL + `LICENSE_ADMIN_API_KEY`. Génération
  = signe + `POST /create` + avertissement rouge si le serveur ne l'a pas pris.
- CLI : `python scripts/keygen.py --gen --customer CUST-001 --server https://app.garageflows.fr --api-key <KEY>`
  (lit aussi `keys/server_config.json`). `--no-push` pour désactiver.

---

## 6. Logiciel (Étape 6)

`electron/main.js` — `LICENSE_SERVER` (défaut `https://app.garageflows.fr`) :

- **Démarrage** : vérifie la licence stockée auprès du serveur ; blocage +
  ré-activation si révoquée/suspendue/expirée/inconnue ; hors-ligne toléré (grace).
- **Activation** : la fenêtre native **confirme auprès du serveur** avant d'accepter.
- **Toutes les 2 min** : `serverValidate` → **serveur central uniquement** (plus de
  repli local) ; overlay via IPC `license:revoked`/`license:reactivated`.

Configuration client : `GF_LICENSE_SERVER=https://app.garageflows.fr`.

---

## 7. Tableau d'audit (problèmes → correctifs)

| # | Partie | Problème | Gravité | Correctif | Statut |
|---|---|---|---|---|---|
| 1 | LES DEUX | Secret unique réutilisé (session=API=clés) et **commité** | Critique | 3 familles séparées ; fichiers retirés de git ; placeholders | ✅ (rotation à faire par l'opérateur) |
| 2 | SITE | `auth.ts` loggue identifiants + hash | Critique | Logs supprimés + anti-énumération | ✅ |
| 3 | SITE | `DATABASE_URL`/IDs loggués (revoke/status) | Élevé | Logs supprimés | ✅ |
| 4 | SITE | garagesite3 `revoke-by-key` = faux `{ok:true}` ; `create` vide | Critique | Proxy honnête (501/502) vers le serveur central | ✅ |
| 5 | SITE | Comparaison de clé non constant-time | Moyen | `timingSafeEqual` | ✅ |
| 6 | SITE (DB) | 2 systèmes de licences (modèles morts) | Élevé | `License/Device/Activation/LicenseLog` supprimés | ✅ |
| 7 | LES DEUX | Pas de source unique (SQLite locale/poste) | Critique | PostgreSQL central ; clients online | ✅ |
| 8 | LOGICIEL | Keygen ne pousse pas au serveur | Critique | Envoi auto + vérif + erreurs | ✅ |
| 9 | SITE | `status/check` sans expiration | Élevé | `evaluate()` bloque l'expiration | ✅ |
| 10 | SITE | Tombstone `licenseType` invalide + non réconcilié | Moyen | type `trial` + réconciliation à l'activation | ✅ |
| 11 | SITE | Fallbacks de secret incohérents | Moyen | `src/lib/security/session.ts` unifié | ✅ |
| 12 | SITE | Prochaine version 16 supposée ; projet en Next 14 | Info | Signalé ; build Next 14 vérifié | ℹ️ |
| 13 | SITE (DB) | Uniques/index `LicenseKey` manquants | Élevé | Nouveau schéma Postgres indexé | ✅ |
| 14 | LOGICIEL | `config/license.ts` mort ; `protection.ts` dupliqué | Faible | Supprimés | ✅ |
| 15 | LES DEUX | `keys/*.json` (token + clé) commités | Élevé | Retirés + gitignore | ✅ |

---

## 8. Vérifications effectuées

- **GarageFlowsV2** : `tsc --noEmit` = **0 erreur** ; `prisma validate` (×2) OK ;
  `next build` = **Compiled successfully** ; `node --check electron/main.js` OK ;
  `py_compile` keygen OK.
- **garagesite3** : `tsc --noEmit` = **0 erreur** ; `next build` OK.
- Aucune référence vers du code supprimé ; aucun doublon de système de licences ;
  clé fuitée absente des fichiers suivis.

---

## 9. Déploiement — plan étape par étape

**A. Serveur central (`app.garageflows.fr`)**
```bash
# .env
NEXTAUTH_SECRET="<openssl rand -base64 32>"
LICENSE_ADMIN_API_KEY="<openssl rand -hex 32>"        # ≠ NEXTAUTH_SECRET
LICENSE_DATABASE_URL="postgresql://…/garageflow_licenses"
# (optionnel) GF_PRIVATE_KEY="<base64 PKCS8 PEM>" pour signer côté serveur

npm ci
npm run license:migrate     # crée les tables PostgreSQL
npm run build               # génère les 2 clients + build Next
npm start
```

**B. Keygen (poste de l'éditeur)**
```bash
pip install cryptography
python scripts/keygen.py --init          # génère keys/private.pem (À GARDER SECRET)
# coller la clé publique affichée dans src/lib/license/public-key.ts et electron/main.js
python scripts/keygen_ui.pyw             # GUI → onglet Serveur : URL + LICENSE_ADMIN_API_KEY
```

**C. Logiciel client (build .exe)**
```bash
# variable d'environnement du build/app :
GF_LICENSE_SERVER=https://app.garageflows.fr
npm run dist
```

## 10. Points restant à traiter (hors périmètre de cette session)

1. **Rotation des secrets** compromis (obligatoire — présents dans l'historique git).
2. **Provisionner un PostgreSQL** et exécuter `license:migrate` (aucune base fournie ici).
3. **Générer une vraie paire de clés ECC** et coller la clé publique (les clés de
   démo intégrées ne correspondent à aucune `private.pem` locale).
4. Tests **runtime E2E** (Keygen→serveur→logiciel) non exécutés ici : ni PostgreSQL,
   ni backend `cryptography` fonctionnel dans l'environnement d'audit.
5. Optionnel : migration Next 14 → 16 si réellement souhaitée (chantier séparé).
