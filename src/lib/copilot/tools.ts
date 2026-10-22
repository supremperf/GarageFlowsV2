/** Closed catalogue. Schema/permissions are server policy, never model output. */
import { z } from 'zod'
import { can, type Permission } from '@/lib/authz'
import { INTENTS } from './intents'
import type { CopilotResponse, IntentId } from './types'

const Empty = z.object({}).strict()
const VinInput = z.object({ vin: z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/) }).strict()
const DiagnosticInput = z.object({ text: z.string().trim().max(500), obdCode: z.string().regex(/^[PCBU][0-3][0-9A-F]{3}$/).optional() }).strict()
const JobInput = z.object({ reference: z.string().trim().min(2).max(60) }).strict()
export interface ToolDefinition {
  id: string; title: string; kind: 'read' | 'handoff'; permission: Permission | null
  resolver?: string; intent?: IntentId; schema: z.ZodType
  parameters: string; access: string; confirmation: string; verification: string
  errors: readonly string[]; period?: string
}
const READ_DETAILS: Record<string, [string, Permission | null, string, string, string?]> = {
  pending_quotes: ['Devis envoyés sans réponse', 'quote:manage', 'Numéro/client/ancienneté, maximum 50, garage connecté', 'Relire les devis envoyés'],
  today_revenue: ['CA HT payé aujourd’hui', 'financial:read', 'Factures payées du jour du garage', 'Moteur billing depuis lignes persistées', 'today'],
  margin: ['Marge de la période historique du moteur', 'financial:read', 'Factures et pièces du dernier mois, garage connecté', 'Moteur profitability ; période annoncée, pas arbitraire', 'last_month'],
  late_vehicles: ['Véhicules en retard aujourd’hui', 'job:manage', 'Interventions du jour non terminées, retard enregistré', 'Relire statut et retard déclaré', 'today'],
  low_stock: ['Pièces à réapprovisionner', 'job:manage', 'Stock/consommation garage, coûts retirés sans financial:read', 'Moteur stock-forecast et redaction existante'],
  available_mechanics: ['Mécaniciens non absents', 'job:manage', 'Noms de mécaniciens non absents, pas une réservation de créneau', 'Relire le drapeau d’absence'],
  top_clients: ['Meilleurs clients par CA payé', 'financial:read', 'Agrégats des factures payées du garage', 'Moteur billing, au plus cinq clients'],
  proactive: ['Priorités stock et devis', 'job:manage', 'Ruptures urgentes et compte des devis envoyés du garage', 'Deux lectures ; pas une cause certaine ni une action exécutée'],
  forecast_revenue: ['Prévision CA du mois prochain', 'financial:read', 'Historique mensuel payé du garage', 'Moteur forecast, estimations explicitement distinctes du réalisé', 'next_month'],
  diagnostic: ['Pistes de diagnostic', null, 'Base diagnostic locale et symptômes utilisateur, pas dossier patient/véhicule vérifié', 'Causes possibles, jamais diagnostic certain'],
  vin_decode: ['Décodage VIN', null, 'VIN explicite utilisateur ; moteur existant', 'Résultat du moteur VIN, champs inconnus conservés'],
}
const HANDOFF_PERMISSIONS: Record<string, Permission> = { create_appointment: 'job:manage', create_quote: 'quote:manage', send_reminder: 'customer:manage', order_parts: 'stock:manage', generate_report: 'financial:read' }
export const TOOLS: readonly ToolDefinition[] = [
  ...INTENTS.map(i => {
    if (i.kind === 'action') return { id: i.id, intent: i.id,
      title: i.id === 'order_parts' ? 'Ouvrir le suivi des commandes fournisseurs' : i.keywords[0], kind: 'handoff' as const,
      permission: HANDOFF_PERMISSIONS[i.id], schema: Empty,
      parameters: i.id === 'order_parts' ? 'Aucun champ envoyé ; le suivi des commandes existantes s’ouvre. Aucune commande automatique sans intégration réelle.' : 'Aucun champ métier envoyé : compléter dans l’outil dédié',
      access: 'Ouverture d’un outil existant uniquement ; aucune écriture depuis le chat',
      confirmation: i.id === 'order_parts' ? 'La confirmation ouvre le panneau ; elle ne crée ni n’envoie une commande.' : 'Confirmation du chat puis validation effective dans le formulaire',
      verification: i.id === 'order_parts' ? 'Le panneau liste uniquement les commandes déjà enregistrées. Aucun prix, stock fournisseur ou délai n’est vérifié.' : 'Le chat vérifie seulement la proposition. Vérifier création/envoi dans l’outil après sa réponse serveur.',
      errors: i.id === 'order_parts' ? ['forbidden', 'needs_confirmation', 'integration_unavailable'] : ['forbidden', 'needs_confirmation', 'form_unavailable'] }
    const [title, permission, access, verification, period] = READ_DETAILS[i.id]
    return { id: i.id, intent: i.id, title, kind: 'read' as const, permission, resolver: i.resolver,
      schema: i.id === 'vin_decode' ? VinInput : i.id === 'diagnostic' ? DiagnosticInput : Empty,
      parameters: i.id === 'vin_decode' ? 'vin: 17 caractères VIN extraits du texte utilisateur' : i.id === 'diagnostic' ? 'text: symptôme utilisateur <=500 ; obdCode optionnel extrait localement' : 'Aucun paramètre libre ; période fixée par le moteur',
      access, confirmation: 'Aucune écriture ; session licenciée et permission serveur requises', verification, period,
      errors: ['forbidden', 'invalid_input', 'unavailable', 'timeout', 'unverified'] }
  }),
  { id: 'job_search', title: 'Recherche d’interventions', kind: 'read', permission: 'job:manage', resolver: 'job_search', schema: JobInput,
    parameters: 'reference: plaque SIV ou nom explicite, 2..60 caractères, lié au texte utilisateur local', access: 'Interventions du garage ; pas notes, prix, contacts ; au plus cinq affichées',
    confirmation: 'Lecture uniquement', verification: 'Relire la base à chaque tour ; homonymes/plus de cinq résultats à préciser ; cause du retard inconnue',
    errors: ['forbidden', 'invalid_input', 'not_found', 'ambiguous', 'timeout', 'unavailable'] },
]
export interface ToolCall { toolId: string; input: Record<string, unknown> }
export function toolAllowed(tool: ToolDefinition, role: string): boolean {
  return ['OWNER', 'MANAGER', 'RECEPTIONIST'].includes(role) && (!tool.permission || can(role, tool.permission))
}
export function allowedTools(role: string): ToolDefinition[] { return TOOLS.filter(t => toolAllowed(t, role)) }
export function validateCall(value: unknown, role: string): ToolCall {
  const parsed = z.object({ toolId: z.string(), input: z.record(z.string(), z.unknown()) }).strict().parse(value)
  const tool = TOOLS.find(t => t.id === parsed.toolId)
  if (!tool || tool.kind !== 'read') throw new Error('unknown_tool')
  if (!toolAllowed(tool, role)) throw new Error('forbidden')
  return { toolId: tool.id, input: tool.schema.parse(parsed.input) as Record<string, unknown> }
}
export function responseForCall(call: ToolCall): CopilotResponse {
  const tool = TOOLS.find(t => t.id === call.toolId)!
  return { type: 'answer', intent: tool.intent ?? null, resolver: tool.resolver, confidence: 'medium', message: '',
    slots: { ...(call.input.vin ? { vin: String(call.input.vin) } : {}), ...(call.input.obdCode ? { obdCode: String(call.input.obdCode) } : {}),
      ...(call.input.reference || call.input.text ? { text: String(call.input.reference ?? call.input.text) } : {}) } }
}
/** Executable list exposed to model: no schemas with arbitrary SQL/URLs or data from a garage. */
export function toolDescriptions(role: string) {
  return allowedTools(role).map(({ id, title, kind, parameters, period }) => ({ id, title, kind, parameters, period }))
}
export function permissionForResolver(resolver: string): Permission | null | undefined {
  return TOOLS.find(t => t.kind === 'read' && t.resolver === resolver)?.permission
}
