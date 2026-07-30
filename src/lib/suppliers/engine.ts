/**
 * Supplier engine — orchestrates connectors → comparison → grouped orders.
 *
 * Registers any number of `SupplierConnector`s, fans a batch of part queries out
 * to all of them concurrently, then ranks and groups the collected offers. A
 * connector that throws (transport/credential failure) is isolated: its error is
 * recorded and the run continues with the remaining suppliers.
 */
import { buildOrderPlan } from './compare'
import type {
  CompareOptions,
  OrderPlan,
  PartQuery,
  SupplierConnector,
  SupplierOffer,
} from './types'

export interface QuoteRun {
  plan: OrderPlan
  /** Raw offers gathered, before ranking (useful for auditing / display). */
  offers: SupplierOffer[]
  /** Connectors that failed, with their error message. */
  errors: { supplierId: string; supplierName: string; error: string }[]
}

export class SupplierEngine {
  private readonly connectors = new Map<string, SupplierConnector>()

  constructor(connectors: SupplierConnector[] = []) {
    for (const c of connectors) this.register(c)
  }

  register(connector: SupplierConnector): this {
    this.connectors.set(connector.id, connector)
    return this
  }

  unregister(id: string): this {
    this.connectors.delete(id)
    return this
  }

  list(): SupplierConnector[] {
    return Array.from(this.connectors.values())
  }

  /** Fan out queries to every connector, then rank & group the offers. */
  async quote(queries: PartQuery[], opts: CompareOptions = {}): Promise<QuoteRun> {
    const valid = queries.filter((q) => q.partId && q.quantity > 0)
    const connectors = this.list()

    const settled = await Promise.allSettled(connectors.map((c) => c.quote(valid)))

    const offers: SupplierOffer[] = []
    const errors: QuoteRun['errors'] = []
    settled.forEach((res, i) => {
      const c = connectors[i]
      if (res.status === 'fulfilled') {
        offers.push(...res.value)
      } else {
        errors.push({
          supplierId: c.id,
          supplierName: c.name,
          error: res.reason instanceof Error ? res.reason.message : String(res.reason),
        })
      }
    })

    const plan = buildOrderPlan(valid, offers, opts)
    return { plan, offers, errors }
  }
}
