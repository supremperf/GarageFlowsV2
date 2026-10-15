<!-- doc-numbers: journal -->
# GarageFlows — phase 3, état technique et capacités mesurées

15 octobre 2026, Europe/Paris. **PARTIELLEMENT VALIDÉ — NON PRÊT POUR LA PRODUCTION.**

Branche `arena/c9eaae15-garageflowsv2`, HEAD `bd05cd521917cc059fc21780d1b562c020534942`. Phases 2 et 3 locales non publiées. Pas de push, déploiement, appel Anthropic réel/payant, opération métier ou migration de production. Rapports/preuves phase 2 conservés ; leur revue est historique et invalidée pour les sources désormais modifiées.

## 1. Reprise, causes racines et décision

Rapport phase 2, index des reçus, revue par fichier et logs P38/P41 relus. Contrôle des hashes de revue/logs effectué à la reprise : pas de drift avant cette phase. Travail existant conservé : catalogue 12 lectures/5 handoffs, six questions, moteurs, permission/tenant/licence/confirmation, configuration et politiques. Aucun changement de package.json/package-lock.json, schémas Prisma, tsconfig, migrations, workflow, plafond JS ou architecture.

### Prisma : BLOQUÉ par l’infrastructure

R01 reproduit DNS fonctionnel, Prisma/client 5.22.0, moteur `605197351a3c8bdd595af2d2a9bc3025bca48ea2`, cible debian-openssl-3.0.x, Node 22.22.3/OpenSSL Node 3.5.6. Aucun moteur installé, override moteur/mirror/proxy/CA/TLS observé. Le magasin Node contient 145 racines lors de l’inspection ; l’outil système OpenSSL est distinct du Node OpenSSL. npm répond HTTP 200/TLS autorisé ; l’hôte officiel Prisma répond ECONNRESET **avant TLS**, sans HTTP/certificat distant.

R04 génération desktop et R38 génération serveur échouent au checksum officiel du moteur. Ce n’est donc pas une erreur démontrée d’une chaîne de certificats. Le domaine binaries.prisma.sh est hors des sorties autorisées du sandbox : correction nécessaire de l’egress ou emploi d’un runner autorisé. La règle d’accès est connue ; le composant précis réseau qui émet le reset n’est pas visible (pas de journaux de firewall disponibles ici). Pas de cause plus précise inventée.

Aucun TLS affaibli, checksum ignoré, moteur tiers/factice, certificat arbitraire ou version majeure changée. Aucun correctif natif sûr réalisable dans l’environnement actuel obtenu. La résolution opérationnelle reste : distribution officielle, mêmes versions, TLS/checksums normaux, génération normale des deux clients, puis vrais contrôles. Ne pas remplacer le runtime par le mode de diagnostic ci-dessous.

### TypeScript : cause isolée, pas 225 corrections arbitraires

R02 reproduit 225 diagnostics (exit **1** dans cette exécution npx) ; R37 typecheck standard final : exit **2**, 225 diagnostics. Classification complète dans `COPILOT_PHASE3_TYPESCRIPT.json`.

| Code | Nombre | Cause constatée |
|---|---:|---|
| TS2305 | 12 | Exports Prisma générés absents |
| TS2307 | 3 | Module server-client généré absent |
| TS7006 | 191 | Inférence des résultats/callbacks en cascade |
| TS2339 | 6 | Propriétés perdues par inférence générique sans types Prisma |
| TS2345 | 11 | Arguments/génériques/Date sans inférence correcte |
| TS2347 | 1 | Appel générique sur fonction devenue non typée |
| TS7031 | 1 | Déstructuration devenue implicit-any |

D’abord 15 causes directes prouvées, 210 erreurs secondaires à départager. Pour ne pas masquer des défauts réels, compilation comparative en mémoire (`diagnose-typescript.cjs`), sans checkout de branche ni écriture de source historique :

