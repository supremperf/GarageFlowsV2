<!-- doc-role: canonical-baseline -->
<!-- doc-status: actif -->

# GarageFlows — baseline technique mesurée

Ce document et `artifacts/verification/baseline.json` reflètent la dernière
mesure locale, y compris ses échecs. **Verdict : NO-GO.** Rapport de résolution :
[phase 6](2026-10-17/05-RESOLUTION-BLOCAGES.md) ;
[verdict détaillé](2026-10-17/06-VERDICT-FINAL.md) ;
[diagnostic keygen PHASE 7](2026-10-17/07-DIAGNOSTIC-KEYGEN.md) ;
[mission sécurité 151 — NO-GO](security-151/02-VERDICT-ET-INTEGRATION.md).

## Identité et portée

- Version du projet : 1.1.0 ; Node 22 ; versions résolues dans le bloc machine.
- Branche de travail : `arena/55edbdc1-garageflowsv2`.
- Le commit machine est la **base HEAD** d’un arbre de travail modifié et non
  committé ; ce n’est ni le SHA d’un artefact construit ni une attestation de
  déploiement. La liste de fichiers/hachages PHASE 6 est un snapshot historique dans
  `2026-10-17/phase6/review-inventory.tsv` ; les sources modifiées PHASE 7
  sont recensées séparément dans `2026-10-17/phase7/source-hashes.json`.
- Aucun accès aux données/secrets production, aucune migration ou rotation,
  aucun déploiement effectué. Cause de l’incident : **non vérifiable sans accès
  production**, seuil ≥90 % non établi.

## Toolchain et tests (générés, non recopiés manuellement)

La suite standard ci-dessous inclut des tests empêchés et conditionnels : son
libellé ne signifie pas qu’elle est entièrement verte sans moteurs, services ou
clés d’émetteur. Les fichiers échoués lors des hooks ne se réduisent pas au
nombre d’assertions échouées. Voir la ventilation nominative de la phase 6.

<!-- BEGIN AUTO-GENERATED BASELINE (source: artifacts/verification/baseline.json — `npm run baseline:generate`) -->

### Toolchain (versions RÉSOLUES / verrouillées)

> `Version résolue` = version réellement installée / verrouillée (package-lock).
> `Plage déclarée` = contrainte semver du package.json (jamais présentée comme la version installée).

| Composant | Version résolue | Plage déclarée |
|---|---|---|
| Node | v22.23.2 | — |
| npm | 10.9.8 | — |
| Next.js | 15.5.28 | 15.5.28 |
| React | 18.3.1 | ^18.3.1 |
| React DOM | 18.3.1 | ^18.3.1 |
| TypeScript | 5.9.3 | ^5 |
| Prisma (CLI) | 5.22.0 | ^5.16.1 |
| @prisma/client | 5.22.0 | ^5.16.1 |
| Electron | 44.9.3 | 44.9.3 |
| Vitest | 4.1.12 | 4.1.12 |
| OS | win32 x64 | — |

### Tests (suite standard `npm test`, reproductible sans service externe)

| Champ | Valeur |
|---|---|
| Test files | 365 |
| Tests discovered | 4424 |
| Tests passed | 4390 |
| Tests failed | 0 |
| Tests skipped | 34 |

Commit : `e839b83` · Branche : `master6-integration` · Généré (UTC) : `2026-10-24T06:30:34.745Z`

<!-- END AUTO-GENERATED BASELINE -->

## Revalidation locale et limites

- Lint : `npm run lint` (ESLint src), réussi ; TypeScript : `npm run type-check`, réussi.
- Tests Node et ciblés : résultats/commandes dans `2026-10-17/phase6/validation.json`.
- Cohérence docs/env/migrations/template : contrôles réussis, mais **deux checks
  de clé publique sont SKIP** faute de PEM émetteur, pas des attestations positives.
- Prisma généré sans moteur **uniquement pour typage/mocks**. Génération runtime,
  build Next standard et API avec DB native non validés ; téléchargement Prisma bloqué.
- PostgreSQL/Redis conditionnels non exécutés ici. Aucun résultat réel d’août
  n’est reconduit comme preuve de cette version modifiée.
- Playwright : découverte seulement ; installation Chromium bloquée par réseau.
- Scan Gitleaks officiel non exécuté : téléchargement de l’outil bloqué.
- npm audit ne signale aucune vulnérabilité lors de la passe ; cela ne certifie
  ni les secrets, ni tout le code, ni le paquet Windows, ni la conformité juridique.

## Conditions encore ouvertes (pas seulement externes)

1. Génération native/installation complète, suite globale, services isolés,
   build, budget, E2E et paquet Windows réels.
2. Correspondance des clés émettrices et provenance des artefacts déployés.
3. Implémentation et recette du remplacement administratif nominatif/MFA,
   minimisation/protection des diagnostics et audit durable.
4. Revue sémantique A–K complète ; erreurs de corps JSON des autres routes,
   permissions/tenants, concurrence, sauvegarde/restauration et UX réelles.
5. Licences et notices de l’artefact distribué, notamment bibliothèques LGPL ;
   aucune absence de copyleft n’est revendiquée sur l’arbre courant.
6. Investigation de production corrélée, sans attribution de cause non prouvée.

## Historique

La prose antérieure (mesures et revendications août 2026) est conservée
exactement depuis HEAD dans
[le snapshot public antérieur](2026-10-17/snapshots/baseline-before-phase6.md.txt).
Elle n’est pas une certification de l’état courant. Les règles de comptage et de
cohérence restent actives ; le bloc AUTO est produit par
`scripts/generate-verification-baseline.mjs`, pas édité pour masquer les échecs.
