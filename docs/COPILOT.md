<!-- doc-numbers: journal -->
# GarageFlow Copilote — capacités et périmètre

Le copilote conversationnel reste dans la pile Next/React/Prisma existante. Il ajoute une aide applicative sourcée et une recherche d’intervention aux moteurs déterministes existants, avec un planificateur externe facultatif et un exécuteur de lectures contrôlé. Il ne prétend pas interroger tous les écrans ni remplacer un assistant généraliste.

## Modules

- `src/lib/copilot/{types,intents,router,actions,engine}.ts` : catalogue et routeur local, extraction VIN/OBD/jours, propositions sans écriture.
- `knowledge.ts` : corpus applicatif versionné compilé avec le code, recherche lexicale bornée et filtrée par permission ; références de fichiers affichées.
- `conversation.ts` : orchestration, aide prioritaire sur les verbes d’action, contexte utilisateur limité, recherche de référence, sélection documentaire et planification facultative de lectures ; routeur historique conservé en repli.
- `tools.ts` : catalogue fermé (12 lectures, 5 transferts vers formulaires), schémas, droits et vérification.
- `planning.ts` / `execution.ts` : sélection de sources et plan de trois lectures indépendantes maximum ; validation du plan entier avant le premier appel, traces des résultats et erreurs.
- `server-readers.ts` : résolveurs existants déplacés sans réécriture des calculs, contrôle de permission au dispatch ; sondes de ressources du rôle pour la disponibilité.
- `src/lib/copilot-llm/provider.ts` : planificateur Anthropic, opt-in explicite, schéma strict et appel annulable ; pas de génération libre de faits.
- `src/app/api/copilot/route.ts` : session licenciée, garage serveur, limitation de débit, moteurs et lectures réelles, état de disponibilité.
- `src/components/CopilotPanel.tsx` : conversation en RAM, annulation, remise à zéro, sources et confirmation avant ouverture des outils existants.

## Exemples et effet réel

| Demande | Effet |
|---|---|
| « Comment créer un devis ? » | Aide sourcée ; pas de création ni de proposition d’écriture. |
| « Quels devis attendent une réponse ? » | Lecture des devis envoyés du garage connecté, bornée par le résolveur. |
| « CA du jour et stock bas » | Deux lectures indépendantes, chacune revalidée et observée ; aucune commande effectuée. |
| « Quelle est la marge ? » | Calcul existant, accès financier requis ; période indiquée dans la réponse. |
| « Retrouve le dossier AB-123-CD » | Recherche d’interventions par immatriculation, droit `job:manage`, garage de la session. |
| « Retrouve le dossier de Dupont » | Recherche par nom, au plus cinq résultats affichés ; préciser si ambigu. |
| « Et son statut ? » après une recherche de dossier | Réutilise uniquement la référence utilisateur et relit la base ; pas de reprise d’un ancien résultat. |
| « Crée un devis » | Proposition, contrôle de droit et confirmation ; ouvre Facturation. Aucun POST de paramètres vides. |
| « Oui » après une proposition | Demande d’utiliser les boutons ; n’exécute rien depuis le texte. |

Le chat n’invente pas une cause de blocage : une intervention peut présenter un retard enregistré sans cause connue. Les diagnostics restent des pistes du moteur et les prévisions ne sont pas du réalisé.

## API et contexte

- `POST /api/copilot` : `{ query, history?: [{ role: 'user', content }] }` ; question de 1 à 500 caractères, au plus six questions précédentes de même taille. Schéma strict : les rôles système/assistant, identifiants de garage et champs inconnus sont refusés. Corps lu en flux, limité à 20 000 octets.
- L’historique est fourni par le client et donc **non fiable**. Il ne peut accorder un droit, changer le tenant, contenir des faits métier faisant autorité ou confirmer une action.
- La recherche d’intervention ne sélectionne ni notes, ni contacts, ni coûts. Une plaque SIV est normalisée ; le nom reste une recherche textuelle dont la casse dépend du moteur de base. Pas encore de recherche exhaustive FNI/VIN/client/document.
- Les plans exécutables sont limités à trois lectures indépendantes. Un champ SQL/URL/garage/écriture ou un appel interdit fait rejeter le plan avant toute lecture. La fin du délai coupe le signal d’exécution et empêche les appels suivants, mais Prisma peut poursuivre une requête SQL déjà lancée.
- Les lectures réussies retournent leur résultat et un marqueur d’observation ; les erreurs ne donnent pas l’écusson vérifié. Les sources d’aide sont distinctes de cet écusson.
- `GET /api/copilot` : disponibilité authentifiée sans cache, sans sonde payante ; sondes SQL bornées au garage et aux ressources accessibles au rôle, HTTP 503 si une dépendance essentielle est indisponible. Voir `COPILOT_LLM.md`.

