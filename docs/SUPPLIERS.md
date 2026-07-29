# Module Premium — Commande automatique fournisseurs

Transforme les besoins en pièces (ruptures de stock, liste explicite) en
**commandes groupées par fournisseur**, après **comparaison automatique** des
offres (prix / délai / disponibilité + favoris). Chaque commande suit un
**cycle de vie contrôlé**, et chaque action impactante est **confirmée** avant
d'écrire.

## Architecture

```
src/lib/suppliers/
├── types.ts       # PartQuery, SupplierOffer, LineComparison, Order, OrderStatus, SupplierConnector
├── connectors.ts  # SupplierConnector (interface) + StaticConnector / FallbackConnector (offline)
├── compare.ts     # rankLine, buildGroupedOrders, buildOrderPlan (déterministe)
├── order.ts       # machine à états du cycle de vie + effets (stock, horodatage)
├── engine.ts      # SupplierEngine : connecteurs → comparaison → commandes
└── index.ts
```

Le cœur est **pur et déterministe** : les connecteurs renvoient des offres, le
comparateur les classe, les commandes sont regroupées par fournisseur. Les
**vraies intégrations fournisseurs** (API type TecDoc, EDI, catalogues) se
branchent derrière l'interface `SupplierConnector` sans toucher au moteur.

## Comparaison — priorité de classement

Pour chaque pièce demandée, les offres sont classées par :

1. **Couverture** — une offre qui couvre toute la quantité passe avant une offre
   partielle moins chère.
2. **Prix effectif** — avec une **bande de tolérance** (5 % par défaut) dans
   laquelle un **fournisseur favori** l'emporte même s'il est légèrement plus
   cher.
3. **Délai de livraison** le plus court.
4. Favori, puis nom du fournisseur (départage stable → sortie déterministe).

Chaque décision est **explicable** (`OfferRanking.reason`). Les lignes que
personne ne peut fournir sont isolées dans `unfulfillable`.

## Connecteurs

| Connecteur | Rôle |
|---|---|
| `StaticConnector` | Catalogue en mémoire ; correspondance par référence exacte (insensible aux accents) puis par nom. Déterministe. |
| `FallbackConnector` | Renvoie une offre unique « sur commande » — filet de sécurité / tests. |
| *(votre intégration)* | Implémentez `quote(queries): Promise<SupplierOffer[]>` — API, EDI, e‑mail catalogue. Ne jamais lever pour un simple « pièce non trouvée ». |

Le `SupplierEngine` interroge **tous** les connecteurs en parallèle
(`Promise.allSettled`) : un connecteur qui échoue (panne réseau, identifiants)
est **isolé** — son erreur est remontée dans `errors` et le calcul continue.

## Cycle de vie de commande

```
draft ─▶ sent ─▶ confirmed ─▶ received ─▶ returned
  │        │          │
  └────────┴──────────┴─▶ cancelled
```

`transition(from, to)` valide la transition et décrit ses **effets** sans muter :
`incrementStock` (réception), `decrementStock` (retour), `stampSent`,
`stampReceived`. `cancelled` et `returned` sont **terminaux**.

## API — `POST` / `GET /api/suppliers`

Authentifié, cloisonné par `garageId`, limité en débit (30 req/min sur POST).

- **`GET /api/suppliers?targetMultiplier=2`** — *lecture seule*. Construit le plan
  de réapprovisionnement : pièces **à/sous le seuil** (`quantity ≤ minQuantity`),
  quantité recommandée pour remonter à `minQuantity × targetMultiplier`, sourcées
  via un `StaticConnector` par **fournisseur habituel** (déduit de
  `Part.supplierName` / `supplierRef` / `unitCost`). Renvoie
  `{ comparisons, orders, unfulfillable, summary, errors }`.

- **`POST` `{ action: 'create-orders', confirm, parts?, targetMultiplier? }`** —
  crée un **brouillon de commande par fournisseur**. Sans `confirm: true`,
  renvoie `{ confirmationRequired: true, preview }` **sans rien écrire**. Avec
  `confirm: true`, persiste chaque commande en `PurchaseOrder` (numéro via
  compteur transactionnel, lignes au format de l'écran d'achats existant) →
  réceptionnables via l'endpoint `purchase-orders/[id]/receive` déjà en place.

- **`POST` `{ action: 'transition', orderId, to, confirm }`** — avance une
  commande dans son cycle de vie. Sans `confirm`, renvoie l'aperçu des effets.
  Avec `confirm`, applique la transition **atomiquement** : le changement de
  statut sert de garde de concurrence (pas de double comptage), et le stock est
  ajusté à la **réception** (+) ou au **retour** (−).

Aucune écriture n'a lieu sans confirmation explicite (`confirm: true`).

## Tests

`src/lib/suppliers/__tests__/suppliers.test.ts` — 17 tests : correspondance
catalogue (référence / nom accent‑insensible, hors stock ignoré), classement
(favori dans la bande, prix hors bande, couverture vs partiel, rupture),
regroupement + plafonnement à la disponibilité, résilience (connecteur en
panne isolé, fallback, requêtes invalides ignorées) et machine à états
(chemin nominal, transitions interdites/no‑op, états terminaux, effets stock).

## Choix produit & suite

Faute de catalogue fournisseur multi‑sources en base, `GET` s'appuie sur le
**fournisseur connu par pièce** — ce qui donne déjà de vrais regroupements par
fournisseur, exploitables. La **comparaison multi‑fournisseurs** s'active dès
qu'on enregistre plusieurs connecteurs (API réelles, favoris par garage). À
venir : modèle `Supplier` (favoris, délais, e‑mail), connecteurs API réels
derrière l'interface, et envoi automatique du bon de commande par e‑mail via le
module **Notifications**.
