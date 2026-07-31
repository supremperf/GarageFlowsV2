# Playbook de transfert — GarageFlow

_Document de data room M&A. Vérifié de première main le 2026-07-31. Guide de reprise pas-à-pas pour l'équipe acquéreuse._

## 0. Message clé

Le code source est une condition **nécessaire mais non suffisante** pour exploiter GarageFlow. Les blocages critiques de reprise ne sont **pas** du code : ce sont **quatre transferts d'actifs externes** qui n'existent pas dans le dépôt et que la due diligence n'a **pas pu vérifier**. Sans eux, l'acquéreur ne peut ni émettre une licence, ni publier une mise à jour signée, ni faire fonctionner le produit de bout en bout. Ce playbook les traite en priorité absolue, puis décrit la recréation d'infra, le stand-up dev/prod, la validation E2E, et un plan 30/60/90 jours.

## 1. Les 4 blocages P0 — transferts d'actifs externes (conditions de closing)

Ces quatre points doivent être des **conditions suspensives écrites et vérifiées** avant paiement. Aucun n'est résoluble par du code.

### P0-1 — Transfert des DEUX clés privées de signature
- **Ce que c'est** : (a) la clé privée de **licence** ECC/ECDSA P-256 (les tokens `GF2.*` sont vérifiés contre une clé **publique** embarquée dans `electron/main.js:98-104` ; la privée `keys/private.pem` est **gitignorée et absente**) ; (b) la clé privée de **signature des mises à jour** Ed25519 (variable d'environnement serveur ; clé publique embarquée dans `electron/update-verify.js:20-33`).
- **Pourquoi P0** : sans la clé de licence, impossible d'émettre une seule nouvelle licence. Sans la clé d'update, impossible de publier une mise à jour signée (le client **refuse** un manifeste non signé quand une clé est embarquée).
- **Action** : remettre les deux clés privées sous séquestre au closing, ou **re-générer les paires** (voir §1-bis) et redéployer avant closing. Vérifier la correspondance clé publique embarquée ↔ clé privée reçue.

### P0-2 — Transfert du backend control-plane + base de données
- **Ce que c'est** : le serveur de licences/mises à jour vivant (`api.garageflows.fr` / `garagesite3` déployé) et sa base **PostgreSQL** (licences, devices, releases, crashs, audit).
- **Pourquoi P0** : activation, heartbeat, révocation, crash reporting, publication de release et service des manifestes signés y transitent tous. Le desktop est **la moitié du produit**.
- **Action** : transférer le projet Vercel (ou re-déployer le dépôt), exporter/importer la base Postgres, et rebasculer tous les secrets d'environnement (voir `docs/ENVIRONMENT_VARIABLES.md`).

### P0-3 — Transfert des domaines garageflows.fr (DNS + hébergement)
- **Ce que c'est** : propriété des domaines `garageflows.fr` et sous-domaines, DNS, et hébergement.
- **Pourquoi P0** : les domaines sont **codés en dur** dans l'allowlist de téléchargement/update et les endpoints de licence (`electron/update-verify.js:29-33`, `electron/main.js:145,982,1016`).
- **Action** : transfert de registrar + DNS ; à défaut, prévoir un rebrand de domaine qui impliquera de **rebuild et re-signer** les clients desktop pointant vers le nouveau domaine.

### P0-4 — Cession de propriété intellectuelle (chain of title)
- **Ce que c'est** : aucun fichier `LICENSE` ni cession de PI n'existe dans les dépôts (les deux `package.json` sont `private:true`). Un `LICENSE` et un `SECURITY.md` ont été ajoutés cette session dans les deux dépôts, mais la **cession contractuelle** de PI reste à établir.
- **Pourquoi P0** : la chaîne de titularité ne peut pas être confirmée depuis le code seul.
- **Action** : cession de PI écrite couvrant les deux bases de code **et tous les assets de marque** dans `public/` comme condition de closing.

