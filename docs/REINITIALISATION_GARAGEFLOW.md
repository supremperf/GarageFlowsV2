# Réinitialisation GarageFlow — outil avancé

> **Document stable — remplace les anciennes notes `RESET_GARAGEFLOW_Vxxx`.**
> Décrit l'outil de réinitialisation/rotation totale de l'environnement Vercel.

> ⚠️ **Outil AVANCÉ et potentiellement DESTRUCTEUR.** Il supprime et recrée
> **toutes** les variables Production Vercel. Réservé à un opérateur averti,
> **Windows uniquement** (PowerShell). En cas de doute, préférer
> [CONFIGURATION_ENVIRONNEMENT.md](CONFIGURATION_ENVIRONNEMENT.md)
> (`env:configure` / `env:check`), non destructif.

---

## 1. Ce que fait l'outil

Script cible : **`scripts/reset-garageflow.ps1`** (orchestré par
`CONFIGURER-GARAGEFLOW.cmd`, qui s'appuie aussi sur
`scripts/configurer-api-garageflow.ps1` et le manifeste
`scripts/garageflow-env-manifest.json`).

Flux typique :

1. Lecture du manifeste et de l'état courant des variables.
2. **Sauvegarde** locale des fichiers touchés avant modification (copies
   horodatées `*.before-*`).
3. **Export Vercel** des variables Production (`vercel env pull`), avec
   normalisation des URL PostgreSQL Neon (BOM, guillemets, préfixes).
4. **Suppression puis recréation** de chaque variable Production Vercel (une
   seule entrée par nom, marquée sensible).
5. **Redéploiement** puis **validation runtime** via `GET /api/health`.

**Portée : Production uniquement.** L'outil agit sur l'environnement *Production*
Vercel ; il ne touche pas aux environnements Preview/Development.

---

## 2. Garde-fous

- **Sauvegardes automatiques** avant toute écriture (fichiers `.env`,
  `keys/server_config.json`, routes patchées) — voir
  [RESTAURATION_GARAGEFLOW.md](RESTAURATION_GARAGEFLOW.md).
- **Export Vercel préalable** : les valeurs finales sont relues et normalisées
  avant suppression, pour ne jamais recréer une variable à partir d'une valeur
  corrompue.
- **Confirmation explicite** de l'opérateur avant l'étape destructive.
- **Identification sans secret** : la confirmation affiche le **nom du projet**
  et l'**hôte de la base** (sans mot de passe ni valeur sensible), afin de
  vérifier qu'on agit sur la bonne cible.
- **Validation post-déploiement** : `GET /api/health` doit répondre avant de
  considérer l'opération réussie ; sinon les sauvegardes permettent un retour.

---

## 3. Mode dry-run et paramètres (**disponible**)

Le script est scriptable via des paramètres (bloc `param()`), ce qui permet un
aperçu sûr et des exécutions ciblées :

| Paramètre | Effet |
|---|---|
| `-DryRun` | **Simulation** : calcule le plan mais **n'applique aucune** modification Vercel/Neon/projet ; chaque mutation ignorée est journalisée `[DRY-RUN] …`. |
| `-NonInteractive` | Exécution sans invite. **Refuse de démarrer** sans `-ConfirmDestructiveReset`. |
| `-ConfirmDestructiveReset` | Confirme explicitement une exécution destructrice en mode non interactif. |
| `-BackupOnly` | Sauvegarde puis **arrêt** avant toute modification. |
| `-Restore <dossier>` | Restaure `.env` + `keys/server_config.json` locaux depuis une sauvegarde ; **n'agit pas** sur Vercel (voir [RESTAURATION_GARAGEFLOW.md](RESTAURATION_GARAGEFLOW.md)). |
| `-SkipDeploy` | Pas de déploiement Vercel ni de tests runtime (ni la suppression de licences qui suit). |
| `-SkipDatabaseReset` | N'exécute pas la réparation `legacyIdV*` (no-op ici). |
| `-SkipLicenseReset` | Ne supprime pas les anciennes licences. |
| `-VerboseDiagnostics` | Diagnostics détaillés. |

Aperçu sans rien modifier :

```
npm run env:reset:dry-run
# ou : powershell -NoProfile -ExecutionPolicy Bypass -File scripts/reset-garageflow.ps1 -DryRun
```

> En `-DryRun`, la **lecture** de la sauvegarde Vercel (`vercel env pull`) reste
> effectuée pour bâtir l'aperçu ; seules les **écritures** (variables, DB,
> déploiement, fichiers projet, suppression des licences) sont ignorées. Lancez
> donc le dry-run depuis un poste authentifié à Vercel. Sans aucun paramètre, le
> script reste **interactif** (double confirmation `RESET` puis `ROTATION-TOTALE`).

---

## 4. Note : réparation `legacyIdV*` = no-op sur ce projet

Le script contient une étape de réparation des colonnes `legacyIdV*` de la table
`LicenseKey` (colonnes historiquement créées en `NOT NULL` sur d'anciennes bases
Neon). **Sur ce projet, c'est un no-op** : les schémas Prisma
(`prisma/schema.prisma`, `prisma/server/schema.prisma`) ne déclarent **aucune**
colonne `legacyId*`. L'étape ne trouve donc rien à corriger et n'a aucun effet
ici ; elle reste présente uniquement pour d'éventuelles bases anciennes.

---

## 5. Avant de lancer — check-list

- [ ] Sauvegarde à jour (voir [RESTAURATION_GARAGEFLOW.md](RESTAURATION_GARAGEFLOW.md)).
- [ ] Bon projet Vercel et bon hôte DB confirmés à l'écran (sans secret).
- [ ] `DATABASE_URL` (poolée) et `DIRECT_URL` (directe) Neon valides sous la main.
- [ ] Fenêtre de maintenance : un redéploiement suit l'opération.
- [ ] `GET /api/health` vérifié **après** exécution.
