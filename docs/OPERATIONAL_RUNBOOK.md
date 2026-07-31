# Runbook opérationnel (Day-2 Ops) — GarageFlow

> Document de data room (due diligence M&A). Procédures d'exploitation courantes,
> fondées sur les routes et mécanismes réellement présents dans le dépôt cloud
> `garagesite3` et le desktop `GarageFlowsV2`. Toutes les routes admin exigent la
> clé `x-gf-key` (`LICENSE_ADMIN_API_KEY`, comparaison à temps constant).

## Pré-requis d'exploitation

| Accès | Usage |
|---|---|
| Clé admin `LICENSE_ADMIN_API_KEY` | Dashboard `/admin` + routes `/api/admin/*` |
| Vault des secrets | Rotation, `CRON_SECRET`, tokens Upstash, `DATABASE_URL` |
| Fournisseur Postgres (Neon/Supabase) | PITR, migrations |
| Registrar / DNS | Domaines `garageflows.fr` |
| Clés privées de signature (P-256 licence, Ed25519 update) | Émission licences, signature updates — **hors dépôt** |
| Compte Vercel (+ Blob) | Déploiement, cron, hébergement des installeurs |

---

## 1. Rotation d'un secret

Le plan de contrôle valide ses secrets **au démarrage, fail-closed** en
production (`src/lib/env.ts` : refuse de booter si `DEVICE_TOKEN_SECRET`/
`HWID_HMAC_SECRET` < 32 caractères, valeurs d'exemple, ou Upstash absent). La
rotation doit donc être faite proprement. Voir aussi `docs/SECRETS_ROTATION.md`.

### Principe
La plupart des secrets sont lus depuis l'environnement à chaque requête → un
changement prend effet au **prochain déploiement / redémarrage**. Il n'y a pas de
rotation à chaud sans redéploiement.

### Procédure générique
1. Générer la nouvelle valeur (longueur ≥ 32, aléatoire).
2. La déposer dans le vault + variables d'environnement de l'hébergeur.
3. Redéployer ; vérifier que le boot passe la validation `env.ts`.
4. Contrôler un parcours sensible (activation licence, heartbeat).
5. Invalider l'ancienne valeur.

### Cas particuliers
- **`DEVICE_TOKEN_SECRET`** (HMAC des device tokens) : le faire tourner
  **invalide tous les device tokens émis** → tous les postes devront
  re-authentifier au prochain heartbeat. À planifier hors heures de pointe.
- **`HWID_HMAC_SECRET`** : change le hachage des HWID → **incohérence** avec les
  `Device.hwidHash` déjà stockés. À ne pas faire sans plan de re-migration ;
  considérer comme un changement de rupture.
- **`LICENSE_ADMIN_API_KEY`** : rotation = perte d'accès admin jusqu'au
  redéploiement ; prévenir les opérateurs.
- **`CRON_SECRET`** : après rotation, mettre à jour la config Vercel Cron sinon
  `GET /api/cron/rollback-check` renverra une erreur d'auth (fail-closed).
- **Tokens Upstash Redis** : indispensables au rate limiting fail-closed ; une
  mauvaise valeur fait renvoyer 503 aux routes licence en prod.

> **Clés privées de signature** : leur « rotation » n'est pas une simple variable
> — elle impose une **nouvelle version desktop** (clés publiques embarquées) et,
> pour la licence, la **ré-émission** des licences. Voir
> `docs/DISASTER_RECOVERY_PLAN.md` §6. À ne faire qu'en cas de compromission.

---

## 2. Révoquer une licence ou un appareil

### 2.1 Révoquer un appareil (device)
`POST /api/admin/devices/revoke` — body `{ deviceId, reason? }`
(`src/app/api/admin/devices/revoke/route.ts`).

- Effet : `revokeDevice` **incrémente `tokenVersion`** → **tous les jetons de cet
  appareil deviennent invalides**, son prochain heartbeat échoue immédiatement.
- La révocation **libère un siège** (seat) sur la licence, réutilisable par une
  nouvelle activation.
- Action journalisée (audit : `action: "device_revoked"`, avec `reason`).

### 2.2 Révoquer / suspendre une licence
Deux routes selon l'identifiant disponible :
- Par identifiant : `POST /api/admin/licenses/revoke`.
- **Par clé (token)** : `POST /api/admin/licenses/revoke-by-key` — body
  `{ key: <token>, status }` (accepte aussi `{ licenseId, status }`)
  (`src/app/api/admin/licenses/revoke-by-key/route.ts`). Change le statut
  **directement en base**.

Comportement côté poste client : la vérification périodique de révocation
(desktop, toutes les ~2 min actives / 20 s si bloqué) détecte le changement.
Important : le desktop est **fail-open sur erreur réseau** (ne verrouille jamais
un utilisateur hors-ligne pour une simple coupure) et, sur statut
révoqué/suspendu, **l'app reste ouverte** mais le renderer affiche l'état — la
coupure d'usage effective intervient via la logique de grâce, pas brutalement.

### 2.3 Après un PITR
Un restore de base peut **annuler des révocations** postérieures au point de
restauration (le `tokenVersion` revient en arrière). Re-appliquer manuellement
les révocations concernées.

---

## 3. Publier / annuler (rollback) une release

Gestion : `releases/service.ts`, UI `/admin/updates`, route
`/api/admin/update/publish`.

### 3.1 Publier
1. Construire l'installeur Windows x64 (voir `docs/WINDOWS_BUILD_GUIDE.md`).
   Rappel d'honnêteté : le binaire **n'est pas signé** (SmartScreen « éditeur
   inconnu ») — risque go-to-market connu.
2. Uploader l'installeur via `/api/admin/update/blob-upload` (Vercel Blob,
   gated admin ; renvoie 501 si `BLOB_READ_WRITE_TOKEN` absent).
