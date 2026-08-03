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

## 3. Interprétation des erreurs HTTP fréquentes

| Code | Signification probable | Piste |
|---|---|---|
| **401** Unauthorized | `x-gf-key` absente/incorrecte, ou `GARAGEFLOW_API_KEY` non déployée. | Vérifier que la clé côté client = clé Vercel après **redéploiement**. |
| **403** Forbidden | Clé valide mais action interdite (scope/rôle), ou politique appareil/licence refusée. | Vérifier droits admin et état de la licence. |
| **429** Too Many Requests | Rate limit atteint (Upstash). Une vraie limite retourne bien 429. | Attendre la fenêtre ; vérifier `UPSTASH_*` et `TRUST_PROXY_HEADERS`. |
| **5xx** | Configuration serveur incomplète (variable obligatoire manquante → fail-fast) ou incident base. | Consulter `GET /api/health` et les logs ; contrôler `DATABASE_URL`/`DIRECT_URL`. |

> Bon réflexe : après toute rotation, un **401 attendu sur l'ancienne clé** et un
> **succès sur la nouvelle** confirment que la transaction est complète.
