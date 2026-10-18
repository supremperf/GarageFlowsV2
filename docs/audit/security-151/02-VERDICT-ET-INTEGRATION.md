<!-- doc-numbers: journal -->
# Sécurité GarageFlows — verdict et intégration

## **NO-GO — mission non terminée**

Le candidat affiche zéro vulnérabilité **npm** sur l’arbre verrouillé complet et contient les versions corrigées des critiques retrouvées sur main. **La branche par défaut n’a pas été modifiée et les 151 IDs GitHub n’ont pas pu être énumérés (REST403).** Le zéro npm, les plages de versions et le zéro GraphQL contradictoire ne constituent pas une preuve de disparition des alertes GitHub.

Les corrections et tests de ce lot sont décrits dans [le journal](01-JOURNAL-ET-VALIDATION.md). L’[inventaire préalable](00-INVENTAIRE-AVANT-CORRECTION.md), les [50 paquets et leurs chemins](package-inventory.json), les [163 avis GHSA](public-advisories.json) et les [174 relations paquet/avis](advisory-inventory.tsv) sont conservés. Ces nombres ne sont pas substitués aux 151 alertes GitHub.

## Contrôle final demandé — état actuellement prouvé

| Contrôle | Attendu | État prouvé / limite |
|---|---|---|
| Critiques | 0 | **0 npm candidat**, versions Next15.5.27/tar7.5.22 contrôlées ; **2 agrégats npm critiques sur main**, dont 3 avis critiques. IDs GitHub non vérifiés. |
| Élevées | 0 | **0 npm candidat**, **34 agrégats npm sur main** ; revue du fork local et du source ne relève pas du seul scanner de noms/versions. |
| Modérées | 0 | **0 npm candidat**, **13 agrégats npm sur main**. |
| Faibles | 0 | **0 npm candidat**, **1 agrégat npm sur main**. |
| `npm audit` complet | 0 | **0 vérifié** avec npm11.16.0 ; prod/dev/optional/peer inclus. Pas de suppression de dépendance essentielle, `--force` ou exclusion de gravité. |
| Lock / compatibilité | Compatibles | `npm ci --ignore-scripts` et `npm ls --all` réussis, lock inchangé ; installation normale **échouée** sur téléchargement Electron. Compatibilité native/distribution non entièrement validée. |
| TypeScript / ESLint | Aucune erreur bloquante | **Exit0 / exit0** localement avec clients générés sans moteur pour typage/mocks. |
| Compilation standard | Réussie | **Non validée localement** : build échoué au téléchargement du moteur Prisma, avant Next. Le build réussi d’un précédent commit ne certifie pas le nouveau. |
| Tests | Tous réussis | **380/380 Node** ; ciblé **30/30**, dont 15 tests catalogue ; audit/critique **13/13**. Globale **3368 réussis / 4222, 3 échecs TLS préparation DB, 851 pending, 79 fichiers empêchés**. Nouvelles fixtures natives à confirmer en CI. |
| Sécurité du code | Audit effectué et corrections complètes | **Partiel**, S01/S02 corrigés et protections existantes maintenues ; confidentialité des coûts, admin/MFA/diagnostics et revue sémantique complète encore ouverts. |
| Fonctions essentielles | Préservées | Aucun écran/fonction supprimé ; comportements nominaux du catalogue testés. Recettes DB native, authentification navigateur, Windows et scénario complet requises pour affirmer absence de régression. |
| GitHub Security Alerts sur main | 0 après intégration | **Non vérifiable / non atteint** : REST403, main reste sur e3ac5f5 ; pas d’intégration rouge forcée. |

## Pourquoi les alertes n’ont pas disparu avec les travaux précédents

**Constat prouvé :** les manifestes/locks de main ne sont pas ceux du candidat. Main verrouille notamment Next14.2.35, Electron31.7.7, electron-builder24.13.3 et tar6.2.1 ; la branche de session dispose de Next15.5.27, Electron41.10.6, builder26.15.3 et tar7.5.22. Les audits séparés confirment main50 paquets affectés / candidat0 npm. Cela explique qu’une correction sur une autre branche ne mette pas à jour le lock audité de main.

