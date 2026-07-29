/**
 * Default notification templates (French). Each is keyed by the trigger name.
 * Variables use the {{ path }} syntax and can be overridden per garage later.
 */
import { extractVariables } from './template'
import type { NotificationTrigger, TemplateDef } from './types'

function tpl(key: string, subject: string, body: string): TemplateDef {
  const variables = Array.from(new Set(extractVariables(subject).concat(extractVariables(body))))
  return { key, subject, body, variables }
}

export const DEFAULT_TEMPLATES: Record<NotificationTrigger, TemplateDef> = {
  appointment_reminder: tpl(
    'appointment_reminder',
    'Rappel de rendez-vous — {{ garageName }}',
    'Bonjour {{ clientName }},\nNous vous rappelons votre rendez-vous le {{ date | date }}{{ time | default:"" }} pour {{ vehicleModel | default:"votre véhicule" }}.\nÀ bientôt,\n{{ garageName }}',
  ),
  maintenance_due: tpl(
    'maintenance_due',
    'Entretien recommandé — {{ vehicleModel }}',
    'Bonjour {{ clientName }},\nL\'entretien de {{ vehicleModel }} ({{ licensePlate }}) est recommandé ({{ reason | default:"échéance kilométrique/temps" }}). Contactez-nous pour planifier.\n{{ garageName }}',
  ),
  vehicle_ready: tpl(
    'vehicle_ready',
    'Votre véhicule est prêt — {{ garageName }}',
    'Bonjour {{ clientName }},\n{{ vehicleModel }} ({{ licensePlate }}) est prêt. Montant : {{ amount | currency }}.\nVous pouvez venir le récupérer.\n{{ garageName }}',
  ),
  delay: tpl(
    'delay',
    'Information sur votre intervention — {{ garageName }}',
    'Bonjour {{ clientName }},\nL\'intervention sur {{ vehicleModel }} prend un peu de retard. Nouvelle estimation : {{ newDate | date }}. Merci de votre compréhension.\n{{ garageName }}',
  ),
  quote_accepted: tpl(
    'quote_accepted',
    'Devis {{ number }} accepté',
    'Le devis {{ number }} ({{ amount | currency }}) a été accepté par {{ clientName }}. Vous pouvez lancer l\'intervention.',
  ),
  quote_refused: tpl(
    'quote_refused',
    'Devis {{ number }} refusé',
    'Le devis {{ number }} a été refusé par {{ clientName }}. Un suivi commercial est peut-être opportun.',
  ),
  invoice_overdue: tpl(
    'invoice_overdue',
    'Facture {{ number }} impayée',
    'Bonjour {{ clientName }},\nLa facture {{ number }} de {{ amount | currency }} (échéance {{ dueDate | date }}) reste impayée. Merci de procéder au règlement.\n{{ garageName }}',
  ),
  warranty_expiring: tpl(
    'warranty_expiring',
    'Garantie bientôt échue — {{ vehicleModel }}',
    'Bonjour {{ clientName }},\nLa garantie pièce « {{ partName }} » de {{ vehicleModel }} expire le {{ expiresAt | date }}.\n{{ garageName }}',
  ),
  order_received: tpl(
    'order_received',
    'Commande {{ number }} réceptionnée',
    'La commande fournisseur {{ number }} a été réceptionnée et le stock a été mis à jour.',
  ),
  stock_out: tpl(
    'stock_out',
    'Rupture de stock — {{ partName }}',
    'La pièce « {{ partName }} » ({{ reference | default:"réf. inconnue" }}) est en rupture (quantité {{ quantity }}). Pensez à réapprovisionner.',
  ),
}

export function getTemplate(key: string): TemplateDef | null {
  return (DEFAULT_TEMPLATES as Record<string, TemplateDef>)[key] ?? null
}
