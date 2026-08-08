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

## 3. Interprétation des erreurs HTTP fréquentes

| Code | Signification probable | Piste |
|---|---|---|
| **401** Unauthorized | `x-gf-key` absente/incorrecte, ou `GARAGEFLOW_API_KEY` non déployée. | Vérifier que la clé côté client = clé Vercel après **redéploiement**. |
| **403** Forbidden | Clé valide mais action interdite (scope/rôle), ou politique appareil/licence refusée. | Vérifier droits admin et état de la licence. |
| **429** Too Many Requests | Rate limit atteint (Upstash). Une vraie limite retourne bien 429. | Attendre la fenêtre ; vérifier `UPSTASH_*` et `TRUST_PROXY_HEADERS`. |
| **5xx** | Configuration serveur incomplète (variable obligatoire manquante → fail-fast) ou incident base. | Consulter `GET /api/health` et les logs ; contrôler `DATABASE_URL`/`DIRECT_URL`. |

> Bon réflexe : après toute rotation, un **401 attendu sur l'ancienne clé** et un
> **succès sur la nouvelle** confirment que la transaction est complète.
