<!-- doc-numbers: journal -->
# Copilote — modèle optionnel et garanties effectives

## Ce qui s’exécute réellement

Le serveur utilise d’abord `conversation.ts` (aide sourcée, contexte borné, recherche d’intervention), puis le routeur déterministe existant. Un planificateur Anthropic **optionnel** peut sélectionner des lectures indépendantes, des articles d’aide, une clarification, un transfert vers un formulaire existant ou une réponse hors périmètre. Le contrat de plan est validé côté serveur ; les anciens chemins de classification restent compatibles. Les gardes de secrets/acquiescement et les propositions locales explicites sont traitées sans modèle. Il ne choisit ni une URL, ni une permission, ni une écriture. Le modèle ne fournit aucun paramètre métier : il choisit uniquement outil/source current ou previous_user. VIN/OBD/référence sont extraits localement et revalidés. Le plan entier est autorisé avant le premier appel, puis chaque outil est revérifié.

Le fournisseur conserve classify et ajoute plan, mais n’implémente **pas** `phrase` ou `complete`. Les faits et montants restent les textes produits par les moteurs métier. Aucun résultat de base de données, texte des anciennes questions, référence historique ou document garage n’est envoyé. Le modèle reçoit uniquement la question courante, les outils/articles autorisés et un contexte local de thèmes/présence de paramètres.

Les anciens helpers `phraseAnswer`/`isGrounded` restent compatibles et testés, mais le contrôle des nombres **n’est pas une preuve sémantique** : négation, unité, identité et phrases sans chiffres peuvent contourner ce contrôle. Il ne faut pas brancher une reformulation libre de faits métier sur cette seule garde. Le fournisseur livré ne le fait pas. Le crochet d’injection `__setLlmProvider` sert aux tests locaux, pas à une route publique.

## Configuration explicite, pas d’activation implicite

```dotenv
GARAGEFLOW_LLM=off
# Pour activer après validation de la confidentialité et des coûts : anthropic
# ANTHROPIC_API_KEY est conservée uniquement côté serveur, jamais NEXT_PUBLIC.
GARAGEFLOW_LLM_MODEL=claude-haiku-4-5-20251001
```

`off` est le défaut. Une clé présente pour l’OCR ne suffit pas à activer le modèle du chat. Le modèle par défaut correspond à un identifiant déjà utilisé par l’OCR de plaque existant ; sa disponibilité, son coût et sa qualité ne sont **pas validés en direct** ici. Un identifiant différent peut être configuré, sans URL arbitraire.

**Confidentialité :** lorsque cette option est activée, hors des gardes et propositions locales traitées sans modèle, la question courante (jusqu’à 500 caractères, potentiellement personnelle) et les catalogues autorisés ainsi que des métadonnées de thèmes/paramètres sont envoyés à `https://api.anthropic.com/v1/messages`. Vérifier au préalable les conditions fournisseur, la politique de conservation, la base légale et le budget du garage. Le filtre des motifs courants de secrets est une défense supplémentaire, pas une détection exhaustive de données sensibles. Aucune clé fournisseur n’est créée ni aucun appel facturé effectué par cette livraison.

Le contrat d’environnement, son document généré, le template et les profils de `node config` incluent les réglages. La configuration conserve les valeurs existantes et laisse le modèle désactivé sur installation neuve.

## Bornes et disponibilité

- Requête externe annulée par `AbortController` après 2,5 secondes ; orchestrateur limité à 3 secondes pour cette planification.
- Aucune relance automatique ; circuit de repli local pendant 30 secondes après erreur.
- Réponse externe lue en flux, limitée à 16 384 octets ; sortie structurée validée par Zod, identifiant sur liste blanche, score fini entre 0 et 1.
- Seuil d’utilisation dans l’orchestrateur : 0,75 ; ce score déclaré par le modèle **n’est pas une probabilité calibrée**.
- Maximum 512 tokens générés par plan ; 128 pour le chemin historique de classification. Ce changement augmente le plafond de coût potentiel par appel, sans mesure de coût réel. Pas de budget financier mensuel ni de coût réel mesuré : à définir avant activation.
- `GET /api/copilot` authentifié, `private, no-store` : état local, version de connaissances, état du modèle, date du dernier résultat structuré validé ; base/resources autorisées réellement sondées, opérationnel=false et HTTP 503 en cas d’erreur/délai. Les coûts/données des sondes ne sont ni exposés ni cachés. Une sonde ne garantit pas le prochain appel.
- Le modèle est `initializing` avant une première réponse structurée valide, `ready` après celle-ci, `degraded` après erreur, `unavailable` si désactivé/mal configuré. Un succès âgé de plus de cinq minutes n’est plus déclaré prêt.
- Le GET contrôle des colonnes/tables utilisées par les outils du rôle, pas toutes les fonctionnalités de l’application ou tous les services externes. Les lectures multiples ne forment pas un instantané SQL atomique. Le GET ne lance aucun appel facturé et ne prouve pas que le prochain appel réussira. Le panneau affiche explicitement un état à l’ouverture, pas une surveillance continue.

Le catalogue d’outils et les connaissances locales sont validés une fois à l’import (unicité, présence des définitions), sans entraînement, téléchargement de vecteurs ou reconstitution répétée d’un index.

## Limites assumées

Ce n’est **pas** une parité ChatGPT, un raisonnement général validé, une planification autonome multi-outils ou une recherche vectorielle exhaustive. Les périodes et intentions des résolveurs historiques restent leurs contrats existants. La mémoire est limitée à des questions utilisateur non fiables, pas à des résultats mémorisés. Pas d’apprentissage automatique depuis les conversations, de mémoire persistante, de fine-tuning ou d’exécution autonome d’actions sensibles.

L’OCR photo de plaque existe séparément dans `/api/plate-ocr` et utilise déjà Anthropic. `/api/ocr` structure du texte reconnu en amont. Leur existence ne prouve pas la disponibilité du modèle du chat et leurs flux n’ont pas été modifiés.

Validation historique : `COPILOT_ADVANCED_AUDIT.md` / `COPILOT_VALIDATION_2026-10-15.md`. État actuel : `COPILOT_PHASE2_AUDIT.md` / `COPILOT_PHASE2_VALIDATION.md`. Les réponses simulées des tests ne constituent pas des échanges réels avec Anthropic.

Phase 3 : `COPILOT_PHASE3_VALIDATION.md` et `COPILOT_PHASE3_MODEL_PROTOCOL.md`. Annulation du planificateur propagée depuis la requête ; résultat non confirmé sans payload/texte sensible dans les observations ; corpus de nouvelles formulations séparé des anciens scénarios scriptés. Aucun modèle réel ni démarrage production validé ici.

## Phase 4 — interprétation structurée, pas autorisation

Le fournisseur de production utilise désormais `interpret` (IR strict → contraintes/entités → plan backend). `plan` demeure un seam de compatibilité ; aucun deuxième appel après un IR invalide. Sortie 512 tokens inchangée, entrée potentiellement plus longue ; essais réels uniquement après consentement plafonné. Voir [le rapport phase 4](COPILOT_PHASE4_VALIDATION.md) et [le runbook](COPILOT_PHASE4_OPERATOR_RUNBOOK.md). Aucun benchmark réel/factuel réussi n’est annoncé ; nouveau runner `scripts/evaluate-copilot-phase4.cjs` à manifeste budgétaire à usage unique.
