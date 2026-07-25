export interface GarageSettings {
  name: string; address: string; phone: string; email: string; website: string
  siret: string; vatNumber: string; taxRate: string
  iban: string; bic: string; bankName: string
  currency: string; paymentTerms: string; invoicePrefix: string
  quotePrefix: string; invoiceFooter: string; logoBase64: string; logoPath: string; hourlyRate: string
  workshopStartHour: string; workshopEndHour: string
  smsPhone: string
}

export interface MechanicRecord {
  id: string
  name: string
  avatar: string
  color: string
  specialty: string
  order: number
  isAbsent: boolean
}
