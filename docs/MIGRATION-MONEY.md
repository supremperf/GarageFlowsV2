# Montants financiers — architecture monétaire déterministe

> Statut : **calcul 100 % en centimes entiers (fait)** + **stockage des totaux en
> centimes, additif et non destructif (fait, colonnes `*Cents`)**. Le retrait des
> colonnes Float et la migration des **prix unitaires** en sous-unités sont
> **stagés** (raisons ci-dessous). Rien n'est simulé : le backfill sur **données
> réelles** est exécuté par l'opérateur (SQL fourni), pas dans cet environnement.

## 1. Le vrai problème : l'ARITHMÉTIQUE, pas seulement le stockage

`0.1 + 0.2 === 0.30000000000000004` en IEEE-754. Le danger des Float monétaires
vient surtout des **calculs** (sommes de lignes, TVA, marges, soldes) qui
accumulent ce bruit. Un stockage « décimal » ne corrige rien si l'application
additionne encore des flottants avant d'écrire.

## 2. Couche de calcul — `src/lib/money.ts` (source unique)

TOUT calcul financier passe par des **entiers de centimes** :

- `toCents` / `fromCents` — conversion €⇄centimes, **arrondi demi-éloigné-de-zéro**,
  robuste au bruit binaire à toute magnitude ;
- `multiplyCents(cents, quantité)` — ligne = `round(quantité × prix_centimes)` ;
- `computeTotals(lignes, taux)` — HT, TVA, TTC ; **invariant garanti** `TTC = HT + TVA` ;
- `applyDiscountCents` — remise (% puis fixe), plancher à 0 ;
- `balanceCents` — `solde = TTC − paiements − avoirs` ;
- `marginCents` / `computeMarginCents` — **marge = produit − coût**, exacte, signe conservé.

`src/lib/billing.ts` (routes invoices/quotes/stats) et les **ordres de réparation**
(`/api/work-orders`) délèguent désormais à `money.ts` — plus **aucune** arithmétique
flottante native pour l'argent dans ces chemins (l'ancien calcul OR
`Math.round((worksHT+partsHT)*100)/100` a été remplacé).

## 3. Contrat d'arrondi (centralisé & documenté)

| Règle | Décision |
|---|---|
| Précision intermédiaire | **centimes entiers** (aucun flottant intermédiaire monétaire) |
| Arrondi d'une ligne | `round(quantité × prix_centimes)` — **arrondi PAR LIGNE** |
| Arrondi de TVA | `round(HT_centimes × taux / 100)` — sur le **total HT**, une fois |
| TTC | `HT_centimes + TVA_centimes` (addition exacte) → jamais recalculé depuis un flottant |
| Remises | pourcentage puis montant fixe, en centimes ; plancher à 0 |
| Avoirs / montants négatifs | arrondi **symétrique** (miroir des montants positifs) → une facture et son avoir s'annulent exactement (résidu 0) |
| Mode d'arrondi | **demi-éloigné-de-zéro** (`toCents`/`multiplyCents`) |

Ce contrat est **identique** pour factures, devis et ordres de réparation
(cohérence prouvée par tests : `money.test.ts`, `money-migration.test.ts`,
`money-document-consistency.test.ts`, `tva.test.ts`).

## 4. Classification des champs (ne PAS tout convertir pareil)

| Modèle.champ | Nature | Traitement |
|---|---|---|
| `WorkOrder.totalHT` / `totalTTC` | **total monétaire** (somme arrondie) | **→ `totalHtCents` / `totalTtcCents` (Int)** — fait |
| `PurchaseOrder.totalHT` | **total monétaire** | **→ `totalHtCents` (Int)** — fait |
| `LoanerReservation.depositAmount` | **somme** (caution) | **→ `depositAmountCents` (Int)** — fait |
| `*.unitPrice`, `*.unitCost`, `LaborOperation.unitPrice`, `Garage.hourlyRate`, `LoanerReservation.dailyRate` | **prix/coût unitaire** (sous-centime possible) | **stagé** (sous-unités entières ×10 000) — cf. §7 |
| `*.quantity` (Quote/Invoice line, Part) | **quantité** (fractionnable) | **non monétaire** — reste numérique (stagé en sous-unités si besoin) |
| `*.taxRate` (Garage/Quote/Invoice/WorkOrder) | **taux (%)** | **non monétaire** — reste numérique |

## 5. Migration de stockage exécutée (additive, non destructive)

Suit le recette additive sûre : **ajouter → convertir → vérifier → basculer → (plus
tard) retirer**.

1. **Colonnes ajoutées** (nullable, `Int`) dans **les deux schémas** :
   `prisma/schema.prisma` (SQLite/desktop) **et** `prisma/server/schema.prisma`
   (PostgreSQL). `prisma validate` + `generate` : **OK**.