### 1-bis. Option de re-keying (recommandée si le séquestre est incertain)
Plutôt que de dépendre des clés historiques, l'acquéreur peut :
1. Générer une nouvelle paire ECC P-256 (licence) et Ed25519 (update).
2. Remplacer les clés **publiques** embarquées (`electron/main.js`, `electron/update-verify.js`, `src/lib/license/public-key.ts`).
3. Rebuild + re-signer le client desktop.
4. Déployer les clés **privées** côté control-plane.

Ceci coupe toute dépendance au vendeur pour la signature, au prix d'un rebuild et d'une migration des installations existantes (les anciennes licences signées avec l'ancienne clé devront être ré-émises).

## 2. Recréation de l'infrastructure

| Composant | Source de vérité | Notes de reprise |
|---|---|---|
| Control-plane cloud | `garagesite3` (Next.js 15) sur Vercel | `vercel.json` planifie le cron d'auto-rollback horaire (`/api/cron/rollback-check`, `0 * * * *`) ; l'auth cron est fail-closed via `CRON_SECRET`. |
| Base cloud | PostgreSQL | Migrations reproductibles : `prisma/server/migrations` (4 migrations ordonnées + `migration_lock.toml` postgresql). |
| Redis | Upstash | **Requis en prod** ; rate limiting fail-closed 503 si indisponible. |
| Blob installeurs | Vercel Blob | `BLOB_READ_WRITE_TOKEN` requis, sinon 501. |
| Base desktop | SQLite (template committé) | ⚠️ Schéma desktop **non reproductible depuis les migrations** (seulement 2 patches incrémentaux, pas de baseline `init` ni `migration_lock.toml`) — repose sur `db push` + template DB. À baseliner. |

**Validation d'env prod** : le boot refuse de démarrer en prod si des secrets manquent/sont faibles (`src/lib/env.ts`, `garagesite3` : `DEVICE_TOKEN_SECRET`≥32, `HWID_HMAC_SECRET`≥32, `UPSTASH_REDIS_REST_URL/TOKEN`). Voir `.env.example` (tracké, placeholders documentés uniquement) dans chaque dépôt.

## 3. Stand-up d'un environnement de développement

### 3.1 Desktop (`GarageFlowsV2`)
```
npm install
npx prisma db push          # crée le schéma SQLite (exit 0 vérifié)
npm run db:seed             # crée "Garage Demo" : 5 mécaniciens, 13 jobs (exit 0 vérifié)
npm run dev                 # ou build standalone via scripts/post-build.js
npx tsc --noEmit            # doit sortir 0
npm test                    # 678 tests passés (sous-ensemble non-intégration)
```
Login démo : identifiant démo étiqueté (`admingarageflow@admin.fr`) — **pas** un secret du dépôt. L'environnement démo build de bout en bout (vérifié).

### 3.2 Cloud (`garagesite3`)
```
npm install
# fournir DATABASE_URL Postgres + secrets (voir .env.example)
npx prisma migrate deploy   # applique les 4 migrations sur base vide
npx tsc --noEmit            # exit 0
npm test                    # 140 tests passés (sous-ensemble non-intégration)
```

## 4. Stand-up production (checklist)

1. Provisionner Postgres + Upstash Redis + Vercel Blob.
2. Configurer **tous** les secrets prod (fail-closed au boot ; se référer à `.env.example`).
3. Déployer `garagesite3` sur Vercel ; confirmer le cron `rollback-check` actif.
4. Déployer/pointer les domaines (P0-3).
5. Configurer `UPDATE_SIGNING_PRIVATE_KEY` / `KEY_ID` (sinon les manifestes sortent `null`).
6. ⚠️ **Signature de code Windows non configurée** : aucun certificat dans le bloc electron-builder (`package.json`). Sans certificat OV/EV, chaque installation déclenche l'avertissement SmartScreen « éditeur inconnu ». Procurer et câbler un certificat avant go-to-market.
7. Générer `keys/public.pem` avant build desktop (`post-build.js` **avertit seulement**, n'échoue pas, si absent — risque de build dégradé).

## 5. Validation de bout en bout (prouver que la reprise fonctionne)

L'équipe acquéreuse doit prouver **indépendamment du vendeur** :

1. **Émettre une licence** : via l'admin control-plane (`/api/admin/licenses/generate`, nécessite `keys/private.pem`), créer une licence pour un HWID de test. → un token `GF2.*` valide est produit.
2. **Activer un device** : le desktop active la licence, vérifie la signature ECDSA contre la clé publique embarquée, et enregistre le device (limite de sièges appliquée transactionnellement).
3. **Signer une mise à jour** : publier une release avec `UPDATE_SIGNING_PRIVATE_KEY` configurée → un manifeste Ed25519 est émis ; le desktop **vérifie** signature + SHA-256 **avant** d'exécuter l'installeur, et refuse tout binaire non vérifié.
4. **Heartbeat + révocation** : révoquer le device côté admin → le desktop passe bloqué (poll adaptatif 20 s) sans verrouiller un utilisateur hors-ligne (fail-open réseau).
5. **Rollback** : simuler des crashs au-delà du seuil → le cron horaire `rollback-check` déclenche l'auto-rollback (fail-closed `CRON_SECRET`).

Si ces cinq étapes passent sans le vendeur, la reprise opérationnelle est prouvée.

## 6. Plan de transfert 30 / 60 / 90 jours

### Jours 0–30 — Sécuriser l'opérabilité (P0)
- Exécuter les 4 transferts P0 (clés, backend, domaines, cession PI) — ou re-keying (§1-bis).
- Recréer/hériter l'infra cloud ; valider le boot fail-closed.
- Réaliser la validation E2E §5 **sans le vendeur**.
- Établir l'accès admin, la rotation des secrets, et une sauvegarde de la base Postgres.

### Jours 31–60 — Réduire les risques P1
- Baseliner les migrations desktop (fin du `db push` + template).
- Procurer et câbler le certificat de signature de code Windows.
- Rendre bloquant l'audit de dépendances de garagesite3.
- Câbler l'UI manquante (backup/restore, monitoring) — services prêts, UI absente.
- Décider : de-scoper ou construire l'API `/api/v1` (persistance DB, rate limiting distribué, webhooks).

### Jours 61–90 — Feuille de route de valeur
- Cadrer/chiffrer le chantier **e-invoicing** (obligation B2B française 2026-2027 : per-line VAT, snapshots de montants, SIRET, avoir + paiements, Factur-X/UBL, PDP/Chorus Pro, statuts de cycle de vie) — **absent aujourd'hui**.
- Ré-architecturer le **verrou hard 72 h hors-ligne** (grâce configurable / mode dégradé lecture seule).
- Bâtir l'automatisation E2E/UI (Playwright) sur les 3 surfaces avant tout refactor majeur.
- IAM admin réel (comptes par opérateur, MFA, RBAC, rotation de clé) pour le control-plane.
- Câbler le white-label `BRAND.*` dans l'UI si le thèse rebrand-and-resell est retenue.
- Construire un outil d'import/onboarding (aucun import CSV/Excel aujourd'hui).

## 7. Caveats de transfert

- L'existence, la validité et la propriété exclusive des clés privées et du backend n'ont **pas pu être vérifiées** — actifs hors dépôt.
- La propriété des domaines garageflows.fr n'a **pas pu être vérifiée** depuis le dépôt.
- L'état de déploiement production réel (config env, clés de signature configurées) n'a pas pu être observé.
- Les fondamentaux business (revenus, clients live, trafic, churn) sont hors périmètre du code et à diligencer séparément.

---
_Voir aussi : [docs/ACQUISITION_READINESS_AUDIT.md](./ACQUISITION_READINESS_AUDIT.md)._
