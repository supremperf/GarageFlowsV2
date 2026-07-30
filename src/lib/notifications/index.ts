/**
 * Multi-channel notification engine — public entry point.
 *
 *   const engine = new NotificationEngine({ providers: [emailProvider, smsProvider] })
 *   const results = await engine.dispatchTrigger({
 *     trigger: 'vehicle_ready', to: '+33...', context: { clientName, vehicleModel, amount },
 *   })
 *
 * Offline-safe: unconfigured channels yield a 'not_configured' result rather
 * than an error, so a complete journal is always produced.
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
