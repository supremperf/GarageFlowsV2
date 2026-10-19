<!-- doc-numbers: journal -->

# PHASE 6 — verdict final de cette vérification

Date : **17 octobre 2026**. Mesure globale finale **PHASE 6** : **19:56:14–19:57:23 UTC** (21:56–21:57 Europe/Paris). Branche `arena/55edbdc1-garageflowsv2`, base Git `aa90f89c059db58a4a3fe3c339a2dffbfbf10fad`, **arbre de travail modifié**, pas un artefact construit ou déployé.

# Verdict : **NO-GO**

Les six blocages ont été traités dans l'ordre et documentés, mais **ne sont pas tous résolus**. Le code n'est pas déclaré prêt avec de seules actions externes restantes : l'implémentation administrative renforcée, la minimisation/protection des diagnostics et la revue sémantique complète A–K restent notamment ouvertes **localement**. Un GO CONDITIONNEL ne serait donc pas justifié.

Aucun déploiement, rotation de secret, migration ni changement de données de production effectué. Aucun accès DB de production utilisé. **Cause de l'incident : non vérifiable sans accès production.** Le seuil de preuve ≥90 % de la phase 0.5 n'est pas atteint ; aucun taux de certitude n'est inventé.

## Mise à jour PHASE 7 — cas keygen rejeté

Voir [07 — diagnostic et procédure immédiate](07-DIAGNOSTIC-KEYGEN.md), [runbook opérateur](../../KEYGEN.md) et [mesures PHASE 7](phase7/validation.json). Le chemin Python avec paire cohérente passe les vrais vérificateurs ; le GUI contrôle maintenant la paire et les ancres locales avant signature. Le serveur distingue les étapes dans des logs neutralisés, pas dans la réponse de production.

**Blocage 4 reste PARTIEL pour l’instance réelle.** Aucun jeton refusé, reçu de clés publiques ou digest de cible n’a été fourni ici. Une différence de clés n’est donc pas démontrée : une altération du token ou une divergence du build peut donner le même message. Le défaut de prévention local est corrigé, mais n’est pas présenté comme la cause prouvée de cet incident. Il serait faux de passer à RÉSOLU ou BLOQUÉ-CONFIGURATION-DOCUMENTÉ sans cette preuve. Fournir les reçus non secrets du runbook permettra de qualifier exactement le cas, sans transmettre de clé privée.

Les compteurs ci-dessous restent le relevé daté PHASE 6 ; la baseline canonique et les mesures PHASE 7 portent la revalidation ultérieure. **NO-GO global inchangé** : les autres blocages ne sont pas levés.

## 1. Tableau des six blocages