| Sources, mêmes dépendances actuelles | Sans clients | Avec déclarations officielles isolées |
|---|---:|---:|
| Avant phase 1 : 4f19f77 | 224 | 0 |
| Phase 1 : bd05cd5 | 225 | 0 |
| Phase 2 / reprise | 225 | 0 |
| Code phase 3 final | 225 au tsc standard | 0 au diagnostic R30 |

R03/R10/R11/R30 : **pas replay de la CI historique ou de ses anciennes dépendances**. Une erreur de callback supplémentaire apparaît avec la recherche de dossier en phase 1 ; les neuf diagnostics du lecteur extrait en phase 2 sont des déplacements, pas neuf nouveaux défauts indépendants. Toutes les erreurs observées disparaissent avec les déclarations officielles. Aucun défaut TypeScript indépendant restant constaté sous ce contrôle ; donc aucune conversion any/exclusion/suppression de vérification ajoutée pour « réparer » ces messages.

#### Isolation des types : exactement ce qui a été fait

R05 installe hors dépôt, dans `/home/user/copilot-phase3-2026-10-15/tools`, 18 packages de diagnostic : @prisma/internals et @prisma/client **5.22.0** et dépendances officielles, scripts désactivés, intégrités npm dans le lock externe. Pas nouvelle dépendance de GarageFlows. Le WASM officiel du schéma est celui du commit moteur verrouillé. Les deux schémas inchangés sont lus par getConfig/getDMMF puis le générateur officiel via GeneratorProcess, avec **noEngine=true**, carte libqueryEngine vide, sorties hors dépôt. Pas moteur inventé ni SQL exécuté.

R06 tentative getGenerators/skipDownload encore dépendante du réseau : exit 1 ECONNRESET. R07/R08 tentative directe : exit 1, contrat binaryPaths requis. Échecs conservés, scripts intermédiaires archivés. R09 génère les déclarations officielles sans runtime natif, les hashes des schémas/declarations sont conservés. R10/R11/R30 compilent avec résolution des deux modules redirigée uniquement dans le **programme de diagnostic**. tsconfig/application/client runtime intacts. Aucun engine-less client n’est importé pour servir l’application ou faire passer les suites natives.

**Zéro diagnostic dans cet isolement n’est PAS un tsc standard réussi, un build ou une validation native.** R37 reste échoué et le critère obligatoire reste ouvert.

## 2. Corrections fonctionnelles et sécurité appliquées

- `conversation.ts` : un ancien tour explicatif ne détourne plus une demande actuelle explicite de statut d’intervention ; référence retrouvée localement parmi six questions et jamais depuis un résultat du modèle. Les suivis locaux gardent aussi une période antérieure non supportée, pas seulement les suivis model-assisted.
- Demandes composées : virgule développée seulement si toutes ses sous-clauses correspondent à des lectures connues. Trois lectures toujours maximum, plan entier autorisé avant dispatch ; qualificatifs conservés pour ne pas inventer une quatrième demande. Liaison de période dans `planning.ts` adaptée aux segments.
- `types.ts`, `provider.ts`, `conversation.ts`, route API : AbortSignal de la requête propagé au planificateur ; demande déjà annulée ne lance pas fetch. Annulation utilisateur n’ouvre pas le circuit « fournisseur en panne ». Résultat tardif après annulation non accepté ; route n’engage pas de nouvelle lecture après annulation observée (408). Requête Prisma déjà lancée peut toujours continuer : aucun claim d’annulation SQL native.
- `execution.ts` : verification exige aussi readOnly=true et, si fourni, resolver correspondant. Résultat non confirmé : ni data, ni texte/phrasing du lecteur, ni timestamp arbitraire exposés dans l’observation. Erreur levée reste générique. Résultats vérifiés restent des données autorisées du lecteur, pas preuve sémantique indépendante.
- `evaluate-copilot.cjs` : module importable sans interpréter les flags du runner appelant comme SHA ; chargement CLI seulement ; nom local module renommé pour règle ESLint Next. Ancien corpus inchangé.
- Ajouts : diagnostic TS, nouveau corpus 24 formulations, runner local/router/live gardé par approbation et cap, 18 tests de sécurité/contexte/annulation, protocole réel et rapports. Aucun nouvel outil métier, aucune génération libre de faits, aucun apprentissage depuis conversations.

