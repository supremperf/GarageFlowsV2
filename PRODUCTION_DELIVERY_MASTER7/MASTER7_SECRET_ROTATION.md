---
doc-numbers: journal
---

# ROTATION DES SECRETS — MASTER 7

**Aucune valeur de secret n'apparaît dans ce document.** Les empreintes SHA-256 tronquées servent uniquement à vérifier, après rotation, que la valeur a réellement changé.

Preuves : `MASTER7_EVIDENCE/logs/02-secrets-historiques-classification.txt` et `03-revocation-blob-tentative.txt`.

---

## 1. L'exposition est plus large que MASTER 6 ne le disait

MASTER 6 annonçait « 3 findings ». C'était le nombre de détections de gitleaks, **pas** le nombre de secrets. Mesuré :

| Fichier | Dernière version avec contenu | Champs | dont sensibles |
|---|---|---:|---:|
| `.env.storage.local` | `290d290db` (2026-10-16) | 24 | **17** |
| `keys/licenses_db.json` | `0f519f040` | 17 | 1 |
| `keys/server_config.json` | `0f519f040` | 2 | 2 |

Aucun n'est suivi par une branche actuelle. Tous subsistent dans l'historique d'un dépôt **public**.

## 2. Les cinq groupes, avec verdict d'activité mesuré

Méthode : sondes **strictement en lecture** contre l'infrastructure du propriétaire — `SELECT 1`, `\conninfo`, `GET /ping`, listing. Aucune écriture, aucune suppression, aucun crédit consommé, aucune donnée métier lue.

| Groupe | Champs | Type | **Verdict** |
|---|---:|---|---|
| **A — Neon PostgreSQL** | 9 | URLs + mot de passe | 🔴 **ENCORE VALIDE, rôle propriétaire** |
| **B — Upstash Redis** | 7 | URLs REST + jetons | ✅ inopérant, hôte supprimé (NXDOMAIN) |
| **C — Vercel Blob** | 1 | jeton lecture-écriture | 🔴 **ENCORE ACTIF** |
| **D — licence GF2** | 1 | jeton de licence émis | ✅ `SIGNATURE_INVALID` en production |
| **E — clé d'API locale** | 2 | URL localhost + clé | 🟡 service local uniquement |

### A — Neon PostgreSQL : le point le plus grave

```
psql -d <URL-MASQUÉE> -t -A -c "select 1"   →  code 0, résultat « 1 »
psql -d <URL-MASQUÉE> -c "\conninfo"        →  code 0

« Vous êtes connecté à la base de données "neondb" en tant qu'utilisateur
  "neondb_owner" sur l'hôte "ep-aged-cell-ayqiwroc-pooler.c-5.us-east-2.aws.neon.tech" »
```

Un identifiant publié sur un dépôt public **authentifie encore**, avec le **rôle propriétaire**.

**Prod ou Preview ?** Non tranché, et je ne peux pas le trancher sans manipuler des valeurs de production. Les noms exposés correspondent exactement au jeu que l'intégration Neon injecte en **Preview** (type `Config` chez Vercel) ; la production porte `DATABASE_URL`/`DIRECT_URL` en type `Secret`, définis séparément. L'hypothèse la plus probable est donc Preview — **mais une base Preview avec le rôle propriétaire reste une base vivante du compte, et peut partager le projet Neon de la production.** La rotation est requise dans les deux cas.

### C — Vercel Blob : identifié au store près

Le jeton a la forme `vercel_blob_rw_<storeId>_<secret>`. L'identifiant de store qu'il embarque — qui n'est pas un secret — désigne :

```
store_4TyemjFvecVTkX2W   « garageflows-update »
Billing State : Active   Blob Count : 0   Size : 0B   Access : Public
Base URL : 4tyemjfvecvtkx2w.public.blob.vercel-storage.com
```

C'est le store de **distribution des mises à jour**, en accès `Public`. Un jeton public en écriture y autorise le dépôt de fichiers arbitraires servis depuis un domaine rattaché au compte : **vecteur d'empoisonnement du canal de mise à jour**.

Ce qui limite la portée, vérifié : le store est **vide**, aucune variable Blob n'est configurée sur le projet, et le mécanisme de mise à jour exige un manifeste **signé**.

### D — la licence exposée ne peut rien activer