| N° | Blocage | Statut | Preuves et limite restante |
|---|---|---|---|
| 1 | Suite globale, trois assertions, 79 fichiers, pending | **BLOQUÉ-EXTERNE-DOCUMENTÉ** | Globale finale : **4 194 tests, 3 343 réussis, 3 échoués, 848 pending**, 345 fichiers dont 79 en échec/empêchés d'aboutir. Mêmes 79 fichiers que le diagnostic initial : 78 avec erreur de récupération du moteur, 1 avec client `--no-engine` exigeant `prisma://`. **0/79 réparé** en exécution native. Les messages complets/stacks des trois assertions et des hooks sont conservés ; aucune innocence du code métier n'en est déduite. Un skip illégitime `alg: none` a été retiré et le test passe sans clé privée. [Détail initial nominatif](phase6/01-TESTS-ET-TRACES.md), [traces finales](phase6/vitest-final-failures.json), [matrice finale par fichier](phase6/vitest-final-files.json). |
| 2 | Build et alternatives Prisma | **BLOQUÉ-EXTERNE-DOCUMENTÉ** | `npm run build` exit 1 pendant `prisma generate`, **avant Next** ; déconnexion avant TLS vers `binaries.prisma.sh`. Vendor/cache/historique/mirrors/overrides/clients/artefacts CI examinés ; téléchargement d'artefact CI échoué. Data Proxy/Accelerate/adapters étudiés sur le runtime officiel 5.22.0, pas imposés comme contournement. Le build après restauration des moteurs reste inconnu. [Erreur complète](phase6/build.log), [étude et commandes de reprise](phase6/02-BUILD-ET-REPRISE.md). |
| 3 | 28 incohérences d'environnement | **RÉSOLU** | Inventaire unitaire et corrections par lots **28 → 24 → 0**, avec exemples/docs/manifest/garde. Contrôle final exit 0 : 126 variables canoniques, 8 alias interdits, 48 variables plateforme. Ce résultat porte sur le contrat du dépôt, **pas** sur les valeurs effectivement déployées. [Journal, blocage 3](05-RESOLUTION-BLOCAGES.md), [contrôle final](phase6/env-final.log). |
| 4 | Correspondance émetteur / vérificateurs | **PARTIEL** | Cartographie GF_PRIVATE_KEY/fichier Python/ancres PWA/Electron et fixtures crypto vérifiées ; PHASE 7 ajoute contrôle bloquant avant émission GUI, CLI headless, diagnostics réels TypeScript/activation et runbook. Cause du rejet de l’instance NON CONFIRMÉE sans reçus publics et version cible ; correspondance production non attestée. [Procédure opérateur lecture seule](../../VERIFICATION_CLE_EMETTRICE.md). |
| 5 | Remplacement administratif sécurisé | **PARTIEL** | Ancienne route maintenue en 404, probes PowerShell bloquants/sans envoi de secret, inventaire des usages du dépôt effectué. **SPEC P1 détaillée + runbook**, avec identité humaine, MFA récente, RBAC, CSRF, anti-rejeu, idempotence, tombstones, transaction/audit durable et recette. Ce remplacement **n'est pas implémenté** ; le PATCH existant avec licence admin n'est pas une preuve de MFA humaine. [SPEC et runbook](../../REVOCATION_ADMIN_RUNBOOK.md). |
| 6 | Audit exhaustif A–K | **PARTIEL** | Inventaires code/routes/UI/encodage/schémas, inspections transversales et correctifs supplémentaires exécutés ; aucune catégorie n'est déclarée entièrement auditée. Les restes locaux et les prérequis externes sont distingués. [Grille A–K et reste à vérifier](phase6/03-GRILLE-A-K.md), [inventaire nominatif avec statut sémantique](phase6/review-inventory.tsv). |

## 2. Résultats réellement mesurés

Source de cette synthèse : [validation.json](phase6/validation.json). La [baseline canonique](../FINAL_VERIFICATION_BASELINE.md) et `artifacts/verification/baseline.json` ont été régénérés par le script existant depuis **la globale finale**, et non depuis une suite ciblée verte.

| Vérification | Résultat |
|---|---|
| Vitest global final | **Exit 1** ; 3 343 réussis / 4 194 ; 3 échecs ; 848 pending ; 0 todo. |
| Trois échecs | `src/test-utils/__tests__/prepare-test-db.test.ts`, suite GF31-AUD-024 : « produit une base exploitable, et le modèle porte l’empreinte du schéma » ; « le second appel réutilise le modèle au lieu de reconstruire » ; « une base déjà présente est REMPLACÉE, jamais réutilisée telle quelle ». Chacun échoue sur la préparation native avant l'assertion métier ; [messages et stacks complets](phase6/vitest-final-failures.json). |
| Pending finaux | **813** empêchés par hooks de préparation + **35** conditionnels : 21 PostgreSQL, 5 Redis, 1 artefact Windows, 6 présence/correspondance de clés réelles, 2 GF_TEST_LICENSE de l'émetteur. [Liste exhaustive test par test](phase6/pending-tests-final.tsv). L'ancien relevé de 849 reste historique ; un test `alg: none` fonctionne désormais sans clé privée. |
| Validation ciblée | **477/477**, 32 fichiers, aucun échec/pending ; contrat licence/sync, Electron, environnement, fixtures crypto, transport UI, pagination/API et gardes baseline/docs. Commande exacte et liste des fichiers dans [validation.json](phase6/validation.json), [rapport](phase6/targeted-validation.json). Ces tests ne prouvent pas un rendu navigateur ou un démarrage Electron. |
| Test réactivé | `forgery-resistance`, cas 7 `alg: none` : réussi sans clé privée ; suite 5 réussis / 10, 5 skips réels conservés. [Rapport](phase6/conditional-test-activated.json). |
| Node | **376/376**, aucun skip/todo, [sortie](phase6/node-tests.log). |
| Lint / TypeScript | Exit **0 / 0**, [lint](phase6/lint.log), [types](phase6/type-check.log). Avertissements SQLite expérimentaux encore présents dans les tests, [relevé](phase6/warnings-final.json) ; aucune revendication de runtime sans warning. |
| Contrat environnement | Exit **0**, aucun problème résiduel ; [sortie](phase6/env-final.log). |
| Cohérence globale | [Sortie finale](phase6/consistency-final.log). Les contrôles de clés dépendant du PEM émetteur restent explicitement SKIP, pas une attestation production. |
| Dépendances | `npm audit` : **0** vulnérabilité déclarée par le registre à cet instant ; [JSON](phase6/npm-audit.json). **32 paquets outdated**, non assimilés à 32 vulnérabilités ; [versions](phase6/outdated.json). Pas de mise à niveau majeure aveugle. |
| SQLite / schémas | Inspection lecture seule du template : 45 tables, integrity OK, aucune violation FK ; [preuve](phase6/sqlite-readonly.json). Modèles 43 desktop / 47 serveur ; noms de champs communs concordants, contraintes/annotations/production **non certifiées** ; [inventaire](phase6/schema-inventory.json). |
| Build / navigateur / packaging | **Non validés** : build interrompu avant Next ; 144 tests Playwright seulement découverts ; installation Chromium échouée ; pas de recette sur le binaire Windows distribué. |
| Recherche de secrets exhaustive | **Non validée** : téléchargement Gitleaks échoué, aucun scan Gitleaks exécuté. Les contrôles locaux de chemins/empreintes ne le remplacent pas. |