Les cinq propositions historiques restent des **transferts vers les formulaires**, pas des écritures du chat : rendez-vous, devis, rappel, commande, rapport. Le champ `endpoint` décrit l’API existante ; **ne pas l’appeler depuis le chat avec les paramètres incomplets**. L’enregistrement ou l’envoi doit être confirmé et vérifié dans l’outil métier. Aucune suppression n’est disponible dans le chat.

## Mémoire et connaissances

Historique limité en mémoire du panneau ; aucune persistance serveur/localStorage ou apprentissage depuis les échanges. « Nouvelle conversation » efface les questions et messages du panneau et annule la requête active. Fermer le panneau annule aussi son fetch. Cela ne supprime pas rétroactivement une requête déjà reçue par le serveur/fournisseur, et n’annule pas nécessairement une requête SQL déjà lancée.

Le corpus couvre les fonctionnalités documentées par ses articles, pas tout le dépôt. Pour le modifier : mettre à jour contenu, ancre réelle et version, exécuter les tests, relire la sémantique de la source et faire une revue. Le test d’existence de l’ancre ne suffit pas à prouver que l’aide est fonctionnellement correcte. Pas de documents clients ingérés ni de texte récupéré interprété comme instruction.

## Validation

- `npx vitest run src/lib/copilot/__tests__ src/lib/copilot-llm/__tests__`
- `node scripts/evaluate-copilot.cjs` : corpus local ciblé, comparaison avec le commit de référence ; imports/compilation hors chronométrage. Ce n’est pas une mesure de qualité d’un LLM réel.
- `npx vitest run src/integration/copilot*.test.ts` : vraies bases SQLite temporaires, session fournie par harnais de test ; exige les moteurs et clients Prisma.

Baseline historique : `COPILOT_VALIDATION_2026-10-15.md`. Phase 2 : `COPILOT_PHASE2_VALIDATION.md` et `COPILOT_PHASE2_AUDIT.md`. Pas de validation navigateur ni de disponibilité réelle Anthropic implicites dans ces commandes.

Le résumé de contexte reste dérivé de six questions : thèmes et disponibilité de paramètres seulement pour le modèle, références reliées localement au texte utilisateur. Pas de stockage d’objectif/confirmation/résultat durable. Hors fenêtre, demander à nouveau la référence plutôt que fabriquer une continuité. Les anciennes réponses ne deviennent pas des faits.

Évaluation élargie : `node scripts/evaluate-copilot-phase2.cjs` (68 scénarios de développement, dont réponses de planificateur scriptées ; pas qualité d’un vrai modèle). Un plan de lectures indépendantes n’est pas une boucle de raisonnement autonome avec des décisions dépendant des résultats précédents.

Phase 3 : `COPILOT_PHASE3_VALIDATION.md` et `COPILOT_PHASE3_MODEL_PROTOCOL.md`. Annulation du planificateur propagée depuis la requête ; résultat non confirmé sans payload/texte sensible dans les observations ; corpus de nouvelles formulations séparé des anciens scénarios scriptés. Aucun modèle réel ni démarrage production validé ici.

## Phase 4 — couche sémantique contrôlée, validation partielle

Voir [le rapport phase 4](COPILOT_PHASE4_VALIDATION.md), [le protocole opérateur](COPILOT_PHASE4_OPERATOR_RUNBOOK.md) et `COPILOT_PHASE4_EVIDENCE.json`. IR strict et liaison backend ajoutés, sans nouveaux outils/écritures ; les simulations ne prouvent pas la compréhension réelle. Le repli local échoue sur 31 des 48 cas de validation figés. Aucun statut production ni appel payant autorisé par cette documentation.
