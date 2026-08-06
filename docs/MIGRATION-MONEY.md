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
**signés** (canonicalisation euros) inchangés, PDF/exports identiques, 1017 tests
verts sans modification d'aucune valeur attendue.

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

**PostgreSQL** (chaîne `prisma migrate deploy`, testée sur base vide en CI) :
1. `20260806100000_money_cents` — totaux en centimes (add + backfill).
2. `20260807000000_money_scaled_units` — **ADD** colonnes exactes + **BACKFILL**
   `ROUND(ancien × 10000)` + **VÉRIFICATION BLOQUANTE** (`RAISE EXCEPTION` si une
   ligne diverge > ½ unité d'échelle — la migration échoue AVANT toute perte).
3. `20260807100000_money_drop_floats` — re-vérification défensive, contraintes
   `NOT NULL DEFAULT 0` sur les centimes, **DROP** des anciennes colonnes Float.

**SQLite (desktop)** : entrées **162–212** du runner versionné
(`src/lib/migrations.ts` + `/api/internal/migrate`), appliquées une fois au
démarrage Electron. Chaque colonne : ADD (garde `onlyIfColumnMissing`) →
BACKFILL déterministe (garde `onlyIfColumnExists` sur l'ancienne colonne) →
DROP. Les gardes rendent la séquence sûre sur base ANCIENNE (migre) comme NEUVE
(no-op). **Preuve exécutée** : `npm run test:migration` rejoue la séquence sur
une base ancienne peuplée (positifs, négatifs, NULL, 4 décimales, 0,25/1,5/2,375),
vérifie les valeurs converties, l'idempotence de la relance et le no-op sur base
neuve. Le modèle `prisma/garageflow-template.db` est régénéré au schéma final.

**Reset (`RESET-GARAGEFLOW.cmd`)** : la convergence de schéma reste **strictement
additive** (ADD IF NOT EXISTS des colonnes exactes) ; backfill vérifié et drops
relèvent EXCLUSIVEMENT de la chaîne de migrations, jamais du reset.

## 6. Déploiement production & rollback (opérateur)

1. **Sauvegarde complète** (`pg_dump` Neon + copie `garageflow.db` desktop) — OBLIGATOIRE.
2. **Staging d'abord** : restaurer un dump de prod en staging, `npm run
   db:server:deploy`, vérifier que les 3 migrations passent (la vérification
   bloquante ferait échouer un backfill divergent) et lancer les smoke tests.
3. **Production** : `npm run db:server:deploy` (applique 1→3 dans l'ordre).
4. **Contrôles post-migration** (exemples) :
   `SELECT count(*) FROM "InvoiceLine";` (inchangé) ; échantillon de factures →
   totaux identiques à l'affichage d'avant migration.
5. **Rollback** : restaurer la sauvegarde de l'étape 1 + redéployer la version
   applicative précédente. Les DROP ne sont pas réversibles **sans** la
   sauvegarde — c'est documenté et volontaire (état final sans Float). Une
   migration interrompue avant `_drop_floats` laisse une base intacte (phases
   additives) ; `migrate deploy` reprend où il s'est arrêté.
6. **Desktop** : la migration s'exécute au premier démarrage post-mise à jour,
   AVANT toute interaction ; la sauvegarde automatique quotidienne précède.

## 7. Garde-fous CI (bloquants)

- `check:money` — **échoue si UN SEUL champ monétaire Float** réapparaît
  (aucune « liste de suivi » : la règle est zéro) ; seuls les 4 `taxRate`
  sont classés non monétaires, justification affichée.
- `check:money-calculations` — échoue sur `prix × quantité` flottant,
  `Math.round(x*100)/100` monétaire, `parseFloat` monétaire, TTC direct
  `*(1+taxRate/100)` hors couche centrale.
- `test:money` (51 tests) / `test:migration` (8 tests) — précision 4 décimales,
  quantités fractionnaires, avoirs, bornes Int32, backfill, idempotence.