Les deux régressions de gardes intermédiaires ont été reconnues comme **locales**, pas attribuées au réseau : la garde UI ne suivait pas le helper de transport ; la garde des paramètres API ne suivait pas le helper pagination. Les corrections suivent import et appel effectif et ajoutent des contre-exemples ; ni whitelist ni retrait de tests. Les [traces UI](phase6/intermediate-ui-guard-failure.json) et [pagination](phase6/intermediate-pagination-guard-failure.json) restent conservées.

## 3. Défauts corrigés distincts des sujets non démontrés

En complément des corrections licence/sync détaillées dans le [journal initial](03-JOURNAL-ET-INCIDENT.md), cette phase a notamment corrigé :

- contrat d'environnement et normalisation de l'alias d'URL directe, avec refus des conflits et absence de sortie runtime de l'alias ;
- fail-open du rate limiter sur création de licence et diagnostics : échec de la dépendance → 503, sans opération sensible ;
- erreurs masquées du chargement appareils dans la modale : transport contrôlé, état d'erreur neutre et possibilité de réessayer ;
- pagination de cinq listes (`clients`, `invoices`, `quotes`, `vehicles`, `jobs`) : parsing strict et 400 avant DB sur entrée invalide/débordement ;
- notices obsolètes/tronquées : texte complet et identité/version/chemin de paquet vérifiés ; SBOM et notices régénérés pour 98 dépendances de production ;
- faux succès de la sonde admin et instructions obsolètes sur les clés ;
- prose canonique revendiquant à tort un build propre et une absence de défauts connus ; snapshot antérieur conservé, baseline courante rouge assumée ; rapport racine d’août explicitement reclassé historique avec avertissement et lien actuel ;
- prérequis privé inutile sur le refus d'un en-tête `alg: none`.

Ces corrections de code/documentation ne sont **pas** la preuve d'une cause d'incident de production. Pour toute hypothèse non corrélée : **Cette hypothèse est compatible avec le code mais NON CONFIRMÉE sans accès aux logs de production / à la base de données.**

## 4. Conditions de bascule — travaux locaux / CI encore ouverts

Cette liste ne doit pas être transférée intégralement à un opérateur production : plusieurs travaux sont de développement et restent réalisables hors production.

