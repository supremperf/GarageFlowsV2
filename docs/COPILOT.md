<!-- doc-numbers: journal -->
# GarageFlow Copilote — capacités et périmètre

Le copilote conversationnel reste dans la pile Next/React/Prisma existante. Il ajoute une aide applicative sourcée et une recherche d’intervention aux moteurs déterministes existants, avec un classificateur externe facultatif. Il ne prétend pas interroger tous les écrans ni remplacer un assistant généraliste.

## Modules

- `src/lib/copilot/{types,intents,router,actions,engine}.ts` : catalogue et routeur local, extraction VIN/OBD/jours, propositions sans écriture.
- `knowledge.ts` : corpus applicatif versionné compilé avec le code, recherche lexicale bornée et filtrée par permission ; références de fichiers affichées.
- `conversation.ts` : orchestration, aide prioritaire sur les verbes d’action, contexte utilisateur limité, recherche de référence et classification facultative de lectures inconnues.
- `src/lib/copilot-llm/provider.ts` : classificateur Anthropic, opt-in explicite, schéma strict et appel annulable ; pas de génération libre de faits.
- `src/app/api/copilot/route.ts` : session licenciée, garage serveur, limitation de débit, moteurs et lectures réelles, état de disponibilité.
- `src/components/CopilotPanel.tsx` : conversation en RAM, annulation, remise à zéro, sources et confirmation avant ouverture des outils existants.

## Exemples et effet réel

| Demande | Effet |
|---|---|
| « Comment créer un devis ? » | Aide sourcée ; pas de création ni de proposition d’écriture. |
| « Quels devis attendent une réponse ? » | Lecture des devis envoyés du garage connecté, bornée par le résolveur. |
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
- Les lectures réussies retournent leur résultat et un marqueur d’observation ; les erreurs ne donnent pas l’écusson vérifié. Les sources d’aide sont distinctes de cet écusson.
- `GET /api/copilot` : disponibilité authentifiée sans cache, sans sonde payante ou preuve de disponibilité SQL. Voir `COPILOT_LLM.md`.

Les cinq propositions historiques restent des **transferts vers les formulaires**, pas des écritures du chat : rendez-vous, devis, rappel, commande, rapport. Le champ `endpoint` décrit l’API existante ; **ne pas l’appeler depuis le chat avec les paramètres incomplets**. L’enregistrement ou l’envoi doit être confirmé et vérifié dans l’outil métier. Aucune suppression n’est disponible dans le chat.

## Mémoire et connaissances

Historique limité en mémoire du panneau ; aucune persistance serveur/localStorage ou apprentissage depuis les échanges. « Nouvelle conversation » efface les questions et messages du panneau et annule la requête active. Fermer le panneau annule aussi son fetch. Cela ne supprime pas rétroactivement une requête déjà reçue par le serveur/fournisseur, et n’annule pas nécessairement une requête SQL déjà lancée.

Le corpus couvre les fonctionnalités documentées par ses articles, pas tout le dépôt. Pour le modifier : mettre à jour contenu, ancre réelle et version, exécuter les tests, relire la sémantique de la source et faire une revue. Le test d’existence de l’ancre ne suffit pas à prouver que l’aide est fonctionnellement correcte. Pas de documents clients ingérés ni de texte récupéré interprété comme instruction.

## Validation

- `npx vitest run src/lib/copilot/__tests__ src/lib/copilot-llm/__tests__`
- `node scripts/evaluate-copilot.cjs` : corpus local ciblé, comparaison avec le commit de référence ; imports/compilation hors chronométrage. Ce n’est pas une mesure de qualité d’un LLM réel.
- `npx vitest run src/integration/copilot*.test.ts` : vraies bases SQLite temporaires, session fournie par harnais de test ; exige les moteurs et clients Prisma.

État exact, résultats et blocages : `COPILOT_VALIDATION_2026-10-15.md`. Pas de validation navigateur ni de disponibilité réelle Anthropic implicites dans ces commandes.
