# Complément CI après publication — résultats négatifs maintenus

**Ce complément prévaut sur toute lecture d’un ancien snapshot « en cours ». Statut : PARTIELLEMENT VALIDÉ — NON PRÊT POUR LA PRODUCTION.**

Observation officielle du 15 octobre 2026, 14:54:48 UTC (16:54:48 Europe/Paris), détails et check IDs dans `ci-post-publication-observation.json` ; l’état ultérieur des jobs de publication doit être consulté dans la PR.

## Révision applicative c1f6a5c

- Deux gates Native base **PASS** : TypeScript/build standards et JS **3 612 476 / 3 625 984 octets**, 237 fichiers.
- Deux scans officiels Gitleaks complets **0**, sur le candidat et le merge de test.
- Deux notices Copilote natives **54 exécutés / 54 PASS**, enfant exit 0.
- **Job complet push PASS**, mais **job complet PR FAIL** à l’étape `Tests (unit + integration)` : le test e-invoicing de rejet simulé 422, `src/lib/einvoicing/__tests__/submit-chain.test.ts:321`, dépasse **5000 ms**. Trace officielle conservée dans le JSON complémentaire.
- Aucun fichier e-invoicing modifié depuis 0d64899. **P30**, reproduction isolée locale, donne **17/17 PASS**, exit 0. Cela ne prouve pas la cause du timeout, ne remplace pas la suite complète et ne rend pas le check PR vert. Aucune durée de test/ assertion/ exigence n’a été changée.
- Packaging Windows candidat **FAIL** à `Run npm run dist` (check 116491291102). Cause non classifiée à partir des annotations accessibles, aucun paquet validé à la place. C’est un blocage supplémentaire, pas une publication applicative.
- Recette authentifiée et validations requises **FAIL** ; gate final **skipped**, pas validé. CodeQL demeure en échec de résultats sécurité bien que le job d’analyse réussisse.

## Publication documentaire bc6d6c2

- Deux nouveaux scans officiels Gitleaks complets **0** : checks 116492482082 (candidat) et 116492520486 (merge de test). Les 959 triages exacts n’ont pas changé.
- Deux audits de dépendances **PASS**.
- Au snapshot, TS/build, suites complètes, CodeQL et responsive sont encore **en cours** ; aucune réussite future n’est déduite de ces états.

## Intégrité et portée

Le rapport initial, son manifeste et P01–P29 ne sont pas réécrits. Le présent complément ajoute P30 et l’observation officielle. Les commandes exactes de collecte sont l’API GitHub `commits/<sha>/check-runs?per_page=100`, puis `check-runs/<id>/annotations?per_page=100` et `actions/jobs/<id>` pour les IDs observés. Aucun corps SARIF brut ni secret n’est publié.

L’échec documentaire P29, les risques CodeQL non acceptés, les API d’alertes 403, l’absence de corpus indépendant et de recette réelle, et l’absence de plafond fournisseur positif restent déclarés. Paiement bloqué ; aucun merge/déploiement. Les PASS locaux ciblés, les 54 PASS natifs et le build ne sont pas transformés en PASS global.
