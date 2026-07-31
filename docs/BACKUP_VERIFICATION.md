# Vérification des sauvegardes — comment PROUVER une restauration

> Document de data room (due diligence M&A). Objectif : décrire une procédure
> **reproductible** qui prouve qu'une sauvegarde est *restaurable*, pas seulement
> *présente*. Fondé sur le code réel (`src/lib/backup/`, `electron/main.js`).

## 0. Principe directeur (à lire en premier)

> **L'existence d'un fichier de sauvegarde n'est PAS une preuve de
> restaurabilité.** Un `.db` peut être tronqué, un blob chiffré peut avoir une
> clé perdue, un dump peut être incomplet. La seule preuve valable est une
> **restauration effective sur des données de test, suivie d'un contrôle
> d'intégrité**. Tant que ce test n'a pas réussi, on considère la sauvegarde
> comme non prouvée.

Un programme de sauvegarde crédible pour un acquéreur repose sur trois piliers :
**(1)** la sauvegarde existe, **(2)** elle se restaure, **(3)** les données
restaurées sont correctes et complètes. Ce document couvre (2) et (3).

---

## 1. Ce que le code garantit déjà (vérification intégrée)

### 1.1 Service chiffré (`src/lib/backup/service.ts`) — vérification automatique

Le service de sauvegarde chiffré (niveau B, **code seul, sans UI** — voir
`docs/BACKUP_AND_RESTORE.md`) intègre une vérification qui va plus loin qu'un
simple test d'existence :

- `createBackup` calcule et stocke un **checksum SHA-256 du texte clair** dans
  `BackupRecord.checksum`, ainsi que les **compteurs par table** (`entityCounts`).
