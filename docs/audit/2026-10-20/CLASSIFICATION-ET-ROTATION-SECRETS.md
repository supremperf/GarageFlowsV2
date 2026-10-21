# GarageFlows — Classification des variables et rotation sélective

**Date :** 2026-10-20

> Aucune valeur de secret ici : noms de variables et empreintes SHA-256 tronquées.

La règle appliquée impose qu'**aucune variable ne soit modifiée avant que sa
classification soit établie**. Ce document est donc le préalable, pas le
compte rendu.

---

## 1. Classification des 44 variables du `.env`

| Catégorie | Variables | Action |
|---|---|---|
| **Secret interne — régénéré** | `NEXTAUTH_SECRET`, `GARAGEFLOW_API_KEY`, `DEVICE_TOKEN_PEPPER`, `GF_DB_MAC_SECRET`, `GF_PORTAL_SECRET`, `GF_SMTP_CIPHER_KEY`, `GF_SIGNATURE_SECRET`, `GF_BACKUP_KEY` | **régénérés (8)** |
| **Secret interne — exclu, justifié** | `GF_INTERNAL_EXPORT_KEY`, `GF_UPDATE_SIGNING_KEY` | **non touchés** (voir §3) |
| **Connexion Neon** | `DATABASE_URL`, `DIRECT_URL` | récupérées (rôle `gf_app`) — déclarées côté Vercel |
| **Injectées par intégration** | `DATABASE_URL_UNPOOLED`, `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_USER`, `POSTGRES_HOST`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`, `POSTGRES_URL_NO_SSL`, `POSTGRES_PRISMA_URL` | **conservées** |
| **Connexion Upstash** | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL`, `REDIS_URL` | **conservées** |
| **Fournisseur externe** | `BLOB_READ_WRITE_TOKEN` | **conservé** (règle §4) |
| **URL / configuration** | `NEXTAUTH_URL`, `GF_LICENSE_SERVER` | **conservées** |
| **Configuration métier** | les 8 `EINVOICING_*` | **conservées** |

**Absentes de ce `.env`**, donc rien à régénérer ni à conserver :
`GF_EINVOICE_CREDENTIALS_KEY`, `GF_TOTP_ENC_KEY`, `GF_PRIVATE_KEY`,
`SMTP_*`, `EMAIL_*`, `ANTHROPIC_API_KEY`.

> `ANTHROPIC_API_KEY` est pourtant attendue par `src/app/api/plate-ocr/route.ts`
> et `src/lib/copilot-llm/provider.ts` : le copilote et l'OCR de plaque sont donc
> **non configurés**. À signaler, non à inventer.

---

## 2. Données existantes dépendant de chaque clé — mesurées avant d'agir

C'est ce relevé qui a décidé de chaque action, pas la liste de départ.

| Clé | Données en production | Conséquence de la rotation |
|---|---|---|
| `GF_SMTP_CIPHER_KEY` | **0** mot de passe SMTP chiffré (sur 21 garages) | **aucune** — migration sans objet |
| `GF_BACKUP_KEY` | **0** sauvegarde (`BackupRecord`) | **aucune** |
| `GF_SIGNATURE_SECRET` | **0** signature | **aucune** |
| `GF_TOTP_ENC_KEY` | **0** `twoFactorSecret` | clé absente de toute façon |
| `GF_DB_MAC_SECRET` | **11** `recordMac` | **migration faite** (re-MAC) |
| `DEVICE_TOKEN_PEPPER` | **5** appareils | **migration faite** (sièges libérés) |
| `GF_PORTAL_SECRET` | 1 `PortalUser`, 2 `PortalDevice` | liens portail en circulation invalidés |
| `NEXTAUTH_SECRET` | 16 utilisateurs | reconnexion de tous |
| `GARAGEFLOW_API_KEY` | — | `keys/server_config.json` réaligné |

Le dépôt porte une politique explicite, verrouillée par
`src/lib/__tests__/env-manifest-drift.test.ts` : la liste `NEVER_AUTO_ROTATE`
(`GF_SMTP_CIPHER_KEY`, `GF_TOTP_ENC_KEY`, `GF_SMTP_CIPHER_KEY_OLD`,
`GF_EINVOICE_CREDENTIALS_KEY`, `GF_BACKUP_KEY`) avec ce commentaire :

> *« précédent réel : GF_SMTP_CIPHER_KEY et GF_TOTP_ENC_KEY régénérés à chaque
> reset avaient rendu mots de passe SMTP et secrets TOTP indéchiffrables »*

Trois de ces clés figurent dans la liste à régénérer. **Leur rotation n'a été
faite qu'après avoir mesuré qu'elles ne protégeaient aucune donnée.** Sans ce
relevé, la règle aurait provoqué exactement la perte que le dépôt documente.

**`GF_SMTP_CIPHER_KEY_OLD` n'a pas été posée** : la procédure de migration en
7 étapes devient sans objet avec 0 enregistrement chiffré, et créer un secret
inutile est une charge, pas une sécurité.

---

## 3. Les deux exclusions, et pourquoi

**`GF_INTERNAL_EXPORT_KEY`** — note du manifeste : *« Generated in memory by
Electron for each process. Do not persist or send to Vercel. »* Elle est produite
à l'exécution côté desktop. La régénérer dans un `.env` n'a pas de sens, et la
déclarer sur Vercel est explicitement proscrit.