1. **Implémenter puis recetter la SPEC P1 administrative**, avec identité humaine/MFA/RBAC, durable audit/outbox et anti-rejeu ; minimiser et protéger les diagnostics et les autres surfaces admin. Le 404 retiré ne doit jamais être réouvert.
2. **Achever la revue sémantique A–K**, notamment autorisations/tenants sur toutes les routes, robustesse JSON/pagination restante, contrats métier, transactions, schémas/contraintes, documentation produit et UI/accessibilité. Le fichier d'inventaire liste les chemins ; son SHA et ses marqueurs ne valent pas revue ligne à ligne. Fermer chaque reste listé dans la grille avec preuves et tests.
3. **Restaurer un environnement natif isolé**, rejouer les 79 fichiers et les suites avec PostgreSQL/Redis de test ; analyser et corriger toute régression ainsi révélée. Exécuter build/postbuild, budget, navigateur et recette Windows/Electron réelle avec la toolchain épinglée. Réduire chaque skip uniquement lorsque son prérequis est effectivement disponible. [Procédure CI](phase6/02-BUILD-ET-REPRISE.md).
4. **Compléter sécurité et conformité des artefacts** : scan arbre/historique/binaire, dépendances natives, notices Electron/Chromium, LGPL/libvips, obligations de redistribution/source/relinking et revue juridique. Des notices npm complètes et un audit registre à zéro ne ferment pas ce sujet.
5. **Régénérer les preuves sur la version candidate exacte**, avec provenance/digests et compteur cohérent ; documenter les warnings, l'écart npm local 10.9.8 / npm déclaré 11.16.0 et les résultats négatifs. Aucun échec non expliqué ni catégorie ouverte ne permet un GO.
6. Effectuer ensuite les vérifications nécessitant effectivement la production ci-dessous. Réémettre un verdict seulement après examen de **toutes** les preuves ; ne pas transformer automatiquement l'état en GO au seul rétablissement du réseau.

## 5. Actions strictement humaines nécessitant l'accès production

Aucune de ces actions n'a été effectuée pendant cet audit. **Lecture seule par défaut ; toute mutation requiert une validation humaine explicite distincte. Ne transmettre aucune clé privée, cookie, URL avec mot de passe ou licence client dans le chat ou les pièces d'audit.**

1. **Attester la provenance en service** : relever environnement, SHA de déploiement, digest/signature des bundles serveur/PWA et de chaque version Electron encore distribuée ; rapprocher des attestations CI et versions réellement servies. Un checkout local ne remplace pas cette preuve.
2. **Rapprocher l'émetteur et les ancres déployées** : appliquer la [procédure lecture seule](../../VERIFICATION_CLE_EMETTRICE.md) sur le poste/service autorisé avec injection secrète contrôlée. Conserver uniquement reçus et empreintes publiques. La correspondance entre **GF_PRIVATE_KEY de production et la clé publique effectivement déployée ne peut être vérifiée que par un opérateur ayant accès aux deux valeurs en environnement de production, hors du périmètre de cet audit**. Aucun réalignement/rotation automatique en cas de divergence.
3. **Collecter les traces d'incident corrélées** : dates UTC, request IDs et réponses JSON neutralisées des parcours activation/check/status/heartbeat/devices/sync, version client, événements auth et erreurs serveur. Masquer jetons, identifiants personnels et secrets. Distinguer refus métier (`allowed:false`), erreur réseau et exception serveur ; pas de conclusion à partir du seul HTTP200/500.
4. **Faire les lectures DB autorisées** pour les mêmes licences/appareils/garages, schéma et MAC/états utiles, avec filtres minimaux et sans export brut de secrets : transaction `BEGIN TRANSACTION READ ONLY; … ROLLBACK;`. Comparer état, révocation, expiration, quota et horodatages aux traces et à la machine à états du code déployé. Aucun reset, `db push`, migration, suppression ou rescellement automatique.
5. **Confirmer la configuration réelle et les frontières d'administration** : présence/encodage/sources des paramètres canoniques, disponibilité et politique Redis/DB, proxy/origines, IAM/MFA/RBAC et rétention d'audit. Ne pas publier les valeurs ; inventorier aussi les outils/supports et consommateurs d'admin **hors dépôt**, inobservables ici.
6. **Recetter sur les cibles réelles uniquement avec autorisation explicite**, une fois le remplacement admin développé et validé hors production : compte/licence de recette dédiés, fenêtre approuvée, critères et reçu d'audit. Toute activation/révocation/synchronisation de recette qui écrit en production nécessite cette autorisation préalable. Aucun PATCH historique ou flag de secours ne remplace la recette MFA.
7. **Décider et approuver les changements éventuels**, séparément du présent constat : correction de données, migration, alignement/rotation de clés, publication, rollback et communication aux utilisateurs ; obtenir les validations sécurité/exploitation/juridique pertinentes. Tant que preuves, prérequis ou travaux locaux restent ouverts, maintenir **NO-GO**.

## Références

- [Journal continu horodaté des six blocages](05-RESOLUTION-BLOCAGES.md).
- [Grille A–K, preuves et reste local/externe](phase6/03-GRILLE-A-K.md).
- [Résumé machine de validation](phase6/validation.json).
- [Baseline antérieure conservée comme historique, pas certification](snapshots/baseline-before-phase6.md.txt).
