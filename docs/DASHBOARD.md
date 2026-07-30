# Module Premium — Tableau de bord décisionnel

Consolide les moteurs existants (rentabilité, stock prédictif, devis, CA) en un
**tableau de bord d'aide à la décision** : **KPIs** avec tendance et statut, un
**score de santé** composite, et des **alertes priorisées**. Le moteur est
**déterministe** ; l'API l'alimente avec des données réelles.

## Architecture

```
src/lib/dashboard/
├── types.ts   # Kpi, KpiInput, DashboardInsight, DecisionDashboard
├── build.ts   # buildDashboard, computeKpi, kpiStatus, deltaPct
└── index.ts
```

## KPIs

Chaque KPI porte : **valeur**, **unité**, valeur **précédente**, **tendance**
(`up`/`down`/`flat`, direction neutre du changement), **delta %** (null si non
calculable) et **statut** (`good`/`warning`/`critical`/`neutral`).

Le statut dépend de la **direction** :

- `higher_better` (CA, marge) : `value ≤ critAt → critique`, `value ≤ warnAt →
  alerte`, sinon `bon`.
- `lower_better` (ruptures, devis en attente) : `value ≥ critAt → critique`,
  `value ≥ warnAt → alerte`, sinon `bon`.
- Aucun seuil ⇒ `neutral` (KPI purement informatif).

## Score de santé

`healthScore` part de 100 et est **pénalisé** : KPI critique −20, alerte −8 ;
insight critique −15, haut −8, moyen −3, bas −1. Borné à `[0, 100]`. Libellé :
≥80 « Excellent », ≥60 « Bon », ≥40 « À surveiller », sinon « Critique ». Les
insights sont **triés du plus grave au moins grave**.

## API — `GET /api/dashboard` (lecture seule)

Authentifié, cloisonné par `garageId`. Assemble en une requête :

| KPI | Source | Seuils |
|---|---|---|
| CA HT (mois) | factures payées, mois courant vs précédent | tendance |
| Marge (30 j) | moteur **Rentabilité** | alerte < 20 %, critique < 10 % |
| Pièces à réapprovisionner | moteur **Stock prédictif** | alerte ≥ 3, critique ≥ 8 |
| Devis en attente | devis `sent` | alerte ≥ 10, critique ≥ 25 |

**Insights** : anomalies de rentabilité (top 5), rupture imminente (urgence
`critical` du stock), devis sans réponse > 30 j. Chaque insight porte
**sévérité**, **source** et **métriques**.

## Tests

`src/lib/dashboard/__tests__/dashboard.test.ts` — 12 tests : `deltaPct`
(garde zéro/absent), `kpiStatus` (seuils haut/bas, bornes inclusives, neutre),
`computeKpi` (tendance/delta), et `buildDashboard` (statuts, tri des insights,
pénalités du score, résumé, bornes `[0,100]`, tableau vide sain).

## Intégrations & vision

Compose **Rentabilité**, **Stock prédictif**, **Prévisions** et les devis — tous
déjà testés. Alimente l'**Assistant proactif** et le **Copilot** (« quelle est la
santé de l'atelier ? »). À venir : KPIs paramétrables par garage, objectifs
personnalisés, et projection du CA via le module **Prévisions**.
