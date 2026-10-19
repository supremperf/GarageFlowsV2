<!-- doc-numbers: journal -->
# Copilote phase 2 — reprise d’audit et ordre sûr, 15 octobre 2026

**PARTIELLEMENT VALIDÉ — NON PRÊT POUR LA PRODUCTION.**

## Référence et preuves recontrôlées

Branche `arena/c9eaae15-garageflowsv2`, HEAD `bd05cd521917cc059fc21780d1b562c020534942`, arborescence propre au départ. À la reprise, les 25 empreintes de la clôture phase 1 correspondaient aux fichiers de départ ; ce contrôle ne prouve pas leur comportement fonctionnel. Rapports historiques conservés, pas réécrits après publication.

Baseline fraîche : P05, 94 tests Copilote réussis ; P06, 78 tests configuration ; P07, 9 tests politique/fork. Tests purs/transport scripté et fixtures de configuration, pas Anthropic ni session réelle. Preuves et reçus horodatés Europe/Paris sous `/home/user/copilot-phase2-2026-10-15/`, hors Git.

## Diagnostic Prisma

Prisma/client verrouillés en 5.22.0, moteurs commit `605197351a3c8bdd595af2d2a9bc3025bca48ea2`, plateforme Linux x86_64/glibc 2.36, OpenSSL 3.0.20, cible `debian-openssl-3.0.x`. Node 22.22.3, npm 10.9.8. DNS résout binaries.prisma.sh, npm et GitHub. Aucun HTTP(S)/ALL proxy, CA additionnelle, override moteur/mirror ou désactivation TLS présent lors de l’inspection (noms/pré­sence seulement, pas de dump de valeurs).

- P01 : curl vers le checksum officiel, exit 35 `SSL_ERROR_SYSCALL`, HTTP 000, aucun TLS établi. Ce n’est pas une preuve de certificat présenté et invalide : aucune chaîne distante vérifiée n’est disponible.
- P02 : curl vers registry.npmjs.org/prisma, exit 0, HTTP 200, vérification TLS 0. Le TLS général n’est donc pas intégralement cassé.
- P03 : `npx prisma generate`, exit 1, socket interrompue avant établissement TLS pour le checksum officiel du moteur de requête.
- P04 : API GitHub du dépôt officiel prisma/prisma-engines, liste des cinq dernières releases vide ; aucun binaire alternatif vérifiable obtenu par cette voie. Cela ne prouve pas l’inexistence de toute autre distribution officielle.

binaries.prisma.sh est hors des hôtes sortants autorisés dans cet environnement. Les observations concordent avec cette restriction. Pas de cause identifiée justifiant une mise à jour majeure ou un changement de moteur. Aucun checksum ignoré, miroir non officiel, moteur factice, TLS désactivé ou remplacement de client utilisé.

**BLOQUÉ** : génération/DB native. Solution reproductible attendue : environnement autorisant l’hôte officiel avec TLS et checksums, versions verrouillées et deux générations standard, puis SQLite/PostgreSQL et build normal. Un runner distinct doit être évalué séparément ; cet échec local ne prouve pas son indisponibilité.

## Limites fonctionnelles de phase 1 observées

| Composant | Source | Limite à traiter sans régression |
|---|---|---|
| Routeur | copilot/router.ts, intents.ts, engine.ts | Une intention unique, parfois période inadéquate ou faux positif ; formulations familières/complexes limitées. |
| Instructions | copilot-llm/prompts.ts | Classification unique ; pas de contrat de plan ou d’informations manquantes. |
| Anthropic | copilot-llm/provider.ts | Opt-in, borne/abort/circuit déjà présents ; pas de sélection documentaire ou de plan multi-lectures. Aucun service réel testé. |
| Validation | classify.ts, provider.ts | Intention/score validés ; besoin de valider chaque outil, paramètres et droits d’un plan complet avant tout appel. |
| Dossiers | api/copilot/route.ts | Recherche sûre mais unitaire ; homonymes/périodes/contexte ambigu à expliciter. |
| Articles | copilot/knowledge.ts | 13 articles sourcés, filtre RBAC lexical ; garder le corpus et ajouter sélection contrôlée. |
| Contexte | conversation.ts, CopilotPanel.tsx | Six questions utilisateur, référence précédente unique ; pas d’ancien résultat faisant autorité. Ne pas ajouter de mémoire durable injustifiée. |
| Autorisations | authz.ts, api-helpers.ts, route | Session licenciée et garage serveur, finance protégée ; chaque nouvel outil doit refaire sa propre validation. |
| UI | CopilotPanel.tsx | Sources/reset/abort présents ; afficher plusieurs résultats et un état essentiel réellement sondé sans faux succès. |
| Configuration/startup | config-core.cjs, manifeste, db.ts | off par défaut, deux clients Prisma requis ; GET annonce base non sondée et ne peut pas attester disponibilité métier. |
| Tests | prepare-test-db.ts, suites Copilote | Modèle SQLite natif par empreinte, pas ORM simulé ; six suites bloquées au setup. Corpus ciblé de 27 demandes, insuffisant pour qualité générale. |

