/**
 * Valeurs de marque par DÉFAUT — module PUR (aucune dépendance Node/fs), donc
 * importable côté serveur ET côté client. Source unique des valeurs par défaut,
 * partagée par :
 *  - src/config/brand.ts        (serveur : + Zod + overrides fichier/env)
 *  - src/config/brand.client.ts (client : + overrides NEXT_PUBLIC_*)
 *
 * Ne mettre ici QUE des données littérales (pas de logique, pas de secret).
 */

export interface BrandData {
  productName: string
  shortName: string
  companyName: string
  companyLegalName: string
  tagline: string
  wordmark: { primary: string; secondary: string }
  colors: { primary: string; primaryDark: string; accent: string }
  domains: { marketing: string; app: string; docs: string }
  support: { email: string; phone: string; url: string }
  mail: { fromName: string; fromAddress: string; replyTo: string }
  legal: { entity: string; siren: string; address: string; termsUrl: string; privacyUrl: string; legalNoticeUrl: string }
  assets: { logoLight: string; logoDark: string; favicon: string; windowsIcon: string }
  packaging: { productName: string; appId: string; executableName: string }
  commercial: { email: string; url: string }
}

/** Identité GarageFlow par défaut (validée par le schéma Zod de brand.ts). */
export const DEFAULT_BRAND: BrandData = {
  productName: 'GarageFlow',
  shortName: 'GarageFlow',
  companyName: 'GarageFlow',
  companyLegalName: 'GarageFlow',
  tagline: "Logiciel de gestion et planning d'atelier automobile",
  wordmark: { primary: 'Garage', secondary: 'Flow' },
  colors: { primary: '#2563eb', primaryDark: '#1d4ed8', accent: '#60a5fa' },
  domains: {
    marketing: 'garageflows.fr',
    app: 'app.garageflows.fr',
    docs: 'garageflows.fr/aide',
  },
  support: {
    email: 'support@garageflows.fr',
    phone: '',
    url: 'https://garageflows.fr/aide',
  },
  mail: {
    fromName: 'GarageFlow',
    fromAddress: 'no-reply@garageflows.fr',
    replyTo: 'support@garageflows.fr',
  },
  legal: {
    entity: 'GarageFlow',
    siren: '',
    address: '',
    termsUrl: 'https://garageflows.fr/conditions',
    privacyUrl: 'https://garageflows.fr/rgpd',
    legalNoticeUrl: 'https://garageflows.fr/mentions-legales',
  },
  assets: {
    logoLight: '/icon.png',
    logoDark: '/icon.png',
    favicon: '/favicon.ico',
    windowsIcon: 'icon.ico',
  },
  packaging: {
    productName: 'GarageFlow',
    appId: 'com.garageflow.app',
    executableName: 'GarageFlow',
  },
  commercial: {
    email: 'contact@garageflows.fr',
    url: 'https://garageflows.fr',
  },
}

/** Sous-ensemble d'identité exposable au client (jamais de données sensibles). */
export interface ClientBrand {
  productName: string
  shortName: string
  tagline: string
  wordmark: { primary: string; secondary: string }
  colors: { primary: string; primaryDark: string; accent: string }
  supportUrl: string
  marketingDomain: string
  /** Nom de l'exécutable/installeur Windows (pour l'UI d'aide aux mises à jour). */
  executableName: string
}
