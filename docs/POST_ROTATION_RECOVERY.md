# Récupération après la rotation totale des secrets Production

> À lire AVANT tout redéploiement réussi. La rotation du 2026‑08‑04 a remplacé,
> dans Vercel Production, des clés « au repos » **sans procédure de migration**.
> Tant qu'aucun build n'a réussi, la production tourne encore sur l'ancien build
> (les variables Vercel sont figées au build) — donc **rien n'est cassé pour
> l'instant**, mais un redéploiement direct casserait les données ci‑dessous.

## 1. Impact par clé (source : `docs/ROTATION_SECRETS.md` + code)

| Clé rotée | Casse | Réparable ? |
|---|---|---|
| `GF_DB_MAC_SECRET` | Tous les `recordMac` invalides → `license/check` & `license/activate` bloquent **toutes** les licences (`tampered`) | **OUI** — re‑MAC (script ci‑dessous) |
| `DEVICE_TOKEN_PEPPER` | Tous les hachages d'appareil invalides → ré‑activation forcée + inflation de sièges | **OUI** — reset appareils (`--reset-devices`) |
| `GF_SMTP_CIPHER_KEY` | `smtpPass` chiffrés illisibles | Partiel — voir §4 |
| `GF_TOTP_ENC_KEY` | Secrets 2FA du portail illisibles | Non — ré‑inscription 2FA |
| `GF_BACKUP_KEY` | Anciennes sauvegardes irrécupérables | Non (si l'ancienne clé est perdue) |
| Paire ECDSA de licence (`GF_PRIVATE_KEY` + `keys/`) **nouvelle**, mais `public-key.ts` **remis à l'ancienne** | Incohérence signature/vérification | Décision — voir §3 |

## 2. Réparation `recordMac` + appareils (automatisable, sûre)

Exécuter UNE fois, localement, contre la base Neon de production, avec les
**nouvelles** valeurs en variables d'environnement :

```bash
# 1) Vérifier (dry-run, n'écrit rien)
DATABASE_URL="postgresql://…neon…" GF_DB_MAC_SECRET="<nouvelle>" \
  node scripts/repair-after-secret-rotation.js

# 2) Appliquer (re-MAC de toutes les licences)
DATABASE_URL="postgresql://…neon…" GF_DB_MAC_SECRET="<nouvelle>" \
  node scripts/repair-after-secret-rotation.js --yes

# 3) Si DEVICE_TOKEN_PEPPER a aussi été roté : réinitialiser les appareils
DATABASE_URL="postgresql://…neon…" GF_DB_MAC_SECRET="<nouvelle>" \
  node scripts/repair-after-secret-rotation.js --yes --reset-devices
```

- Le re‑MAC recalcule chaque `LicenseKey.recordMac` avec le `GF_DB_MAC_SECRET`
  courant → les licences repassent valides. **Idempotent**, n'écrit aucun secret.
- `--reset-devices` passe les appareils `active` → `deactivated` (sièges libérés) ;
  chaque machine se ré‑active proprement (nouveau hachage avec le nouveau pepper).
- Le calcul du MAC est **prouvé identique** à `src/lib/license/record-mac.ts` par
  `src/lib/__tests__/remac-script-parity.test.ts` (échec CI si divergence).

Ordre recommandé : lancer le re‑MAC **juste après** un redéploiement réussi (bref
créneau où les licences sont bloquées), ou **avant** en pointant sur la même base.

## 3. Paire de clés de licence (ECDSA) — DÉCISION requise

Roter la paire de licence est la plus destructrice : la signature est **dans le
jeton** de chaque licence émise ; une nouvelle clé publique **n'accepte plus les
anciens jetons** (aucun re‑MAC possible). Deux états cohérents :

- **(Recommandé) Revenir à l'ANCIENNE paire** — préserve toutes les licences déjà
  émises. `public-key.ts` et `electron/main.js` sont **déjà** sur l'ancienne clé
  (empreinte `7bed3cb7…478`) suite au rollback ; il faut **remettre `GF_PRIVATE_KEY`
  (Vercel) et `keys/private.pem` + `keys/public.pem` à l'ANCIENNE valeur** (dossier
  de rapport `…\API générées\…` ou votre ancienne sauvegarde `keys/`).
- **Adopter la NOUVELLE paire** — uniquement si vous voulez **invalider et ré‑émettre
  TOUTES** les licences clients. Alors : réappliquer la **nouvelle** clé publique à
  `public-key.ts` + `electron/main.js`, mettre à jour l'empreinte attendue dans
  `scripts/check-critical-files.js` et `public-key-consistency.test.ts`, redéployer,
  puis ré‑émettre chaque licence.

