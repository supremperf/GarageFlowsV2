export interface GarageSettings {
  name: string; address: string; phone: string; email: string; website: string
  siret: string; vatNumber: string; taxRate: string
  iban: string; bic: string; bankName: string
  currency: string; paymentTerms: string; invoicePrefix: string
  quotePrefix: string; invoiceFooter: string; logoBase64: string; logoPath: string; hourlyRate: string
  workshopStartHour: string; workshopEndHour: string
  /** Minutes des bornes — `'0'` ou `'30'` (granularité demi-heure, GF-021). */
  workshopStartMinute: string; workshopEndMinute: string
  smsPhone: string
}

export interface MechanicRecord {
  id: string
  name: string
  /** Initiales de REPLI, affichées tant qu'aucune photo n'existe. */
  avatar: string
  color: string
  specialty: string
  order: number
  isAbsent: boolean
  /**
   * URL servie de la photo de profil, calculée par `GET /api/mechanics` à partir
   * de la clé de stockage. `null` quand il n'y a pas de photo.
   *
   * Elle n'est jamais stockée en base : une URL figée deviendrait fausse au
   * moindre changement de route, et contournerait le contrôle d'appartenance
   * qu'applique la route de service.
   */
  avatarUrl?: string | null
  /** Date d'archivage ; `null`/absent = mécanicien actif. */
  archivedAt?: string | null
}
