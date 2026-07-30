/**
 * Curated forgotten-parts rule set (French automotive practice). Each rule maps
 * operation keywords to the complementary items commonly required. Base
 * confidences reflect how strongly the item is associated (manufacturer-mandated
 * pairings are highest). Extend/override per garage as needed.
 */
import type { RuleDef } from './types'

export const DEFAULT_RULES: RuleDef[] = [
  {
    id: 'brakes',
    match: ['frein', 'plaquette', 'disque', 'etrier', 'étrier'],
    recommends: [
      {
        name: 'Liquide de frein',
        category: 'consumable',
        baseConfidence: 0.7,
        qty: 1,
        reason: 'Purge du circuit conseillée lors de toute intervention sur le freinage.',
      },
      {
        name: "Capteur d'usure de plaquettes",
        category: 'wear',
        baseConfidence: 0.5,
        qty: 1,
        reason: 'Souvent à remplacer avec les plaquettes lorsque le véhicule en est équipé.',
      },
    ],
  },
  {
    id: 'timing_belt',
    match: ['distribution', 'courroie de distribution'],
    recommends: [
      {
        name: 'Pompe à eau',
        category: 'manufacturer',
        baseConfidence: 0.85,
        qty: 1,
        reason: 'Remplacement conjoint recommandé par le constructeur (accès et durée de vie alignés).',
      },
      {
        name: 'Galet tendeur',
        category: 'manufacturer',
        baseConfidence: 0.8,
        qty: 1,
        reason: 'Inclus dans le kit de distribution préconisé par le constructeur.',
      },
      {
        name: 'Liquide de refroidissement',
        category: 'consumable',
        baseConfidence: 0.7,
        qty: 1,
        reason: 'Vidange nécessaire après dépose de la pompe à eau.',
      },
    ],
  },
  {
    id: 'clutch',
    match: ['embrayage'],
    recommends: [
      {
        name: "Butée d'embrayage",
        category: 'wear',
        baseConfidence: 0.85,
        qty: 1,
        reason: "La butée se remplace systématiquement avec le mécanisme et le disque d'embrayage.",
      },
    ],
  },
  {
    id: 'oil_change',
    match: ['vidange', 'huile'],
    recommends: [
      {
        name: 'Filtre à huile',
        category: 'consumable',
        baseConfidence: 0.9,
        qty: 1,
        reason: 'À remplacer systématiquement à chaque vidange.',
      },
      {
        name: 'Joint de bouchon de vidange',
        category: 'consumable',
        baseConfidence: 0.7,
        qty: 1,
        reason: "Le joint d'étanchéité se remplace à chaque dépose du bouchon.",
      },
    ],
  },
  {
    id: 'tires',
    match: ['pneu', 'pneumatique'],
    recommends: [
      {
        name: 'Valves',
        category: 'consumable',
        baseConfidence: 0.7,
        qty: 4,
        reason: 'Les valves se remplacent au montage de pneus neufs.',
      },
      {
        name: 'Équilibrage',
        category: 'consumable',
        baseConfidence: 0.6,
        qty: 4,
        reason: 'Équilibrage requis après montage de pneus neufs.',
      },
    ],
  },
  {
    id: 'shock_absorbers',
    match: ['amortisseur', 'suspension'],
    recommends: [
      {
        name: "Coupelles d'amortisseur",
        category: 'wear',
        baseConfidence: 0.7,
        qty: 2,
        reason: "Les coupelles et butées se remplacent avec les amortisseurs.",
      },
    ],
  },
  {
    id: 'accessory_belt',
    match: ['courroie accessoire', 'accessoire'],
    recommends: [
      {
        name: 'Galet enrouleur',
        category: 'wear',
        baseConfidence: 0.7,
        qty: 1,
        reason: "Le galet enrouleur se remplace avec la courroie d'accessoires.",
      },
    ],
  },
]
