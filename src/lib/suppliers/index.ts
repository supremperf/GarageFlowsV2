/**
 * Supplier quote/order domain — offline-testable core, not a live provider.
 *
 *   import { SupplierEngine, StaticConnector, transition } from '@/lib/suppliers'
 *
 *   // Unit tests/demos only: never use static/fallback catalogues for a live order.
 *   const engine = new SupplierEngine([
 *     new StaticConnector({ id: 'fixture-supplier', name: 'Fixture', favorite: true, catalog }),
 *   ])
 *   const { plan } = await engine.quote(queries)   // ranked + grouped draft orders
 *   const next = transition('draft', 'sent')       // guarded lifecycle step
 *
 * The core is deterministic and offline-testable; real supplier integrations
 * plug in behind the `SupplierConnector` interface.
 */
export * from './types'
export { StaticConnector, FallbackConnector, normalizeKey } from './connectors'
export type { CatalogEntry, StaticSupplierConfig } from './connectors'
export { rankLine, buildGroupedOrders, buildOrderPlan, roundMoney } from './compare'
export {
  ORDER_TRANSITIONS,
  TERMINAL_STATUSES,
  STATUS_LABELS,
  isTerminal,
  canTransition,
  transition,
} from './order'
export type { TransitionResult } from './order'
export { SupplierEngine } from './engine'
export type { QuoteRun } from './engine'
