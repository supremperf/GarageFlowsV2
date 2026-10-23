---
doc-numbers: journal
---

# AUDIT DES VARIABLES D'ENVIRONNEMENT — état final MASTER 5

**Verdict : CONTRAT DE PRODUCTION SATISFAIT.** Les 10 variables requises par le contrat sont présentes en Production sous leur nom canonique, sans alias interdit. Deux absences sont signalées parce qu'elles **désactivent** des fonctions du produit.

Aucune valeur de secret ne figure dans ce document. Toutes les lectures ont porté sur les **noms** de variables ; les valeurs n'ont jamais été affichées, journalisées ni recopiées dans le dépôt.

## 1. Contrôle exécuté

```
$ npm run check:env-vercel

══ PRODUCTION — 16 variables chez Vercel

REQUISES PAR LE CONTRAT
   PRESENT  DATABASE_URL
   PRESENT  DEVICE_TOKEN_PEPPER
   PRESENT  DIRECT_URL
   PRESENT  GARAGEFLOW_API_KEY
   PRESENT  GF_DB_MAC_SECRET
   PRESENT  GF_PRODUCTION_DB_FINGERPRINT
   PRESENT  NEXTAUTH_SECRET
   PRESENT  NEXTAUTH_URL
   PRESENT  UPSTASH_REDIS_REST_TOKEN
   PRESENT  UPSTASH_REDIS_REST_URL

✅ Toutes les variables requises existent sous leur nom canonique ; aucun alias interdit chez Vercel.
EXIT=0
```

Le projet cible est `garage-flows/app.garageflows.fr` (identifiant `prj_D6TzGiDffWVBjXscUSSgk5re9ymP`). Note de périmètre : **`garage-flows` est le nom de l'ÉQUIPE**, pas celui du projet ; l'énoncé de mission les confondait. L'équipe contient trois projets : `app.garageflows.fr`, `garageflows.fr` et `www.garageflows.fr`.

## 2. Inventaire par environnement (noms uniquement)

### Production — 16 variables, toutes de type `Secret`

`DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `GARAGEFLOW_API_KEY`, `GF_DB_MAC_SECRET`, `DEVICE_TOKEN_PEPPER`, `GF_PRODUCTION_DB_FINGERPRINT`, `GF_PORTAL_SECRET`, `GF_SMTP_CIPHER_KEY`, `GF_SIGNATURE_SECRET`, `GF_BACKUP_KEY`, `CRON_SECRET`, `EINVOICING_QUEUE_TOKEN`.

### Preview — environnement de staging réellement provisionné

Intégration **Neon PostgreSQL** (`DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_PRISMA_URL`, `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `NEON_PROJECT_ID`…) et intégration **Upstash Redis** (`KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_URL`, `REDIS_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`), plus les mêmes secrets applicatifs qu'en Production.

La base Preview est **distincte** de la Production : c'est elle qui a servi aux tests PostgreSQL et Redis réels (voir `DATABASE_FINAL.md`). Aucun test destructif n'a touché la Production.

### Development

`GF_PRODUCTION_DB_FINGERPRINT` uniquement.

## 3. Deux absences qui désactivent des fonctions

### 3.1 `GF_PRIVATE_KEY` — absente de Production

La route `/api/admin/licenses/generate` appelle `loadIssuerPrivateKey()` (`src/lib/license/issuer-key.ts`), qui lit `GF_PRIVATE_KEY` puis, à défaut, `keys/private.pem`. Ni l'une ni l'autre n'existe côté serveur.

**Conséquence : l'émission de licences depuis le serveur de production est inopérante** — l'appel renverra « Clé privée d'émission introuvable : définissez GF_PRIVATE_KEY (PEM en base64) sur le serveur. »

Ce comportement est *fail-closed* (correct), mais il signifie que l'émission doit obligatoirement passer par l'outil hors ligne `scripts/keygen.py`, sur le poste qui détient la clé autorisée (empreinte attendue `b16d2e1bf6b9662f…`). À arbitrer : est-ce le fonctionnement voulu, ou une variable oubliée ?

