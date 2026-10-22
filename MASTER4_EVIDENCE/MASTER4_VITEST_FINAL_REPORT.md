---
doc-numbers: journal
---

# MASTER 4 — Rapport Vitest final

**Date : 22 octobre 2026, exécution complète commencée à 19:01:57 UTC.**  
**Verdict : FAIL — la suite n’est pas verte et les tests ignorés ne sont pas des réussites.**

## 1. Commande et résultat

Commande : `PATH=/tmp/gf-python-venv/bin:$PATH npm run test -- --reporter=json --outputFile=MASTER4_EVIDENCE/vitest-final-results.json` — **code 1**.

| Mesure | Résultat |
|---|---:|
| Fichiers | 365 |
| Fichiers réussis / échoués | 281 / 84 |
| Assertions réussies | 3 517 |
| Assertions échouées | 3 |
| Assertions ignorées/en attente | 869 |
| Durée du journal | environ 338 s |

Preuves : `logs/20-vitest-full-final.txt`, `vitest-final-results.json`. `.env` et `prisma/dev.db` sont inchangés.

## 2. Trois échecs et 84 fichiers

La reproduction ciblée (`logs/03-vitest-three-failures-reproduction.txt`) donne 1 réussi/3 échoués dans `prepare-test-db.test.ts` : création du modèle, réutilisation et remplacement d’une base de test. La cause est l’amorçage Prisma indisponible.

Classification finale des 84 fichiers : **79 Prisma natif, 5 client PostgreSQL généré absent, 0 autre**. Le dernier cas initialement ambigu, `publication-mise-a-jour.test.ts`, a été rejoué seul : sa cause est `Cannot find package '@/generated/server-client'` (`logs/22-publication-failure-root-cause.txt`). Preuves de classement : `logs/23-vitest-and-business-matrix-final.txt`, `vitest-failure-classification.json`.

## 3. Inventaire des 869 skips

| Cause | Nombre |
|---|---:|
| Assertions dans des suites déjà rouges | 834 |
| `TEST_POSTGRES_URL` absent | 23 |
| `TEST_REDIS_URL` absent | 5 |
| Clé privée émettrice indisponible | 4 |
| `GF_TEST_LICENSE` absent | 2 |
| Artefact `dist/win-unpacked` absent | 1 |

Le détail test par test est dans `vitest-skips-inventory.json`. Aucun test n’a été supprimé, converti en skip ou affaibli pour cette mission. Les tests de services réels devront être exécutés après restauration des moteurs et accès isolés ; les tests conditionnés à une clé privée ou une licence de test devront être exécutés sur le poste autorisé, sans copier ces secrets dans les preuves.