**`GF_UPDATE_SIGNING_KEY`** — clé **privée Ed25519** (PEM PKCS#8) signant les
manifestes de mise à jour, `classification: dangerous-external`,
`scope: publisher-only`, `rotationRisk: critical`. La roter invaliderait les
mises à jour **déjà publiées** : les clients installés vérifient avec la clé
publique correspondante. Une rotation exige une procédure de migration côté
clients, pas une régénération. La règle ne la listait pas ; elle n'a pas été
touchée.

---

## 4. Formats respectés

Relevés chez chaque consommateur, pas supposés :

| Clé | Format exigé | Vérification |
|---|---|---|
| `GARAGEFLOW_API_KEY` | `hex64` | `/^[0-9a-f]{64}$/` |
| `GF_SMTP_CIPHER_KEY` | 32 octets en base64 (`secret-cipher.ts:32` `KEY_BYTES = 32`) | décode en **32 octets** |
| `GF_BACKUP_KEY` | 32 octets bruts (`backup/crypto.ts:84` lève sinon) | décode en **32 octets** |
| autres | `strong-secret`, ≥ 32 caractères | 44 caractères |

Génération : `crypto.randomBytes(32)` pour chaque clé, **indépendamment**.
Les formats ont été contrôlés **avant** toute écriture ; un format invalide
aurait interrompu l'opération sans rien modifier.

### Défaut préexistant corrigé au passage

`GF_BACKUP_KEY` décodait en **48 octets** au lieu de 32 :
`backup/crypto.ts:84` aurait levé `GF_BACKUP_KEY must decode to 32 bytes
(got 48)`. **La clé de sauvegarde était donc inutilisable** — ce qui explique
les 0 sauvegardes. La nouvelle décode bien en 32 octets.

---

## 5. Application et migration

| Étape | Résultat |
|---|---|
| `.env` local | **8 lignes modifiées, 36 conservées**, 174 lignes et commentaires préservés. Contrôlé : **0 variable changée hors plan, 0 perdue** |
| Sauvegarde | `.env.avant-rotation-20261020` (couvert par `.env*` dans `.gitignore`) |
| Vercel Production | les 8 déclarées ; `check-env-vercel` → **exit 0** |
| `keys/server_config.json` | réaligné sur la nouvelle `GARAGEFLOW_API_KEY` |
| Déploiement | `appgarageflows-ejt678rlb`, **vérifié comme réellement servi** par le domaine |
| **Migration** | `scripts/repair-after-secret-rotation.js --yes --reset-devices` : **11 `recordMac` recalculés**, **5 appareils** `active → deactivated` |
| Idempotence | relance : « 11 lues, **0 à recalculer, 11 déjà cohérentes** » |

### Preuves de la rotation effective

| Contrôle | Résultat |
|---|---|
| Keygen avec la **nouvelle** clé | **HTTP 200** — « 11 licence(s) connue(s) du serveur » |
| Keygen avec l'**ancienne** clé | **HTTP 403** — rotation effective |
| `GF_SMTP_CIPHER_KEY` / `GF_BACKUP_KEY` | décodent en **32 octets** — valides |
| Suite de tests | **4 337 réussis, 0 échec** |
| `tsc --noEmit` | **exit 0** |
| `verify-rotation` | **8 secrets prouvés rotés** |

---

## 6. Ce qui reste compromis, et pourquoi je ne peux pas le traiter

`verify-rotation` signale encore 10 valeurs. Elles se ramènent à **deux causes**,
toutes deux hors de ma portée :

**a) Neuf variables PostgreSQL** — `DATABASE_URL`, `DIRECT_URL`,
`DATABASE_URL_UNPOOLED`, `PGPASSWORD`, `POSTGRES_URL`,
`POSTGRES_URL_NON_POOLING`, `POSTGRES_PASSWORD`, `POSTGRES_URL_NO_SSL`,
`POSTGRES_PRISMA_URL`.

Elles portent toutes le même secret : le mot de passe de `neondb_owner`, dont la
réinitialisation vous revient (console Neon). **La production, elle, n'utilise
plus ce rôle** : `DATABASE_URL`/`DIRECT_URL` côté Vercel sont sur `gf_app`. Le
risque est donc circonscrit au `.env` du poste et à l'accès direct à la base.

Basculer aussi le `.env` local sur `gf_app` m'a été **refusé par la politique de
la session** (écriture d'identifiants de base dans un fichier). À faire après la
réinitialisation de `neondb_owner`.

**b) `BLOB_READ_WRITE_TOKEN`** — la règle demande de le **conserver** (clé de
fournisseur externe), et il est effectivement conservé. Il reste compromis ; sa
révocation exige `vercel blob delete-store` **en terminal interactif**, le CLI
Vercel refusant qu'un agent supprime un store.

---

## 7. Interdictions respectées

| Interdiction | Respect |
|---|---|
| Supprimer une variable non reconnue | aucune suppression — 44 avant, 44 après |
| Modifier les paramètres SMTP externes | aucun paramètre SMTP n'existe dans ce `.env` |
| Remplacer une clé de fournisseur tiers | aucune touchée |
| Générer une fausse clé de fournisseur | aucune |
| Perdre des données chiffrées | mesuré à 0 avant chaque rotation de clé au repos |
| Casser les licences émises | 11 `recordMac` recalculés, idempotence vérifiée |
| Supprimer une ancienne clé avant migration | `.env.avant-rotation-20261020` conservé |