Le garde `scripts/check-critical-files.js` bloquera un redéploiement dont la clé
publique ne serait pas l'empreinte canonique — c'est voulu.

## 4. SMTP / 2FA / Sauvegardes

- **SMTP** : si vous disposez de l'ANCIENNE `GF_SMTP_CIPHER_KEY`, définissez
  `GF_SMTP_CIPHER_KEY_OLD=<ancienne>` (rotation supportée par
  `src/lib/security/secret-cipher.ts`) puis lancez `node scripts/encrypt-smtp-secrets.js --rotate`
  pour ré‑chiffrer avec la nouvelle. Sinon, chaque garage devra re‑saisir son mot de
  passe SMTP dans Paramètres › Email.
- **2FA portail** : les secrets TOTP chiffrés avec l'ancienne `GF_TOTP_ENC_KEY` sont
  perdus → demander aux utilisateurs concernés de **ré‑activer la 2FA**.
- **Sauvegardes** : les archives chiffrées avec l'ancienne `GF_BACKUP_KEY` ne sont
  restaurables **que** si vous conservez l'ancienne clé.

## 6. Échec « GARAGEFLOW_API_KEY ne fonctionne pas sur le déploiement » (test post‑deploy)

Symptôme : le build Vercel **réussit**, le déploiement se crée, `/api/health`
répond `status:ok`, **puis** la rotation s'arrête sur
`La nouvelle GARAGEFLOW_API_KEY n-a pas passé le test runtime…`.

**Ce n'est PAS un problème de Deployment Protection.** Le test `/api/health`
et le test de clé passent tous deux par `vercel curl --deployment …`, qui
s'authentifie et **traverse** la protection. Si le health check est OK, la
protection est déjà franchie ; l'échec du test de clé vient donc de la
**réponse HTTP de la route** `POST /api/admin/licenses/revoke-by-key`, pas de
Vercel. La validation (`Test-ProtectedApiKeyEndpoint` dans
`scripts/reset-garageflow.ps1`) **retente désormais 4× avec backoff** et
**affiche le vrai code HTTP** ; interprétez‑le ainsi :

| Code HTTP | Cause | Correctif (sans redéployer à l'aveugle) |
|---|---|---|
| **403** | La fonction déployée lit un `GARAGEFLOW_API_KEY` **différent** de la nouvelle clé. | La variable n'est pas (encore) celle que voit CE déploiement. Vérifier `vercel env ls production` ; confirmer que la valeur Production **égale** la clé du rapport ; s'assurer que le déploiement testé a été **construit APRÈS** l'écriture de la variable. Un simple `vercel redeploy` du dernier build (sans re‑générer la clé) suffit souvent. |
| **500** | `GARAGEFLOW_API_KEY` **absente ou < 16 car.** dans le runtime. | La variable n'a pas été appliquée à l'environnement **Production**. La (re)définir en Production puis redéployer. |
| **401** / login Vercel | Protection interceptée (CLI non authentifiée). | `vercel whoami` ; `vercel login` ; vérifier le lien projet et `VERCEL_TOKEN`. |
| **429 / 503 / 502 / 504** | Rate‑limit ou fonction pas encore prête. | Transitoire : les 4 tentatives absorbent la fenêtre ; sinon relancer, ou attendre le `Retry‑After`. |

Point clé : la nouvelle clé est **écrite dans Vercel** puis **envoyée** par le
script depuis la même valeur générée — un 403 signifie presque toujours que le
**runtime testé** ne sert pas encore cette valeur (propagation d'environnement,
ou mauvais environnement ciblé), **pas** que la clé est « cassée ». Aucune
donnée n'est perdue : `revoke-by-key` avec un UUID neuf + `status:active` suit la
branche `not_registered` et **ne crée ni ne modifie** aucune licence.

## 7. Cause réelle d'un HTTP 500 au test de clé : schéma Neon désaligné

Observé le 2026‑08‑05 : le déploiement réussit, `/api/health` = ok, puis le test
de clé renvoie **HTTP 500** avec, dans les logs runtime :

```
Invalid `prisma.licenseKey.findUnique()` invocation:
The column `LicenseKey.parentLicenseId` does not exist in the current database.
[error] [admin/licenses/revoke-by-key] erreur base de données
```

**Ce n'est PAS un problème de clé API** (l'auth est passée, sinon 403). C'est un
**drift de schéma** : le code fusionné (mechanic‑licenses + chrono) référence des
colonnes/tables que la base Neon Production **n'a jamais reçues**. `findUnique`
sans `select` liste **toutes** les colonnes scalaires du modèle → dès qu'une
manque, Postgres échoue et la route renvoie 500. Colonnes/tables ajoutées par le
merge et absentes de Neon :

