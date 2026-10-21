/**
 * SÉRIALISATION DES TRANSACTIONS SUR LE POSTE (SQLite).
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * Prisma ouvre ses transactions SQLite en mode DIFFÉRÉ (`BEGIN`). Deux
 * transactions interactives lancées en même temps lisent toutes deux (verrou
 * SHARED), puis veulent écrire (verrou RESERVED) : chacune attend que l'autre
 * relâche son verrou de lecture — interblocage. SQLite ne le résout qu'au bout
 * du délai d'attente (5 s), en faisant ÉCHOUER les perdants (P1008 / P2028).
 *
 * Mesuré sur `commitInvoiceStock` : dix validations simultanées de la même
 * facture → une seule réussit, NEUF échouent en erreur 500 après 5 à 10 s.
 * L'invariant de stock tenait (un seul débit), mais un double-clic sur
 * « Valider » gelait le poste puis affichait une erreur au lieu de répondre
 * « déjà validée ». (`stock-double-deduction.int.test.ts`.)
 *
 * ─── La correction ──────────────────────────────────────────────────────────
 * SQLite n'admet de toute façon qu'UN écrivain à la fois. Le serveur Next du
 * poste est un processus unique : on fait donc passer les transactions de ce
 * processus l'une après l'autre, dans l'ordre d'arrivée. Plus de verrou croisé,
 * plus d'attente de 5 s ; les perdants voient l'état déjà engagé et repartent
 * proprement (idempotence existante).
 *
 * Une transaction ouverte DEPUIS une autre (même contexte asynchrone) n'attend
 * pas la file — elle s'y bloquerait elle-même. Elle garde le comportement
 * d'origine.
 *
 * PostgreSQL (PWA) n'est PAS concerné : ce module n'est branché que sur le
 * client desktop (src/lib/db.ts).
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export interface TxQueue {
  run<T>(task: () => Promise<T>): Promise<T>
}

export function createTxQueue(): TxQueue {
  const inside = new AsyncLocalStorage<true>()
  let tail: Promise<unknown> = Promise.resolve()

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      if (inside.getStore()) return task()
      const result = tail.then(() => inside.run(true, task))
      // La file avance que la tâche réussisse ou échoue.
      tail = result.catch(() => undefined)
      return result
    },
  }
}

/**
 * Fait passer `client.$transaction` (forme interactive ET forme tableau) par
 * une file unique. Retourne le même client.
 */
export function serializeTransactions<C extends { $transaction: (...args: any[]) => any }>(
  client: C,
): C {
  const queue = createTxQueue()
  const original = client.$transaction.bind(client)
  Object.defineProperty(client, '$transaction', {
    configurable: true,
    writable: true,
    value: (...args: unknown[]) => queue.run(() => Promise.resolve(original(...args))),
  })
  return client
}
