# Modèle d'abonnement SaaS — guide (état réel)

_Décrit le mécanisme **réellement implémenté et testé** (`src/lib/billing/*`,
modèle `Subscription`, `GET /api/subscription`)._

## Principe
GarageFlow **ne prend aucun paiement**. Un **facturier externe** (Stripe ou
équivalent) gère les paiements et pousse l'état de l'abonnement ; GarageFlow le
**persiste** et prend les **décisions d'accès CÔTÉ SERVEUR**. La décision ne fait
jamais confiance à un statut figé : elle **recalcule le statut effectif** à
partir des échéances (fin d'essai, fin de période, fin de grâce).

## États
`trial` → `active` → `grace` → `suspended` / `cancelled`.
- **trial** : essai en cours (accès autorisé jusqu'à `trialEndsAt`).
- **active** : abonnement payé (accès jusqu'à `currentPeriodEnd`).
- **grace** : période échue mais fenêtre de grâce ouverte (accès maintenu jusqu'à
  `graceEndsAt`) — laisse le temps de régulariser un paiement.
- **suspended** : essai/période/grâce échus, ou pause facturier → **accès refusé**.
- **cancelled** : résilié → **accès refusé**.

Transitions automatiques (sans mise à jour externe) : `trial` échu → `suspended` ;
`active` échu → `grace` si fenêtre, sinon `suspended` ; `grace` échue → `suspended`.

## Modèle de données
Table `Subscription` (schémas desktop **et** serveur, une ligne par garage) :
`status, plan, externalCustomerId, externalSubscriptionId, seats, trialEndsAt,
currentPeriodEnd, graceEndsAt, cancelAt, canceledAt`. Migrations desktop
135-137 ; migration serveur `20260801010000_accounts_and_subscription`.

## Décision d'accès (serveur)
- `decideAccess(state, now)` (pur) → `{ allowed, effectiveStatus, reason }`.
- `getAccess(garageId)` (service) lit la base et décide, scopé garageId.
- `statusFromExternal(x)` traduit le statut du facturier ; tout statut inconnu
  est mappé **prudemment sur `suspended`** (fail-closed).
- `GET /api/subscription` (authentifié) renvoie la décision du garage courant
  (aucun identifiant externe sensible renvoyé).

## Tests
- `src/lib/billing/__tests__/subscription.test.ts` : matrice états × échéances,
  fail-closed du mapping externe.
- `src/integration/subscription.test.ts` : upsert depuis un état externe, accès
  reflétant l'état stocké, idempotence sur garageId, isolation par garage.

## Réserves (honnêteté)
- **Paiement réel / webhooks facturier** : l'**intégration au facturier externe**
  (clés API, endpoint webhook signé, réconciliation) est **BLOQUÉE_EXTERNE** —
  elle dépend d'un compte marchand réel. Le modèle + les décisions sont prêts ;
  `upsertFromExternal` est le point d'entrée à câbler derrière un webhook signé.
- **Enforcement applicatif** : `getAccess` peut **fermer l'accès**, mais la mise
  en application globale (bloquer l'app quand `allowed === false`) est un choix
  produit **délibérément non activé** ici pour ne pas perturber les pilotes ;
  l'endpoint et le service sont disponibles pour le câbler.
