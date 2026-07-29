/**
 * Prompt builders for a real LLM provider. Kept separate so the constraints are
 * explicit and testable. A provider implements `complete` and uses these to
 * back its `classify` / `phrase` methods.
 */
import type { IntentSpec, LlmMessage, PhraseInput } from './types'

/** Messages that ask the model to pick ONE known intent id (or "unknown"). */
export function buildClassifyMessages(query: string, intents: IntentSpec[]): LlmMessage[] {
  const list = intents.map((i) => `- ${i.id}: ${i.label}`).join('\n')
  return [
    {
      role: 'system',
      content:
        'Tu classes la demande de l’utilisateur dans EXACTEMENT une des intentions ci-dessous. ' +
        'Réponds uniquement par un JSON {"intentId": "<id>", "confidence": <0..1>}. ' +
        'Si aucune ne convient, réponds intentId "unknown". N’invente jamais d’identifiant hors de la liste.\n\n' +
        `Intentions:\n${list}`,
    },
    { role: 'user', content: query },
  ]
}

/**
 * Messages that ask the model to phrase an answer using ONLY the given facts —
 * the grounding guard rejects any figure it adds anyway, but the instruction
 * keeps it honest.
 */
export function buildPhraseMessages(input: PhraseInput): LlmMessage[] {
  return [
    {
      role: 'system',
      content:
        'Tu es l’assistant d’un garage. Reformule la réponse de façon naturelle et concise, en français. ' +
        'RÈGLE ABSOLUE : n’utilise QUE les chiffres et faits fournis ci-dessous. ' +
        'N’invente aucun montant, aucune quantité, aucune date. Ne calcule rien de nouveau. ' +
        'Si tu n’es pas sûr, garde la formulation fournie.',
    },
    {
      role: 'user',
      content: `Question: ${input.query}\n\nFaits (source de vérité):\n${input.facts}\n\nFormulation de repli: ${input.fallback}`,
    },
  ]
}
