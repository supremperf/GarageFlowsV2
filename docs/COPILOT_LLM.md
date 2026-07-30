# Module Premium — Copilot IA : couche LLM (avec garde anti-hallucination)

Ajoute au **Copilot** une couche **langage naturel** derrière une interface
`LlmProvider` pluggable. Règle de sécurité **absolue** (exigée par le cahier des
charges) : **le LLM ne fait que reformuler ; les chiffres restent
déterministes**. Toute formulation du modèle passe une **garde d'ancrage** qui
rejette tout nombre absent des faits et retombe sur le texte déterministe. Le
tout fonctionne **sans aucun provider** (classification déterministe + faits
verbatim).

## Architecture

```
src/lib/copilot-llm/
├── types.ts     # LlmProvider, LlmMessage, IntentSpec, PhraseInput, résultats
├── ground.ts    # parseLoose, extractNumbers, isGrounded, enforceGrounding
├── classify.ts  # ruleClassify (fallback) + classifyIntent (provider → fallback)
├── prompts.ts   # buildClassifyMessages / buildPhraseMessages (contraints)
├── phrase.ts    # phraseAnswer (garde d'ancrage + repli)
├── provider.ts  # resolveLlmProvider (null par défaut → Copilot déterministe)
└── index.ts
```

## Garde d'ancrage (anti-hallucination)

`isGrounded(phrasing, facts)` extrait **tous les nombres** de la formulation et
exige que **chacun** figure (par valeur, à tolérance près) dans les faits (FR ou
EN : « 1 234,56 », « 12 000 », « 93.6 »). Une phrase sans nombre est ancrée par
défaut. `phraseAnswer` :

1. sans provider → renvoie le **repli déterministe** verbatim ;
2. avec provider → si la formulation est **ancrée** (dans les faits + la
   question), on l'utilise ; sinon on la **rejette** et on garde le texte
   déterministe (`source: 'fallback_ungrounded'`) ; une erreur/undefined du
   provider retombe aussi sur le repli.

## Classification d'intention

`classifyIntent(query, intents, provider?)` préfère la classification du provider
**mais uniquement si elle nomme une intention connue** — un identifiant halluciné
est **rejeté** et l'on retombe sur `ruleClassify` (score de mots-clés à frontière
de mot). Sans provider, tout passe par le fallback déterministe.

## Provider réel (non fourni)

`resolveLlmProvider()` renvoie `null` par défaut : le Copilot reste 100 %
déterministe. Un vrai provider implémente `complete(messages)` (appel API) puis
`classify` / `phrase` via les *prompt builders* — voir l'exemple commenté dans
`provider.ts` (activation par variable d'environnement + politique réseau). Les
prompts **contraignent** explicitement le modèle (une intention de la liste ;
« n'utilise QUE les chiffres fournis »), et la garde d'ancrage reste le filet de
sécurité même si le modèle ignore l'instruction.

## Intégration `/api/copilot`

La réponse gagne un champ **`phrasing`** : avec un provider configuré, la
formulation naturelle **ancrée** ; sinon `res.message` verbatim. Les faits
transmis incluent les données déterministes (`res.data`), donc toute reformulation
est vérifiée contre les vrais nombres. Aucune régression : le Copilot déterministe
et ses actions confirmées restent inchangés.

## Tests

`src/lib/copilot-llm/__tests__/copilot-llm.test.ts` — 18 tests : parsing FR/EN,
extraction de nombres, **ancrage** (accepte les faits, rejette un nombre inventé,
phrase sans nombre), `enforceGrounding`, `ruleClassify`, `classifyIntent`
(provider valide, **intention hallucinée rejetée**, provider en erreur, sans
provider), `phraseAnswer` (ancrée → LLM, **hallucination → repli**, erreur/vide →
repli, sans provider → repli), et les *prompt builders* contraints. Un provider
« scripté » (de test) simule un modèle qui hallucine pour prouver la garde.

## Vision

Cette couche réalise l'« Assistant conversationnel » du Copilot sans jamais
laisser un modèle inventer un chiffre. À venir : provider Claude réel derrière
l'interface, extraction de créneaux (slots) assistée, et mémoire de conversation.
