# Sauvegarde et restauration — GarageFlow

> Document de data room (due diligence M&A). Rédigé pour être **factuel** : il
> distingue explicitement ce qui est *opérationnel* (câblé et fonctionnel), *code
> seul sans interface*, et *à provisionner par l'acquéreur*. Chiffres et chemins
> issus d'une lecture directe du code (session du 2026-07-31).

## 1. Vue d'ensemble

GarageFlow protège les données à **deux niveaux techniques distincts**, plus une
recommandation pour le plan de contrôle cloud :

| Niveau | Portée | Mécanisme | État |
|---|---|---|---|
| A. Sauvegardes locales 3 paliers | Base SQLite du poste (desktop) | Copies binaires `.db` horaire/quotidienne/hebdo par le process Electron | **Opérationnel** (câblé, automatique) |
| B. Service de sauvegarde chiffré | Export logique par garage | Snapshot Prisma → AES-256-GCM → disque + `BackupRecord` | **Code complet, SANS interface utilisateur** |
| C. Base PostgreSQL (cloud garagesite3) | Plan de contrôle licences/updates | PITR fournisseur (Neon/Supabase) | **À configurer côté fournisseur** (hors dépôt) |

Point d'honnêteté central : le niveau A est réellement automatique et éprouvé ;
le niveau B est un module **codé et testé unitairement mais non exposé dans
l'UI** — aucune page/bouton produit ne l'invoque aujourd'hui ; le niveau C
dépend d'un service géré externe que l'acquéreur doit posséder et paramétrer.

---

## 2. Niveau A — Sauvegardes locales 3 paliers (opérationnel)

Implémentation : `electron/main.js` (fonction `runBackup`, lignes ~1231-1291 ;
planification lignes ~2375-2377).

### 2.1 Emplacements

Toutes les copies sont écrites sous `APP_DATA/backups` :

```
backups/
  hourly/   garageflow_YYYYMMDD_HH.db   (24 conservées)
  daily/    garageflow_YYYYMMDD.db      (7 conservées)
  weekly/   garageflow_YYYY-Www.db      (4 conservées)
```

Constantes : `BAK_DIR`, `BAK_HOURLY`, `BAK_DAILY`, `BAK_WEEKLY`
(`electron/main.js:86-89`).

### 2.2 Politique de rétention

| Palier | Fréquence | Déclencheur | Rétention |
|---|---|---|---|
| Horaire | Toutes les heures | `setInterval(runBackup, 60·60·1000)` + un run au démarrage | 24 fichiers (~1 jour) |
| Quotidien | 1×/jour | Premier run horaire d'un nouveau jour calendaire | 7 fichiers (~1 semaine) |
| Hebdomadaire | 1×/semaine ISO | Premier quotidien d'une nouvelle semaine ISO (`isoWeek`) | 4 fichiers (~1 mois) |

La purge (`pruneDir`) trie par nom et supprime les plus anciens au-delà du
quota. La numérotation `YYYYMMDD` rend le tri lexicographique équivalent au tri
chronologique.

### 2.3 Nature technique et garanties

- **Copie binaire brute** du fichier SQLite (`fs.copyFileSync(DB_PATH, …)`) — pas
  un dump logique. Rapide, mais dépend de la cohérence du fichier au moment de la
  copie (voir §2.5, limite connue).
- **Sauvegarde pré-mise-à-jour** : `runBackup()` est aussi appelé juste avant
  l'installation d'une mise à jour (`electron/main.js:2038`), de sorte qu'un
  échec d'update laisse un point de restauration immédiat.
- **Accès utilisateur** : l'IPC `app:open-backups` ouvre le dossier de
  sauvegardes dans l'explorateur (`electron/main.js:1856`) ; l'IPC `app:backup`
  déclenche une sauvegarde manuelle (`electron/main.js:1859-1860`). Ce sont les
  seuls points de contact UI de ce niveau.

### 2.4 Restauration niveau A (manuelle, opérateur)

Il n'existe pas d'assistant de restauration in-app pour le niveau A. La
restauration est une opération de fichier :

1. Fermer complètement GarageFlow.
2. Localiser le fichier de base active (`DB_PATH` sous `APP_DATA`).
3. Renommer la base courante (ex. `garageflow.db.old-<date>`) — ne jamais
   supprimer avant validation.
4. Copier le `.db` de sauvegarde choisi (horaire/quotidien/hebdo) vers `DB_PATH`.
5. Relancer l'application. Au démarrage, `setupDatabase()` valide l'en-tête
   SQLite (`isDbValid`, magic `53514c69746520`) ; un fichier corrompu est mis en
   quarantaine (`DB_PATH.bad-<timestamp>`) plutôt que d'être écrasé silencieusement
   (`electron/main.js:836-889`).

### 2.5 Limites connues (honnêteté)

- **Cohérence à chaud** : la copie est faite sans verrou WAL explicite. En
  pratique le risque est faible (fichier local mono-utilisateur), mais un
  `VACUUM INTO` / `sqlite3 .backup` serait plus rigoureux. À noter pour un
  durcissement post-acquisition.
