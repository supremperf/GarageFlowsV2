<!-- doc-numbers: journal -->
# Copilote — modèle optionnel et garanties effectives

## Ce qui s’exécute réellement

Le serveur utilise d’abord `conversation.ts` (aide sourcée, contexte borné, recherche d’intervention), puis le routeur déterministe existant. Pour une intention inconnue seulement, un classificateur Anthropic **optionnel** peut sélectionner une lecture autorisée dans un catalogue fermé. Il ne choisit ni une URL, ni une permission, ni une écriture. Les slots du modèle sont ignorés ; VIN/OBD sont extraits localement.

Le fournisseur de production n’implémente **pas** `phrase` ou `complete`. Les faits et montants restent les textes produits par les moteurs métier. Aucun résultat de base de données, historique de conversation ou document garage n’est envoyé par ce classificateur.

Les anciens helpers `phraseAnswer`/`isGrounded` restent compatibles et testés, mais le contrôle des nombres **n’est pas une preuve sémantique** : négation, unité, identité et phrases sans chiffres peuvent contourner ce contrôle. Il ne faut pas brancher une reformulation libre de faits métier sur cette seule garde. Le classificateur livré ne le fait pas. Le crochet d’injection `__setLlmProvider` sert aux tests locaux, pas à une route publique.

## Configuration explicite, pas d’activation implicite

```dotenv
GARAGEFLOW_LLM=off
# Pour activer après validation de la confidentialité et des coûts : anthropic
# ANTHROPIC_API_KEY est conservée uniquement côté serveur, jamais NEXT_PUBLIC.
GARAGEFLOW_LLM_MODEL=claude-haiku-4-5-20251001
```

`off` est le défaut. Une clé présente pour l’OCR ne suffit pas à activer le modèle du chat. Le modèle par défaut correspond à un identifiant déjà utilisé par l’OCR de plaque existant ; sa disponibilité, son coût et sa qualité ne sont **pas validés en direct** ici. Un identifiant différent peut être configuré, sans URL arbitraire.

**Confidentialité :** lorsque cette option est activée et que la demande n’est pas comprise localement, la question courante (jusqu’à 500 caractères, potentiellement personnelle) et le catalogue d’intentions autorisées sont envoyés à `https://api.anthropic.com/v1/messages`. Vérifier au préalable les conditions fournisseur, la politique de conservation, la base légale et le budget du garage. Le filtre des motifs courants de secrets est une défense supplémentaire, pas une détection exhaustive de données sensibles. Aucune clé fournisseur n’est créée ni aucun appel facturé effectué par cette livraison.

Le contrat d’environnement, son document généré, le template et les profils de `node config` incluent les réglages. La configuration conserve les valeurs existantes et laisse le modèle désactivé sur installation neuve.

## Bornes et disponibilité

- Requête externe annulée par `AbortController` après 2,5 secondes ; orchestrateur limité à 3 secondes pour cette classification.
- Aucune relance automatique ; circuit de repli local pendant 30 secondes après erreur.
- Réponse externe lue en flux, limitée à 16 384 octets ; sortie structurée validée par Zod, identifiant sur liste blanche, score fini entre 0 et 1.
- Seuil d’utilisation dans l’orchestrateur : 0,75 ; ce score déclaré par le modèle **n’est pas une probabilité calibrée**.
- Maximum 128 tokens générés par classification. Pas de budget financier mensuel ni de coût réel mesuré : à définir avant activation.
- `GET /api/copilot` authentifié, `private, no-store` : état local, version de connaissances, état du modèle, date du dernier résultat validé ; `database: not_probed`.
- Le modèle est `initializing` avant une première classification valide, `ready` après celle-ci, `degraded` après erreur, `unavailable` si désactivé/mal configuré. Un succès âgé de plus de cinq minutes n’est plus déclaré prêt.
- Le GET ne lance aucun appel facturé et ne prouve pas que le prochain appel réussira. Le panneau affiche explicitement un état à l’ouverture, pas une surveillance continue.

Les connaissances locales sont disponibles dès l’import, sans entraînement, téléchargement de vecteurs ou reconstitution répétée d’un index.

## Limites assumées

Ce n’est **pas** une parité ChatGPT, un raisonnement général validé, une planification autonome multi-outils ou une recherche vectorielle exhaustive. Les périodes et intentions des résolveurs historiques restent leurs contrats existants. La mémoire est limitée à des questions utilisateur non fiables, pas à des résultats mémorisés. Pas d’apprentissage automatique depuis les conversations, de mémoire persistante, de fine-tuning ou d’exécution autonome d’actions sensibles.

L’OCR photo de plaque existe séparément dans `/api/plate-ocr` et utilise déjà Anthropic. `/api/ocr` structure du texte reconnu en amont. Leur existence ne prouve pas la disponibilité du modèle du chat et leurs flux n’ont pas été modifiés.

Validation et limites d’environnement : voir `COPILOT_ADVANCED_AUDIT.md` et `COPILOT_VALIDATION_2026-10-15.md`. Les réponses simulées des tests ne constituent pas des échanges réels avec Anthropic.