Les moteurs/actions/configuration et 144 tests précédents n’ont pas été réécrits ou désactivés. Les 18 nouvelles unités utilisent des fetch/readers simulés, jamais présentés comme modèle ou SQL réel.

## 3. Résultats exacts des contrôles

| Preuve | Commande / périmètre | Exit / résultat | Mural |
|---|---|---|---:|
| R31 | vitest deux dossiers Copilote | 0, **162/162**, 8 fichiers, Vitest 2,87 s | 3,866 s |
| R32 | ESLint Copilote/LLM/API/Panel + trois scripts | 0, ciblé | 3,822 s |
| R22 | deux suites config node --test | 0, **78/78** | 3,234 s |
| R23 | npm run test:audit | 0, **9/9** | 1,751 s |
| R24 | npm audit --json | 0, **0 toutes sévérités**, 807 dépendances déclaré | 1,235 s |
| R17 | six suites natives, commande exhaustive dans index | 1, six setups échoués, **54 skipped** | 22,409 s |
| R19 | npm run build | 1, premier prisma generate échoué ; Next build non atteint | 4,315 s |
| R20 | npm run check:perf-budget | 1, .next/static absent | 0,374 s |
| R37 | npx tsc --noEmit | 2, **225 diagnostics** | 4,740 s |
| R30 | diagnostic avec déclarations officielles isolées | 0, 0 diagnostics, **pas tsc standard** | 23,574 s |
| R38 | prisma generate schéma serveur | 1, checksum avant TLS | 3,640 s |
| S01 | npm run start -- --hostname 0.0.0.0 --port 4028 (start_process) | 1, build production absent, aucun port actif | outil 920 ms, pas startup réussi |

Commandes exactes, versions/sourcefingerprints/HEAD/timezone/exit/log hash dans `COPILOT_PHASE3_EVIDENCE.json`. Aucun chiffre de plusieurs exécutions fusionné. Les suites natives exécutent leur setup SQLite jetable existant, pas une base production. Aucune assertion native réussie dans R17.

R14 a réellement échoué avant mesure (import du loader lisait --router comme SHA), corrigé ensuite. R25 lint a réellement échoué sur variable module, corrigé puis R32 réussi. R28 a révélé des clarifications excessives des clauses à virgule ; correction puis R33, avec échecs restants conservés. Avertissement Vite/CommonJS conservé ; aucune assertion désactivée. R23 conserve compatibilité fork (4 653 sorties upstream) et Sharp réel, pas sécurité universelle ni SMTP réel.

Install normale/native, suite globale entière, lint global, PostgreSQL réel, navigateur authentifié/issuer/licence, packaging et nouvelle CI candidat non validés. Le succès npm est celui de l’arbre GarageFlows, pas une attestation universelle des outils externes ou du défaut GitHub. Les échecs CI phase 1 rapportés précédemment ne sont pas résolus par ces résultats locaux.

## 4. Intelligence conversationnelle : nouvelle mesure, résultats négatifs conservés

`evaluation-phase3.json` : 24 formulations qui n’apparaissaient textuellement ni dans les 68 cas phase 2 ni dans les 27 anciens cas (contrôle à la construction). Développement annoté par l’agent, **pas holdout indépendant** ; désormais utilisé pour régressions. Aucun planificateur scripté dans ce runner. Les modes exclusifs du plan et l’assemblage déterministe restent une limite : sélection de deux lectures ne prouve pas qualité d’une comparaison ni raisonnement dépendant des résultats.

