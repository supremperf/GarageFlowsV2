# Rotation des secrets — GarageFlow

> **Document stable — remplace les anciennes notes `RESET_GARAGEFLOW_Vxxx`.**
> Complète (sans le remplacer) [SECRETS_ROTATION.md](SECRETS_ROTATION.md), qui
> traite des secrets **historiquement exposés** à révoquer. Le présent document
> traite de la rotation **opérationnelle** au quotidien.

Aucune valeur secrète réelle n'apparaît ici : uniquement des placeholders. Ne
jamais copier de valeur depuis `.env`.

---

## 1. Rotation de `GARAGEFLOW_API_KEY` (transactionnelle)

`GARAGEFLOW_API_KEY` peut être rotée sans casser de données chiffrées, mais elle
existe **à trois endroits** qui doivent rester cohérents. La rotation est donc
**transactionnelle** : les trois emplacements changent ensemble, puis on valide.

1. Générer une nouvelle valeur : `openssl rand -hex 32`.
2. Mettre à jour, dans le même geste :
   - **Vercel** (variables Production du serveur) ;
   - le **`.env`** local d'exploitation ;
   - **`keys/server_config.json`** (configuration du Keygen).
3. **Redéployer** le serveur.
4. **Après déploiement**, tester l'endpoint protégé (en-tête `x-gf-key`) — par
   ex. `/api/admin/licenses/revoke-by-key` — pour confirmer que la nouvelle clé
   est acceptée et l'ancienne rejetée (401).

> Ordre impératif : le **test vient APRÈS le déploiement**. Une valeur poussée
> dans Vercel n'est active qu'après redéploiement.

---

## 2. Secrets à NE JAMAIS faire tourner aveuglément

Ces secrets protègent ou chiffrent des données **déjà écrites**. Les changer
sans plan de migration rend ces données **définitivement illisibles** ou casse
l'authentification. Ne les rotez que sur incident avéré, avec sauvegarde et
procédure de re-chiffrement.

| Secret | Ce qui casse si roté aveuglément |
|---|---|
| `GF_TOTP_ENC_KEY` | Les secrets TOTP chiffrés (`gtotp1.k1`) deviennent illisibles ; aucune migration multi-clé automatique. |
| `GF_SMTP_CIPHER_KEY` | Les identifiants SMTP chiffrés (`gsmtp1.k1`) deviennent illisibles. |
| `GF_BACKUP_KEY` | Toutes les **sauvegardes** chiffrées avec l'ancienne clé deviennent **irrécupérables**. |
| `GF_DB_MAC_SECRET` | Casse la vérification `recordMac` des enregistrements `LicenseKey` (invalidation en masse). |
| `DEVICE_TOKEN_PEPPER` | Invalide tous les jetons d'appareil / hachages **HWID** existants (ré-activation forcée). |
| `NEXTAUTH_SECRET` | Invalide toutes les sessions ; casse aussi les dérivations qui l'utilisent comme repli crypto (portail). |
| `GF_SIGNATURE_SECRET` | Change la clé de scellement : les signatures antérieures ne se vérifient plus. |
| `GF_PRIVATE_KEY` | Invalide **toutes les licences signées** émises jusque-là. **Jamais dans le dépôt, jamais générée automatiquement.** |

> Rappel : `GF_TOTP_ENC_KEY` et `GF_SMTP_CIPHER_KEY` sont aujourd'hui
> **`absent-consumer`** dans ce dépôt (voir
> [VARIABLES_ENVIRONNEMENT.md](VARIABLES_ENVIRONNEMENT.md)) ; la mise en garde
> reste valable dès qu'un consommateur sera branché.

Avant toute rotation d'un secret de cette liste : **sauvegarder** les données
concernées, prévoir le re-chiffrement (deux clés en parallèle si l'app le
permet), et tester sur un environnement non-production.

---

## 2 bis. Rotation de la paire de licence (`GF_PRIVATE_KEY` / `keys/public.pem`)

