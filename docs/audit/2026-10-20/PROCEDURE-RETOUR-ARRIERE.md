# GarageFlows — Procédure de retour arrière

**Date :** 2026-10-20 · À lire **avant** tout redéploiement de production.

## Ce qui a changé, et ce qui est réversible

| Changement | Réversible ? | Comment |
|---|---|---|
| 12 variables déclarées sur Vercel Production | oui | `vercel env rm <NOM> production --project app.garageflows.fr` |
| 26 variables sur Preview | oui | idem avec `preview` |
| Base Neon `gf-preview-db` créée | oui | `vercel integration resource remove gf-preview-db` |
| Rôle PostgreSQL `gf_app` créé | oui | voir ci-dessous |
| 3 commits sur `test-100-pourcent-valide` | oui | branche isolée, jamais fusionnée |
| **Déploiement de production** | **non modifié** | aucun déploiement n'a été déclenché |

**Rien n'a été supprimé.** Aucune donnée client n'a été touchée : la base de
production n'a reçu qu'un `CREATE ROLE` et des `GRANT`.

## Si un redéploiement échoue

Le déploiement actuel (`dpl_6Khy1XJoiCMGwojg42cBookExTWj`, 17/10) reste
fonctionnel et conserve ses propres variables figées. Pour y revenir :

```bash
vercel rollback dpl_6Khy1XJoiCMGwojg42cBookExTWj --scope garage-flows
```

L'ancien rôle `neondb_owner` étant **toujours actif**, ce déploiement continue de
joindre la base. C'est exactement pourquoi la rotation a créé un nouveau rôle au
lieu de changer le mot de passe existant : le retour arrière reste possible.

## Revenir en arrière sur la rotation

Tant que `neondb_owner` n'est pas révoqué, l'annulation est immédiate :

```bash
# Rétablir les anciennes URL (valeurs encore présentes dans le .env du poste)
vercel env rm DATABASE_URL production --project app.garageflows.fr
vercel env rm DIRECT_URL   production --project app.garageflows.fr
# puis les redéclarer avec les valeurs neondb_owner, et redéployer
```

```sql
-- Si l'on renonce définitivement au rôle applicatif
REASSIGN OWNED BY gf_app TO neondb_owner;  -- seulement si gf_app a créé des objets
DROP OWNED BY gf_app;
DROP ROLE gf_app;
```

## Révocation de l'ancien rôle — à ne faire qu'APRÈS validation

**Point de non-retour.** À n'exécuter que lorsque le redéploiement est validé et
que l'application fonctionne sous `gf_app` :

```sql
ALTER ROLE neondb_owner PASSWORD '<nouvelle valeur forte>';
```

Préférer ceci à `DROP ROLE neondb_owner` : ce rôle **possède** le schéma et les
tables existantes ; le supprimer casserait la base. Changer son mot de passe
suffit à neutraliser l'identifiant compromis.

Avant de l'exécuter, vérifier les quatre points :

1. `node scripts/check-env-vercel.mjs --environnement production --projet app.garageflows.fr` → exit 0 ;
2. le déploiement répond, et `/api/version` renvoie le `schemaVersion` attendu ;
3. une écriture métier réelle aboutit (création d'un client de test, puis suppression) ;
4. `node --env-file=.env scripts/verify-rotation.mjs` → exit 0, après mise à jour du `.env` local.

## Sauvegarde

**Non vérifiée au cours de cette mission.** Neon conserve un historique de
branches permettant une restauration à un instant donné, mais aucune
restauration n'a été testée. À traiter avant de considérer la production comme
couverte — une sauvegarde jamais restaurée n'est pas une sauvegarde.

## Point d'hygiène restant

Le `.env` du poste contient encore les identifiants PostgreSQL **compromis** et le
token Blob compromis. Après validation du redéploiement, le mettre à jour ou le
retirer du poste.
