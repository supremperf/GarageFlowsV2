<!-- doc-numbers: journal -->
# Copilote — audit et plan d'amélioration, 15 octobre 2026

**Statut initial : PARTIELLEMENT VALIDÉ. Décision globale : NON PRÊT POUR LA PRODUCTION.**

## A. Constats vérifiables avant modifications

Référence : `4f19f77891debc6009a1c241d2689f2a42bca0e8`, branche `arena/c9eaae15-garageflowsv2`, checkout propre. Next 15.5.27/React 18, Electron 41, TypeScript, Prisma 5 (SQLite desktop/PostgreSQL serveur), SDK Anthropic 0.91.1 déjà déclaré. Inspection du panneau conversationnel, routes Copilote/rapports, deux schémas Prisma, matrice des permissions, API métier et suite existante ; pas une validation fonctionnelle exhaustive des 1 897 fichiers.

| Élément | Source | Constat initial / risque |
|---|---|---|
| Modèle | `src/lib/copilot-llm/provider.ts` | Résout toujours `null`, aucun modèle déployé par ce composant. Le SDK Anthropic ne prouve pas que le Copilote l'utilise. |
| Routage | `src/lib/copilot/router.ts`, `intents.ts`, `engine.ts` | 16 intentions, mots-clés par sous-chaîne ; `vin` peut reconnaître un morceau de mot. « meilleurs fournisseurs » route à tort vers les clients. Pas de contexte conversationnel. |
| Réponses | `src/app/api/copilot/route.ts` | 11 résolveurs lisent/calculent des résultats ; contrôles financiers et redaction des coûts existants à préserver. Pas de consultation documentaire. |
| Garde LLM | `src/lib/copilot-llm/ground.ts`, `phrase.ts` | Vérifie les nombres uniquement, pas la sémantique. Une phrase sans nombre peut inventer un fait. Ne doit pas être présentée comme vérification complète du texte libre. |
| Actions | `src/lib/copilot/actions.ts`, `src/components/CopilotPanel.tsx`, `src/app/page.tsx` | Propositions avec confirmation puis ouverture d'outils/formulaires réels ; aucune écriture automatique dans le chat. Les paramètres vides ne doivent pas être envoyés automatiquement aux API métier. |
| Sécurité | `src/lib/api-helpers.ts`, `authz.ts` | Session licenciée, garage provenant de la session, matrice deny-by-default ; mécaniciens ont une session distincte, pas un accès global. |
| Données | `prisma/schema.prisma`, `prisma/server/schema.prisma`, `src/lib/db.ts` | Interventions/clients/véhicules/devis/factures/stock/planning, relations et garageId ; les notes et documents sont des données non fiables, pas des instructions. |
| Mémoire/UI | `CopilotPanel.tsx` | Messages uniquement en RAM du panneau ; seul le texte courant est envoyé. Pas d'annulation des fetchs ni d'état du modèle. |
| Disponibilité | Provider/API/panneau | Aucune sonde réelle du modèle et aucun état prêt/dégradé. |
| Mesure initiale | Vitest ciblé | 53 tests réussis, 3 fichiers, durée observée 693 ms ; tests purs/scriptés, pas une mesure de latence réseau ni de qualité d'un modèle réel. |

Installation locale pour tests : `npm ci --ignore-scripts --no-audit --no-fund`, 729 paquets, exit 0. C'est une installation JS sans scripts, pas un `npm ci` complet, pas une vérification npm audit et pas une génération des clients Prisma. Aucun fichier privé .env de production n'a été fourni.

## B. Priorités et critères d'acceptation

1. **P0, sécurité/fiabilité, coût faible** : ne pas envoyer les données métier au modèle ni accepter ses reformulations libres comme faits vérifiés ; maintenir les gardes financiers et la confirmation des actions. Vérifier les entrées, refuser les outils/intentions inconnus et les scores invalides ; aucune exécution de code/HTTP arbitraire.
2. **P1, compréhension et connaissances, coût faible** : corpus local versionné lié à de vrais fichiers/interfaces, recherche lexicale bornée, références visibles ; pas de vecteur/service supplémentaire pour ce petit volume. Gestion des demandes d'aide et des références conversationnelles bornées, sans réutiliser d'anciens résultats métier.
3. **P1, capacité réelle** : adaptateur Anthropic optionnel, activation explicite (confidentialité/coût), modèle configurable, délais/annulation/circuit temporaire ; intentions sur liste blanche seulement. Garder le fonctionnement local sans clé, ne jamais fabriquer de jeton fournisseur.
4. **P1, outils métier** : recherche de dossiers dans le garage authentifié, projection limitée sans prix/notes/secrets, clarification des références ambiguës et distinction retard enregistré/cause inconnue. Aucun changement du contrat des écritures métier.
5. **P1, disponibilité et UX** : état local/modèle confirmé/dégradé/indisponible, sonde bornée et dédupliquée, connaissances prêtes à l'import, annulation côté client, effacement de la conversation. Aucun cache inter-tenant des données métier.
6. **P2, validation** : tests de routage/langage, fournisseurs simulés, prompt injection, RBAC/garage, corps malformés, mémoire, indisponibilité ; mesures de routage avant/après et latence locale distinctes d'une évaluation LLM réelle. Documenter les prérequis et limites restant ouverts.

## Limites de l'autorisation et de la validation

Pas d'entraînement, de service payant lancé, d'appel réel facturé, de nouveau stockage persistant de conversations, de migration, de production, de push ou de merge. Le réseau de cet environnement ne permet pas api.anthropic.com et aucune clé Copilote n'est fournie : qualité/disponibilité/latence d'un modèle réel restent BLOQUÉES. Les tests avec fournisseurs et Prisma simulés ne seront pas déclarés comme intégration réelle. Les versions, budgets JS et gardes de sécurité existants ne doivent pas être assouplis.