Cette rotation a une étape que les autres n'ont pas : la clé **publique** est
recopiée **dans le code**, à trois endroits. Une rotation qui ne met à jour que
`GF_PRIVATE_KEY` produit un logiciel qui refuse **silencieusement** toutes les
licences — `crypto.verify()` renvoie `false`, sans exception ni journal ; l'app
réaffiche l'activation, le serveur peut ensuite refuser pour quota d'appareils,
et l'utilisateur est verrouillé hors de son propre logiciel sans qu'aucun
message n'indique la vraie cause. **Le cas s'est produit trois fois** (2026-08-03,
2026-08-07, 2026-08-08).

Ordre à respecter :

1. Générer la paire (`python scripts/keygen.py --init`) — la privée ne quitte
   jamais `keys/private.pem`.
2. **Depuis le dépôt**, `keys/public.pem` en place : `npm run keys:sync`.
   Une seule commande met à jour les trois ancrages (`_PK` d'`electron/main.js`,
   `_LINES` de `src/lib/license/public-key.ts`, `REFERENCE_FP` du test de
   cohérence) et inscrit la clé sortante parmi les empreintes retirées.
3. Publier `GF_PRIVATE_KEY` (Base64 du PEM) dans l'environnement de production.
4. `npm run check:consistency` — doit être vert **avant** tout build ou déploiement.
5. Mettre à jour la vitrine **garagesite3** : elle vit dans un AUTRE dépôt,
   aucun script local ne l'atteint.
6. Rebuild ET redéploiement : un binaire ou un déploiement antérieur porte
   encore l'ancienne clé.

> **Le dossier de build n'est pas le dépôt.** Une rotation exécutée depuis le
> dossier de lancement met à jour ce dossier seul ; le dépôt reste périmé et
> propage la panne au prochain push. Faites l'étape 2 dans le dépôt.

Vérification honnête, sans rien supposer : placez un jeton GF2 réellement émis
par le nouveau keygen dans `GF_TEST_LICENSE` et lancez
`npx vitest run src/lib/license/__tests__/public-key-consistency.test.ts`.
Les deux tests optionnels ne sont plus ignorés : ils prouvent qu'une vraie
licence est acceptée et qu'une signature altérée est rejetée.

---

## 3. Plan Phase 2 — rotation des secrets **internes** uniquement

Objectif : durcir les secrets que GarageFlows **possède** sans toucher aux
identifiants de services tiers (SMTP hôte, Anthropic, Blob, Neon, Upstash). Un
secret tiers n'est jamais « roté » par GarageFlows : il se régénère chez le
fournisseur, avec ses propres procédures et fenêtres.

État dans **cette** session d'audit : **BLOQUÉ** pour toute exécution distante.
Le `.env` présent ne contient que quatre lignes (`DATABASE_URL`, `NEXTAUTH_URL`,
`NEXTAUTH_SECRET` vide, `GARAGEFLOW_API_KEY` vide), aucune base de production
n'est joignable et aucun jeton Vercel n'est disponible : rien n'a été remplacé
ici. Les preuves d'une campagne antérieure (rotation de huit secrets, migration
re-MAC, déploiement Vercel) sont conservées dans
[`docs/audit/2026-10-20/CLASSIFICATION-ET-ROTATION-SECRETS.md`](audit/2026-10-20/CLASSIFICATION-ET-ROTATION-SECRETS.md)
et [`PREUVES-VALIDATION.md`](audit/2026-10-20/PREUVES-VALIDATION.md) ; elles ne
sont **pas rejouées ni re-vérifiées** par cette session. Le tableau ci-dessous
décrit la procédure de référence, pas une rotation nouvellement effectuée.