## Plan priorisé et critères

1. P0 : préserver les 94/78/9 tests ; catalogue fermé de lectures/handoffs décrivant permissions, paramètres, accès, erreurs, confirmation et vérification. Revalider au dispatch ; refuser le plan entier si interdit avant toute lecture.
2. P1 : plan structuré jusqu’à trois lectures indépendantes, sélection de documents autorisés, clarification des paramètres manquants, hors périmètre ; aucune URL/SQL/écriture du modèle. Réutiliser les résolveurs, pas réécrire les calculs.
3. P1 : contexte résumé localement en thèmes/types de paramètres disponibles, sans texte historique, identité client, résultat ou confirmation envoyés au modèle. Paramètres réattachés exclusivement depuis les questions utilisateur locales et relus en base. Garder six questions ; pas de résumé durable sans évaluation justifiant davantage.
4. P1 : état essentiel base/catalogue/connaissances confirmé, modèle facultatif séparé ; délais/circuit et annulation conservés. Ne pas appeler un service payant pour une sonde de démarrage.
5. P2 : évaluations élargies locales/multi-tours/injections, tests d’exécution scriptée distincts de SQLite réel, comparaison avant/après et métriques aux dénominateurs exacts. Réexécuter ce qui est faisable ; garder les échecs/blocages explicites.

Aucun push, déploiement, appel de modèle payant, nouveau secret fournisseur, migration métier ou apprentissage depuis les conversations autorisé pour cette phase.

## Clôture locale de l’audit — état après réalisation

Le tableau de limites ci-dessus décrit la baseline inspectée, **pas le comportement actuel**. La phase 2 ajoute un contrat de plan, un catalogue/exécuteur contrôlés et des sondes authentifiées de ressources. Détails, inventaire, preuves et réserves dans `COPILOT_PHASE2_VALIDATION.md` ; revue sémantique à empreintes dans `COPILOT_PHASE2_REVIEW.json`.

P26 complète le diagnostic : Node 22.22.3 utilise OpenSSL 3.5.6 (distinct de l’outil système OpenSSL 3.0.20 décrit plus haut), Prisma/client 5.22.0, aucun moteur installé. HEAD officiel Prisma : ECONNRESET **avant TLS**, sans HTTP ; npm : HTTP 200 / TLS autorisé. Les restrictions de sortie expliquent vraisemblablement cet échec ; aucun correctif de certificat n’est justifié par les preuves disponibles. La correction requiert un environnement autorisant la distribution officielle, pas une dégradation de TLS.

Derniers contrôles du code : P36, 144 tests purs/transport simulé ; P37, ESLint ciblé ; P38, typecheck global **échoué**, 225 diagnostics (clients générés manquants et erreurs en cascade, dont neuf dans les lecteurs déplacés). Configuration P33 : 78 ; politique P34 : 9. Les suites natives P14 ont échoué au setup (54 tests skipped), build P15 et budget P16 ont échoué ; ils n’ont pas été déclarés réussis après les modifications. Le libellé de marge est corrigé en « depuis la date / un mois glissant » pour correspondre à subMonths, sans modifier le calcul.

P30 compare 68 scénarios de développement à bd05cd5 : 44/68 → 68/68, mais 18 réponses de planificateur sont scriptées. P29 conserve 27/27 sur l’ancien corpus, avec une baseline plus ancienne 4f19f77 : ne pas mélanger ces deux comparaisons. Pas de mesure de qualité humaine ou de vrai modèle, disponibilité SQL native, latence froide complète ou preuve du démarrage production.

Décision inchangée : **PARTIELLEMENT VALIDÉ — NON PRÊT POUR LA PRODUCTION**. Pas de push, déploiement ni appel payant. Les échecs obligatoires de la CI publiée bd05cd5 restent distincts du candidat local non publié.
