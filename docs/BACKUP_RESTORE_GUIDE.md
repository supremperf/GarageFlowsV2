# Sauvegarde & restauration — guide (état réel)

_Ce document décrit le mécanisme **réellement implémenté et testé**. Ce qui n'est
pas fait est indiqué explicitement._

## Ce qui existe (code + tests)
- **Sauvegarde chiffrée** par garage : snapshot logique transactionnel →
  **AES-256-GCM** (clé `GF_BACKUP_KEY` **ou** passphrase scrypt) → blob écrit sur
  disque (`GF_BACKUP_DIR`) + `BackupRecord` (historique, checksum, comptes).
- **Manifeste auto-descriptif** embarqué DANS le blob chiffré (format `gf-backup`
  v2) : version de schéma, version d'app, garageId, date, comptes par table,
  **empreinte SHA-256 des données**. Permet de vérifier et restaurer **sans** le
  `BackupRecord` local.
- **Couverture des données** : clients, véhicules, pièces, opérations, OR, devis,
  factures (+ lignes), rappels, inspections (+ items), garanties, signatures **et
  la persistance e-invoicing** (`EInvoiceSubmission`/`EInvoiceEvent`). La ligne
  racine **Garage** est aussi capturée (pour la restauration sur machine vierge).
- **Vérification d'intégrité** : `verifyBackup` (local) et `inspectBlob`
  (portable) déchiffrent et recomparent les empreintes **sans** toucher aux
  données.
- **Restauration atomique** : `restoreBackup` (local, par id) et
  `restoreFromBlob` (portable, à partir du seul blob) — transaction unique,
  suppression enfant→parent puis recréation parent→enfant.
- **Restauration sur une AUTRE machine** : `restoreFromBlob` recrée la ligne
  Garage si absente (create-if-missing) puis restaure les données. Garde-fous :
  intégrité vérifiée, `confirmGarageId` obligatoire.
- **API** (propriétaire) : `POST /api/admin/backups` (créer),
  `GET .../backups` (lister), `.../[id]/verify`, `.../[id]/download`,
  `.../[id]/restore`, et `POST /api/admin/backups/restore-blob` (portable).
- **Tests** : `src/lib/backup/__tests__/*` + `src/integration/backup-portable.test.ts`
  (manifeste, couverture e-invoicing, restauration sur machine vierge, rejet
  d'altération, rejet de garage/passphrase non concordants).

## Procédure — sauvegarde
1. Définir `GF_BACKUP_KEY` (32 octets) **ou** utiliser une passphrase forte.
2. `POST /api/admin/backups` (propriétaire) → blob chiffré + `BackupRecord`.
3. Récupérer le blob hors-site : `GET /api/admin/backups/{id}/download`.
4. Conserver la **clé/passphrase séparément** du blob (sinon le chiffrement est vain).

## Procédure — restauration sur une machine vierge
1. Installer l'application et disposer du blob + de la clé/passphrase.
2. S'authentifier en tant que **propriétaire** du garage cible **ayant le même
   `garageId`** que la sauvegarde (voir la réserve ci-dessous).
3. `POST /api/admin/backups/restore-blob` avec `{ blob, passphrase?, confirm }`
   (`confirm` = id du garage). La réponse est un **rapport de restauration**
   (comptes par table, `garageRestored`).

## Réserves (honnêteté)
- **Correspondance d'identifiant** : la restauration préserve le `garageId`
  d'origine. Restaurer dans un garage fraîchement créé (id différent) n'est PAS
  supporté sans remappage d'identifiants — **non implémenté**. Le scénario
  couvert est la reprise après sinistre vers une installation qui réutilise le
  même `garageId` (recréé par la sauvegarde elle-même).
- **Comptes utilisateurs** : la sauvegarde couvre les **données métier** du
  garage, pas les comptes `User`/`PortalUser` (choix délibéré pour éviter
  d'écraser des accès/verrouillages). Le bootstrap d'un compte propriétaire sur
  une machine vierge relève de l'onboarding.
- **Assistant graphique** : l'API est complète ; un **assistant UI guidé**
  (glisser-déposer d'un blob, aperçu du manifeste, confirmation) n'est pas encore
  livré — **à construire** (les endpoints existent et sont utilisables).
- **Stockage cloud** : la remise hors-site (S3, etc.) est **manuelle** ; aucune
  intégration cloud automatique n'est fournie.