| Secret | Propriétaire | Données protégées | Migration obligatoire | Statut |
|---|---|---|---|---|
| `GF_SMTP_CIPHER_KEY` | GarageFlows | Mots de passe SMTP (`Garage.smtpPass`, enveloppe `GFSEC1:`) | Déchiffrer avec `_OLD`, réécrire avec la nouvelle clé | **Préparé** — procédure §3.1 |
| `NEXTAUTH_SECRET` | GarageFlows | Sessions NextAuth | Aucune : invalidation volontaire | **Préparé** — rotation groupée §3.2 |
| `DEVICE_TOKEN_PEPPER` | GarageFlows | Jetons d'appareil, hachages associés | Ré-appairage des appareils | **Préparé** — §3.2 |
| `GARAGEFLOW_API_KEY` | GarageFlows | Authentification serveur `x-gf-key` | Transaction 3 emplacements §1 | **Préparé** — §1 |
| `GF_DB_MAC_SECRET` | GarageFlows | MAC des enregistrements `LicenseKey` | Recalcul MAC de toutes les licences | **Non exécuté** — re-MAC à valider |
| `GF_BACKUP_KEY` | GarageFlows | Archives chiffrées | Conserver l'ancienne clé pour restaurer | **Non exécuté** — conservation obligatoire |
| `GF_INTERNAL_EXPORT_KEY` | GarageFlows | Exports internes signés | Réémission des exports en cours | **Non exécuté** |
| `GF_EINVOICE_CREDENTIALS_KEY` | GarageFlows | Identifiants PDP e-facturation | Re-saisie ou ré-chiffrement | **Non exécuté** — PDP non validée |
| `GF_PORTAL_SECRET` | GarageFlows | Jetons portail | Invalidation des liens portail en cours | **Non exécuté** |
| `GF_SIGNATURE_SECRET` | GarageFlows | Scellement des signatures | Signatures antérieures non vérifiables | **Non exécuté** |
| `GF_PRIVATE_KEY` (ECC) | GarageFlows | **Toutes les licences** | Aucune migration possible | **INTERDIT** — voir §2 bis |

### 3.1 `GF_SMTP_CIPHER_KEY` — rotation avec re-chiffrement

Le module `src/lib/security/secret-cipher.ts` chiffre en AES-256-GCM et inscrit
un `kid` (8 premiers hex de SHA-256 de la clé). Il accepte plusieurs anciennes
clés dans `GF_SMTP_CIPHER_KEY_OLD` (liste séparée par des virgules). C'est ce qui
rend la rotation réversible : tant que la clé sortante est conservée, une ligne
non encore rechiffrée reste lisible.

1. **Sauvegarde vérifiée** de la base concernée (Neon pour le serveur, SQLite pour
   un poste) — la restauration doit être testée sur une base jetable, pas promise.
2. Générer la nouvelle clé : `openssl rand -base64 32` (32 octets, jamais réutilisés
   ailleurs).
3. Définir **simultanément** dans l'environnement cible :
   ```env
   GF_SMTP_CIPHER_KEY="<nouvelle>"
   GF_SMTP_CIPHER_KEY_OLD="<ancienne>"
   ```
4. Simuler : `node scripts/encrypt-smtp-secrets.js --dry-run`
   (`--schema prisma/server/schema.prisma` pour la base PostgreSQL).
   Le script refuse sans `--yes` hors simulation et n'affiche aucune valeur.
5. Rechiffrer : `node scripts/encrypt-smtp-secrets.js --yes --rotate`.
6. **Vérifier** : une connexion SMTP réelle depuis l'application (envoi de test)
   et `npx vitest run src/lib/security/__tests__/secret-cipher.test.ts`.
7. Attendre une fenêtre de validation humaine (recommandé : 24 h, et au moins un
   redéploiement), puis **retirer** `GF_SMTP_CIPHER_KEY_OLD`.
8. Rejouer l'étape 6 après retrait : sans `_OLD`, une valeur encore chiffrée avec
   l'ancienne clé produit une erreur explicite — c'est le contrôle qui prouve que
   plus aucune ligne ne dépend de l'ancienne clé.

Points de sûreté :

