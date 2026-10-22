/**
 * Multi-channel notification engine — public entry point.
 *
 *   const engine = new NotificationEngine({ providers: [emailProvider, smsProvider] })
 *   const results = await engine.dispatchTrigger({
 *     trigger: 'vehicle_ready', to: '+33...', context: { clientName, vehicleModel, amount },
 *   })
 *
 * Offline-safe: unconfigured channels yield a 'not_configured' result rather
 * than an error. The notification journal is not treated as recipient delivery;
 * an in-app channel stays disabled until a real recipient-visible inbox exists.
 */
export * from './types'
export { renderTemplate, extractVariables } from './template'
export { DEFAULT_TEMPLATES, getTemplate } from './templates'
export { TRIGGER_CHANNELS, channelsForTrigger } from './triggers'
export { FunctionProvider, InternalProvider, MockProvider } from './channels'
export {
  NotificationEngine,
  renderMessage,
  type NotificationEngineOptions,
  type DispatchInput,
  type TriggerDispatchInput,
} from './engine'