- `verifyBackup(garageId, id, passphrase?)` :
  1. lit l'enveloppe chiffrée sur disque,
  2. la **déchiffre réellement** (AES-256-GCM ; échoue si clé/passphrase erronée
     ou données falsifiées — le tag GCM l'impose),
  3. **recalcule le checksum** et le compare au checksum stocké,
  4. **parse le snapshot** et recompte les tables,
  5. marque `status: 'verified'` **sans toucher aux données vives**.

C'est un véritable test de déchiffrement + intégrité, pas un `fs.existsSync`.
Limite : il ne prouve pas encore que les lignes **réinséreraient** sans conflit
de contrainte — d'où la procédure de restauration réelle du §2.

### 1.2 Sauvegardes locales `.db` (niveau A) — validation d'en-tête

Au démarrage, `isDbValid()` (`electron/main.js`) lit les 15 premiers octets et
vérifie le **magic SQLite** (`53514c69746520...`) et une taille minimale. C'est un
garde-fou utile mais **insuffisant comme preuve** : un en-tête valide ne garantit
pas l'intégrité complète du fichier.

---

## 2. Procédure de preuve de restauration (à exécuter périodiquement)

### 2.A — Sauvegarde locale SQLite (niveau A)

Objectif : prouver qu'un `.db` de `backups/` produit une application
fonctionnelle avec les bonnes données.

1. **Préparer un poste de test isolé** (VM ou dossier `APP_DATA` dédié via
   variable d'environnement) — ne jamais tester sur la base de production.
2. Copier le fichier de sauvegarde candidat (`hourly/`, `daily/` ou `weekly/`)
   comme base active du poste de test.
3. **Contrôle d'intégrité SQLite** avant lancement :
   ```
   sqlite3 <fichier>.db "PRAGMA integrity_check;"   → doit répondre "ok"
   sqlite3 <fichier>.db "PRAGMA foreign_key_check;" → doit être vide
   ```
4. Lancer GarageFlow sur le poste de test ; vérifier le démarrage sans dialogue
   d'erreur (`isDbValid` passe).
5. **Contrôles fonctionnels** : ouvrir la liste clients, un devis, une facture ;
   vérifier que les compteurs correspondent à l'attendu (voir §3, jeu de test).
6. Consigner le résultat (date, fichier testé, PRAGMA ok, contrôles UI ok) dans
   le registre §4.

### 2.B — Sauvegarde chiffrée logique (niveau B)

Objectif : prouver que l'enveloppe chiffrée se déchiffre, s'intègre et se
restaure réellement en base.

1. Créer un **garage de test** dédié (`garageId` jetable) avec un jeu de données
   connu (§3).
2. `createBackup(garageId, { note: 'verif-<date>' })` → produit un
   `BackupRecord` + un blob sur disque.
3. **Vérification d'intégrité** : `verifyBackup(garageId, id)` → doit renvoyer
   `{ ok: true, checksumMatches: true }` et des `counts` égaux au jeu de test.
   Statut passe à `verified`.
4. **Preuve de restauration réelle** : sur le **garage de test uniquement**,
   `restoreBackup(garageId, id, { confirm: id })`. La confirmation
   `confirm === id` est un garde-fou obligatoire ; la restauration re-contrôle le
   checksum avant d'écrire et s'exécute dans une transaction atomique.
5. **Contrôle post-restauration** : recompter chaque table et comparer aux
   `entityCounts` d'origine ; vérifier quelques enregistrements pivots (une
   facture émise, ses lignes, son client rattaché).
6. Répéter le test **avec le mauvais secret** pour prouver l'échec attendu : une
   clé/passphrase erronée doit faire échouer le déchiffrement (le tag GCM
   garantit qu'aucune donnée corrompue n'est acceptée).

### 2.C — PostgreSQL cloud (niveau C)

Objectif : prouver que le PITR / `pg_dump` reconstitue le plan de contrôle.

1. Restaurer un `pg_dump` (ou un point PITR) dans une **base éphémère**.
2. Appliquer/valider les migrations (`prisma migrate deploy` doit être un no-op
   si le dump est cohérent).
3. Contrôles de cohérence : compter `LicenseKey`, `Device`, `AppRelease` ;
   vérifier qu'un couple licence/appareil connu s'active sur un poste test
   pointant vers l'environnement restauré.
4. Vérifier que la validation d'environnement fail-closed (`src/lib/env.ts`)
   démarre bien avec les secrets réinjectés depuis le vault.

---

## 3. Jeu de données de test recommandé

Utiliser un jeu **déterministe et vérifiable**. Le dépôt fournit déjà un seed
reproductible (`prisma/seed.ts`) qui crée un « Garage Demo » avec **5 mécaniciens
et 13 jobs** (vérifié : `prisma db push` + `npm run db:seed` en sortie 0). Ce
seed constitue une base idéale de test car ses compteurs sont connus :

- Après restauration, `mechanics = 5` et `jobs = 13` doivent être retrouvés à
  l'identique.
- Ajouter au moins **une facture émise avec plusieurs lignes** et **un devis**
  pour couvrir les tables enfant (`invoiceLines`, `quoteLines`) et prouver que
  l'ordre parent→enfant du snapshot est respecté.

## 4. Registre de vérification (à tenir)

| Date | Niveau (A/B/C) | Fichier / point | Intégrité | Restauration réelle | Compteurs OK | Opérateur |
|---|---|---|---|---|---|---|
| … | | | ok / échec | oui / non | oui / non | |

Fréquence recommandée : **niveau A** mensuel (échantillon), **niveau B** à chaque
release une fois l'UI livrée, **niveau C** trimestriel + après tout changement de
schéma.

## 5. Erreurs à ne pas commettre (anti-preuves)

- Considérer une sauvegarde « OK » parce que le fichier est présent et non vide.
- Tester la restauration sur la base de production (risque d'écrasement — le
  garde-fou `confirm === id` limite mais n'élimine pas l'erreur humaine).
- Ne jamais tester le **chemin d'échec** (mauvaise clé) : sans lui, on ne prouve
  pas que l'intégrité est réellement contrôlée.
- Oublier les secrets : une sauvegarde chiffrée sans la clé `GF_BACKUP_KEY` (ou la
  passphrase) est **irrécupérable**. La gestion du secret fait partie de la preuve.

---

_Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md`._