### 3.2 `GARAGEFLOW_LLM` et `ANTHROPIC_API_KEY` — absentes de Production

`resolveLlmProvider()` (`src/lib/copilot-llm/provider.ts:134`) n'instancie le fournisseur que si `GARAGEFLOW_LLM === 'anthropic'` **et** `ANTHROPIC_API_KEY` est renseignée. En leur absence, `providerHealth()` renvoie honnêtement `{ state: 'unavailable', reason: 'Modèle externe désactivé ; mode local actif.' }`.

**Point important, et c'est le code qui le dit** : même avec ces deux variables correctement renseignées, **aucun appel externe ne partirait**. `AnthropicClassifier.request()` court-circuite toute entrée/sortie hors environnement de test :

```ts
// There is currently NO independently verified monetary enforcement service.
// Keep all production IO closed, even with valid server key/model/opt-in.
if (!this.simulatedTransport) {
  this.attempt = { outcome: 'budget_blocked', … }
  return null
}
```

Le copilote fonctionne donc exclusivement sur son **moteur local déterministe** — ce n'est pas une réponse simulée, c'est un autre moteur, et son indisponibilité externe est rapportée. Voir `AUDIT_COMPLET_GARAGEFLOWS.md §Copilote`.

## 4. SMTP : aucune variable, par conception

Il n'existe **aucune** variable `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` dans cette architecture. Les identifiants SMTP sont des **données par garage**, portées par le modèle `Garage` :

```prisma
smtpHost   String?
smtpPort   Int?
smtpUser   String?
smtpPass   String?   // AES-256-GCM au repos (GF_SMTP_CIPHER_KEY)
smtpFrom   String?
smtpSecure Boolean @default(true)
```

La seule variable de plateforme associée est `GF_SMTP_CIPHER_KEY` — **présente** en Production. Elle ne doit jamais être rotée automatiquement : une rotation sans `GF_SMTP_CIPHER_KEY_OLD` rendrait tous les mots de passe SMTP déjà stockés définitivement illisibles.

L'envoi réel a été vérifié de bout en bout contre un serveur SMTP local jetable — voir `SECURITE_GARAGEFLOWS.md §SMTP`.

## 5. Ce qui n'a PAS été ajouté

Aucune variable n'a été créée, modifiée ni supprimée chez Vercel. Le contrat étant satisfait, ajouter « au cas où » les noms cités dans l'énoncé de mission (`JWT_SECRET`, `LICENSE_PUBLIC_KEY`, `LICENSE_KEY_FINGERPRINT`, `REFERENCE_FP`, `REDIS_URL`, `AI_API_KEY`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_GBP_*`…) aurait introduit des variables que le code ne lit pas :

- `REFERENCE_FP` et la clé publique de licence ne sont **pas** des variables d'environnement : ce sont des **ancrages dans les sources**, matérialisés au build (`materialize-build-public-key.cjs`) ;
- `AUTH_SECRET` n'est pas lu : c'est `NEXTAUTH_SECRET` ;
- `AI_API_KEY` n'est pas lu : c'est `ANTHROPIC_API_KEY`, et seulement avec `GARAGEFLOW_LLM`.

## 6. Hygiène locale corrigée

`.vercelignore` excluait déjà `.env*`, `keys/`, `node_modules/`, `.next/`, `dist/`, `*.exe`. Deux ajouts ont été faits :

- **bases SQLite locales** (`prisma/*.db` et journaux WAL/SHM), avec l'exception explicite `!prisma/garageflow-template.db` — le modèle committé reste nécessaire à `scripts/post-build.js`. Téléverser une base de travail vers la plateforme de build était inutile et contraire à l'hygiène ;
- **dossiers de preuves et artefacts locaux** (`MASTER4_EVIDENCE/`, `MASTER5_EVIDENCE/`, `release/`, `e2e/shots/`, `playwright-report/`, `test-results/`, `.tmp-*/`).

Par ailleurs, `vercel link` a créé un `.env.local` contenant un jeton OIDC de courte durée ; ce fichier a été **supprimé** du dossier projet après usage.