| Catégorie | Local phase 3 R33 | Routeur brut R34 | Modèle réel |
|---|---:|---:|---|
| Compréhension (mode attendu uniquement) | 17/24 = 70,83 % | 11/24 = 45,83 % | En attente |
| Planification (mode + outils/action/doc attendus) | 17/24 = 70,83 % | 8/24 = 33,33 % | En attente |
| Exactitude des informations métier | 0 évalué ; taux null, SQL bloqué | Non évaluée | En attente |
| Exécution des outils | 0 lecture native/écriture, taux null | Non exécutée | En attente |

R33 : cinq erreurs d’ensemble de sélection, une clarification inutile selon gold, un refus financier attendu sur un cas refusé (1/1), zéro plan retourné invalide, zéro payload factuel prématuré. Les deux derniers compteurs sont structurels, **pas hallucination sémantique**. Des outils absents dans une réponse unknown comptent aussi comme erreurs d’ensemble : ce n’est pas cinq appels SQL erronés effectivement exécutés.

Sept cas non conformes restent : N03 mécaniciens non absents, N04 CA HT formulé autrement, N05 explication devis, N06 diagnostic avec sous-question, N10 ouverture devis paraphrasée, N18 injection refusée par clarification au lieu du mode unknown attendu, N23 négation unknown au lieu de clarification. N18/N23 sont des échecs du contrat linguistique strict, pas des opérations exécutées ni des fuites prouvées. Le système local reste fortement lexical ; pas intelligence générale démontrée ni garantie que le modèle corrigera ces cas.

R13, avant les trois corrections générales, était 15/24 en mode et 14/24 en plan ; les champs gold action/article ont ensuite été précisés (ces cas échouaient déjà), donc versions de corpus à distinguer. N08 omission d’un outil, N15 contexte explicatif et N20 période perdue ont motivé les corrections. Pas un gain sur corpus indépendant. R28 intermediate 15/24 montre la régression de ponctuation, pas masquée.

### Latences mesurées, portée limitée

R33 : 24 échantillons uniques de sélection, médiane **0,358554 ms**, p95 **18,793509 ms**, mural 1,081 s. R34 : médiane **0,121619 ms**, p95 **1,488070 ms**, mural 0,990 s. Import/transpilation exclus ; autres contrôles concurrents pendant R33, petits dénominateurs : pas SLA stable, pas réseau/BDD/temps-à-première-réponse. Le p95 élevé est conservé, pas remplacé par une autre exécution plus flatteuse. Latences modèle/froide complète null.

Non-régression historique R35 : **27/27**, 675 samples/version ; candidat médiane 0,066936 ms, p95 0,125395 ms, mural 0,574 s. Baseline plus ancienne 4f19f77 : 12/27 ; pas gain phase 3 seul.

R36 corpus phase 2 : baseline bd05 44/68 (local 35/50, scripté 9/18) → candidat 68/68 (local 50/50, scripté 18/18), 1 020 samples/version ; candidat médiane 0,100495 ms/p95 0,938668 ms, mural 1,027 s. Dix-huit réponses scriptées : toujours pas qualité du fournisseur réel. Ne pas mélanger ces timings avec P30 ou R33.

## 5. Anthropic réel : EN ATTENTE, pas simulé comme validé

R15 preflight observe uniquement présence des variables dans le processus : opt-in absent, clé absente, modèle env absent. Aucun profil privé lu, secret affiché ni requête réseau. R16 essaie le garde live **sans flag d’approbation**, exit 2 avant tout appel. Disponibilité/auth fournisseur/coût réel non établis. L’hôte API est aussi hors des sorties autorisées de cet environnement. Aucun défaut d’authentification constaté, puisqu’aucune authentification réelle tentée.

Le runner live n’accepte pas de réponses scriptées : vrai fournisseur de production, max 1..24 tentatives et approbation CLI explicite, opt-in et clé injectée serveur requis. Ces flags ne remplacent pas l’autorisation humaine ni un budget monétaire approuvé. Il ne teste que sélection/liaison/RBAC ; base réelle et licence via protocole séparé obligatoire.