- **Pas de chiffrement** : les `.db` du niveau A sont en clair sur le disque du
  poste (la protection repose sur le chiffrement disque de l'OS, non géré ici).
- **Pas d'export off-site automatique** : les copies restent locales. Aucune
  synchronisation cloud n'est câblée pour ce niveau.

---

## 3. Niveau B — Service de sauvegarde chiffré (code seul, PAS d'UI)

Implémentation : `src/lib/backup/` — `crypto.ts`, `snapshot.ts`, `service.ts`
(+ `src/lib/backup/__tests__/`).

> **Statut à déclarer sans ambiguïté** : ce service est **complet et testé au
> niveau unitaire**, mais **aucune interface utilisateur ni route produit ne
> l'expose**. C'est un actif de code réutilisable, pas une fonctionnalité
> livrée. Toute valorisation doit le classer « code-only-no-UI ».

### 3.1 Cryptographie (`crypto.ts`)

- **AES-256-GCM** (chiffrement authentifié : confidentialité + intégrité). Toute
  altération du ciphertext/IV/tag fait échouer `decrypt` — une sauvegarde
  falsifiée ne peut jamais être restaurée silencieusement.
- **Enveloppe auto-descriptive versionnée** `EncryptedEnvelope` (`v:1`, `alg`,
  `kdf`, `salt?`, `iv`, `tag`, `ct`, tous en base64).
- **Deux modes de clé** :
  - `GF_BACKUP_KEY` : clé brute 32 octets (base64), `kdf: 'raw'`.
  - Passphrase par requête : dérivation **scrypt** (`N=16384, r=8, p=1`), sel
    aléatoire de 16 octets embarqué dans l'enveloppe, `kdf: 'scrypt'`.
- **Checksum SHA-256** du texte clair stocké avec la sauvegarde pour vérifier la
  restauration (`sha256`).

### 3.2 Snapshot logique (`snapshot.ts`)

- Un **unique tableau ordonné** `TABLE_SPECS` (parent → enfant) pilote à la fois
  le snapshot (lecture) et la restauration (suppression enfant→parent, puis
  recréation parent→enfant), garantissant leur cohérence.
- 17 tables couvertes, scopées par `garageId` (clients, mechanics, parts,
  laborOperations, vehicles, jobs, jobParts, quotes, quoteLines, invoices,
  invoiceLines, reminders, inspections, inspectionItems, workOrders, warranties,
  signatures).
- **Restauration atomique** : tout se déroule dans une transaction Prisma
  (`prisma.$transaction`) — un échec annule l'ensemble.

### 3.3 Orchestration (`service.ts`)

| Fonction | Rôle | Garantie |
|---|---|---|
| `createBackup` | Snapshot → chiffrement → écriture disque + `BackupRecord` | Blob écrit en `mode 0o600` sous `GF_BACKUP_DIR` |
| `verifyBackup` | Déchiffre, recontrôle le checksum, parse — **sans toucher aux données vives** | Marque `status: 'verified'` si OK |
| `restoreBackup` | Remplacement atomique | Exige `confirm === id` (accusé de réception explicite) + revérifie le checksum avant d'écrire |
| `listBackups` / `readBackupBlob` | Historique / export du blob chiffré | — |

Le modèle `BackupRecord` (Prisma) conserve `checksum`, `kdf`, `entityCounts`,
`sizeBytes`, `status` (`completed`→`verified`→`restored`), permettant une
vérification automatique documentée (voir `docs/BACKUP_VERIFICATION.md`).

### 3.4 Ce qu'il resterait à faire pour le livrer

1. Exposer des routes API produit (`/api/backup/*`) au-dessus de `service.ts`.
2. Ajouter une UI (liste, créer, vérifier, restaurer avec confirmation).
3. Câbler `GF_BACKUP_KEY` / gestion de passphrase dans la configuration.
4. Optionnel : export off-site du blob chiffré (le blob est conçu pour cela via
   `readBackupBlob`).

---

## 4. Niveau C — Base PostgreSQL du plan de contrôle (à provisionner)

Le dépôt cloud `garagesite3` (Next.js 15 + PostgreSQL/Prisma, 13 modèles) porte
les licences, appareils, releases, crashs, modules, audit. **Il n'embarque pas
sa propre logique de sauvegarde** : la donnée vit dans une base Postgres gérée.

Recommandations (à mettre en œuvre côté fournisseur — **hors code, à la charge de
l'acquéreur**) :

- **PITR (Point-In-Time Recovery)** du fournisseur : Neon (branches + restore
  point) ou Supabase (PITR sur offres payantes). Cible RPO ≤ quelques minutes.
- **Dumps logiques périodiques** (`pg_dump`) stockés hors du fournisseur
  principal, chiffrés au repos, avec test de restauration régulier.
- **Secrets applicatifs** (voir `docs/SECRETS_ROTATION.md`) : `DATABASE_URL`,
  `DEVICE_TOKEN_SECRET`, `HWID_HMAC_SECRET`, tokens Upstash — **non sauvegardables
  depuis la base** ; à conserver dans un coffre (vault) et transférer au closing.
- Les migrations Postgres sont reproductibles (`prisma/server/migrations`,
  `migration_lock.toml` épinglé `postgresql`, 4 migrations ordonnées) — un
  environnement peut être reconstruit à partir du schéma.

> **Actif externe à transférer** : l'accès au projet Neon/Supabase, ses
> sauvegardes/PITR et les secrets d'environnement font partie des livrables du
> deal, au même titre que les clés de signature et les domaines (voir P0 dans
> l'audit).

---

## 5. Résumé « qui sauvegarde quoi »

| Donnée | Où | Protégée par |
|---|---|---|
| Données métier du garage (SQLite) | Poste client | Niveau A (auto) + Niveau B (si déployé) |
| Photos / exports | `PHOTOS_DIR` sous `APP_DATA` | Non incluses dans A/B — à documenter |
| Licences / appareils / releases / crashs | Postgres cloud | Niveau C (PITR fournisseur) |
| Secrets & clés privées de signature | Coffre / env serveur | Hors sauvegarde applicative — transfert manuel au closing |

---

_Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md`._