- `LicenseKey.parentLicenseId`, `mechanicId`, `mechanicHint`, `assignedAt`, `assignedBy`, `suspendedAt`
- `JobPhoto.mechanicId`
- `Job.timerAccumulatedSec`
- tables `MechanicLicenseAssignment`, `JobMechanicNote`, `MechanicActionAudit` (+ index/FK)

Migrations concernées (présentes dans le dépôt, **jamais appliquées** en prod) :
`20260804000000_mechanic_licenses`, `20260804120000_link_repairtypepart_garage`,
`20260804130000_add_part_jobpart_indexes`, `20260805000000_job_timer_accumulated`.

**Pourquoi ça arrive** : le build Vercel ne fait que `prisma generate` — il **ne
migre pas** la base. La rotation ne lançait qu'une réparation `legacyIdV*`.

**Correctif appliqué** : `scripts/reset-garageflow.ps1` **converge** désormais le
schéma Neon **avant** le déploiement (`Invoke-ServerSchemaConverge`) : un DDL
**idempotent** (`ADD COLUMN / CREATE TABLE / CREATE INDEX IF NOT EXISTS` + FK
guardées par `pg_constraint`) exécuté via `prisma db execute` (le même mécanisme
sûr que la réparation `legacyIdV*`). C'est volontairement **`db execute` et non
`migrate deploy`** : `migrate deploy` **saute** toute migration déjà inscrite dans
`_prisma_migrations` même si ses colonnes manquent réellement (drift) et peut
avorter sur un état de migration échoué — le DDL conditionnel, lui, **converge
toujours** les colonnes/tables réelles quel que soit l'historique, et est
rejouable sans risque. Additif (aucune colonne supprimée) : sûr pour l'ancien
déploiement encore en ligne, qui ignore les nouvelles colonnes.

**Portée & limites** : la convergence couvre exactement ce qui casse le runtime
(colonnes/tables **mechanic‑licenses + chrono** + leurs index/FK). Les objets
purement « performance » d'autres migrations récentes (index `JobPart`/`Part`,
FK `RepairTypePart`) ne sont **pas** inclus — sans impact sur les 500 — et
relèvent d'un `migrate deploy` complet. `IF NOT EXISTS` est idempotent **par
nom** : si une colonne existait déjà avec un mauvais type/nullabilité (drift
partiel bricolé à la main), elle est laissée telle quelle et doit être corrigée
manuellement.

**Manuel (si besoin, hors rotation)** — deux voies, avec les valeurs Production :

```bash
# (a) Voie « historique propre » : applique les migrations en attente ET les
#     enregistre dans _prisma_migrations. À privilégier si l'historique est sain.
DATABASE_URL="postgresql://…neon-direct…" DIRECT_URL="postgresql://…neon-direct…" \
  npm run db:server:deploy    # = prisma migrate deploy --schema prisma/server/schema.prisma

# (b) Voie « convergence » (drift-safe) : rejoue le DDL idempotent écrit par la
#     rotation dans le dossier de rapport (converge-server-schema.sql).
DATABASE_URL="postgresql://…neon-direct…" DIRECT_URL="postgresql://…neon-direct…" \
  npx prisma db execute --schema prisma/server/schema.prisma --file converge-server-schema.sql
```

**Cas de drift piégeux** : si `_prisma_migrations` marque une migration
« appliquée » alors que ses colonnes manquent, `migrate deploy` (voie a) la
**saute** et le 500 persiste — utilisez alors la voie (b), puis, pour réaligner
l'historique, `prisma migrate resolve --applied <nom_migration>` pour chacune des
migrations 2026‑08‑04/05.

## 5. Rappel — le build échouait sur une injection locale

L'échec Vercel (`Cannot find name 'seats'` à `license/activate/route.ts:203`)
venait d'un `console.info(… seats …)` **injecté par le script de rotation** dans le
bloc mécanicien, où `seats` n'existe pas (la valeur littérale `seats: 1` est passée
à `activateDevice`). La branche committée **compile proprement**. Correctif local :
remplacer `seats` par `seats: 1` dans ce `console.info`, ou
`git restore src/app/api/license/activate/route.ts`.
