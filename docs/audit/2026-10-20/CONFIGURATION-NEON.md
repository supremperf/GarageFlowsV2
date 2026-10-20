# GarageFlows — Configuration Neon / PostgreSQL

**Date :** 2026-10-20 · Toutes les opérations ont été exécutées et vérifiées.

## Production — `neondb`

| Élément | Constat |
|---|---|
| Moteur | PostgreSQL (Neon), région `us-east-2` |
| Contenu au 20/10 | **21 garages, 0 client, 11 licences** — base de pré-lancement |
| Rôles avec login | `cloud_admin`, `neon_auth`, `neon_service`, `neondb_owner`, **`gf_app`** (créé) |
| Pooler | `DATABASE_URL` → hôte `-pooler` · `DIRECT_URL` → hôte direct |

### Rotation des identifiants compromis — EXÉCUTÉE, sans coupure

`DATABASE_URL`, `DIRECT_URL` et `PGPASSWORD` partageaient un mot de passe
**connu compromis** (exposé dans l'historique git, consigné dans
`scripts/compromised-secrets.json`).

Méthode retenue — **nouveau rôle plutôt que changement de mot de passe** :
changer celui de `neondb_owner` aurait cassé la production immédiatement, le
déploiement en cours portant l'ancienne valeur figée.

```sql
CREATE ROLE gf_app WITH LOGIN PASSWORD '<généré, 40 car.>';
-- GRANT neondb_owner TO gf_app  → REFUSÉ par Neon :
--   « Only roles with the ADMIN option on role "neondb_owner" may grant this role »
-- Repli appliqué :
GRANT USAGE, CREATE ON SCHEMA public TO gf_app;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO gf_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO gf_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO gf_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO gf_app;
```

Vérifications **réelles** avant toute déclaration :

| Contrôle | Résultat |
|---|---|
| Connexion sous `gf_app` | ✅ `current_user = gf_app` |
| Lecture | ✅ 21 garages lus |
| Écriture | ✅ `CREATE TEMP TABLE` + `INSERT` |
| `DATABASE_URL`/`DIRECT_URL` déclarées (Production) | ✅ via stdin, valeur jamais sur disque |
| Production toujours en service | ✅ `/api/health` et `/api/version` → 200 |

**`neondb_owner` reste actif** : aucune coupure. Sa révocation n'interviendra
qu'après validation du redéploiement (`PROCEDURE-RETOUR-ARRIERE.md`).

> Limite assumée : `gf_app` n'est pas un moindre privilège, c'est une **rotation
> d'identifiant**. Les objets créés par de futures migrations appartiendront à
> `gf_app` ; `ALTER DEFAULT PRIVILEGES` ne couvre que les objets créés par le rôle
> qui l'a défini. À surveiller si les deux rôles créent des objets en alternance.

## Preview — `gf-preview-db` (créée)

```
vercel integration add neon -e preview -n gf-preview-db --plan free_v3 -m region=fra1 --no-env-pull
```

| Élément | Valeur |
|---|---|
| Plan | **`free_v3` (gratuit)** — aucun engagement financier |
| Région | **`fra1` / eu-central-1 (Francfort)** — dans l'UE |
| Connexion | **Preview uniquement** (`-e preview` vérifié : aucune variable Neon en Production) |
| Moteur | PostgreSQL **18.6** |
| Migrations | **22 appliquées**, `prisma migrate deploy` → exit 0 |
| Tables créées | **48** |

### Isolation PROUVÉE

| Base | Empreinte SHA-256 de `hôte + chemin` |
|---|---|
| Production | `777a6b42d0d8b748165a1c7e…` |
| Preview | `5d93970cee92aae5c7b19f43…` |

**Empreintes différentes ⇒ bases distinctes.** Cette empreinte est déclarée sur
les trois environnements dans `GF_PRODUCTION_DB_FINGERPRINT` : `src/lib/env.ts`
refuse désormais de démarrer un Preview qui viserait la base de production.

### Tests métier réels sur la base Preview — 16/16

CRUD (garage, client, véhicule, pièce, facture + ligne), transaction de
décrément, **idempotence** du rejeu, **rollback** après panne simulée,
**isolation multi-tenant** (deux garages), **concurrence** (5 engagements
simultanés → 1 seul gagnant, 1 seul décrément), cohérence du journal des
mouvements (somme = −2), suppression en cascade. Données entièrement fictives,
nettoyées en fin de test.

## Development

Aucune ressource distante : le développement utilise SQLite local
(`prisma/schema.prisma`), conformément à l'architecture à double schéma. Seule
`GF_PRODUCTION_DB_FINGERPRINT` y est déclarée, pour que la garde d'isolation
dispose de sa référence partout.

## Point ouvert

`scripts/validate-server-db.js` a échoué une fois en `P1001` sur l'hôte **direct**
juste après un `migrate deploy` réussi — très probablement la mise en veille
Neon (scale-to-zero du plan gratuit). La connexion a ensuite abouti en 235 ms.
Le script gagnerait à retenter avant de conclure à une base injoignable.
