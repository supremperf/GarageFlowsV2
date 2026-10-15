<!-- doc-numbers: journal -->

# Publication et CI observée — 14 octobre 2026

**VALIDATION PARTIELLE — NON PRÊT POUR LA PRODUCTION.** Addendum postpublication : il complète, sans effacer, les observations prépublication du rapport.

## GitHub

Branche `arena/c9eaae15-garageflowsv2` publiée au commit **`c53d8e5e933221dc790ca7c0758ece95a7eab053`** ; SHA distant vérifié à 14:40:06 UTC (16:40:06 Paris), exit 0. Le premier push avait été rejeté, sans force push. Les huit commits de configuration distants ont été intégrés dans l’historique de cette même branche. Un unique conflit de ponctuation/ajout des scripts dans package.json a été résolu : tous les changements distants étaient déjà inclus dans les fichiers locaux ; l’arbre résultant est exactement celui d’ef8e88f (`4c597e7991e940d59f5f25194f09a422c86e966b`). **Aucun merge de PR/main, déploiement, tag/release ni modification des protections.**

100 journaux immuables, auparavant ignorés par la règle générique *.log, ont été ajoutés explicitement après précontrôle borné. Aucune preuve originale n’a été normalisée. PUBLICATION-INDEX.json vérifie que les chemins des manifestes sont bien dans l’index ; ce n’est pas une validation fonctionnelle ni une assurance de confidentialité exhaustive.

## CI réelle, pas une prédiction

[Run 38581782030](https://github.com/supremperf/GarageFlowsV2/actions/runs/38581782030), commit c53d8e5 : créé **14:34:52 UTC**, terminé/actualisé **14:38:02 UTC**, état completed, conclusion **failure**.

| Job | Conclusion observée |
|---|---|
| Full dependency tree — zero vulnerabilities | success |
| Type-check, Lint & Test (desktop SQLite + serveur PostgreSQL) | success |
| E2E (Playwright — responsive, auto-démarrage) | success |
| Secret scan (Gitleaks) | **failure** à « Gitleaks — scan working tree » |
| Required validation | **failure** |
| Authenticated browser validation (approved staging only) | skipped |
| Windows candidate packaging and inspection (not publication) | skipped |
| Final release gate (full) | skipped |

L’installation du scanner et les vérifications d’intégrité figurent comme étapes réussies dans la réponse GitHub. Le scan s’est terminé avec exit 1 ; les annotations accessibles ne donnent que ce code, pas les règles/fichiers signalés. **Cela ne suffit ni à compter/confirmer des secrets ni à classer l’échec en faux positif.** Le journal détaillé `gh run view 38581782030 --log-failed` échoue lors de sa récupération sur results-receiver.actions.githubusercontent.com (EOF), pas sur l’API de métadonnées GitHub. L’URL temporaire signée de cette erreur n’est pas publiée. Fournir le journal expurgé des règles/chemins/lignes depuis l’interface GitHub, ou autoriser l’accès à la chaîne officielle de téléchargement, puis traiter chaque finding sans exclusion globale ni désactivation du gate.

Les trois jobs verts sont des **conclusions de jobs**, non un inventaire de cas. Faute de journaux/artefacts détaillés récupérés, aucun nouveau total de tests, taux de skips ou mesure de budget n’est inventé. Ils ne réécrivent pas les résultats locaux 3829 / 2982 pass / 3 fail / 844 skips / 4 erreurs globales. Les E2E responsives ne sont pas la recette authentifiée, qui est skipped ; aucun candidat Windows ni gate complet validé.

Preuves : `evidence/github-ci-published.json`, `evidence/gh-published-ci.log`, `evidence/gh-gitleaks-annotations.log`, commandes horodatées dans commands.jsonl. Les annotations mentionnent aussi Node 20 forcé vers Node 24 pour checkout et la prochaine migration ubuntu-latest vers Ubuntu 26 : risques de reproductibilité runner à suivre, sans extrapoler un défaut produit.

## Nouveau périmètre de risque — FUP-20261014-026

Le serveur GitHub avertit au push : **151 vulnérabilités sur main** (2 critical, 63 high, 71 moderate, 15 low). Ce n’est pas le lockfile testé ici et cela ne contredit pas automatiquement l’audit npm de cette branche à zéro ; **cela ne prouve pas non plus que main est corrigée**. Les détails Dependabot sont refusés par l’API : HTTP 403 Resource not accessible by integration, exit 1, preuve gh-dependabot-access.log. Le compteur est une observation serveur, non 151 vulnérabilités analysées manuellement. Aucun impact/exploit ou composant affecté n’est supposé.

Intervention minimale : accès lecture Dependabot alerts, ou inventaire expurgé fourni par l’administrateur ; comparer les manifestes/alertes et préparer les corrections revues. Une intégration dans main nécessitera une autorisation distincte. Ne pas clôturer 026 en héritant de l’audit npm vert de cette branche.

## Statut courant

La matrice contient désormais **26 IDs uniques**. 009 devient ÉCHOUÉ pour le scan distant ; 008 reste PARTIELLEMENT VALIDÉ : le gate a réellement refusé cet échec, mais les protections obligatoires restent non attestées. 001/002/003/017 ont une observation distante supplémentaire bornée (métadonnées des jobs réussis), pas une clôture des cas et artefacts manquants. 026 reste BLOQUÉ. Revue manuelle et SAST toujours inachevés ; offline grace 025 toujours ouverte. Budget inchangé et production interdite tant que les critères obligatoires restent ouverts.

Cet addendum sera publié dans un commit documentaire ultérieur : le run ci-dessus concerne précisément c53d8e5. La CI déclenchée par ce commit documentaire doit être observée séparément, jamais déclarée verte par héritage.
