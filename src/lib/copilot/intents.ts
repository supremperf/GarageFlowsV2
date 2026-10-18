/**
 * Intent catalogue. Multi-word keywords are more specific and score higher.
 * `resolver` names the module the API calls for a read intent.
 */
import type { IntentId, IntentKind } from './types'

export interface IntentDef {
  id: IntentId
  kind: IntentKind
  keywords: string[]
  resolver?: string
}

export const INTENTS: IntentDef[] = [
  // ── Read intents (answered with real data) ─────────────────────────────────
  { id: 'pending_quotes', kind: 'read', resolver: 'quotes_pending', keywords: ['devis en attente', 'devis attendent', 'quels devis', 'devis a valider', 'reponse au devis', 'devis sans reponse'] },
  { id: 'today_revenue', kind: 'read', resolver: 'revenue_today', keywords: ["chiffre d'affaires", 'chiffre d affaires', 'ca du jour', "ca d'aujourd", 'ca aujourd', 'recette du jour'] },
  { id: 'margin', kind: 'read', resolver: 'margin', keywords: ['marge', 'rentabilite', 'benefice'] },
  { id: 'late_vehicles', kind: 'read', resolver: 'late_vehicles', keywords: ['vehicules en retard', 'en retard', 'vehicules bloques', 'vehicules du jour'] },
  { id: 'low_stock', kind: 'read', resolver: 'low_stock', keywords: ['rupture de stock', 'rupture', 'stock bas', 'stock faible', 'reapprovision', 'reapprovisionnement', 'pieces manquantes', 'stock a commander'] },
  { id: 'available_mechanics', kind: 'read', resolver: 'available_mechanics', keywords: ['mecaniciens disponibles', 'qui est disponible', 'mecaniciens libres', 'disponibilite des mecaniciens'] },
  { id: 'top_clients', kind: 'read', resolver: 'top_clients', keywords: ['meilleurs clients', 'top clients', 'cinq meilleurs', 'clients les plus rentables'] },
  { id: 'proactive', kind: 'read', resolver: 'proactive', keywords: ['priorites', 'a faire', 'urgences', 'alertes', 'quoi faire', 'que dois-je faire'] },
  { id: 'forecast_revenue', kind: 'read', resolver: 'forecast', keywords: ['prevision', 'previsions', 'tendance', 'va evoluer', 'prevoir le chiffre', 'projection'] },
  { id: 'diagnostic', kind: 'read', resolver: 'diagnostic', keywords: ['diagnostic', 'panne', 'symptome', 'voyant moteur', 'voyant', 'bruit', 'fumee', 'code defaut', 'vibration', 'perte de puissance'] },
  { id: 'vin_decode', kind: 'read', resolver: 'vin', keywords: ['vin', 'numero de chassis', 'decoder le vin', 'chassis'] },

  // ── Action intents (ALWAYS confirmation-gated) ─────────────────────────────
  { id: 'create_appointment', kind: 'action', keywords: ['creer un rendez-vous', 'cree un rendez-vous', 'creez un rendez-vous', 'prendre rendez-vous', 'planifier un rendez-vous', 'nouveau rendez-vous', 'creer un rdv', 'cree un rdv', 'ajouter un rdv'] },
  { id: 'create_quote', kind: 'action', keywords: ['creer un devis', 'cree un devis', 'creez un devis', 'faire un devis', 'nouveau devis', 'etablir un devis', 'preparer un devis'] },
  { id: 'send_reminder', kind: 'action', keywords: ['envoyer un rappel', 'envoie un rappel', 'envoyer rappel', 'relancer', 'relance', 'rappel client'] },
  { id: 'order_parts', kind: 'action', keywords: ['commander des pieces', 'commande des pieces', 'passer commande', 'commande fournisseur', 'commander'] },
  { id: 'generate_report', kind: 'action', keywords: ['generer un rapport', 'genere un rapport', 'creer un rapport', 'cree un rapport', 'faire un rapport', 'exporter'] },
]

export function intentById(id: IntentId): IntentDef | undefined {
  return INTENTS.find((i) => i.id === id)
}