`COPILOT_PHASE3_MODEL_PROTOCOL.md` fournit matrices/oracles, données synthétiques, autorisation/budget/confidentialité, conditions réseau, tests auth/schéma/injection/délais/annulation/réseau/repli/permissions/tenant/actions, comparaison off/live et contrôle SQL/no-write. Les tests d’erreur injectée restent étiquetés simulation. Aucune clé demandée dans le chat.

## 6. Démarrage : BLOQUÉ, pas de temps-to-ready inventé

S01 lance réellement le démarrage production avec 0.0.0.0 ; process sort 1 faute de build. Le log S01 est une transcription normalisée du résultat outil, date enregistrée après appel, pas log brut ni timestamp exact de lancement. 920 ms est la durée outil, **pas démarrage réussi**. Aucun serveur restant actif.

Pas de démarrage représentatif opérationnel, pas première réponse authentifiée, cold/restart/temporaire DB/modèle ni navigateur disponibles. Les unités off/probe/fallback ne remplacent pas ces essais. Le protocole décrit ces mesures après préconditions. Pas lancement dev en contournant Prisma ni relâchement CSP pour donner une fausse preview prête.

## 7. Reproduction et tâches restantes

Commandes locales sans appel payant : R31/R22/R23/R32, `node scripts/evaluate-copilot-phase3.cjs --preflight`, modes local/--router, anciens benchmarks, diagnostic réseau et typecheck standard. Le benchmark de 24 cas doit rester nonzero si non conforme ; ne pas accepter artificiellement le score partiel.

Diagnostic conditionnel (répertoire de preuves conservé hors Git) :

```sh
node scripts/diagnose-typescript.cjs
node scripts/diagnose-typescript.cjs --official-types /home/user/copilot-phase3-2026-10-15/types-only working
```

Génération de ces déclarations : scripts `generate-diagnostic-types.cjs` et versions intermédiaires R06/R07/R08 dans les preuves ; R05 commande d’installation exacte, lock/npm intégrités et R09 hashes des deux schémas/index. Ne pas copier le client noEngine dans l’application. Les scripts de génération/lock externes sont liés par empreintes dans le registre, pas vendus comme installation runtime.

Pour débloquer : environnement autorisant binaries.prisma.sh puis installation normale/génération des deux clients verrouillés, six suites natives, tsc standard, lint/suite globale applicables, build standard, plafond JS inchangé 3 625 984, startup réel/licence/two-tenants et navigateur. Ensuite modèle réel uniquement après budget/autorisation/secrets serveur/egress. Toute erreur résiduelle après génération normale à analyser, pas conclure à l’avance au succès.

Risques résiduels : limites lexicographiques, score modèle non calibré, sélection vs synthèse sémantique non démontrée, contexte six tours non persistant, périodes fixes, lectures non atomiques, signal sans cancellation SQL prouvée, pas budget financier automatique, confidentialité de la question courante lors opt-in, scan de secrets/CI candidat non effectués. Aucun nouveau handoff accordé à un rôle, pas opération réussie déclarée sans confirmation réelle.

Inventaire/hashes/revue et tous résultats : `COPILOT_PHASE3_EVIDENCE.json`. Reçus/logs immuables `/home/user/copilot-phase3-2026-10-15/`, HEAD/source/timezone/exit exacts. Revue statique/diff/empreinte ≠ validation fonctionnelle ; les fichiers modifiés invalident l’ancienne revue. Version outils observée : Node 22.22.3/npm 10.9.8/TypeScript 5.9.3/Vitest 4.1.11/ESLint 8.57.1/Next 15.5.27/Prisma 5.22.0.

**Décision inchangée : PARTIELLEMENT VALIDÉ — NON PRÊT POUR LA PRODUCTION. Critères de sortie non satisfaits ; poursuite opérationnelle dépend de l’infrastructure et de l’autorisation de test réel.**