- aucune valeur n'est journalisée ou affichée par le script ;
- l'opération est idempotente : une valeur déjà chiffrée avec la clé primaire est
  simplement rechiffrée avec la même clé, jamais corrompue ;
- en cas d'erreur de `kid`, le script s'arrête sur `aucune clé ne correspond` :
  ne jamais retirer `_OLD` avant d'avoir traité cette erreur ;
- `config-rebuild.cjs` refuse une base non vide : il n'efface rien pour
  « simplifier » la migration, comportement à conserver.

### 3.2 Sessions, appareils et clé API — rotation groupée

`scripts/config-manager.cjs` expose `SESSION_KEYS = ['NEXTAUTH_SECRET',
'DEVICE_TOKEN_PEPPER', 'GARAGEFLOW_API_KEY']` et un mode explicite :

```sh
node config --dry-run --offline          # inventaire, aucune mutation
node config --rotate-session-secrets     # plan destructif, confirmation exigée
```

La rotation est **transactionnelle** : le gestionnaire écrit un journal
d'opérations, vérifie les valeurs relues, et restaure les tentatives en cas
d'échec. Elle exige une confirmation explicite, car elle invalide :

- toutes les sessions NextAuth (déconnexion des utilisateurs) ;
- les jetons d'appareils et hachages dérivés du poivre (ré-appairage) ;
- les intégrations utilisant `GARAGEFLOW_API_KEY`.

Ordre recommandé : prévenir les utilisateurs, exécuter hors heures ouvrées,
redéployer, puis vérifier `GET /api/health` et un endpoint protégé (nouvelle clé
acceptée, ancienne refusée avec 401). Ne jamais copier une valeur de Production
vers Development/Preview : chaque environnement reçoit **sa** valeur.

### 3.3 Ce qui n'est **pas** roté

Les identifiants de services externes (`SMTP_HOST`, `SMTP_USER`,
`SMTP_PASSWORD`, `ANTHROPIC_API_KEY`, `BLOB_READ_WRITE_TOKEN`, chaînes
Neon/Upstash, etc.) ne sont pas générés par GarageFlows. Ils restent inchangés et
ne sont jamais remplacés par une valeur inventée. Une compromission avérée suit la
procédure du fournisseur, puis met à jour **tous** les environnements concernés
avec vérification de connexion.

### 3.4 Preuves attendues après rotation

```sh
node scripts/verify-rotation.mjs --require-all   # dans l'environnement de prod
npx vitest run src/lib/security/__tests__/secret-cipher.test.ts
npm run test:config
npm run check:consistency
```

`verify-rotation.mjs` ne compare que des empreintes SHA-256 à une liste de
valeurs compromises : il ne divulgue aucun secret. Sans les variables de
production, il retourne un statut « preuve incomplète » — ne jamais l'interpréter
comme une validation.

---

## 3. Interprétation des erreurs HTTP fréquentes

| Code | Signification probable | Piste |
|---|---|---|
| **401** Unauthorized | `x-gf-key` absente/incorrecte, ou `GARAGEFLOW_API_KEY` non déployée. | Vérifier que la clé côté client = clé Vercel après **redéploiement**. |
| **403** Forbidden | Clé valide mais action interdite (scope/rôle), ou politique appareil/licence refusée. | Vérifier droits admin et état de la licence. |
| **429** Too Many Requests | Rate limit atteint (Upstash). Une vraie limite retourne bien 429. | Attendre la fenêtre ; vérifier `UPSTASH_*` et `TRUST_PROXY_HEADERS`. |
| **5xx** | Configuration serveur incomplète (variable obligatoire manquante → fail-fast) ou incident base. | Consulter `GET /api/health` et les logs ; contrôler `DATABASE_URL`/`DIRECT_URL`. |

> Bon réflexe : après toute rotation, un **401 attendu sur l'ancienne clé** et un
> **succès sur la nouvelle** confirment que la transaction est complète.
