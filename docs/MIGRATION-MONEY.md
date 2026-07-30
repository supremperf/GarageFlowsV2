# Montants financiers — arithmétique en centimes (fin des Float dangereux)

## Le vrai problème : l'ARITHMÉTIQUE, pas seulement le stockage

`0.1 + 0.2 === 0.30000000000000004` en IEEE-754. Le danger des Float monétaires
vient des **calculs** (sommes de lignes, TVA, soldes) qui accumulent ce bruit et
faussent totaux et arrondis. Un stockage Decimal ne corrige rien si l'application
additionne encore des flottants avant d'écrire.

## Ce qui a été fait (correction de la cause racine)

- **Couche monétaire centralisée `src/lib/money.ts`** : TOUT calcul financier se
  fait en **entiers de centimes**. L'addition d'entiers est exacte ; l'arrondi est
  unique et explicite (`toCents`, demi vers le haut, robuste au bruit binaire).
- **`src/lib/billing.ts`** (utilisé par les routes invoices/quotes/stats) délègue
  désormais à `money.ts`. Plus aucune arithmétique flottante directe.
- **Invariant garanti** : `totalTTC = totalHT + TVA` (vérifié en centimes → exact).
- Helpers : remise (%, fixe), solde `= TTC − paiements − avoirs`, format `fr-FR`.

Les valeurs **écrites** en base sont désormais toujours des euros exacts à 2
décimales (dérivés des centimes), donc représentables sans perte en Float.

## Choix de stockage (assumé)

Le stockage reste en `Float` côté schéma Prisma pour ce projet **desktop SQLite** :
SQLite n'a pas de type décimal natif et `Prisma Decimal` y est mal supporté. Comme
tous les montants écrits proviennent maintenant de calculs en centimes (donc des
valeurs à 2 décimales exactes), le risque de dérive à l'écriture est éliminé.

### Migration optionnelle vers des colonnes en centimes (entiers)

Pour une garantie « au niveau du schéma » (recommandée si migration vers Postgres) :
1. Ajouter des colonnes `*_cents INTEGER` en parallèle des colonnes Float.
2. Backfill : `cents = round(montant * 100)` (sauvegarde préalable obligatoire).
3. Basculer lecture/écriture sur les colonnes `_cents` (via `money.ts`).
4. Vérifier `SELECT count(*) WHERE round(montant*100) <> cents` = 0, puis retirer
   les colonnes Float.

Cette étape est **non nécessaire à la correctness** (assurée par la couche de
calcul) ; elle apporte une défense en profondeur au niveau base.

## Tests

`src/lib/__tests__/money.test.ts` : `0,1 + 0,2`, arrondis TVA, quantité décimale,
multi-lignes, remises %/fixe, solde (paiements + avoirs), grands montants, et
l'invariant `TTC = HT + TVA` sur plusieurs cas. Les tests existants
(`tva.test.ts`, `business-logic.test.ts`) passent sans modification (non-régression).