**Non prouvé :** correspondance exacte entre chaque ID GitHub initial et chaque relation GHSA, nombre d’alertes actuelles par gravité via l’API sécurisée, éventuel délai de rescannage. Ne pas attribuer tous les écarts au seul cache GitHub ou déclarer les alertes « obsolètes ». Le code Actions, Python, les binaires natifs et le fork ne sont pas entièrement audités par npm.

## Procédure de reprise et de clôture réelle

1. **Accès alertes** : réautoriser la connexion GitHub Arena avec lecture Dependabot, ou faire exécuter par l’opérateur autorisé :

   ```sh
   gh api --paginate 'repos/supremperf/GarageFlowsV2/dependabot/alerts?state=open&per_page=100' --jq '.[]' > dependabot-open.json-stream
   ```

   Le flux contient les fiches, pas des identifiants de connexion. Ne fournir aucun PAT/cookie/mot de passe. Classer les IDs et comparer GHSA/manifest/scope/plages au présent inventaire ; garder les nouveaux avis apparus depuis la mesure. L’échec HTTP403 est un blocage, pas zéro alerte.
2. **CI exacte du candidat** : pousser uniquement la branche de session et préparer une PR brouillon vers main. Lire les jobs et annotations du **nouveau SHA**. Corriger tout échec fonctionnel réellement accessible ; ne pas déclarer les tests natifs verts à partir de types/mocks. Les cas PostgreSQL/Redis, Windows et E2E authentifiés restent obligatoires. Les éléments de la CI précédente sont conservés séparément.
3. **Environnement** : rétablir téléchargements HTTPS officiels des moteurs Prisma/Electron/Chromium ou un cache attesté, sans désactiver TLS/checksums. Exécuter `npm ci`, génération native des deux clients, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, packaging et recettes. Voir également la procédure technique [Prisma/build](../2026-10-17/phase6/02-BUILD-ET-REPRISE.md).
4. **Source/autorisation** : terminer O01 (coût serveur, projections par rôle et snapshots monétaires) et O02 (identité humaine/MFA, audit durable et nouveau protocole diagnostic compatible), puis toutes les frontières tenant/CSRF/SSRF/IA. Aucun contournement d’accès ni réparation de données production implicite. L’[inventaire de revue antérieur](../2026-10-17/phase6/review-inventory.tsv) est un point de départ historique, pas un certificat du code actuel.
5. **Fork maintenu localement** : conserver l’audit source de `vendor/braces-bounded`, les bornes et tests 4653 vecteurs ; GHSA-vfj7-8cjw-p6xm n’a pas de version upstream corrigée au relevé. Surveiller les nouveaux avis upstream, que le nom privé ne fera pas automatiquement remonter. Son renommage seul ne justifierait jamais une clôture. Mainteneur/revue indépendante et suivi nécessaires.
6. **Intégration** : revue de l’ensemble du diff préexistant (plus de deux mille fichiers, pas seulement ce lot), contrôles obligatoires réellement verts et approbation humaine. **Ne pas fusionner** tant que tests/revue sont rouges ou qu’un déploiement automatique production n’est pas explicitement approuvé. Aucun push direct sur main et aucune migration/rotation dans cet audit.
7. **Après intégration autorisée**, confirmer SHA de main et lock réellement analysé, laisser terminer les scans GitHub, récupérer de nouveau toutes les pages REST. Pour chaque ID initial : fixé / encore ouvert / nouvel avis, preuve de version et cause. Exiger zéro pour **toutes** les gravités ; si une alerte subsiste, la diagnostiquer, pas la dismiss/supprimer pour obtenir du vert.
8. Réémettre le verdict final uniquement avec build/runtime/recettes et liste des alertes effectivement closes. Aucun GO fondé seulement sur `npm audit`.

Le présent lot ne désactive ni Dependabot, ni Security Alerts, ni les contrôles obligatoires et ne publie aucun secret. **Aucune mutation/déploiement production effectué.**
