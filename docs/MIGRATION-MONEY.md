# Architecture monétaire — entiers exacts (migration TERMINÉE au niveau schéma)

> Statut : **ZÉRO champ monétaire `Float`** dans les deux schémas Prisma
> (`npm run check:money` le prouve et l'impose en CI). Les montants sont stockés
> en **entiers exacts** ; tous les calculs passent par la couche centrale
> `src/lib/money.ts` (`npm run check:money-calculations` l'impose). Le **backfill
> des données réelles de production** reste à exécuter par l'opérateur (migrations
> fournies, vérification bloquante intégrée) — voir §5/§6.

## 1. Représentation de stockage (unique source de vérité)

| Nature | Représentation | Exemple |
|---|---|---|
| Totaux, TVA, soldes, cautions, avoirs | **centimes entiers** (`*Cents` Int) | 37,04 € → `3704` |
| Prix / coûts unitaires, taux horaires & journaliers | **dix-millièmes d'euro** (`*TenThousandths` Int) | 12,3456 € → `123456` |
| Quantités fractionnaires (lignes devis/facture) | **dix-millièmes d'unité** (`quantityTenThousandths` Int) | 1,5 → `15000` |
| Taux de TVA | Float **classé non monétaire** (valeurs 0/5,5/10/20 exactes en binaire ; 1 multiplication + 1 arrondi en centimes) | `20` |
| Quantités de stock (Part/JobPart) | Int (unités entières, non monétaire) | `5` |

Champs migrés (les 2 schémas, SQLite + PostgreSQL, **identiques**) :
`Garage.hourlyRateTenThousandths`, `Part.unitCost/unitPriceTenThousandths`,
`JobPart.unitPrice/unitCostTenThousandths`, `QuoteLine`/`InvoiceLine`
`.quantity/unitPrice/unitCostTenThousandths`, `LaborOperation.unitPriceTenThousandths`,
`LoanerReservation.dailyRateTenThousandths` + `depositAmountCents`,
`WorkOrder.totalHtCents/totalTtcCents`, `PurchaseOrder.totalHtCents`.
**Les anciennes colonnes Float sont SUPPRIMÉES des schémas** — aucune double
écriture, aucun fallback applicatif.

## 2. Couche de calcul — `src/lib/money.ts` (obligatoire)

- `lineCents(prix_€, qté)` — arrondi du **montant étendu** par ligne : le prix
  unitaire **n'est jamais arrondi au centime avant** multiplication.
  **12,3456 € × 3 = 37,04 €** (testé ; 37,05 est interdit).
- `lineTotalCentsFromScaled(uPtt, qtt)` — chemin **100 % entier** (dix-millièmes ×
  dix-millièmes → centimes, un seul arrondi, garde anti-dépassement 2^53).
- `computeTotals` — HT/TVA/TTC, invariant `TTC = HT + TVA` au centime.
- `toScaled`/`fromScaled` (±, échelle 1e-4), `toCents`/`fromCents`,
  `marginCents`/`computeMarginCents`, `applyDiscountCents`, `balanceCents`,
  `allocateCents` (répartition d'arrondi sans perte), `parseAmountToScaled`
  (**parsing STRICT** des saisies : virgule/point, refus NaN/Infinity/notation
  exponentielle/> 4 décimales/hors Int32 — jamais de `Number()` silencieux).
- `src/lib/money-db.ts` — frontière base⇄application : dérive la **vue euros**
  des entiers exacts (`linesToEuros`, `partToEuros`, `garageToEuros`,
  `workOrderToEuros`, …) et convertit les saisies (`lineToScaled`).

**Fidélité binaire** : `scaled/10000` est une division IEEE correctement arrondie
→ elle redonne EXACTEMENT le même double que la saisie d'origine
(`199900/10000 === 19.99`). Conséquences prouvées par les tests : documents
**signés** (canonicalisation euros) inchangés, PDF/exports identiques — suite
complète : 1 066 tests (1 059 exécutés verts, 7 conditionnés à un Redis de test).

## 3. Contrat d'API

Les réponses exposent **les entiers exacts** (source de vérité, sans perte JSON)
**et** les nombres euros dérivés (`unitPrice`, `quantity`, `totalHT`, …) pour
l'affichage et la compatibilité. Les saisies clientes restent en euros/unités,
validées par Zod (`finite`, bornes, **≤ 4 décimales**) puis converties en entiers
exacts à l'écriture. Les anciennes **sauvegardes** (euros flottants) restent
restaurables : `restoreSnapshot` convertit à la volée (`migrateLegacyRow`).

## 4. Règles d'arrondi (centralisées — aucune route n'invente la sienne)

| Règle | Décision |
|---|---|
| Ligne | `round(prix_exact × qté_exacte)` au **centime**, une seule fois, demi-éloigné-de-zéro |
| TVA | `round(HT_centimes × taux / 100)` sur le total HT, une fois |
| TTC | `HT_centimes + TVA_centimes` (exact) |
| Remises | % puis fixe, en centimes, plancher 0 |
| Négatifs (avoirs) | arrondi symétrique — une facture et son avoir s'annulent exactement |
| Répartition | `allocateCents` (plus fort reste, somme exacte garantie) |

## 5. Migrations (fournies, vérifiées, ordonnées)

**PostgreSQL** (chaîne `prisma migrate deploy`, exécutée réellement sur base
vide en CI **et** validée sur base peuplée de données legacy) :
1. `20260806100000_money_cents` — totaux en centimes (add + backfill).
2. `20260807000000_money_scaled_units` — **ADD** colonnes exactes + **BACKFILL**
   `ROUND(ancien × 10000)` + **VÉRIFICATION BLOQUANTE PAR COLONNE** : un bloc
   `DO $gfmoney$` contrôle CHACUNE des 17 colonnes migrées (divergence > ½ unité
   d'échelle, cohérence des `NULL` dans les deux sens pour
   `LoanerReservation.dailyRate/depositAmount`) et `RAISE EXCEPTION` — la
   migration échoue AVANT toute perte.
3. `20260807100000_money_drop_floats` — **RE-VÉRIFICATION PRÉ-DROP PAR COLONNE**
   (bloc `DO $gfdrop$` : une ligne de spécification = une colonne supprimée =
   une preuve ; présence de la colonne cible + divergence + `NULL`), puis
   contraintes `NOT NULL DEFAULT 0` sur les centimes, puis **DROP** des 17
   anciennes colonnes Float. PostgreSQL exécute le fichier dans UNE transaction :
   tout échec annule TOUT (aucun DROP après échec — prouvé par test négatif :
   valeur corrompue → `RAISE EXCEPTION` nommant la colonne, base intacte).
4. `scripts/migrate-money-json.ts` (`npm run db:server:migrate-json`) — migration
   **JSON v1 → v2** côté serveur (voir §8) : transactionnelle, idempotente,
   fail-closed, exécutée aussi par `validate-server-db.js` en CI.

**SQLite (desktop)** : entrées **162–178** (une migration composite par colonne :
ADD gardé `onlyIfColumnMissing` → BACKFILL gardé `onlyIfColumnExists` →
`verifySql` **BLOQUANT** → DROP) puis **179_money_json_v2** (JSON persistants,
§8) du runner versionné (`src/lib/migrations.ts` + `/api/internal/migrate`),
appliquées une fois au démarrage Electron. Chaque migration s'exécute dans **UNE
transaction Prisma** (enregistrement dans `_gf_migrations` inclus) : un échec
annule la migration entière, arrête la séquence et NE l'enregistre PAS — relance
possible après restauration. Les gardes rendent la séquence sûre sur base
ANCIENNE (migre) comme NEUVE (no-op enregistré). **Preuves exécutées** :
`npm run test:migration` rejoue la séquence composite sur base ancienne peuplée
(valeurs converties vérifiées, idempotence, no-op base neuve) **et les échecs**
(table absente → séquence stoppée non enregistrée ; divergence → rollback prouvé,
ancienne colonne préservée). Le modèle `prisma/garageflow-template.db` est au
schéma final avec **baseline complète** (§9).

**Reset (`RESET-GARAGEFLOW.cmd`)** : la convergence de schéma reste **strictement
additive** (ADD IF NOT EXISTS des colonnes exactes) ; backfill vérifié et drops
relèvent EXCLUSIVEMENT de la chaîne de migrations, jamais du reset.

## 6. Déploiement production & rollback (opérateur)

1. **Sauvegarde complète** (`pg_dump` Neon + copie `garageflow.db` desktop) — OBLIGATOIRE.
2. **Staging d'abord** : restaurer un dump de prod en staging, `npm run
   db:server:deploy`, vérifier que les 3 migrations passent (les vérifications
   par colonne feraient échouer un backfill divergent), puis `npm run
   db:server:migrate-json -- --dry-run` (simulation sans écriture) et enfin
   `npm run db:server:migrate-json` ; lancer les smoke tests.
3. **Production** : `npm run db:server:deploy` (applique les migrations dans
   l'ordre) **puis** `npm run db:server:migrate-json` (JSON v1 → v2, §8).
4. **Contrôles post-migration** (exemples) :
   `SELECT count(*) FROM "InvoiceLine";` (inchangé) ; échantillon de factures →
   totaux identiques à l'affichage d'avant migration ; le résumé du script JSON
   (migrés / déjà v2 / signés gelés) doit correspondre aux comptes attendus.
5. **Rollback** : restaurer la sauvegarde de l'étape 1 + redéployer la version
   applicative précédente. Les DROP ne sont pas réversibles **sans** la
   sauvegarde — c'est documenté et volontaire (état final sans Float). Une
   migration interrompue avant `_drop_floats` laisse une base intacte (phases
   additives) ; `migrate deploy` reprend où il s'est arrêté. Le script JSON est
   transactionnel : un échec = AUCUNE écriture (relançable après correction).
6. **Desktop** : au premier démarrage post-mise à jour, l'application crée une
   **sauvegarde pré-migration vérifiée** PUIS exécute les migrations, AVANT
   toute fenêtre (ordre imposé par le code et contrôlé en CI, §9). En cas
   d'échec : dialogue explicite avec le chemin de la sauvegarde, arrêt code 1,
   aucune fenêtre principale.

## 7. Garde-fous CI (bloquants)

- `check:money` — **échoue si UN SEUL champ monétaire Float** réapparaît
  (aucune « liste de suivi » : la règle est zéro) ; seuls les 4 `taxRate`
  sont classés non monétaires, justification affichée.
- `check:money-calculations` — échoue sur `prix × quantité` flottant,
  `Math.round(x*100)/100` monétaire, `parseFloat` monétaire, TTC direct
  `*(1+taxRate/100)` hors couche centrale.
- `check:money-json` — toute écriture de `worksJson`/`partsJson`/`linesJson`
  passe par les sérialiseurs v2 ; `JSON.stringify` de propriétés monétaires
  flottantes interdit (exceptions justifiées : transport client revalidé,
  passage verbatim des documents signés, fixtures v1 de test — une exception
  morte fait échouer le garde).
- `check:migration-safety` — invariants de la chaîne (runner atomique sans
  catch toléré, enregistrement en transaction, DROP ⇒ `verifySql`, ordre
  Electron sauvegarde → serveur → migration → fenêtre, contrôle HTTP + métier,
  sauvegarde vérifiée à rétention sûre).
- `check:sqlite-template` — ouvre RÉELLEMENT le modèle : `integrity_check`,
  `foreign_key_check`, baseline complète (179/179), checksums conformes,
  schéma final sans ancienne colonne Float.
- `check:pg-migrations` — bijection stricte `DROP COLUMN` ⇔ vérification par
  colonne dans les migrations PostgreSQL (17/17), bloc de contrôle avant tout
  DROP.
- `test:money` / `test:money-json` / `test:migration` (incl. échecs simulés
  et sauvegarde pré-migration) — précision 4 décimales, quantités
  fractionnaires, avoirs, bornes Int32, backfill, idempotence, rollback.

## 8. JSON persistants — format v2 en entiers exacts

Trois documents JSON persistés contiennent de l'argent : `WorkOrder.worksJson`,
`WorkOrder.partsJson`, `PurchaseOrder.linesJson`. Module unique :
`src/lib/money-json.ts` (partagé par l'API, le runner SQLite et le script
PostgreSQL — aucune logique dupliquée).

- **v2 (stockage actuel)** — objet versionné, AUCUN flottant monétaire :
  `{"schemaVersion":2,"parts":[{"name":"Filtre","qtyTenThousandths":30000,`
  `"unitPriceTenThousandths":123456,"lineTotalCents":3704}]}` (12,3456 € × 3 =
  37,04 € — l'arrondi unique par ligne est STOCKÉ, plus jamais recalculé en
  flottant). Validation Zod `.strict()` : clé inconnue, flottant, valeur
  manquante → rejet.
- **v1 (historique)** — tableaux nus en euros flottants, accepté en LECTURE
  seulement : parsing STRICT (fini, ≤ 4 décimales via `parseAmountToScaled`,
  artefacts binaires type `12.345599999999999` normalisés — jamais de
  `JSON.parse` + `Number()` nus sur du persistant).
- **Migration v1 → v2** — SQLite : `179_money_json_v2` (runner, transactionnel) ;
  PostgreSQL : `scripts/migrate-money-json.ts` (une transaction, `--dry-run`
  disponible). Idempotente (v2 → ignoré). **Contrôle de cohérence bloquant** :
  |total recalculé − `totalHtCents` stocké| ≤ max(1, nb lignes) centimes, sinon
  `JSON_TOTAL_MISMATCH` et AUCUNE écriture — le total STOCKÉ reste la référence.
  Le v2 produit est re-parsé avant écriture.
- **Exception LÉGALE — ordres signés** : le JSON des `WorkOrder` signés est
  canonicalisé VERBATIM dans le document signé (`lib/signature/document.ts`) ;
  il est **GELÉ à vie** (jamais migré, jamais réécrit — la migration les exclut
  par `signedAt`/`signatureData`, le PATCH refuse toute modification de lignes
  sur un document signé). La lecture v1 reste supportée pour EUX uniquement.

## 9. Sûreté d'exécution desktop (fail-closed) & récupération

**Ordre de démarrage imposé** (contrôlé par `check:migration-safety`) :
`setupDatabase` → **sauvegarde pré-migration** → serveur Next → migrations →
fenêtre principale. La sauvegarde (`electron/pre-migration-backup.js`) copie
`garageflow.db` + `-wal`/`-shm` AVANT l'ouverture par le serveur, **vérifie
l'en-tête SQLite réel** de la copie, et conserve les 5 plus récentes
(`garageflows-pre-migration-AAAAMMJJ-HHMMSS.db` dans
`%APPDATA%\GarageFlow\backups\pre-migration`) sans jamais supprimer la
nouvelle. Base absente (première installation) = skip explicite, pas un échec.

**Registre `_gf_migrations`** : `id`, `appliedAt`, `name`, `checksum` (sha256 de
la définition), `schemaVersion`. Une base NEUVE part du modèle
`prisma/garageflow-template.db` **baseliné** (179 migrations enregistrées —
`scripts/baseline-template.mjs`, régénéré par `post-build`/`setup-dev`) : elle
ne rejoue RIEN. Un checksum divergent (définition modifiée après application)
**bloque** (`MIGRATION_CHECKSUM_MISMATCH`) au lieu de rejouer en silence.
Intégrité contrôlée AVANT et APRÈS la séquence (`PRAGMA integrity_check` +
`foreign_key_check`, résultats vérifiés).

**Codes d'erreur** (réponse structurée `{ok:false, failedMigration, stage,
errorCode, recoverable}` ; Electron vérifie statut HTTP **et** `ok === true`) :

| Code | Sens | Récupération |
|---|---|---|
| `PRE_MIGRATION_BACKUP_FAILED` | copie de sauvegarde invalide/impossible | libérer de l'espace disque, vérifier la base, relancer |
| `DB_INTEGRITY_FAILED` | base corrompue AVANT migration (rien n'est touché) | restaurer une sauvegarde saine |
| `MIGRATION_SQL_FAILED` | SQL en échec — transaction annulée, non enregistrée | relancer ; si persistant, restaurer la sauvegarde pré-migration |
| `MIGRATION_VERIFICATION_FAILED` | backfill divergent — rollback complet | données à examiner, base inchangée |
| `JSON_TOTAL_MISMATCH` | total JSON recalculé ≠ stocké (hors tolérance) | examiner le document cité (id dans les journaux), base inchangée |
| `MIGRATION_CHECKSUM_MISMATCH` | définition modifiée après application | mise à jour applicative attendue — ne pas forcer |
| `MIGRATION_BAD_RESPONSE` | réponse serveur illisible | relancer l'application |
| `MIGRATION_IN_PROGRESS` | migration déjà en cours | attendre puis relancer |

En cas d'échec au démarrage : dialogue utilisateur avec le code, le chemin de la
sauvegarde pré-migration et un bouton « Ouvrir le dossier de sauvegarde » ;
l'application se ferme (code 1) **sans ouvrir la fenêtre principale**. Les
données restent dans l'état d'avant la migration échouée (transactions) ; la
sauvegarde pré-migration permet en dernier recours de revenir à l'état
antérieur en remplaçant `garageflow.db` (application fermée).
