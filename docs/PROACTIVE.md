# Module Premium — Assistant proactif (capstone)

> **MOTEUR NON EXPOSÉ EN HTTP.** La route `/api/proactive` a été **supprimée le
> 14/08/2026** (GF-DUR-043). Le moteur reste en place : `src/lib/proactive/`,
> `buildAlerts()`, déterministe et couvert par ses tests.
>
> Motif : l'historique complet du dépôt (`git log --all -S`) montre qu'**aucune
> interface n'a jamais appelé cette route**, à aucun moment.
>
> Attention à ne pas surinterpréter la suppression : `planReorders()`
> (`src/lib/stock-forecast/`), que ce module composait, reste bien atteint par
> `/api/dashboard`. Seule la composition en alertes priorisées n'est plus servie
> en HTTP.
>
> Le contrat HTTP décrit plus bas est donc **historique**. Le rétablir demande un
> seul fichier de route ; ce document reste la référence de ce qu'il servirait.

Le copilote ne se contente pas de répondre : il **anticipe**. Ce module **compose
les autres moteurs** en une liste d'**alertes priorisées et actionnables**,
affichées sans qu'on ait à les demander.

## Architecture

```
src/lib/proactive/
├── types.ts    # ProactiveAlert, AlertType, signaux d'entrée
├── engine.ts   # buildAlerts : compose les signaux → alertes triées
└── index.ts
```

Le moteur est **pur** : l'API rassemble les signaux (depuis Prisma et les autres
moteurs) et les lui passe.

## Signaux composés

| Type | Source | Exemple de message |
|---|---|---|
| `stock_out_soon` | **Stock prédictif** (#7) | « Le stock « Huile 5W30 » sera probablement épuisé dans ~4 jour(s). » |
| `quote_pending` | Devis `sent` | « Le devis DEV-2041 (Dubois) attend une réponse depuis 6 jour(s). » |
| `mechanic_overload` | charge de **demain** vs journée | « Karim sera surchargé le 2026-08-01 (140% de charge). » |
| `invoice_overdue` | factures impayées | « La facture FAC-1287 est impayée depuis 40 jour(s). » |
| `ct_expiring` | véhicules (contrôle technique) | « Le contrôle technique de AB-123-CD expire dans 10 jour(s). » |
| `vip_recall` | agrégat clients (CA + inactivité) | « Le client VIP « TransLog » n'est pas venu depuis 200 jour(s). » |

Chaque alerte porte une **sévérité** (critical/high/medium/low), un **message**,
une **action suggérée** (Commander / Relancer / Rééquilibrer…) et le **montant en
jeu** si pertinent. Tri par sévérité puis montant.

## API

- `GET /api/proactive` → authentifié. Rassemble les signaux (stock via
  `planReorders`, devis en attente, surcharge de demain, impayés, CT, VIP depuis
  l'agrégat factures) et renvoie `{ alerts, summary }`. Chaque bloc est en
  best-effort (une source en échec n'empêche pas les autres). Aucun modèle ajouté.

## Tests

`src/lib/proactive/__tests__/proactive.test.ts` — 6 tests : alerte stock
critique + filtrage du non-urgent, seuil d'âge des devis, surcharge (≥100 % /
critique ≥130 %), impayés/CT par ancienneté, rappel VIP (CA + inactivité), tri
par sévérité puis montant.

## Vision
C'est le **cerveau** de GarageFlow qui se dessine : les moteurs analytiques
(#5–#12) alimentent un assistant qui pousse spontanément rappels, risques,
anomalies et opportunités — prochaine étape : le copilote conversationnel qui
exécute les actions proposées après validation.
