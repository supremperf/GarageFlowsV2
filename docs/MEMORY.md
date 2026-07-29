# Module Premium — Mémoire intelligente du garage

Chaque intervention **enrichit une base de connaissances**. Le moteur en dérive
des **recommandations explicables** à partir de l'historique — le garage
« apprend » progressivement.

## Architecture

```
src/lib/memory/
├── types.ts    # InterventionRecord, MemoryInsight, MemoryResult
├── analyze.ts  # analyzeMemory : agrège l'historique → insights
└── index.ts
```

Le moteur est **pur** ; l'API transforme l'historique des interventions (Jobs +
pièces + mécanicien) en enregistrements.

## Insights produits

| Type | Détection | Exemple |
|---|---|---|
| `recurring_fault` | même véhicule + même type ≥ 2 fois | « Le véhicule AA-1 est déjà venu 3 fois pour « freins ». » |
| `frequent_vehicle` | ≥ 3 passages | « Le véhicule AA-1 est un habitué (3 passages). » |
| `part_reliability` | même référence reposée sur le même véhicule ≥ 2 fois | « La référence BRK1 a été reposée 2 fois sur AA-1 — fiabilité à surveiller. » |
| `repair_speed` | un mécanicien ≤ 80 % de la moyenne du type | « Pour « vidange », Karim est en moyenne plus rapide (30 min contre 40). » |
| `low_satisfaction` | satisfaction moyenne < 3/5 sur un type | « La satisfaction sur « diag » est faible (2/5). » |

Chaque insight porte **sévérité**, **confiance**, **message**, **référence** et
**métriques** ; triés par sévérité.

## API

- `GET /api/memory?months=12&plate=AB-123-CD` → authentifié. Charge l'historique
  des interventions (avec pièces et mécanicien), le convertit et renvoie
  `{ insights, summary, scope }`. Le filtre `plate` donne une vue par véhicule.
  Aucun modèle ajouté (`satisfaction`/`returned` sont pris en charge par le
  moteur dès qu'ils seront capturés en base).

## Tests

`src/lib/memory/__tests__/memory.test.ts` — 7 tests : panne récurrente, véhicule
habitué, pièce reposée, méthode plus rapide (moyennes exactes), satisfaction
faible, résumé + tri par sévérité, aucun insight pour une visite isolée.

## Copilot & vision
Ces insights alimentent l'**Assistant proactif** et le **Copilot** (« ce véhicule
est déjà venu… », « cette référence est peu fiable… »). À venir : capture de la
satisfaction et des retours en base pour activer les insights correspondants, et
recommandations de méthode par type de réparation.
