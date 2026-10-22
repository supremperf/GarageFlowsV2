---
doc-numbers: journal
---

# MASTER 4 — Performance

**Date : 22 octobre 2026 (Europe/Paris).**  
**Verdict : BLOCKED — aucune mesure de production valide.**

| Contrôle | Résultat | Statut | Preuve |
|---|---|---|---|
| Build de référence | `BUILD_ID` absent, build Prisma en échec | BLOCKED | `logs/07-build-typecheck-standalone.txt` |
| Budget réel | `npm run check:perf-budget` après correction : code 1 sur `BUILD_ID`, avant tout scan | FAIL / prérequis absent | `logs/29-performance-direct-guard-correction.txt` |
| Garde directe | 4/4 tests : absent, vide, build valide, seuil toujours appliqué | PASS | même preuve |
| Release-safety | 193/193 | PASS | même preuve |
| Performance runtime | Pas de standalone ni Chromium | NOT RUN | rapports standalone/Playwright |

L’appel direct du 22 octobre avant correction avait affiché 9,96 MiB depuis les assets mutables de développement. **Cette valeur n’est pas une mesure de production et n’est retenue ni comme référence ni comme dépassement.** Le script exige maintenant un `BUILD_ID` non vide avant de mesurer ; les seuils de `perf-budget.json` n’ont pas été modifiés.

L’invocation initiale `perf:budget`, inexistante, est conservée dans `logs/25-performance-budget.txt` comme erreur d’opérateur et non comme contrôle produit. Action restante : produire un build officiel, mesurer ses assets immuables, exécuter les scénarios runtime avec Chromium et comparer les valeurs réelles aux budgets sans les relever pour obtenir un vert.