2. **Application des colonnes** :
   - Desktop (SQLite) : entrées **158–161** du runner versionné `src/lib/migrations.ts`
     (`ALTER TABLE … ADD COLUMN`), appliquées **une fois** au démarrage Electron
     (`/api/internal/migrate`), avant toute interaction — même mécanisme éprouvé
     que les colonnes précédentes.
   - Serveur (PostgreSQL) : migration additive
     `prisma/server/migrations/20260806100000_money_cents/` **+** filet de sécurité
     dans la convergence du reset (`reset-garageflow.ps1`, `ADD COLUMN IF NOT EXISTS`).
3. **Backfill** : `cents = ROUND(float × 100)` (dans la migration Prisma ; idempotent,
   ne touche que les lignes non converties). **N'a pas été exécuté ici** (pas de base
   réelle) — l'opérateur le lance sur staging **avec sauvegarde préalable**.
4. **Écriture** : l'application écrit désormais les **centimes comme source de vérité**
   (`work-orders`, `purchase-orders`, `loaner-reservations`) ; la colonne Float est
   maintenue en **miroir dérivé** (`fromCents(cents)`), donc **aucune lecture,
   signature, PDF ou export existant ne change** (les nombres euros exposés sont
   identiques au centime).
5. **Lecture** : la valeur euro reste dérivable de `cents ?? toCents(float)` — les
   lignes antérieures (cents `NULL`) retombent sans risque sur le Float.
6. **Retrait des colonnes Float** : **stagé** — uniquement **après** vérification sur
   données réelles (étape 3) et bascule des lectures sur les centimes. Voir §6.
7. **Rollback** : les colonnes `*Cents` étant additives et nullables, un retour
   arrière = ignorer/dropper ces colonnes ; les Float restent la source. Aucun
   `DROP`/`TRUNCATE` n'est exécuté par la migration ou le reset.

## 6. Vérification & rollback (SQL opérateur, PostgreSQL)

```sql
-- Vérif : aucune divergence cents ↔ round(float*100) (attendu : 0)
SELECT count(*) FROM "WorkOrder"
 WHERE "totalHtCents"  <> ROUND(("totalHT"::numeric)*100)::int
    OR "totalTtcCents" <> ROUND(("totalTTC"::numeric)*100)::int;
-- Vérif : cohérence HT + TVA = TTC au centime (attendu : 0)
SELECT count(*) FROM "WorkOrder"
 WHERE "totalTtcCents" <> "totalHtCents" + ROUND("totalHtCents" * "taxRate" / 100.0)::int;
-- Vérif : dépassement de capacité Int32 (attendu : 0)
SELECT count(*) FROM "WorkOrder" WHERE abs("totalHtCents") > 2147483647;
-- Vérif : valeurs nulles inattendues après backfill (attendu : 0)
SELECT count(*) FROM "WorkOrder" WHERE "totalHtCents" IS NULL OR "totalTtcCents" IS NULL;

-- Rollback (si besoin) — les Float restent la source de vérité ; on peut simplement
-- ignorer les colonnes cents, ou (base non partagée) :
-- ALTER TABLE "WorkOrder" DROP COLUMN "totalHtCents", DROP COLUMN "totalTtcCents";
```

## 7. Pourquoi les prix unitaires ne sont **pas** encore migrés (stagé, assumé)

- **SQLite (desktop) n'a pas de type décimal** et `@db.Decimal` y est indisponible ;
  les deux schémas doivent rester **compatibles**. Le seul stockage exact possible
  est l'**entier en sous-unités** (ex. ×10 000). C'est une migration de **~30
  fichiers** touchant chaque ligne (create/read/serialize).
- Les prix unitaires figurent dans le **document signé cryptographiquement**
  (`src/lib/signature/document.ts`) : changer leur représentation impose de
  reconvertir en **euro identique** avant canonicalisation pour ne pas invalider les
  signatures historiques — à **valider sur données réelles**.
- `Prisma.Decimal` est **écarté** : il casse la frontière JSON (`Decimal→string`),
  les opérateurs natifs (`×`, `+`, comparaisons) et, sur SQLite, est stocké en REAL
  (aucun gain). ~125 fichiers impactés → régression garantie.

En attendant, la **correctness du calcul** est déjà garantie (tout passe en centimes
via `money.ts`), donc un prix unitaire stocké en Float ne **corrompt aucun calcul**.

## 8. Tests

- `src/lib/__tests__/money.test.ts` — socle centimes, invariant TTC = HT + TVA, arrondis.
- `src/lib/__tests__/money-migration.test.ts` — marge/coût, TVA multi-taux, prix à 4
  décimales, quantité fractionnaire, acompte, paiement partiel, avoir total/partiel,
  montants négatifs, **montant maximal (borne Int32)**, et **équivalence de backfill**
  `toCents(v) === ROUND(v×100)` avec round-trip exact.
- `money-document-consistency.test.ts`, `tva.test.ts`, `business-logic.test.ts` — non-régression.
