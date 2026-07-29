# Module Premium — GarageFlow AI Copilot (cœur)

Le **cerveau conversationnel** de GarageFlow : comprend les questions métier,
**route vers le bon moteur** (parmi les 13 modules), répond avec des **données
réelles**, et **prépare** les actions à impact en exigeant **toujours une
confirmation** avant exécution.

## Architecture

```
src/lib/copilot/
├── types.ts    # IntentId, Classification, PreparedAction, CopilotResponse
├── intents.ts  # catalogue d'intentions (lecture / action) + mots-clés + resolver
├── router.ts   # classify : classification + extraction de slots (VIN/OBD/jours)
├── actions.ts  # prepareAction : proposition d'action (toujours confirmation requise)
├── engine.ts   # handleQuery : classe → répond (lecture) ou propose (action)
└── index.ts
```

Le cœur est **déterministe** (routeur par mots-clés + extraction), donc testable
et sûr. Un LLM pourra **augmenter** la classification plus tard sans changer le
**contrat de confirmation** : le copilote **n'exécute jamais** d'écriture.

## Intentions

**Lecture** (répondues avec des données réelles) : devis en attente, CA du jour,
marge, véhicules en retard, stock à commander, mécaniciens disponibles, meilleurs
clients, priorités (assistant proactif), prévision de CA, diagnostic (symptôme /
code OBD extrait), décodage VIN (VIN extrait).

**Action** (proposition **confirmation-gated**) : créer un rendez-vous, créer un
devis, envoyer un rappel, commander des pièces, générer un rapport. La réponse
contient une `PreparedAction { endpoint, method, params, confirmationRequired: true }`
que l'UI exécute **après** validation — jamais le copilote.

## Extraction de slots

VIN (17 car.), code OBD (`[PCBU][0-3][0-9A-F]{3}`), durée en jours ; le texte
restant sert de symptôme pour le diagnostic.

## API

- `POST /api/copilot` `{ query }` → authentifié, rate-limité. Classe la question ;
  pour une **lecture**, appelle le resolver (Prisma + moteurs Profitabilité /
  Prévisions / Stock prédictif / Diagnostic / VIN…) et renvoie message + data ;
  pour une **action**, renvoie une proposition à confirmer (**aucune écriture**).

## Tests

`src/lib/copilot/__tests__/copilot.test.ts` — 12 tests : routage des intentions
de lecture (devis, marge, priorités), extraction VIN/OBD, distinction
lecture/action, inconnu, **gating de confirmation** (toute action est
`confirmationRequired: true`), `handleQuery` (answer / action_proposal / unknown).

## Vision
Chaque écran, chaque donnée devient interrogeable et actionnable via le copilote —
au-dessus des 13 moteurs métier livrés, avec validation humaine systématique pour
toute action à impact (conforme au cahier des charges). Prochaine étape :
augmentation LLM (multi-fournisseur) + mémoire conversationnelle + RAG sur les
données du garage, au-dessus de ce socle déterministe et traçable.