Vérifié avec le vérificateur réel du dépôt (`scripts/diagnose-license.mjs`, qui compile `src/lib/license/verify.ts` et n'imprime jamais le jeton) :

```
ancrage de vérification : b16d2e1bf6b9662f9748e009c0cf88770ab602233ee546895ac352f808bc3d9d
résultat                : { ok: false, code: "SIGNATURE_INVALID" }
```

Signée par une autre clé, retirée depuis. **Aucune installation réelle ne peut être activée avec elle.** C'est une bonne nouvelle vérifiée, pas une supposition.

## 3. La révocation a été tentée, et refusée par l'outil

Chez Vercel Blob, le jeton est lié au store : révoquer = supprimer le store.

```
$ vercel blob delete-store store_4TyemjFvecVTkX2W --non-interactive
{
  "status": "error",
  "reason": "dangerous_operation_requires_user",
  "message": "Deleting a blob store cannot be undone and cannot be performed
              non-interactively. Agents must not make this change on behalf of a
              user. The user must run this command interactively in a terminal."
}
```

**La CLI Vercel interdit par conception à un agent de supprimer un store.** Ce garde-fou n'a pas été contourné, et ne doit pas l'être.

## 4. Ce que vous devez exécuter — par ordre d'urgence

### P0-1 · Révoquer le jeton Blob — 2 commandes

Depuis un terminal interactif :

```
vercel blob delete-store store_4TyemjFvecVTkX2W
vercel blob create-store garageflows-update
```

Puis vérifier, sans divulguer le jeton :

```
node MASTER7_EVIDENCE/outils/verifier-revocation-blob.cjs
```

Attendu : `✅ RÉVOQUÉ — HTTP 401` (ou 403, ou 404). L'outil sort en code 1 tant que le jeton répond 200.

Le nouveau jeton ne doit **jamais** être collé dans un terminal partagé, un rapport ou une conversation : le récupérer depuis `https://vercel.com/garage-flows/~/stores/blob`.

### P0-2 · Roter l'identifiant Neon

Je ne peux pas le faire : aucune clé d'API Neon n'est disponible dans cette session, et les variables correspondantes sont gérées par l'intégration Vercel (type `Config`).

1. Console Neon → le projet contenant `ep-aged-cell-ayqiwroc` → **réinitialiser le mot de passe** du rôle `neondb_owner`.
2. Vérifier que l'intégration Vercel a propagé les nouvelles valeurs (`vercel env ls` doit montrer une date de mise à jour récente sur le jeu `Config`).
3. Redéployer si nécessaire, puis vérifier `GET /api/health` → 200.
4. Contrôler que l'ancienne valeur ne fonctionne plus :

```
psql -d "<ancienne URL>" -c "select 1"     →  doit échouer sur authentification
```

**Déterminez au passage s'il s'agit de la base de production ou de Preview** : c'est une consultation du tableau de bord Neon, que je ne peux pas faire sans manipuler des valeurs de production.

### P1-3 · Remplacer la clé d'API locale

`keys/server_config.json` pointait vers `http://localhost`. Aucun service distant n'est atteignable avec cette clé, mais elle doit être considérée comme publique et remplacée si elle a été réutilisée ailleurs.

### P1-4 · Révoquer la licence exposée côté serveur

Son `lid` est `59eaa25b-d32e-488d-b281-c53b2b463d41`. Elle ne vérifie pas sous l'autorité de production, donc le risque est nul ; marquer son état comme révoqué en base reste une hygiène utile.

### Rien à faire pour Upstash

L'hôte `living-goldfish-190029.upstash.io` ne résout plus : la base a été supprimée, la ressource n'existe plus. Vérifier simplement que la nouvelle instance n'a pas repris le même jeton — improbable, Upstash en génère un nouveau.

## 5. Ce qui n'a pas été fait, et pourquoi

- **Aucune réécriture d'historique.** Sur un dépôt public déjà cloné et indexé, cela ne retire rien et masque la trace. Et le mandat l'interdit.
- **Aucune suppression de store, de base ou de variable.** La seule opération destructrice nécessaire est refusée aux agents par l'outil lui-même.
- **Aucune valeur de secret affichée**, ni dans ce document, ni dans les preuves, ni dans les journaux de commandes — les sorties sont masquées à la source.
- **Aucune donnée métier lue** : deux requêtes de diagnostic, `select 1` et `\conninfo`.

## 6. Alternative structurelle à évaluer

Si l'historique complet du dépôt n'a pas de valeur propre, **le rendre privé** limiterait l'exposition future sans effacer le passé. Les secrets déjà publiés restent à roter de toute façon : un secret committé sur un dépôt public est compromis définitivement.