3. `publishRelease` : renseigner version, host de téléchargement (allowlist),
   `rolloutPercent`, ciblage.
4. **Signature du manifeste** : le manifeste est signé **Ed25519** seulement si
   `UPDATE_SIGNING_PRIVATE_KEY`/`KEY_ID` sont configurés (sinon `manifest = null`
   et le client refusera un update non signé quand une clé publique est
   embarquée). S'assurer que la clé de signature est en place.
5. **Rollout progressif** : augmenter `rolloutPercent` par paliers en surveillant
   `/admin/crashes`.

### 3.2 Rollback
- **Manuel immédiat** : `updateRelease` / `/admin/updates` — passer la release en
  rollback ou remonter la précédente.
- **Automatique** : le cron horaire `GET /api/cron/rollback-check`
  (`vercel.json`, auth `CRON_SECRET`) déclenche `autoRollbackIfUnhealthy` si le
  nombre de **machines enregistrées distinctes** en crash dépasse le seuil. Voir
  `docs/INCIDENT_RESPONSE.md` §6.
- **Anti-downgrade** : le client applique une protection semver — un rollback
  serveur doit publier une version cible cohérente pour être accepté côté poste
  (`electron/update-verify.js`).

### 3.3 Vérifs post-publication
- Un poste test reçoit-il le manifeste signé ? La vérification **SHA-256 avant
  exécution** de l'installeur passe-t-elle ? (refus si hash/taille ne
  correspondent pas — `electron/main.js:2144-2173`).
- Les compteurs de crash restent-ils bas sur la nouvelle version ?

---

## 4. Réinitialiser un HWID (changement de matériel)

Contexte : le HWID est un **SHA-256** de caractéristiques machine
(cpu/mac/plateforme/hostname/disque) comparé en temps constant ; côté serveur
seul le **HMAC** du HWID est stocké (`Device.hwidHash`), jamais le HWID brut. Il
n'existe pas de bouton « reset HWID » : un changement de matériel se traite comme
un **remplacement d'appareil**.

### Procédure
1. Identifier l'ancien appareil dans `/admin/devices` (ou `GET /api/admin/devices`).
2. **Révoquer** l'ancien appareil (§2.1) → libère le siège, invalide ses jetons.
3. Sur la nouvelle machine, **ré-activer** la licence : une nouvelle activation
   crée un nouveau `Device` avec le nouveau `hwidHash`, dans la limite des sièges
   (`seat limit`, enforce atomique `SELECT … FOR UPDATE`, TOCTOU-safe).
4. Vérifier l'activation (heartbeat OK) sur la nouvelle machine.

### Cas « siège saturé »
Si la licence est déjà au maximum de sièges, l'étape 2 (révocation de l'ancien)
est **obligatoire avant** la ré-activation ; sinon l'activation est refusée. Pour
un dépannage exceptionnel, ajuster la limite de sièges via
`/api/admin/licenses/update` (à tracer dans l'audit).

---

## 5. Contrôles de routine et journal d'audit

- **Audit global** : `server/audit.ts`, modèle `AuditLog`, UI `/admin/audit`
  (recherche/filtre/export CSV). Toutes les actions sensibles (révocations,
  publications, rollback auto) y sont journalisées.
- **Limite d'honnêteté** : l'acteur est `admin`/`cron`, **sans identité par
  utilisateur** (clé admin unique partagée) — l'audit dit *quoi* mais pas
  toujours *qui* précisément. À renforcer (comptes + RBAC) avant montée en gamme.
- **Rate limiting** : routes licence/admin protégées par Upstash Redis,
  fail-closed en prod (503 si Redis indisponible) — un 503 massif sur ces routes
  signale d'abord un problème Redis, pas forcément une attaque.

---

_Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md`._
