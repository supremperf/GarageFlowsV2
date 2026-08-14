# Module Premium — Planning intelligent

> **MOTEUR NON EXPOSÉ EN HTTP.** La route `/api/scheduling` a été **supprimée le
> 14/08/2026** (GF-DUR-043). Le moteur reste en place : `src/lib/scheduling/`,
> `optimizeSchedule()`, déterministe et couvert par ses tests.
>
> Motif : l'historique complet du dépôt (`git log --all -S`) montre qu'**aucune
> interface n'a jamais appelé cette route**, à aucun moment. À ne pas confondre
> avec les suggestions d'affectation du planning, qui reposent sur
> `runAIEngine()` (`src/lib/ai-engine.ts`) et sont, elles, bien atteintes par
> l'écran via `store/schedule-store.ts`.
>
> Le contrat HTTP décrit plus bas est donc **historique**. Le rétablir demande un
> seul fichier de route ; ce document reste la référence de ce qu'il servirait.

Propose une **affectation optimisée** des interventions de la journée aux
**mécaniciens** et **ponts (élévateurs)**, en respectant compétences,
disponibilités, horaires et urgences — pour **réduire les temps morts** et
**équilibrer les charges**. C'est une **proposition** : l'utilisateur garde le
contrôle final.

## Architecture

```
src/lib/scheduling/
├── types.ts     # SchedMechanic, SchedJob, Assignment, ScheduleResult, metrics
├── optimize.ts  # optimizeSchedule : greedy déterministe à deux ressources
└── index.ts
```

## Algorithme (déterministe)

Chaque intervention nécessite **un mécanicien ET un pont**. Les jobs sont placés
par **priorité** (urgents d'abord, puis priorité, plus tôt possible, plus longs
d'abord) ; chacun est affecté à la paire (mécanicien, pont) offrant le **départ
le plus tôt**, en départageant vers le **mécanicien le moins chargé**
(équilibrage) puis le pont d'indice le plus bas.

Contraintes respectées : **compétences** (un généraliste — sans compétences
déclarées — peut tout faire), **fenêtre de disponibilité** par mécanicien,
**journée de travail**, **absences**, **capacité en ponts**.

Sortie : `assignments` (mécanicien, pont, début/fin), `unscheduled`
(`no_eligible_mechanic` / `no_slot`) et `metrics` (makespan, charge par
mécanicien + taux d'occupation, **écart-type d'équilibrage**).

## API

- `GET /api/scheduling?date=YYYY-MM-DD&bays=2&dayStart=&dayEnd=` → authentifié.
  Charge les interventions non terminées de la date + les mécaniciens actifs,
  propose un planning (avec heures `HH:MM`) et les métriques. `proposal: true` —
  rien n'est écrit en base. Aucun modèle ajouté.

## Tests

`src/lib/scheduling/__tests__/scheduling.test.ts` — 8 tests : sérialisation sur
un pont, parallélisation + équilibrage sur deux ponts, compétences requises,
aucun mécanicien éligible, aucun créneau (job trop long), priorité aux urgents,
exclusion des absents, respect des fenêtres de disponibilité.

## À venir
- Écriture optionnelle du planning proposé (validation utilisateur) ;
- Prise en compte des dépendances (attente pièces via Stock prédictif) et des
  compétences dérivées de la spécialité mécanicien.
