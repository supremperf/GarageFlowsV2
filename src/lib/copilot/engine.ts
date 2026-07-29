/**
 * Copilot orchestration (pure). Classifies a query and either routes a read
 * intent (the API resolves the data) or prepares a confirmation-gated action.
 */
import { prepareAction } from './actions'
import { intentById } from './intents'
import { classify } from './router'
import type { CopilotResponse } from './types'

export function handleQuery(text: string): CopilotResponse {
  const c = classify(text)

  if (c.kind === 'unknown' || !c.intent) {
    return {
      type: 'unknown',
      intent: null,
      message:
        "Je n'ai pas compris la demande. Essayez par ex. « Quels devis attendent une réponse ? », " +
        '« Quelle est la marge du mois ? » ou « Crée un devis ».',
      confidence: c.confidence,
      slots: c.slots,
    }
  }

  if (c.kind === 'action') {
    const action = prepareAction(c.intent, c.slots)
    return {
      type: 'action_proposal',
      intent: c.intent,
      message: `Souhaitez-vous que je prépare : ${action?.summary} ? Cette action nécessite votre confirmation.`,
      action: action ?? undefined,
      confidence: c.confidence,
      slots: c.slots,
    }
  }

  // Read intent — the API fills `data` + `message` via the named resolver.
  const def = intentById(c.intent)
  return {
    type: 'answer',
    intent: c.intent,
    message: '',
    resolver: def?.resolver,
    confidence: c.confidence,
    slots: c.slots,
  }
}
