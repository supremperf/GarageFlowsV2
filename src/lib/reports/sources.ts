/**
 * Report data-source registry — metadata about the sources the API can load and
 * the fields available on each (for editor autocompletion / validation).
 */
export type FieldType = 'string' | 'number' | 'date'

export interface ReportField {
  key: string
  label: string
  type: FieldType
}

export interface ReportSourceDef {
  label: string
  fields: ReportField[]
}

export const REPORT_SOURCES: Record<string, ReportSourceDef> = {
  invoices: {
    label: 'Factures',
    fields: [
      { key: 'number', label: 'Numéro', type: 'string' },
      { key: 'status', label: 'Statut', type: 'string' },
      { key: 'issueDate', label: "Date d'émission", type: 'date' },
      { key: 'clientName', label: 'Client', type: 'string' },
      { key: 'totalHT', label: 'Total HT', type: 'number' },
      { key: 'totalTTC', label: 'Total TTC', type: 'number' },
      { key: 'taxRate', label: 'TVA %', type: 'number' },
    ],
  },
  parts: {
    label: 'Pièces (stock)',
    fields: [
      { key: 'reference', label: 'Référence', type: 'string' },
      { key: 'name', label: 'Nom', type: 'string' },
      { key: 'quantity', label: 'Quantité', type: 'number' },
      { key: 'minQuantity', label: 'Seuil mini', type: 'number' },
      { key: 'unitCost', label: 'Coût', type: 'number' },
      { key: 'unitPrice', label: 'Prix', type: 'number' },
      { key: 'location', label: 'Emplacement', type: 'string' },
    ],
  },
  clients: {
    label: 'Clients',
    fields: [
      { key: 'name', label: 'Nom', type: 'string' },
      { key: 'email', label: 'Email', type: 'string' },
      { key: 'phone', label: 'Téléphone', type: 'string' },
      { key: 'address', label: 'Adresse', type: 'string' },
      { key: 'createdAt', label: 'Créé le', type: 'date' },
    ],
  },
  jobs: {
    label: 'Interventions',
    fields: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'customerName', label: 'Client', type: 'string' },
      { key: 'vehicleModel', label: 'Véhicule', type: 'string' },
      { key: 'licensePlate', label: 'Immatriculation', type: 'string' },
      { key: 'repairType', label: 'Type', type: 'string' },
      { key: 'status', label: 'Statut', type: 'string' },
      { key: 'estimatedDuration', label: 'Durée estimée (min)', type: 'number' },
      { key: 'mechanicName', label: 'Mécanicien', type: 'string' },
    ],
  },
}

export function isValidSource(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(REPORT_SOURCES, name)
}
